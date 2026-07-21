precision highp float;

uniform vec3 cameraPosition;
uniform vec3 uLightPosition;
uniform vec3 uDeepColor;
uniform vec3 uSurfaceColor;
uniform float uTime;
uniform sampler2D uHeightMap;
uniform vec2 uHeightTexel;
uniform float uHeightScale;

in vec2 vUv;
in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vSlope;
in float vRippleCrest;

out vec4 outColor;

float decodeHeight(vec2 sampleUv) {
  return (texture(uHeightMap, sampleUv).r - 0.5) / 0.45 * uHeightScale;
}

void main() {
  // Sample the animated height map per fragment for fine wind-driven normals.
  vec2 normalStep = uHeightTexel * 5.5;
  float heightX = decodeHeight(vUv + vec2(normalStep.x, 0.0))
    - decodeHeight(vUv - vec2(normalStep.x, 0.0));
  float heightZ = decodeHeight(vUv + vec2(0.0, normalStep.y))
    - decodeHeight(vUv - vec2(0.0, normalStep.y));
  vec3 normalMap = vec3(-heightX * 15.0, 0.0, -heightZ * 15.0);
  vec3 normal = normalize(vWorldNormal + normalMap);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float lightDistance = length(uLightPosition - vWorldPosition);
  float attenuation = 1.0 / (1.0 + 0.016 * lightDistance * lightDistance);

  float diffuse = max(dot(normal, lightDirection), 0.0);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 96.0);
  float broadSpecular = pow(max(dot(normal, halfDirection), 0.0), 18.0);
  float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 4.0);

  vec3 reflected = reflect(-viewDirection, normal);
  float skyReflection = smoothstep(-0.2, 0.75, reflected.y);
  vec3 nightSky = mix(vec3(0.012, 0.035, 0.075), vec3(0.055, 0.14, 0.28), skyReflection);

  float depthGradient = smoothstep(0.0, 1.0, vUv.y);
  vec3 water = mix(uDeepColor, uSurfaceColor, 0.28 + diffuse * 0.22 + depthGradient * 0.14);
  water = mix(water, nightSky, 0.18 + fresnel * 0.32);
  water += vec3(0.52, 0.7, 0.9) * specular * attenuation * 0.8;
  water += vec3(0.08, 0.2, 0.38) * broadSpecular * attenuation * 0.18;
  float windGlint = pow(max(dot(normal, halfDirection), 0.0), 42.0);
  water += vec3(0.16, 0.42, 0.7) * windGlint * attenuation * 0.28;
  float windRelief = clamp(length(normalMap.xz) * 3.8, 0.0, 1.0);
  float windBands = 0.5 + 0.5 * sin(vUv.x * 30.0 + vUv.y * 3.2 + uTime * 1.25);
  water += vec3(0.018, 0.052, 0.105) * windRelief * (0.35 + windBands * 0.65);
  water += vec3(0.012, 0.032, 0.066) * smoothstep(0.12, 0.5, windRelief);
  water += vec3(0.07, 0.2, 0.36) * smoothstep(0.02, 0.28, vSlope) * 0.25;
  water += vec3(0.012, 0.03, 0.065);
  water += vec3(0.2, 0.48, 0.78) * smoothstep(0.04, 0.62, vRippleCrest) * 0.42;

  float horizonFade = smoothstep(0.0, 0.14, vUv.y);
  water *= 0.78 + horizonFade * 0.22;

  outColor = vec4(water, 1.0);
}
