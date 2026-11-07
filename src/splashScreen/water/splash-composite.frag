precision highp float;

uniform sampler2D uDepth;
// r: liquid thickness along the view ray, g: aerated part of it.
uniform sampler2D uThickness;
// The water surface rendered this frame, seen through the liquid.
uniform sampler2D uBackground;
uniform sampler2D uEnvironment;
uniform vec2 uResolution;
// projectionMatrix[0][0] and projectionMatrix[1][1].
uniform vec2 uProjectionScale;
uniform mat3 uViewToWorld;
uniform vec3 uLightViewPosition;
uniform vec3 uLightColor;
uniform vec3 uWaterTint;
uniform float uEmptyDepth;
// Depth step (world units) that separates two surfaces rather than one slope.
uniform float uDepthDiscontinuity;

out vec4 outColor;

float depthAt(ivec2 pixel) {
  return texelFetch(uDepth, clamp(pixel, ivec2(0), ivec2(uResolution) - 1), 0).r;
}

vec3 viewPositionAt(ivec2 pixel, float depth) {
  vec2 ndc = (vec2(pixel) + 0.5) / uResolution * 2.0 - 1.0;
  return vec3(ndc / uProjectionScale * depth, -depth);
}

// One-sided difference that stays on the same surface at silhouettes; a
// droplet with no neighbour on its own surface falls back to facing the eye.
vec3 surfaceTangent(vec3 center, ivec2 pixel, ivec2 step) {
  float forwardDepth = depthAt(pixel + step);
  float backwardDepth = depthAt(pixel - step);
  vec3 forward = viewPositionAt(pixel + step, forwardDepth) - center;
  vec3 backward = center - viewPositionAt(pixel - step, backwardDepth);
  bool forwardValid = abs(forwardDepth + center.z) < uDepthDiscontinuity;
  bool backwardValid = abs(backwardDepth + center.z) < uDepthDiscontinuity;
  if (forwardValid && (!backwardValid || abs(forward.z) <= abs(backward.z))) return forward;
  if (backwardValid) return backward;
  return viewPositionAt(pixel + step, -center.z) - center;
}

vec2 environmentUv(vec3 direction) {
  float longitude = atan(direction.z, direction.x);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  return vec2(longitude / 6.2831853 + 0.5, latitude / 3.1415927 + 0.5);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  float depth = depthAt(pixel);
  if (depth >= uEmptyDepth) discard;

  vec3 position = viewPositionAt(pixel, depth);
  vec3 normal = normalize(cross(
    surfaceTangent(position, pixel, ivec2(1, 0)),
    surfaceTangent(position, pixel, ivec2(0, 1))
  ));
  vec3 viewDirection = normalize(-position);
  if (dot(normal, viewDirection) < 0.0) normal = -normal;

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 texel = 1.0 / uResolution;
  vec2 thickness = 0.25 * (
    texture(uThickness, screenUv + vec2(-0.75, -0.75) * texel).rg
    + texture(uThickness, screenUv + vec2(0.75, -0.75) * texel).rg
    + texture(uThickness, screenUv + vec2(-0.75, 0.75) * texel).rg
    + texture(uThickness, screenUv + vec2(0.75, 0.75) * texel).rg
  );
  float liquidThickness = thickness.r;
  float aeration = clamp(thickness.g / max(thickness.r, 1e-4), 0.0, 1.0);

  float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);

  // Curved liquid acts as a lens over the water behind it; thicker parts bend
  // and absorb more, so sheets stay clear while jets and drops read as volume.
  vec2 refractionOffset = normal.xy * (0.004 + min(liquidThickness, 0.35) * 0.05);
  vec3 background = texture(
    uBackground,
    clamp(screenUv - refractionOffset, vec2(0.002), vec2(0.998))
  ).rgb;
  vec3 absorption = exp(-vec3(1.6, 0.6, 0.4) * liquidThickness);
  // Thin sheets also scatter some of the light they carry towards the eye.
  vec3 transmitted = background * absorption
    + uWaterTint * (1.0 - absorption)
    + uLightColor * 0.06 * smoothstep(0.0, 0.15, liquidThickness);

  vec3 reflectedDirection = uViewToWorld * reflect(-viewDirection, normal);
  vec3 environment = textureLod(uEnvironment, environmentUv(reflectedDirection), 1.0).rgb * 1.6;

  vec3 lightDirection = normalize(uLightViewPosition - position);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float alignment = max(dot(normal, halfDirection), 0.0);
  float glint = pow(alignment, 360.0) * 5.0 + pow(alignment, 48.0) * 0.5 + pow(alignment, 12.0) * 0.08;
  float diffuseLight = max(dot(normal, lightDirection), 0.0);

  vec3 color = mix(transmitted, environment, fresnel);
  // Curved rims see light from many directions and stay bright.
  color += environment * pow(1.0 - facing, 2.0) * 0.35;
  color += uLightColor * glint;
  vec3 whiteWater = uLightColor * (0.22 + 0.38 * diffuseLight) + uWaterTint * 0.4;
  color = mix(color, whiteWater, aeration * smoothstep(0.02, 0.18, liquidThickness) * 0.6);

  float coverage = smoothstep(0.004, 0.03, liquidThickness);
  outColor = vec4(color, coverage);
}
