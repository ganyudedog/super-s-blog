precision highp float;

in vec2 vUv;

out vec4 outColor;

uniform float uTime;
uniform float uRippleAge;
uniform float uRippleAge2;
uniform float uImpactStrength;
uniform vec2 uRippleCenter;
uniform vec2 uRippleCenter2;
uniform float uImpactStrength2;

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec2 fade(vec2 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float perlin(vec2 p) {
  vec4 pi = floor(p.xyxy) + vec4(0.0, 0.0, 1.0, 1.0);
  vec4 pf = fract(p.xyxy) - vec4(0.0, 0.0, 1.0, 1.0);
  pi = mod289(pi);
  vec4 ix = pi.xzxz;
  vec4 iy = pi.yyww;
  vec4 fx = pf.xzxz;
  vec4 fy = pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(
    dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)
  ));
  g00 *= norm.x;
  g01 *= norm.y;
  g10 *= norm.z;
  g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fadeXY = fade(pf.xy);
  vec2 nx = mix(vec2(n00, n01), vec2(n10, n11), fadeXY.x);
  return 2.3 * mix(nx.x, nx.y, fadeXY.y);
}

float waterHeight(vec2 uv) {
  // Positive phase movement makes the visible wave travel toward -X.
  vec2 surfaceScale = vec2(4.2, 1.3);
  vec2 flow = vec2(uTime * 0.105, -uTime * 0.018);
  float base = perlin(uv * vec2(4.5, 6.0) * surfaceScale + flow) * 0.02;
  base += perlin(uv * vec2(9.0, 12.0) * surfaceScale - flow * 1.7) * 0.009;
  base += perlin(uv * vec2(19.0, 24.0) * surfaceScale + flow * 2.2) * 0.005;

  // Directional wind bands move toward -X and deform the surface itself.
  float windNoise = perlin(uv * vec2(8.0, 18.0) * surfaceScale + flow * 0.8);
  float windWave = sin(uv.x * 30.0 * surfaceScale.x
    + uv.y * 3.2 * surfaceScale.y + uTime * 1.25 + windNoise * 1.8);
  float windEnvelope = 0.45 + 0.55 * smoothstep(0.0, 0.9, uv.y);
  base += windWave * 0.007 * windEnvelope;

  // Smaller streaks provide the normal-map detail responsible for the shimmer.
  float windStreak = sin(uv.x * 78.0 * surfaceScale.x
    + uv.y * 8.0 * surfaceScale.y + uTime * 2.9 + windNoise * 2.5);
  base += windStreak * 0.0035 * (0.55 + 0.45 * smoothstep(0.0, 1.0, uv.y));

  if (uRippleAge < 0.0 && uRippleAge2 < 0.0) {
    return base;
  }

  float ripple = 0.0;
  if (uRippleAge >= 0.0) {
    // Compensate for the plane depth and camera pitch without collapsing the ring.
    vec2 delta = (uv - uRippleCenter) * vec2(4.2, 1.7);
    float distanceToImpact = length(delta);
    float radius = uRippleAge * 0.28;
    float noiseWarp = perlin(uv * 8.0 + vec2(uTime * 0.08, 0.0));
    float behindFront = radius - distanceToImpact;
    float waveWindow = smoothstep(-0.025, 0.015, behindFront)
      * exp(-max(behindFront, 0.0) * 5.5);
    float rings = sin((distanceToImpact - radius) * 78.0 + noiseWarp * 3.4);
    float leadingRing = exp(-pow((distanceToImpact - radius) * 20.0, 2.0));
    float timeDecay = exp(-uRippleAge * 0.38);
    // The impact pulls a visible cavity below the surface before the rim rebounds.
    float cavity = -exp(-pow(distanceToImpact / 0.105, 2.0))
      * exp(-uRippleAge * 3.2) * 0.3;
    float cavityRim = exp(-pow((distanceToImpact - 0.105) * 24.0, 2.0))
      * exp(-uRippleAge * 2.0) * 0.075;
    float crater = -exp(-distanceToImpact * 30.0) * exp(-uRippleAge * 5.0);

    ripple += cavity + cavityRim
      + (rings * waveWindow * 0.72 + leadingRing * 0.5 + crater * 0.34)
      * 0.13 * timeDecay * uImpactStrength;
  }

  if (uRippleAge2 >= 0.0) {
    vec2 delta2 = (uv - uRippleCenter2) * vec2(4.2, 1.7);
    float distanceToImpact2 = length(delta2);
    float radius2 = uRippleAge2 * 0.28;
    float noiseWarp2 = perlin(uv * 8.0 + vec2(uTime * 0.08, 0.0));
    float behindFront2 = radius2 - distanceToImpact2;
    float waveWindow2 = smoothstep(-0.025, 0.015, behindFront2)
      * exp(-max(behindFront2, 0.0) * 5.5);
    float rings2 = sin((distanceToImpact2 - radius2) * 78.0 + noiseWarp2 * 3.4);
    float leadingRing2 = exp(-pow((distanceToImpact2 - radius2) * 20.0, 2.0));
    ripple += (rings2 * waveWindow2 * 0.72 + leadingRing2 * 0.5)
      * 0.13 * exp(-uRippleAge2 * 0.38) * uImpactStrength2;
  }

  return base + ripple;
}

float rippleCrest(vec2 uv) {
  if (uRippleAge < 0.0 && uRippleAge2 < 0.0) {
    return 0.0;
  }

  float crest = 0.0;
  if (uRippleAge >= 0.0) {
    vec2 delta = (uv - uRippleCenter) * vec2(4.2, 1.7);
    float distanceToImpact = length(delta);
    float radius = uRippleAge * 0.28;
    float noiseWarp = perlin(uv * 8.0 + vec2(uTime * 0.08, 0.0));
    float waveFront = exp(-pow((distanceToImpact - radius) * 20.0, 2.0));
    float irregularity = 0.7 + 0.3 * smoothstep(-1.0, 1.0, noiseWarp);
    crest += waveFront * exp(-uRippleAge * 0.38) * irregularity * uImpactStrength;
  }
  if (uRippleAge2 >= 0.0) {
    vec2 delta2 = (uv - uRippleCenter2) * vec2(4.2, 1.7);
    float distanceToImpact2 = length(delta2);
    float radius2 = uRippleAge2 * 0.28;
    float waveFront2 = exp(-pow((distanceToImpact2 - radius2) * 20.0, 2.0));
    crest += waveFront2 * exp(-uRippleAge2 * 0.38) * uImpactStrength2;
  }
  return min(crest, 1.0);
}

void main() {
  float height = waterHeight(vUv);
  float crest = rippleCrest(vUv);
  float windSignal = 0.5 + 0.5 * sin(
    vUv.x * 126.0 + vUv.y * 4.16 + uTime * 1.25
  );
  outColor = vec4(0.5 + height * 0.45, crest, windSignal, 1.0);
}
