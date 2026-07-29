precision highp float;

uniform vec3 cameraPosition;
uniform mat4 viewMatrix;
uniform vec3 uLightPosition;
uniform vec3 uWaterColor;
uniform vec3 uDeepWaterColor;
uniform vec3 uTipWaterColor;
uniform float uTime;
uniform float uAge;
uniform sampler2D uSceneTexture;
uniform vec2 uResolution;
uniform float uWaterLevel;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vRadial;
in float vTheta;
in float vLobeStrength;
in float vShellThickness;
in float vSide;

out vec4 outColor;

void main() {
  if (vWorldPosition.y < uWaterLevel) discard;

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 geometryNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
  if (dot(geometryNormal, viewDirection) < 0.0) geometryNormal = -geometryNormal;
  vec3 guideNormal = normalize(vWorldNormal);
  if (dot(guideNormal, viewDirection) < 0.0) guideNormal = -guideNormal;

  vec3 azimuth = normalize(vec3(-sin(vTheta), 0.0, cos(vTheta)));
  vec3 radialDirection = normalize(vec3(cos(vTheta), 0.12, sin(vTheta)));
  float flowA = sin(vTheta * 13.0 + vRadial * 18.0 - uTime * 3.2);
  float flowB = sin(vTheta * 21.0 - vRadial * 11.0 + uTime * 2.35);
  vec3 normal = normalize(
    mix(geometryNormal, guideNormal, 0.82)
    + azimuth * flowA * mix(0.014, 0.038, vRadial)
    + radialDirection * flowB * mix(0.01, 0.026, vRadial)
  );

  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float normalView = clamp(dot(normal, viewDirection), 0.0, 1.0);
  float fresnelBase = 1.0 - normalView;
  float fresnel2 = fresnelBase * fresnelBase;
  float fresnel = 0.025 + 0.975 * fresnel2 * fresnel2 * fresnelBase;

  vec3 viewNormal = normalize(mat3(viewMatrix) * normal);
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float opticalDepth = clamp(
    vShellThickness / max(normalView, 0.22) * 13.0,
    0.0,
    1.0
  );
  vec2 screenTangent = normalize(vec2(-viewNormal.y, viewNormal.x) + vec2(0.0001));
  vec2 refractionOffset = viewNormal.xy * mix(0.0035, 0.019, opticalDepth);
  refractionOffset += screenTangent * flowA * 0.0014 * vRadial;
  vec2 refractedUv = clamp(
    screenUv + refractionOffset,
    vec2(0.003),
    vec2(0.997)
  );
  vec3 backgroundSharp = texture(uSceneTexture, refractedUv).rgb;
  vec3 backgroundSoft = texture(
    uSceneTexture,
    clamp(refractedUv + screenTangent * 0.0018, vec2(0.003), vec2(0.997))
  ).rgb;
  vec3 background = mix(backgroundSharp, backgroundSoft, opticalDepth * 0.22);
  float interiorLayer = smoothstep(0.2, -0.2, vSide);

  float edge = smoothstep(0.62, 1.0, vRadial);
  float heightGradient = smoothstep(uWaterLevel, uWaterLevel + 0.82, vWorldPosition.y);
  vec3 waterTint = mix(uWaterColor, uTipWaterColor, 0.2 + heightGradient * 0.28);
  waterTint = mix(waterTint, uDeepWaterColor, (1.0 - heightGradient) * 0.08);
  vec3 transmittance = exp(-vec3(1.55, 0.44, 0.14) * opticalDepth * 0.5);
  vec3 color = background * transmittance
    + waterTint * (1.0 - transmittance) * 0.68;
  color += uTipWaterColor * opticalDepth * 0.055;
  vec3 interiorTransmission = mix(background, waterTint, 0.16 + opticalDepth * 0.12);
  color = mix(color, interiorTransmission + uTipWaterColor * 0.045, interiorLayer * 0.42);

  float halfLight = max(dot(normal, halfDirection), 0.0);
  float spec2 = halfLight * halfLight;
  float spec4 = spec2 * spec2;
  float spec8 = spec4 * spec4;
  float spec16 = spec8 * spec8;
  float spec64 = spec16 * spec16 * spec16 * spec16;
  float broadSpecular = spec8;
  float foamPattern = 0.52
    + 0.3 * sin(vTheta * 11.0 - uTime * 1.7)
    + 0.18 * sin(vTheta * 23.0 + vRadial * 7.0 + uTime * 1.1);
  float foam = edge * smoothstep(0.48, 0.7, foamPattern)
    * smoothstep(0.035, 0.18, uAge)
    * (1.0 - smoothstep(0.68, 1.08, uAge));
  float aeratedRim = edge * (0.34 + foam * 0.66);
  float capillaryEdge = smoothstep(0.88, 0.985, vRadial)
    * (0.72 + 0.28 * sin(vTheta * 17.0 + flowB * 0.45));
  float rootMeniscus = (1.0 - smoothstep(0.025, 0.16, vRadial))
    * (0.72 + 0.28 * sin(vTheta * 9.0 - flowA * 0.35));
  float filmPattern = 0.5 + flowA * 0.26 + flowB * 0.24;
  float filmGlint = smoothstep(0.7, 0.94, filmPattern)
    * (0.28 + edge * 0.72)
    * (0.48 + vLobeStrength * 0.52);
  float lobeHighlight = edge * smoothstep(0.35, 0.9, vLobeStrength);
  float silhouette = pow(fresnelBase, 1.6) * (0.42 + edge * 0.58);
  color += uTipWaterColor * (
    spec64 * 0.82
    + spec16 * 0.24
    + broadSpecular * 0.065
    + fresnel * 0.2
    + silhouette * 0.24
    + lobeHighlight * 0.08
  );
  color += uTipWaterColor * (
    0.055
    + heightGradient * 0.055
    + aeratedRim * 0.24
    + capillaryEdge * (0.22 + lobeHighlight * 0.14)
    + rootMeniscus * (0.08 + fresnel * 0.1)
    + filmGlint * 0.13
  );
  color = mix(
    color,
    vec3(0.76, 0.92, 0.98),
    clamp(aeratedRim * 0.52 + capillaryEdge * 0.3, 0.0, 0.76)
  );

  float lifeFade = 1.0 - smoothstep(1.0, 1.32, uAge);
  float coverage = 0.52
    + opticalDepth * 0.24
    + fresnel * 0.2
    + aeratedRim * 0.14
    + capillaryEdge * 0.09
    + rootMeniscus * 0.045;
  coverage *= mix(1.0, 0.26, interiorLayer);
  outColor = vec4(color, clamp(coverage * lifeFade, 0.0, 0.94));
}
