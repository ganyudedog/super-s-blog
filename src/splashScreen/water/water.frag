precision highp float;

/*
 * Direct-light response adapted from "Seascape" by Alexander Alekseev
 * (TDM), 2014. CC BY-NC-SA 3.0. Sky color and ray-marched geometry omitted.
 */

uniform vec3 cameraPosition;
uniform vec3 uLightPosition;
uniform vec3 uDistantLightDirection;
uniform vec3 uDeepColor;
uniform vec3 uSurfaceColor;
uniform float uTime;
uniform sampler2D uHeightMap;
uniform vec2 uHeightTexel;
uniform float uHeightScale;
uniform float uRippleAge;
uniform vec2 uRippleCenter;
uniform vec2 uWaterSize;
uniform sampler2D uVideoTexture;
uniform float uVideoReady;
uniform vec2 uVideoUvScale;
uniform vec2 uVideoUvOffset;
uniform vec2 uResolution;
uniform float uRevealProgress;

in vec2 vUv;
in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vSlope;
in float vRippleCrest;
in float vPointerFoam;

out vec4 outColor;

float decodeWindHeight(vec2 sampleUv) {
  return (texture(uHeightMap, sampleUv).a - 0.5) / 0.45 * uHeightScale;
}

float seascapeDiffuse(vec3 normal, vec3 lightDirection, float power) {
  return pow(
    max(dot(normal, lightDirection) * 0.4 + 0.6, 0.0),
    power
  );
}

float seascapeSpecular(
  vec3 normal,
  vec3 lightDirection,
  vec3 eyeDirection,
  float shininess
) {
  float normalization = (shininess + 8.0) / (3.14159265 * 8.0);
  float alignment = max(
    dot(reflect(eyeDirection, normal), lightDirection),
    0.0
  );
  return pow(alignment, shininess) * normalization;
}

