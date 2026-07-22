precision highp float;

in vec3 position;
in float aTheta;
in float aRadial;
in float aSide;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uAge;
uniform float uLayerOffset;

out vec3 vWorldPosition;
out vec3 vWorldNormal;
out float vRadial;
out float vTheta;
out float vTurbulence;
out float vSide;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

vec3 waterTongue(float theta, float radial) {
  float phase = clamp(uAge / 1.08, 0.0, 1.0);
  float rise = smoothstep(0.0, 0.3, phase);
  float expand = smoothstep(0.02, 0.68, phase);
  float collapse = smoothstep(0.58, 1.0, phase);

  vec2 circle = vec2(cos(theta), sin(theta));
  float broadNoise = noise2D(circle * 2.35 + vec2(1.7, -0.8));
  float fineNoise = noise2D(circle * 5.4 + vec2(-2.1, 3.4) + phase * 0.18);
  float directionalBias = 0.5 + 0.5 * dot(circle, normalize(vec2(0.31, 0.95)));
  float dominantJet = pow(max(0.0, dot(circle, normalize(vec2(-0.78, 0.37)))), 5.0);
  float secondaryJet = pow(max(0.0, dot(circle, normalize(vec2(0.43, -0.9)))), 8.0);
  float angularField = broadNoise * 0.43
    + fineNoise * 0.2
    + directionalBias * 0.1
    + dominantJet * 0.34
    + secondaryJet * 0.11;
  float lobes = mix(0.12, 1.38, smoothstep(0.24, 0.76, angularField));
  float edgeNoise = 1.0
    + 0.045 * sin(11.0 * theta + phase * 8.0)
    + 0.022 * sin(23.0 * theta - phase * 13.0);

  float outerRadius = mix(0.18, 0.48, expand)
    * edgeNoise * mix(0.78, 1.15, lobes / 1.38);
  float radius = mix(0.075, outerRadius, radial);
  float edge = smoothstep(0.7, 1.0, radial);
  radius += edge * edge * 0.11 * rise * (1.0 - collapse);

  float height = (0.035 + 0.46 * rise * (1.0 - collapse))
    * pow(radial, 1.18) * lobes;
  height -= edge * edge * 0.1 * rise * (1.0 - collapse);
  height -= 0.38 * collapse;

  return vec3(
    cos(theta) * radius,
    height,
    sin(theta) * radius * 1.8
  );
}

void main() {
  float thetaStep = 0.006;
  float radialStep = 0.004;
  vec3 localPosition = waterTongue(aTheta, aRadial);
  vec3 thetaPosition = waterTongue(aTheta + thetaStep, aRadial);
  vec3 radialPosition = waterTongue(aTheta, aRadial + radialStep);
  vec3 localNormal = normalize(cross(
    thetaPosition - localPosition,
    radialPosition - localPosition
  ));
  float shellThickness = mix(0.042, 0.005, smoothstep(0.0, 1.0, aRadial));
  localPosition += localNormal * (aSide * shellThickness * 0.5 + uLayerOffset);
  localNormal *= aSide;

  vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vRadial = aRadial;
  vTheta = aTheta;
  vTurbulence = sin(aTheta * 17.0 + aRadial * 23.0 + uAge * 8.0);
  vSide = aSide;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
