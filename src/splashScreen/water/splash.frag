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
uniform sampler2D uEnvironmentMap;
uniform vec2 uResolution;
uniform float uWaterLevel;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vRadial;
in float vTheta;
in float vTurbulence;
in float vSide;
in float vLobeStrength;
in float vShellThickness;
in float vGeometryMode;

out vec4 outColor;

vec2 environmentUv(vec3 direction) {
  float longitude = atan(direction.z, direction.x);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  return vec2(longitude / 6.2831853 + 0.5, latitude / 3.1415927 + 0.5);
}

void main() {
  if (vWorldPosition.y < uWaterLevel) discard;

  float phase = clamp(uAge / 1.32, 0.0, 1.0);
  float edge = smoothstep(0.58, 1.0, vRadial);
  float heightGradient = smoothstep(uWaterLevel, uWaterLevel + 0.82, vWorldPosition.y);
  float breakup = smoothstep(0.72, 0.96, phase) * edge;
  float breakupPattern = 0.5 + 0.5 * sin(vTheta * 13.0 + sin(vTheta * 7.0));
  if (breakup * breakupPattern > 0.92 || (breakup > 0.62 && vLobeStrength < 0.07)) discard;

  vec3 azimuth = normalize(vec3(-sin(vTheta), 0.0, cos(vTheta)));
  vec3 radialDirection = normalize(vec3(cos(vTheta), 0.0, sin(vTheta)));
  float flowA = sin(vTheta * 11.0 + vRadial * 17.0 - uTime * 2.8 + vTurbulence * 0.2);
  float flowB = sin(vTheta * 19.0 - vRadial * 9.0 + uTime * 1.9);
  vec3 normal = normalize(
    vWorldNormal
    + azimuth * flowA * mix(0.032, 0.072, vRadial)
    + radialDirection * flowB * mix(0.026, 0.054, vRadial)
  );
  if (!gl_FrontFacing) normal = -normal;

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightVector = uLightPosition - vWorldPosition;
  float lightDistance = length(lightVector);
  vec3 lightDirection = lightVector / max(lightDistance, 0.001);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float attenuation = 1.0 / (1.0 + 0.006 * lightDistance * lightDistance);
  float normalView = clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float backDiffuse = max(dot(-normal, lightDirection), 0.0);
  float liquidDiffuse = max(diffuse, backDiffuse * 0.62);
  float fresnel = 0.025 + 0.975 * pow(1.0 - normalView, 5.0);

  float opticalPath = vShellThickness / max(normalView, 0.14);
  opticalPath *= mix(1.2, 0.82, step(0.5, vGeometryMode));
  float rivulet = 0.5 + 0.5 * sin(vTheta * 10.0 + vRadial * 15.0 + flowA * 1.8);
  opticalPath *= mix(0.88, 1.2, smoothstep(0.62, 0.9, rivulet));
  float perceivedThickness = 1.0 - exp(-opticalPath * 16.0);

  vec3 viewNormal = normalize(mat3(viewMatrix) * normal);
  vec2 screenNormal = viewNormal.xy;
  vec2 screenTangent = normalize(vec2(-screenNormal.y, screenNormal.x) + vec2(0.0001));
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 refractionOffset = screenNormal * mix(0.006, 0.035, perceivedThickness);
  refractionOffset += screenTangent * flowB * 0.0022;
  vec2 refractedUv = clamp(screenUv + refractionOffset, vec2(0.003), vec2(0.997));
  vec3 refractedSharp = texture(uSceneTexture, refractedUv).rgb;
  vec3 refractedSoft = texture(
    uSceneTexture,
    clamp(refractedUv + screenTangent * 0.0025, vec2(0.003), vec2(0.997))
  ).rgb;
  vec3 refractedBackground = mix(refractedSharp, refractedSoft, 0.28 + perceivedThickness * 0.18);

  vec3 transmittance = exp(-vec3(4.4, 1.28, 0.32) * opticalPath * 2.2);
  vec3 waterTint = mix(uDeepWaterColor, uWaterColor, 0.7 + heightGradient * 0.18);
  waterTint = mix(waterTint, uTipWaterColor, edge * 0.28 + heightGradient * 0.11);
  vec3 transmitted = refractedBackground * transmittance
    + waterTint * (1.0 - transmittance);
  float volumeScattering = perceivedThickness * (1.0 - transmittance.r);
  transmitted = mix(transmitted, uDeepWaterColor, perceivedThickness * 0.14);
  transmitted += mix(uWaterColor, uTipWaterColor, 0.58)
    * perceivedThickness * 0.2;
  transmitted += uTipWaterColor * volumeScattering * 0.2;

  vec3 reflectionDirection = reflect(-viewDirection, normal);
  vec3 reflection = textureLod(
    uEnvironmentMap,
    environmentUv(reflectionDirection),
    2.0 + perceivedThickness * 1.6
  ).rgb;
  vec3 reflectionSoft = textureLod(
    uEnvironmentMap,
    environmentUv(reflectionDirection + azimuth * 0.06),
    3.0
  ).rgb;
  reflection = mix(reflection, reflectionSoft, 0.32) * 1.2;

  float reflectionWeight = clamp(0.045 + fresnel * 0.78, 0.04, 0.82);
  vec3 color = mix(transmitted, reflection, reflectionWeight);
  float sharpSpecular = pow(max(dot(normal, halfDirection), 0.0), 72.0);
  float broadSpecular = pow(max(dot(normal, halfDirection), 0.0), 18.0);
  float liquidRim = pow(1.0 - normalView, 1.45);
  color *= 0.94 + liquidDiffuse * attenuation * 0.18;
  color += uTipWaterColor
    * (sharpSpecular * 0.58 + broadSpecular * 0.16)
    * attenuation;
  color += uTipWaterColor
    * (0.035 + liquidRim * 0.24 + fresnel * edge * 0.2 + volumeScattering * 0.1);

  float lifeFade = 1.0 - smoothstep(0.76, 1.0, phase);
  float coverage = mix(0.88, 0.995, perceivedThickness);
  coverage *= mix(0.74, 1.0, step(0.0, vSide));
  outColor = vec4(color, clamp(coverage * lifeFade, 0.0, 0.98));
}