void main() {
  // Seascape widens its normal epsilon with distance. Applying the same idea
  // to the existing height field removes far-field aliasing without changing
  // the actual mesh or the video refraction.
  float viewDistance = length(cameraPosition - vWorldPosition);
  float normalRadius = mix(
    1.15,
    2.9,
    smoothstep(12.0, 105.0, viewDistance)
  );
  vec2 normalStep = uHeightTexel * normalRadius;
  float heightRight = decodeWindHeight(vUv + vec2(normalStep.x, 0.0));
  float heightLeft = decodeWindHeight(vUv - vec2(normalStep.x, 0.0));
  float heightUp = decodeWindHeight(vUv + vec2(0.0, normalStep.y));
  float heightDown = decodeWindHeight(vUv - vec2(0.0, normalStep.y));
  float heightUpRight = decodeWindHeight(vUv + normalStep);
  float heightUpLeft = decodeWindHeight(vUv + vec2(-normalStep.x, normalStep.y));
  float heightDownRight = decodeWindHeight(vUv + vec2(normalStep.x, -normalStep.y));
  float heightDownLeft = decodeWindHeight(vUv - normalStep);
  float heightX = (heightRight - heightLeft) * 0.6
    + (heightUpRight + heightDownRight - heightUpLeft - heightDownLeft) * 0.2;
  float heightZ = (heightUp - heightDown) * 0.6
    + (heightUpRight + heightUpLeft - heightDownRight - heightDownLeft) * 0.2;
  vec3 normalMap = vec3(-heightX * 38.0, 0.0, -heightZ * 38.0);
  vec3 normal = normalize(vec3(normalMap.x, 1.0, normalMap.z));
  float windSignal = texture(uHeightMap, vUv).b;
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 eyeDirection = -viewDirection;
  vec3 pointLightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 distantLightDirection = normalize(uDistantLightDirection);
  vec3 extendedLightDirection = normalize(mix(
    distantLightDirection,
    vec3(0.0, 1.0, 0.0),
    0.36
  ));
  float lightDistance = length(uLightPosition - vWorldPosition);
  float pointAttenuation = 1.0 / (
    1.0 + 0.016 * lightDistance * lightDistance
  );
  float diffuse = seascapeDiffuse(normal, extendedLightDirection, 4.0);
  float fresnel = clamp(1.0 - dot(normal, viewDirection), 0.0, 1.0);
  fresnel = min(fresnel * fresnel * fresnel, 0.5);

  float depthGradient = smoothstep(0.0, 1.0, vUv.y);
  vec3 water = mix(
    uDeepColor,
    uSurfaceColor,
    0.28 + diffuse * 0.06 + depthGradient * 0.14
  );
  water *= 1.0 - fresnel * 0.08;
  if (uRippleAge >= 0.0) {
    vec2 cavityDelta = (vUv - uRippleCenter) * uWaterSize;
    float cavityMask = exp(-pow(length(cavityDelta) / 0.62, 2.0))
      * exp(-uRippleAge * 3.2);
    water *= 1.0 - cavityMask * 0.42;
  }

  // The same DOM video is sampled through the water surface. This is
  // transmission/refraction rather than a mirrored reflection pass.
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  vec2 videoUv = screenUv * uVideoUvScale + uVideoUvOffset;
  float distortionStrength = mix(0.0025, 0.009, clamp(windSignal, 0.0, 1.0));
  vec2 videoDistortion = vec2(normalMap.x, -normalMap.z) * distortionStrength;
  videoDistortion += vec2(
    sin(vUv.y * 84.0 + uTime * 0.72),
    cos(vUv.x * 76.0 - uTime * 0.54)
  ) * 0.0014;
  vec2 refractedUv = clamp(videoUv + videoDistortion, vec2(0.002), vec2(0.998));
  vec2 blurDirection = normalize(vec2(0.72, 0.34) + normalMap.xz * 0.05) * 0.0018;
  vec3 videoColor = texture(uVideoTexture, refractedUv).rgb * 0.58;
  videoColor += texture(
    uVideoTexture,
    clamp(refractedUv + blurDirection, vec2(0.002), vec2(0.998))
  ).rgb * 0.21;
  videoColor += texture(
    uVideoTexture,
    clamp(refractedUv - blurDirection, vec2(0.002), vec2(0.998))
  ).rgb * 0.21;
  float videoLuma = dot(videoColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 desaturatedVideo = mix(vec3(videoLuma), videoColor, 0.82);
  vec3 submergedVideo = desaturatedVideo * vec3(0.72, 0.94, 1.08);
  float transmissionHighlightCompression = 1.0 / (
    1.0 + max(videoLuma - 0.24, 0.0) * 0.65
  );
  submergedVideo *= transmissionHighlightCompression;
  float waterDepth = smoothstep(0.015, 0.28, vUv.y);
  float irregularRange = smoothstep(
    0.28,
    0.76,
    windSignal * 0.62 + clamp(vSlope, 0.0, 1.0) * 0.24
      + 0.14 * sin(vUv.x * 31.0 + vUv.y * 17.0 + uTime * 0.22)
  );
  submergedVideo = mix(
    submergedVideo,
    mix(uDeepColor, uSurfaceColor, 0.68),
    0.1 + waterDepth * 0.14
  );
  float transmission = uRevealProgress * uVideoReady
    * mix(0.58, 0.78, irregularRange)
    * smoothstep(0.0, 0.12, vUv.y);
  water = mix(water, submergedVideo, transmission);

  // Seascape-style direct lighting: every term is continuous. There is no sky
  // sample, random normal texture, or thresholded glint mask to pixelate.
  float facetStrength = clamp(length(normalMap.xz) * 3.0, 0.0, 1.0);
  float farField = smoothstep(0.28, 0.9, vUv.y);
  float distanceBalance = mix(0.96, 1.28, farField);
  float surfaceDiffuse = seascapeDiffuse(
    normal,
    extendedLightDirection,
    5.0
  );
  float crestDiffuse = seascapeDiffuse(
    normal,
    extendedLightDirection,
    28.0
  );
  float broadReflection = seascapeSpecular(
    normal,
    extendedLightDirection,
    eyeDirection,
    12.0
  );
  float fineReflection = seascapeSpecular(
    normal,
    extendedLightDirection,
    eyeDirection,
    48.0
  );
  float localBroad = seascapeSpecular(
    normal,
    pointLightDirection,
    eyeDirection,
    9.0
  );
  float localFine = seascapeSpecular(
    normal,
    pointLightDirection,
    eyeDirection,
    38.0
  );
  float stableLocalReflection = seascapeSpecular(
    vec3(0.0, 1.0, 0.0),
    pointLightDirection,
    eyeDirection,
    10.0
  );
  float directReflection = surfaceDiffuse * (0.11 + facetStrength * 0.08)
    + crestDiffuse * 0.38
    + broadReflection * 0.36
    + fineReflection * 0.08;
  float localReflection = 1.0 - exp(
    -(localBroad * 0.88 + localFine * 0.2 + stableLocalReflection * 0.62)
  );
  vec3 directLightColor = vec3(0.3, 0.58, 0.9);
  water += directLightColor
    * directReflection
    * distanceBalance
    * (0.82 + fresnel * 0.55);
  water += vec3(0.42, 0.68, 0.9)
    * localReflection
    * (0.14 + pointAttenuation * 0.86)
    * 0.72;
  float windRelief = clamp(length(normalMap.xz) * 3.8, 0.0, 1.0);
  float windRibbon = smoothstep(0.52, 0.92, windSignal);
  water += vec3(0.018, 0.052, 0.105) * windRelief * (0.28 + windRibbon * 0.72);
  water += vec3(0.009, 0.024, 0.05) * (0.3 + windSignal * 0.7);
  water += vec3(0.012, 0.032, 0.066) * smoothstep(0.12, 0.5, windRelief);
  water += vec3(0.07, 0.2, 0.36) * smoothstep(0.02, 0.28, vSlope) * 0.25;
  water += vec3(0.012, 0.03, 0.065);
  float rippleHighlight = smoothstep(0.05, 0.62, vRippleCrest);
  water += vec3(0.2, 0.43, 0.68) * rippleHighlight * 0.1;

  float horizonFade = smoothstep(0.0, 0.14, vUv.y);
  water *= 0.78 + horizonFade * 0.22;

  outColor = vec4(water, 1.0);
}
