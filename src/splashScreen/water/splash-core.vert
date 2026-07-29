precision highp float;

in float aTheta;
in float aRadial;
in float aSide;
in vec2 aCircle;
in float aLobeStrength;
in float aAngularDrift;
in float aEdgeNoise;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uAge;
uniform float uLayerOffset;
uniform sampler2D uHeightMap;
uniform vec2 uRippleCenter;
uniform vec2 uWaterSize;
uniform float uHeightScale;

out vec3 vWorldPosition;
out vec3 vWorldNormal;
out float vRadial;
out float vTheta;
out float vTurbulence;
out float vSide;
out float vLobeStrength;
out float vShellThickness;
out float vViewDepth;
out float vGeometryMode;

float sampleWaterHeight(vec2 horizontalPosition) {
  vec2 sampleUv = uRippleCenter + vec2(
    horizontalPosition.x / uWaterSize.x,
    -horizontalPosition.y / uWaterSize.y
  );
  float encodedHeight = textureLod(
    uHeightMap,
    clamp(sampleUv, vec2(0.001), vec2(0.999)),
    0.0
  ).r;
  return (encodedHeight - 0.5) / 0.45 * uHeightScale;
}

void main() {
  float radial = clamp(aRadial, 0.0, 1.0);
  float formation = smoothstep(0.0, 0.075, uAge);
  float flightTime = max(uAge - 0.035, 0.0);
  float drift = radial * sqrt(max(radial, 0.0001)) * aAngularDrift;
  float radialTravel = 1.0 - exp(-uAge * 3.15);
  float rimRadius = 0.19 + radialTravel * 0.88 + max(uAge - 0.34, 0.0) * 0.075;
  rimRadius *= aEdgeNoise * mix(0.92, 1.08, aLobeStrength);
  float descent = smoothstep(0.48, 0.94, uAge);
  float sheetWidth = mix(0.13, 0.39, radialTravel) * mix(1.0, 0.62, descent);
  float innerRadius = max(0.075, rimRadius - sheetWidth);
  float outerRadius = rimRadius + mix(0.045, 0.12, formation);
  float edge = smoothstep(0.7, 1.0, radial);
  float radius = mix(innerRadius, outerRadius, radial) + edge * edge * 0.055 * formation;
  radius += sin(aTheta * 5.0 + radial * 8.0 - 0.6) * 0.012 * radial * formation;

  float lobe2 = aLobeStrength * aLobeStrength;
  float lobe4 = lobe2 * lobe2;
  float jetMask = smoothstep(0.76, 1.0, radial);
  float tipJet = lobe4 * jetMask * sqrt(max(jetMask, 0.0001)) * 0.42;
  float outerLaunchSpeed = mix(2.78, 4.65, aLobeStrength) + tipJet;
  float launchSpeed = mix(2.45, outerLaunchSpeed, sqrt(max(radial, 0.0001)));
  float height = 0.018
    + (launchSpeed * flightTime - 4.9 * flightTime * flightTime) * formation;
  height += edge * 0.075 * formation * (1.0 - descent);
  height += sin(aTheta * 8.0 + radial * 9.0 - uAge * 1.3)
    * 0.024 * radial * formation * (1.0 - descent * 0.48);
  height += sin(aTheta * 15.0 - radial * 5.0 + 0.9)
    * 0.009 * edge * formation;

  vec2 tangent = vec2(-aCircle.y, aCircle.x);
  vec2 direction = normalize(aCircle + tangent * drift * mix(0.55, 1.0, formation));
  vec2 horizontalPosition = direction * radius;
  float rootAttachment = 1.0 - smoothstep(0.0, 0.44, radial);
  height = mix(height, sampleWaterHeight(horizontalPosition) - 0.052, rootAttachment);

  float stretch = smoothstep(0.34, 0.92, uAge);
  float shellThickness = mix(0.062, 0.011, smoothstep(0.0, 1.0, radial))
    * mix(1.0, 0.68, stretch);
  float capillaryThickness = edge
    * mix(0.006, 0.025, formation)
    * mix(1.0, 0.72, stretch)
    * mix(0.9, 1.12, aLobeStrength);
  shellThickness += capillaryThickness;
  float radialVelocityGradient = max(outerLaunchSpeed - 2.45, 0.0)
    * mix(0.42, 0.78, sqrt(max(radial, 0.0001)));
  float radialHeightSlope = radialVelocityGradient * flightTime * formation
    / max(sheetWidth, 0.09);
  radialHeightSlope += edge * formation * (1.0 - descent) * 0.24;
  radialHeightSlope = clamp(radialHeightSlope, 0.12, 3.4);
  vec3 localNormal = normalize(vec3(
    -direction.x * radialHeightSlope,
    1.0,
    -direction.y * radialHeightSlope
  ));
  vec3 localPosition = vec3(horizontalPosition.x, height, horizontalPosition.y);
  localPosition += localNormal * (aSide * shellThickness * 0.5 + uLayerOffset);

  vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
  vec4 viewPosition = viewMatrix * worldPosition;
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal) * aSide;
  vRadial = radial;
  vTheta = aTheta;
  vTurbulence = sin(aTheta * 17.0 + radial * 23.0 + uAge * 8.0);
  vSide = aSide;
  vLobeStrength = aLobeStrength;
  vShellThickness = shellThickness;
  vViewDepth = -viewPosition.z;
  vGeometryMode = 0.0;
  gl_Position = projectionMatrix * viewPosition;
}
