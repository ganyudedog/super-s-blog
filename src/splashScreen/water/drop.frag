precision highp float;

uniform sampler2D uSceneTexture;
uniform vec2 uResolution;
uniform float uTime;

in vec2 vUv;
in vec3 vViewNormal;

out vec4 outColor;

vec3 sampleRefractedBackground(vec2 sampleUv, vec2 blurStep) {
  vec3 color = texture(uSceneTexture, sampleUv).rgb * 0.52;
  color += texture(
    uSceneTexture,
    clamp(sampleUv + blurStep, vec2(0.003), vec2(0.997))
  ).rgb * 0.12;
  color += texture(
    uSceneTexture,
    clamp(sampleUv - blurStep, vec2(0.003), vec2(0.997))
  ).rgb * 0.12;
  color += texture(
    uSceneTexture,
    clamp(sampleUv + vec2(blurStep.x, -blurStep.y), vec2(0.003), vec2(0.997))
  ).rgb * 0.12;
  color += texture(
    uSceneTexture,
    clamp(sampleUv + vec2(-blurStep.x, blurStep.y), vec2(0.003), vec2(0.997))
  ).rgb * 0.12;
  return color;
}

void main() {
  vec3 opticalNormal = normalize(vViewNormal);
  float facing = clamp(abs(opticalNormal.z), 0.0, 1.0);
  float opticalThickness = pow(facing, 0.58);
  vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
  vec2 refractionOffset = opticalNormal.xy
    * mix(0.003, 0.014, opticalThickness);
  vec2 refractedUv = clamp(
    screenUv + refractionOffset,
    vec2(0.003),
    vec2(0.997)
  );
  vec2 blurStep = vec2(1.0) / max(uResolution, vec2(1.0));
  blurStep *= mix(1.1, 2.6, opticalThickness);
  vec3 refracted = sampleRefractedBackground(refractedUv, blurStep);

  float fresnel = pow(1.0 - facing, 3.2);
  float rim = smoothstep(0.05, 0.72, fresnel);
  vec3 viewLightDirection = normalize(vec3(-0.52, 0.62, 0.58));
  float keyHighlight = pow(
    max(dot(opticalNormal, viewLightDirection), 0.0),
    28.0
  );
  vec2 lowerDelta = (vUv - vec2(0.57, 0.2)) * vec2(0.9, 2.1);
  float lowerCaustic = exp(-dot(lowerDelta, lowerDelta) * 17.0);
  float shimmer = 0.95 + 0.05 * sin(uTime * 4.2);

  vec3 color = refracted * mix(0.985, 1.025, opticalThickness);
  color += vec3(0.82, 0.94, 1.0)
    * (fresnel * 0.34 + rim * 0.11 + keyHighlight * 0.45 * shimmer);
  color += vec3(0.46, 0.72, 0.9)
    * lowerCaustic * opticalThickness * 0.1;

  float alpha = mix(0.9, 0.98, rim + keyHighlight * 0.3);
  outColor = vec4(color, alpha);
}
