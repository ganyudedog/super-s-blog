precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uState;
uniform float uFoamGain;

vec2 sampleState(vec2 uv) {
  ivec2 dimensions = textureSize(uState, 0);
  ivec2 maximum = dimensions - ivec2(1);
  vec2 pixel = clamp(uv, vec2(0.0), vec2(1.0))
    * vec2(dimensions) - 0.5;
  ivec2 base = ivec2(floor(pixel));
  vec2 blend = fract(pixel);
  vec2 bottomLeft = texelFetch(uState, clamp(base, ivec2(0), maximum), 0).rg;
  vec2 bottomRight = texelFetch(
    uState,
    clamp(base + ivec2(1, 0), ivec2(0), maximum),
    0
  ).rg;
  vec2 topLeft = texelFetch(
    uState,
    clamp(base + ivec2(0, 1), ivec2(0), maximum),
    0
  ).rg;
  vec2 topRight = texelFetch(
    uState,
    clamp(base + ivec2(1), ivec2(0), maximum),
    0
  ).rg;
  return mix(
    mix(bottomLeft, bottomRight, blend.x),
    mix(topLeft, topRight, blend.x),
    blend.y
  );
}

void main() {
  // The simulation already applies an isotropic 3x3 blur. One manual
  // bilinear lookup is enough here to hide the low-resolution state grid.
  vec2 densityLayers = sampleState(vUv);
  float core = densityLayers.r;
  float halo = densityLayers.g;
  float density = clamp(core * 0.68 + halo * 0.86, 0.0, 1.0);
  float body = smoothstep(0.012, 0.24, density);
  float coreMask = smoothstep(0.14, 0.76, core);
  float haloMask = smoothstep(0.008, 0.34, halo);
  float alpha = clamp(
    body * 0.16 + haloMask * 0.24 + coreMask * 0.16,
    0.0,
    0.62
  ) * uFoamGain;

  vec3 lowDensityColor = vec3(0.18, 0.54, 0.84);
  vec3 highDensityColor = vec3(0.82, 0.96, 1.0);
  vec3 fogColor = mix(
    lowDensityColor,
    highDensityColor,
    clamp(coreMask * 0.42 + body * 0.34, 0.0, 1.0)
  );
  outColor = vec4(fogColor, alpha);
}
