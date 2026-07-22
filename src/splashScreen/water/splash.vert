precision highp float;

in vec3 position;
in float aTheta;
in float aRadial;
in float aSide;
in float aRimAngle;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uAge;
uniform float uLayerOffset;
uniform float uRimMode;
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

float crownPeak(float theta, float center, float width, float strength) {
  float angleDelta = atan(sin(theta - center), cos(theta - center));
  return exp(-pow(angleDelta / width, 2.0)) * strength;
}

float crownLobe(float theta) {
  float profile = 0.0;
  profile = max(profile, crownPeak(theta, 0.38, 0.31, 0.82));
  profile = max(profile, crownPeak(theta, 1.36, 0.37, 0.56));
  profile = max(profile, crownPeak(theta, 2.58, 0.25, 1.0));
  profile = max(profile, crownPeak(theta, 3.35, 0.3, 0.68));
  profile = max(profile, crownPeak(theta, 4.68, 0.27, 0.91));
  profile = max(profile, crownPeak(theta, 5.72, 0.4, 0.61));
  vec2 circle = vec2(cos(theta), sin(theta));
  float irregularity = 0.94 + noise2D(circle * 4.3 + vec2(1.7, -2.1)) * 0.08;
  return clamp(profile * irregularity, 0.0, 1.0);
}

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

vec3 waterTongue(float theta, float radial) {
  float formation = smoothstep(0.0, 0.075, uAge);
  float flightTime = max(uAge - 0.035, 0.0);
  float angularDrift = pow(clamp(radial, 0.0, 1.0), 1.35)
    * (sin(theta * 3.0 + 0.7) * 0.042 + sin(theta * 7.0 - 1.1) * 0.018);
  float lobeStrength = crownLobe(theta + angularDrift);
  float edgeNoise = 1.0
    + 0.026 * sin(9.0 * theta + 0.8)
    + 0.012 * sin(17.0 * theta - 1.1);

  // Horizontal momentum keeps carrying the crown outwards after the apex.
  float radialTravel = 1.0 - exp(-uAge * 3.15);
  float rimRadius = 0.19 + radialTravel * 0.88 + max(uAge - 0.34, 0.0) * 0.075;
  rimRadius *= edgeNoise * mix(0.92, 1.08, lobeStrength);
  float descent = smoothstep(0.48, 0.94, uAge);
  float sheetWidth = mix(0.13, 0.39, radialTravel) * mix(1.0, 0.62, descent);
  float innerRadius = max(0.075, rimRadius - sheetWidth);
  float outerRadius = rimRadius + mix(0.045, 0.12, formation);
  float radius = mix(innerRadius, outerRadius, radial);
  float edge = smoothstep(0.7, 1.0, radial);
  radius += edge * edge * 0.055 * formation;
  radius += sin(theta * 5.0 + radial * 8.0 - 0.6)
    * 0.012 * radial * formation;

  // Each strip follows the same gravity as the falling drop. Different launch
  // speeds make lower, weaker tongues return first instead of shrinking in place.
  float tipJet = pow(lobeStrength, 4.2)
    * pow(smoothstep(0.76, 1.0, radial), 1.35) * 0.42;
  float outerLaunchSpeed = mix(2.78, 4.65, lobeStrength) + tipJet;
  float launchSpeed = mix(
    2.45,
    outerLaunchSpeed,
    pow(clamp(radial, 0.0, 1.0), 0.76)
  );
  float ballisticHeight = launchSpeed * flightTime - 0.5 * 9.8 * flightTime * flightTime;
  float height = 0.018 + ballisticHeight * formation;
  height += edge * 0.075 * formation * (1.0 - descent);
  height += sin(theta * 8.0 + radial * 9.0 - uAge * 1.3)
    * 0.024 * radial * formation * (1.0 - descent * 0.48);
  height += sin(theta * 15.0 - radial * 5.0 + 0.9)
    * 0.009 * edge * formation;

  float surfaceTheta = theta + angularDrift * mix(0.55, 1.0, formation);
  vec2 horizontalPosition = vec2(
    cos(surfaceTheta) * radius,
    sin(surfaceTheta) * radius
  );
  float rootAttachment = 1.0 - smoothstep(0.0, 0.44, radial);
  float attachedHeight = sampleWaterHeight(horizontalPosition) - 0.052;
  height = mix(height, attachedHeight, rootAttachment);

  return vec3(
    horizontalPosition.x,
    height,
    horizontalPosition.y
  );
}

