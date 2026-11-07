precision highp float;

const int MAX_RADIUS = 12;

uniform sampler2D uDepth;
uniform vec2 uDirection;
// Smoothing radius in world units; converted to pixels per fragment.
uniform float uWorldRadius;
uniform float uPixelScale;
// Depth difference (world units) beyond which neighbours stop blending.
uniform float uDepthFalloff;
uniform float uEmptyDepth;

out vec4 outColor;

// Separable bilateral filter over the nearest-particle depth: it merges the
// spheres into one continuous liquid surface without bleeding across gaps.
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  float centerDepth = texelFetch(uDepth, pixel, 0).r;
  if (centerDepth >= uEmptyDepth) {
    outColor = vec4(uEmptyDepth);
    return;
  }
  float radius = clamp(uWorldRadius * uPixelScale / centerDepth, 1.0, float(MAX_RADIUS));
  int reach = int(radius);
  float inverseSigmaSquared = 2.0 / (radius * radius);
  ivec2 lastPixel = textureSize(uDepth, 0) - 1;
  ivec2 direction = ivec2(uDirection);
  float depthSum = 0.0;
  float weightSum = 0.0;
  for (int offset = -reach; offset <= reach; offset += 1) {
    float distance = float(offset);
    float sampleDepth = texelFetch(
      uDepth,
      clamp(pixel + direction * offset, ivec2(0), lastPixel),
      0
    ).r;
    if (sampleDepth >= uEmptyDepth) continue;
    float range = (sampleDepth - centerDepth) / uDepthFalloff;
    float weight = exp(-distance * distance * inverseSigmaSquared - range * range);
    depthSum += sampleDepth * weight;
    weightSum += weight;
  }
  outColor = vec4(depthSum / max(weightSum, 1e-5));
}
