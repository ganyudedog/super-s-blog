precision highp float;

uniform vec3 cameraPosition;
uniform vec3 uLightPosition;
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

float decodeHeight(vec2 sampleUv) {
  return (texture(uHeightMap, sampleUv).r - 0.5) / 0.45 * uHeightScale;
}

void main() {
  // Sample the animated height map per fragment for fine wind-driven normals.
  vec2 normalStep = uHeightTexel * 1.25;
  float heightX = decodeHeight(vUv + vec2(normalStep.x, 0.0))
    - decodeHeight(vUv - vec2(normalStep.x, 0.0));
  float heightZ = decodeHeight(vUv + vec2(0.0, normalStep.y))
    - decodeHeight(vUv - vec2(0.0, normalStep.y));
  vec3 normalMap = vec3(-heightX * 28.0, 0.0, -heightZ * 28.0);
  vec3 normal = normalize(vWorldNormal + normalMap);
  float windSignal = texture(uHeightMap, vUv).b;
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float lightDistance = length(uLightPosition - vWorldPosition);
  float attenuation = 1.0 / (1.0 + 0.016 * lightDistance * lightDistance);

  float diffuse = max(dot(normal, lightDirection), 0.0);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 96.0);
  // The dominant reflection uses a fixed horizontal normal, so wind cannot drag it around.
  vec3 stableNormal = vec3(0.0, 1.0, 0.0);
  float stableReflection = pow(max(dot(stableNormal, halfDirection), 0.0), 30.0);
  float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.0);

  vec3 reflected = reflect(-viewDirection, normal);
  float skyReflection = smoothstep(-0.2, 0.75, reflected.y);
  vec3 nightSky = mix(vec3(0.012, 0.035, 0.075), vec3(0.055, 0.14, 0.28), skyReflection);

  float depthGradient = smoothstep(0.0, 1.0, vUv.y);
  vec3 water = mix(uDeepColor, uSurfaceColor, 0.28 + diffuse * 0.22 + depthGradient * 0.14);
  water = mix(water, nightSky, 0.18 + fresnel * 0.32);
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
    * mix(0.62, 0.84, irregularRange)
    * smoothstep(0.0, 0.12, vUv.y);
  water = mix(water, submergedVideo, transmission);

  water += vec3(0.52, 0.7, 0.9) * specular * attenuation * 0.015;
  float reflectionShimmer = 0.94 + 0.06 * windSignal;
  water += vec3(0.22, 0.48, 0.76)
    * stableReflection * attenuation * reflectionShimmer * 0.92;
  float windGlint = pow(max(dot(normal, halfDirection), 0.0), 42.0);
  water += vec3(0.16, 0.42, 0.7) * windGlint * attenuation * 0.012;
  float windRelief = clamp(length(normalMap.xz) * 3.8, 0.0, 1.0);
  float windRibbon = smoothstep(0.52, 0.92, windSignal);
  water += vec3(0.018, 0.052, 0.105) * windRelief * (0.28 + windRibbon * 0.72);
  water += vec3(0.009, 0.024, 0.05) * (0.3 + windSignal * 0.7);
  water += vec3(0.012, 0.032, 0.066) * smoothstep(0.12, 0.5, windRelief);
  water += vec3(0.07, 0.2, 0.36) * smoothstep(0.02, 0.28, vSlope) * 0.25;
  water += vec3(0.012, 0.03, 0.065);
  float rippleHighlight = smoothstep(0.05, 0.62, vRippleCrest);
  water += vec3(0.28, 0.58, 0.86) * rippleHighlight * 0.38;

  float horizonFade = smoothstep(0.0, 0.14, vUv.y);
  water *= 0.78 + horizonFade * 0.22;

  outColor = vec4(water, 1.0);
}
