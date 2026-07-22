precision highp float;

uniform vec3 uLightPosition;
uniform float uTime;
uniform float uAge;

in vec3 vWorldPosition;
in vec3 vWorldNormal;
in float vRadial;
in float vTheta;
in float vTurbulence;
in float vSide;

out vec4 outColor;

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

void main() {
  if (vSide < 0.0) {
    discard;
  }
  float phase = clamp(uAge / 1.08, 0.0, 1.0);
  float edge = smoothstep(0.58, 1.0, vRadial);
  float curlBand = smoothstep(0.42, 0.78, vRadial)
    * (1.0 - smoothstep(0.86, 1.0, vRadial));

  vec2 circle = vec2(cos(vTheta), sin(vTheta));
  vec2 flowCoordinate = circle * (1.45 + vRadial * 0.9)
    + vec2(uTime * 0.42, -uTime * 0.34);
  float flowA = noise2D(flowCoordinate);
  float flowB = noise2D(flowCoordinate * 1.83 + vec2(-uTime * 0.26, uTime * 0.38));
  float breakup = smoothstep(0.42, 0.86, phase);
  float breakupNoise = noise2D(circle * 4.8 + vec2(uTime * 0.52, -uTime * 0.68));

  float edgeFoam = edge * smoothstep(0.56, 0.72, flowA * 0.62 + flowB * 0.38);
  float curlFoam = curlBand * smoothstep(0.62, 0.78, flowB);
  float brokenFoam = breakup * edge * smoothstep(0.58, 0.74, breakupNoise);
  float mask = max(edgeFoam, max(curlFoam * 0.72, brokenFoam));
  if (mask < 0.28) {
    discard;
  }

  vec3 normal = normalize(vWorldNormal);
  vec3 lightDirection = normalize(uLightPosition - vWorldPosition);
  float diffuse = max(dot(normal, lightDirection), 0.0);
  vec3 foamColor = mix(
    vec3(0.32, 0.56, 0.68),
    vec3(0.62, 0.78, 0.86),
    0.42 + diffuse * 0.34
  );
  foamColor *= 0.78 + mask * 0.22;

  float lifeFade = 1.0 - smoothstep(0.82, 1.0, phase);
  outColor = vec4(foamColor, clamp(mask * 0.42 * lifeFade, 0.0, 0.4));
}
