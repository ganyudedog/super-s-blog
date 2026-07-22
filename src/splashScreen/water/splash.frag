precision highp float;

uniform vec3 cameraPosition;
uniform vec3 uLightPosition;
uniform vec3 uWaterColor;
uniform float uTime;
uniform float uAge;
uniform sampler2D uSceneTexture;
uniform sampler2D uEnvironmentMap;
uniform vec2 uResolution;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vRadial;
in float vTheta;
in float vTurbulence;

out vec4 outColor;

vec2 environmentUv(vec3 direction) {
  float longitude = atan(direction.z, direction.x);
  float latitude = asin(clamp(direction.y, -1.0, 1.0));
  return vec2(longitude / 6.2831853 + 0.5, latitude / 3.1415927 + 0.5);
}

void main() {
  float normalLayerA = sin(vTheta * 31.0 - uTime * 6.2 + vRadial * 19.0);
  float normalLayerB = sin(vTheta * 53.0 + uTime * 8.5 - vRadial * 37.0);
  vec3 azimuth = normalize(vec3(-sin(vTheta), 0.0, cos(vTheta)));
  vec3 radialDirection = normalize(vec3(cos(vTheta), 0.0, sin(vTheta)));
  vec3 normal = normalize(
    vWorldNormal
    + azimuth * normalLayerA * 0.12
    + radialDirection * normalLayerB * 0.08
  );

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);
  float lightDistance = length(uLightPosition - vWorldPosition);
  float attenuation = 1.0 / (1.0 + 0.018 * lightDistance * lightDistance);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  float specular = pow(max(dot(normal, halfDirection), 0.0), 48.0);
  float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);

  float phase = clamp(uAge / 1.08, 0.0, 1.0);
  float edge = smoothstep(0.62, 1.0, vRadial);
  float thickness = 1.0 - smoothstep(0.08, 1.0, vRadial);
  float flowDistortion = 0.5 + 0.5 * sin(
    vTheta * 21.0 - uTime * 4.8 + vRadial * 29.0 + vTurbulence
  );
  float breakup = smoothstep(0.52, 0.9, phase) * edge;
  float breakupPattern = 0.5 + 0.5 * sin(vTheta * 13.0 + sin(vTheta * 7.0) - uTime * 3.0);
  if (breakup * breakupPattern > 0.88) {
    discard;
  }

  vec2 screenUv = gl_FragCoord.xy / uResolution;
  vec2 refractionOffset = vec2(normal.x, normal.z * 0.55 + normal.y * 0.18)
    * mix(0.006, 0.024, thickness) * (0.72 + flowDistortion * 0.56);
  vec3 refractedBackground = texture(
    uSceneTexture,
    clamp(screenUv + refractionOffset, vec2(0.002), vec2(0.998))
  ).rgb;

  float filmThickness = mix(0.055, 0.72, thickness)
    * (0.88 + flowDistortion * 0.28);
  float opticalPath = filmThickness / max(abs(dot(normal, viewDirection)), 0.2);
  vec3 transmittance = exp(-vec3(1.12, 0.34, 0.13) * opticalPath);
  vec3 absorbedWater = refractedBackground * transmittance
    + uWaterColor * (1.0 - transmittance);

  vec3 reflectionDirection = reflect(-viewDirection, normal);
  vec3 environmentReflection = textureLod(
    uEnvironmentMap,
    environmentUv(reflectionDirection),
    2.4 + flowDistortion * 1.2
  ).rgb;

  vec3 color = mix(absorbedWater, environmentReflection, 0.12 + fresnel * 0.66);
  color *= 0.82 + diffuse * 0.18;
  color += vec3(0.34, 0.62, 0.82) * specular * attenuation * 0.42;

  float lifeFade = 1.0 - smoothstep(0.82, 1.0, phase);
  float alpha = mix(0.92, 0.5, edge);
  outColor = vec4(color, clamp(alpha * lifeFade, 0.0, 0.96));
}
