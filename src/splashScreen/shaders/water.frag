precision mediump float;

varying vec2 vUV;
uniform float uTime;
uniform vec2 uRippleCenters[8];
uniform float uRippleTimes[8];
uniform int uRippleCount;
uniform vec3 uLightPos;
uniform vec2 uResolution;

// === SIMPLEX 3D NOISE ===
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3  ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float heightField(vec2 uv, float time) {
  float h = 0.0;
  h += snoise(vec3(uv * 4.0, time * 0.15)) * 0.012;
  h += snoise(vec3(uv * 7.0 + 3.2, time * 0.25)) * 0.007;
  h += snoise(vec3(uv * 14.0 - 1.8, time * 0.35)) * 0.004;

  for (int i = 0; i < 8; i++) {
    if (i >= uRippleCount) break;
    float elapsed = time - uRippleTimes[i];
    if (elapsed < 0.0 || elapsed > 4.0) continue;
    float dist = length(uv - uRippleCenters[i]);
    float front = elapsed * 0.55;
    float wave = sin((dist - front) * 80.0) * exp(-abs(dist - front) * 4.0);
    float amp = 0.08 * exp(-elapsed * 0.7);
    float centerFade = smoothstep(0.0, 0.08, dist);
    h += wave * amp * centerFade;
  }
  return h;
}

void main() {
  vec2 uv = vUV;
  float eps = 1.0 / uResolution.x;

  float h0 = heightField(uv, uTime);
  float hR = heightField(uv + vec2(eps, 0.0), uTime);
  float hU = heightField(uv + vec2(0.0, eps), uTime);

  vec3 normal = normalize(vec3((h0 - hR) * 20.0, (h0 - hU) * 20.0, 1.0));
  vec3 lightDir = normalize(uLightPos);

  float NdotL = max(dot(normal, lightDir), 0.0);
  float spec = pow(max(dot(normal, normalize(lightDir + vec3(0.0, 0.0, 1.0))), 0.0), 100.0);
  float fresnel = pow(1.0 - abs(normal.z), 3.0) * 0.35;

  vec3 deep  = vec3(0.01, 0.03, 0.12);
  vec3 surf  = vec3(0.04, 0.09, 0.24);
  vec3 rim   = vec3(0.2, 0.3, 0.55);
  vec3 specC = vec3(0.5, 0.6, 1.0);

  vec3 color = mix(deep, surf, NdotL * 0.6 + 0.4);
  color += spec * specC * 0.5;
  color += fresnel * rim;

  float vignette = 1.0 - length(uv - 0.5) * 0.3;
  color *= vignette;

  gl_FragColor = vec4(color, 1.0);
}