float capillaryRimRadius(float theta) {
  float formation = smoothstep(0.0, 0.12, uAge);
  float stretch = smoothstep(0.3, 0.92, uAge);
  float lobeStrength = crownLobe(theta);
  float beadVariation = 1.0
    + sin(theta * 9.0 + 0.65) * 0.14
    + sin(theta * 17.0 - 1.2) * 0.07;
  float ligamentVariation = mix(
    1.0,
    0.82 + 0.28 * sin(theta * 13.0 + 0.9),
    smoothstep(0.52, 0.86, uAge)
  );
  float radius = mix(0.011, 0.022, formation)
    * mix(1.08, 0.7, stretch)
    * mix(1.08, 0.68, pow(lobeStrength, 1.45))
    * beadVariation * ligamentVariation;
  return clamp(radius, 0.0055, 0.029);
}

vec3 capillaryRim(float theta, float tubeAngle) {
  vec3 center = waterTongue(theta, 1.0);
  vec3 thetaPosition = waterTongue(theta + 0.006, 1.0);
  vec3 innerPosition = waterTongue(theta, 0.975);
  vec3 tangent = normalize(thetaPosition - center);
  vec3 inward = normalize(innerPosition - center);
  vec3 sheetNormal = normalize(cross(tangent, inward));
  float rimRadius = capillaryRimRadius(theta);
  vec3 tubeDirection = inward * cos(tubeAngle) + sheetNormal * sin(tubeAngle);
  return center + tubeDirection * rimRadius;
}

float tipBeadRadius(float theta) {
  float formation = smoothstep(0.1, 0.34, uAge);
  float descent = smoothstep(0.54, 0.9, uAge);
  float variation = 0.86 + 0.14 * sin(theta * 5.7 + 1.2);
  float peakScale = mix(0.74, 1.0, crownLobe(theta));
  return mix(0.012, 0.042, formation)
    * mix(1.0, 0.7, descent) * variation * peakScale;
}

vec3 tipBead(float theta, float polarCoordinate, float azimuthAngle) {
  float beadRadius = tipBeadRadius(theta);
  float polarAngle = clamp(polarCoordinate, 0.0, 1.0) * 3.14159265;
  vec3 sphereDirection = vec3(
    sin(polarAngle) * cos(azimuthAngle) * 0.82,
    cos(polarAngle) * 1.16,
    sin(polarAngle) * sin(azimuthAngle) * 0.82
  );
  float surfaceVariation = 1.0
    + 0.07 * sin(azimuthAngle * 3.0 + theta * 4.0)
      * pow(sin(polarAngle), 2.0);
  vec3 center = waterTongue(theta, 1.0);
  center.y += beadRadius * 0.62;
  return center + sphereDirection * beadRadius * surfaceVariation;
}

float peakLigamentRadius(float theta, float along) {
  float formation = smoothstep(0.035, 0.18, uAge);
  float descent = smoothstep(0.58, 0.96, uAge);
  float taper = mix(0.034, 0.006, pow(clamp(along, 0.0, 1.0), 0.78));
  float liquidBulge = 1.0 + sin(along * 9.0 + theta * 3.7) * 0.09;
  return mix(0.009, taper, formation)
    * mix(1.0, 0.72, descent * along) * liquidBulge;
}

vec3 peakLigament(float theta, float along, float tubeAngle) {
  float pathCoordinate = mix(0.6, 1.0, clamp(along, 0.0, 1.0));
  vec3 center = waterTongue(theta, pathCoordinate);
  vec3 nextCenter = waterTongue(theta, min(pathCoordinate + 0.008, 1.0));
  vec3 angularPosition = waterTongue(theta + 0.006, pathCoordinate);
  vec3 pathTangent = normalize(nextCenter - center + vec3(0.0, 0.0001, 0.0));
  vec3 angularTangent = normalize(angularPosition - center);
  vec3 sheetNormal = normalize(cross(angularTangent, pathTangent));
  center.y += sin(clamp(along, 0.0, 1.0) * 3.14159265)
    * 0.015 * smoothstep(0.06, 0.24, uAge);
  float radius = peakLigamentRadius(theta, along);
  vec3 tubeDirection = angularTangent * cos(tubeAngle)
    + sheetNormal * sin(tubeAngle);
  return center + tubeDirection * radius;
}

float baseCollarRadius(float theta) {
  float formation = smoothstep(0.0, 0.16, uAge);
  float settle = smoothstep(0.62, 0.94, uAge);
  float variation = 0.9
    + 0.12 * sin(theta * 6.0 + 0.4)
    + 0.06 * sin(theta * 13.0 - 0.8);
  return mix(0.011, 0.032, formation) * mix(1.0, 0.32, settle) * variation;
}

