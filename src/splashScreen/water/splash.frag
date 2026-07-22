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
uniform sampler2D uFrontDepthMap;
uniform sampler2D uBackDepthMap;
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

vec3 sampleEnvironment(vec3 direction, float lod) {
  return textureLod(uEnvironmentMap, environmentUv(normalize(direction)), lod).rgb;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float flowNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

void main() {
  if (vWorldPosition.y < uWaterLevel) {
    discard;
  }
  vec2 circleCoordinate = vec2(cos(vTheta), sin(vTheta));
  vec2 flowCoordinateA = circleCoordinate * (3.2 + vRadial * 1.7)
    + vec2(vRadial * 4.1 - uAge * 0.74, vRadial * 1.8 + uAge * 0.31);
  vec2 flowCoordinateB = circleCoordinate.yx * (6.1 + vRadial * 2.5)
    + vec2(-vRadial * 7.2 + uAge * 0.46, vRadial * 4.7 - uAge * 0.58);
  float normalLayerA = flowNoise(flowCoordinateA) * 2.0 - 1.0;
  float normalLayerB = flowNoise(flowCoordinateB) * 2.0 - 1.0;
  vec3 azimuth = normalize(vec3(-sin(vTheta), 0.0, cos(vTheta)));
  vec3 radialDirection = normalize(vec3(cos(vTheta), 0.0, sin(vTheta)));
  vec3 normal = normalize(
    vWorldNormal
    + azimuth * normalLayerA * mix(0.052, 0.092, vRadial)
    + radialDirection * normalLayerB * mix(0.038, 0.068, vRadial)
  );

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float lightDistance = length(uLightPosition - vWorldPosition);
  float attenuation = 1.0 / (1.0 + 0.018 * lightDistance * lightDistance);
  if (!gl_FrontFacing) {
    normal = -normal;
  }
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float normalView = clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - normalView, 5.0);

  float phase = clamp(uAge / 1.32, 0.0, 1.0);
  float edge = smoothstep(0.62, 1.0, vRadial);
  float heightGradient = smoothstep(uWaterLevel, uWaterLevel + 0.82, vWorldPosition.y);
  float flowDistortion = 0.5 + 0.5 * sin(
    vTheta * 17.0 - uAge * 3.4 + vRadial * 19.0 + vTurbulence * 0.35
  );
  float roughness = clamp(
    0.24 + edge * 0.13 + (1.0 - flowDistortion) * 0.1
      + smoothstep(0.42, 0.82, phase) * 0.08,
    0.22,
    0.56
  );
  float outerTongue = smoothstep(0.48, 0.82, vRadial);
  float gapPhase = smoothstep(0.5, 0.72, phase);
  if (outerTongue * gapPhase > 0.58 && vLobeStrength < 0.07) {
    discard;
  }
  float breakup = smoothstep(0.58, 0.88, phase) * edge;
  float breakupPattern = 0.5 + 0.5 * sin(vTheta * 13.0 + sin(vTheta * 7.0));
  if (breakup * breakupPattern > 0.92) discard;

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float frontDepth = texture(uFrontDepthMap, screenUv).r;
  float backDepth = texture(uBackDepthMap, screenUv).r;
  float bufferedPath = clamp(backDepth - frontDepth, 0.0, 0.22);
  float hasBufferedThickness = step(0.0001, frontDepth)
    * step(frontDepth + 0.0005, backDepth)
    * (1.0 - step(0.5, vGeometryMode));
  float analyticPath = vShellThickness / max(normalView, 0.14);
  float opticalPath = mix(analyticPath, bufferedPath, hasBufferedThickness);
  float rivuletField = 0.5 + 0.5 * sin(
    vTheta * 10.0 + vRadial * 13.0
      + normalLayerA * 2.8 - normalLayerB * 1.9
  );
  float rivulet = smoothstep(0.66, 0.91, rivuletField)
    * smoothstep(0.12, 0.62, vRadial);
  opticalPath *= mix(0.88, 1.24, rivulet);
  float perceivedThickness = 1.0 - exp(-opticalPath * 13.0);
  vec3 viewNormal = normalize(mat3(viewMatrix) * normal);
  vec2 screenNormal = viewNormal.xy;
  vec2 screenTangent = normalize(vec2(-screenNormal.y, screenNormal.x) + vec2(0.0001));
  float bendStrength = mix(0.009, 0.044, perceivedThickness)
    * mix(0.82, 1.28, flowDistortion);
  vec2 refractionOffset = screenNormal * bendStrength;
  refractionOffset += screenTangent
    * sin(vTheta * 23.0 + vRadial * 17.0 - uAge * 4.2)
    * roughness * 0.0038;
  refractionOffset *= mix(0.72, 1.0, step(0.0, vSide));

  vec2 refractedUv = clamp(screenUv + refractionOffset, vec2(0.003), vec2(0.997));
  vec2 dispersion = refractionOffset * 0.085;
  vec3 refractedSharp = vec3(
    texture(uSceneTexture, clamp(refractedUv + dispersion, vec2(0.003), vec2(0.997))).r,
    texture(uSceneTexture, refractedUv).g,
    texture(uSceneTexture, clamp(refractedUv - dispersion, vec2(0.003), vec2(0.997))).b
  );
  vec2 blurOffset = screenTangent * mix(0.0012, 0.0042, roughness);
  vec3 refractedBlur = (
    texture(uSceneTexture, clamp(refractedUv + blurOffset, vec2(0.003), vec2(0.997))).rgb
    + texture(uSceneTexture, clamp(refractedUv - blurOffset, vec2(0.003), vec2(0.997))).rgb
  ) * 0.5;
  vec3 refractedBackground = mix(refractedSharp, refractedBlur, roughness * 0.48);
  vec3 undistortedBackground = texture(uSceneTexture, screenUv).rgb;
  refractedBackground = clamp(
    undistortedBackground + (refractedBackground - undistortedBackground) * 1.28,
    vec3(0.0),
    vec3(1.0)
  );

  vec3 transmittance = exp(-vec3(3.7, 1.05, 0.25) * opticalPath * 2.15);
  vec3 waterTint = mix(
    uWaterColor,
    uTipWaterColor,
    0.36 + heightGradient * 0.18 + perceivedThickness * 0.22
  );
  waterTint = mix(uDeepWaterColor, waterTint, 0.82 + heightGradient * 0.12);
  vec3 absorbedWater = refractedBackground * transmittance
    + waterTint * (1.0 - transmittance);
  float volumeScattering = perceivedThickness * (1.0 - transmittance.r);
  absorbedWater = mix(absorbedWater, waterTint, volumeScattering * 0.28);
  absorbedWater += uTipWaterColor * volumeScattering * 0.075;

  vec3 reflectionDirection = reflect(-viewDirection, normal);
  float reflectionLod = 1.7 + roughness * 4.6;
  vec3 environmentReflection = sampleEnvironment(reflectionDirection, reflectionLod);
  environmentReflection += sampleEnvironment(
    reflectionDirection + azimuth * roughness * 0.13,
    reflectionLod + 0.45
  );
  environmentReflection += sampleEnvironment(
    reflectionDirection - radialDirection * roughness * 0.11,
    reflectionLod + 0.45
  );
  environmentReflection /= 3.0;
  environmentReflection = environmentReflection * 1.18 + vec3(0.008, 0.024, 0.044);

  float specularPower = mix(92.0, 28.0, roughness);
  float specular = pow(max(dot(normal, halfDirection), 0.0), specularPower);
  float reflectionWeight = clamp(0.035 + fresnel * (0.82 - roughness * 0.22), 0.03, 0.82);
  vec3 color = mix(absorbedWater, environmentReflection, reflectionWeight);
  color *= 0.94 + diffuse * 0.08;
  color += mix(environmentReflection, uTipWaterColor, 0.2)
    * specular * attenuation * mix(0.26, 0.48, 1.0 - roughness);
  color += uTipWaterColor * edge * fresnel * 0.08;
  float liquidEdge = pow(fresnel, 0.72)
    * mix(0.75, 1.2, step(0.5, vGeometryMode));
  color += uTipWaterColor * liquidEdge
    * (0.055 + perceivedThickness * 0.085);
  color += mix(uWaterColor, uTipWaterColor, 0.72)
    * rivulet * perceivedThickness * 0.065;
  color = max(color, waterTint * (0.14 + perceivedThickness * 0.34));
  color *= mix(0.9, 1.0, step(0.0, vSide));

  float lifeFade = 1.0 - smoothstep(0.78, 1.0, phase);
  float compositeCoverage = mix(0.84, 0.98, perceivedThickness);
  compositeCoverage *= mix(0.7, 1.0, step(0.0, vSide));
  outColor = vec4(color, clamp(compositeCoverage * lifeFade, 0.0, 0.98));
}