vec3 baseCollar(float theta, float tubeAngle) {
  vec3 center = waterTongue(theta, 0.0);
  vec3 thetaPosition = waterTongue(theta + 0.006, 0.0);
  vec3 outerPosition = waterTongue(theta, 0.035);
  vec3 tangent = normalize(thetaPosition - center);
  vec3 outward = normalize(outerPosition - center);
  vec3 sheetNormal = normalize(cross(tangent, outward));
  float collarRadius = baseCollarRadius(theta);
  center.y += 0.004 - smoothstep(0.72, 0.98, uAge) * 0.08;
  vec3 tubeDirection = outward * cos(tubeAngle) + sheetNormal * sin(tubeAngle);
  return center + tubeDirection * collarRadius;
}

void main() {
  float thetaStep = 0.006;
  float radialStep = 0.004;
  float stretch = smoothstep(0.34, 0.92, uAge);
  float shellThickness = mix(0.044, 0.0055, smoothstep(0.0, 1.0, aRadial))
    * mix(1.0, 0.62, stretch);
  vec3 localPosition;
  vec3 localNormal;

  if (uRimMode > 3.5) {
    localPosition = peakLigament(aTheta, aRadial, aRimAngle);
    vec3 pathPosition = peakLigament(aTheta, aRadial + radialStep, aRimAngle);
    vec3 tubePosition = peakLigament(aTheta, aRadial, aRimAngle + 0.018);
    localNormal = normalize(cross(
      pathPosition - localPosition,
      tubePosition - localPosition
    ));
    shellThickness = peakLigamentRadius(aTheta, aRadial) * 2.0;
    localPosition += localNormal * uLayerOffset;
  } else if (uRimMode > 2.5) {
    localPosition = baseCollar(aTheta, aRimAngle);
    vec3 thetaPosition = baseCollar(aTheta + thetaStep, aRimAngle);
    vec3 tubePosition = baseCollar(aTheta, aRimAngle + 0.018);
    localNormal = normalize(cross(
      thetaPosition - localPosition,
      tubePosition - localPosition
    ));
    shellThickness = baseCollarRadius(aTheta) * 2.0;
    localPosition += localNormal * uLayerOffset;
  } else if (uRimMode > 1.5) {
    localPosition = tipBead(aTheta, aRadial, aRimAngle);
    float polarAngle = clamp(aRadial, 0.0, 1.0) * 3.14159265;
    localNormal = normalize(vec3(
      sin(polarAngle) * cos(aRimAngle) / 0.82,
      cos(polarAngle) / 1.16,
      sin(polarAngle) * sin(aRimAngle) / 0.82
    ));
    shellThickness = tipBeadRadius(aTheta) * 2.0;
    localPosition += localNormal * uLayerOffset;
  } else if (uRimMode > 0.5) {
    localPosition = capillaryRim(aTheta, aRimAngle);
    vec3 thetaPosition = capillaryRim(aTheta + thetaStep, aRimAngle);
    vec3 tubePosition = capillaryRim(aTheta, aRimAngle + 0.018);
    localNormal = normalize(cross(
      thetaPosition - localPosition,
      tubePosition - localPosition
    ));
    shellThickness = capillaryRimRadius(aTheta) * 2.0;
    localPosition += localNormal * uLayerOffset;
  } else {
    localPosition = waterTongue(aTheta, aRadial);
    vec3 thetaPosition = waterTongue(aTheta + thetaStep, aRadial);
    vec3 radialPosition = waterTongue(aTheta, aRadial + radialStep);
    localNormal = normalize(cross(
      thetaPosition - localPosition,
      radialPosition - localPosition
    ));
    localPosition += localNormal * (aSide * shellThickness * 0.5 + uLayerOffset);
    localNormal *= aSide;
  }

  vec4 worldPosition = modelMatrix * vec4(localPosition, 1.0);
  vec4 viewPosition = viewMatrix * worldPosition;
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vRadial = mix(aRadial, 1.0, step(0.5, uRimMode));
  vTheta = aTheta;
  vTurbulence = sin(aTheta * 17.0 + aRadial * 23.0 + uAge * 8.0);
  vSide = aSide;
  vLobeStrength = crownLobe(aTheta);
  vShellThickness = shellThickness;
  vViewDepth = -viewPosition.z;
  vGeometryMode = uRimMode;

  gl_Position = projectionMatrix * viewPosition;
}
