precision highp float;

in vec2 vUv;

out vec4 outColor;

uniform float uTime;
uniform float uRippleAge;
uniform float uRippleAge2;
uniform float uImpactStrength;
uniform vec2 uRippleCenter;
uniform vec2 uWaterSize;
uniform float uImpactStrength2;
uniform vec2 uWindDirection;
uniform float uWindSpeed;
uniform sampler2D uWaveState;
const int POINTER_RIPPLE_COUNT = 12;
uniform vec4 uPointerRipples[POINTER_RIPPLE_COUNT];
uniform vec2 uPointerDirections[POINTER_RIPPLE_COUNT];

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

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
  return vec2(
    hash21(p + vec2(17.17, 3.11)),
    hash21(p + vec2(7.13, 29.71))
  );
}

float microWaveField(vec2 flowPosition, out float microSignal) {
  vec2 gridPosition = flowPosition / 3.1;
  vec2 baseCell = floor(gridPosition);
  vec2 localPosition = fract(gridPosition);
  float height = 0.0;
  microSignal = 0.0;

  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      vec2 offset = vec2(float(x), float(y));
      vec2 cell = baseCell + offset;
      vec2 center = offset + hash22(cell);
      vec2 delta = localPosition - center;
      delta = vec2(delta.x * 0.72, delta.y * 1.28);
      float distanceToCenter = length(delta);
      float cycleRate = mix(0.17, 0.31, hash21(cell + vec2(41.3, 9.2)));
      float cycle = fract(uTime * cycleRate + hash21(cell + vec2(5.4, 63.1)));
      float radius = mix(0.06, 0.78, cycle);
      float frontDistance = distanceToCenter - radius;
      float life = smoothstep(0.0, 0.13, cycle)
        * (1.0 - smoothstep(0.58, 1.0, cycle));
      float spatialFade = 1.0 - smoothstep(0.22, 1.08, distanceToCenter);
      float ring = cos(frontDistance * 25.0)
        * exp(-abs(frontDistance) * 8.0) * life * spatialFade;
      height += ring;
      microSignal += abs(ring) * 0.48;
    }
  }

  microSignal = clamp(microSignal, 0.0, 1.0);
  return height * 0.002;
}

vec2 impactDelta(vec2 uv) {
  return (uv - uRippleCenter) * uWaterSize;
}

float pointerWakeField(vec2 uv, out float foam) {
  float height = 0.0;
  foam = 0.0;

  for (int index = 0; index < POINTER_RIPPLE_COUNT; index += 1) {
    vec4 ripple = uPointerRipples[index];
    float age = uTime - ripple.z;
    if (age < 0.0 || age > 0.96 || ripple.w <= 0.0) continue;

    vec2 delta = (uv - ripple.xy) * uWaterSize;
    vec2 direction = normalize(uPointerDirections[index]);
    vec2 sideDirection = vec2(-direction.y, direction.x);
    float along = dot(delta, direction);
    float across = dot(delta, sideDirection);
    float wakeLength = mix(2.6, 3.8, clamp(ripple.w, 0.0, 1.0));
    float trailEnvelope = smoothstep(-wakeLength - 0.72, -wakeLength, along)
      * (1.0 - smoothstep(0.18, 0.62, along));
    float fadeIn = smoothstep(0.0, 0.045, age);
    float grooveLife = fadeIn * (1.0 - smoothstep(0.5, 0.9, age)) * ripple.w;
    float backflowLife = smoothstep(0.3, 0.5, age)
      * (1.0 - smoothstep(0.72, 0.96, age)) * ripple.w;
    float grooveWidth = mix(1.12, 1.46, clamp(ripple.w, 0.0, 1.0));
    float groove = exp(-pow(across / grooveWidth, 2.0)) * trailEnvelope;
    float ridgeOffset = grooveWidth * 1.18;
    float sideRidges = exp(-pow((abs(across) - ridgeOffset) / 0.62, 2.0))
      * trailEnvelope;
    float bowWave = exp(-pow((along - 0.42) / 0.68, 2.0))
      * exp(-pow(across / 1.85, 2.0));
    float backflowProgress = smoothstep(0.3, 0.82, age);
    float returnOffset = mix(ridgeOffset, 0.18, backflowProgress);
    float returnWave = exp(-pow((abs(across) - returnOffset) / 0.58, 2.0))
      * trailEnvelope;
    float breakup = 0.72 + 0.28 * sin(
      along * 3.7 + across * 4.1 + float(index) * 2.17
    );

    height += (-groove * 0.052 + sideRidges * 0.027 + bowWave * 0.034)
      * grooveLife;
    height += returnWave * 0.034 * backflowLife;
    foam = max(
      foam,
      (sideRidges * 0.12 + bowWave * 0.18) * breakup * grooveLife
    );
  }

  return clamp(height, -0.085, 0.072);
}

float windSurface(vec2 uv, out float windSignal, out float lightingHeight) {
  // The large-scale current keeps a clear wind direction while locally bending
  // and grouping the smaller waves into irregular packets.
  vec2 windDirection = normalize(uWindDirection);
  vec2 waveAxis = -windDirection;
  vec2 crossAxis = vec2(-waveAxis.y, waveAxis.x);
  vec2 worldPosition = uv * uWaterSize;
  float travel = uTime * uWindSpeed * 130.0;
  vec2 advectedWorld = worldPosition - windDirection * travel;
  float rawAlong = dot(advectedWorld, waveAxis);
  float rawAcross = dot(worldPosition, crossAxis);

  float broadCurrent = perlin(vec2(rawAlong * 0.018, rawAcross * 0.032) + vec2(1.7, -2.4));
  float crossCurrent = perlin(vec2(rawAlong * 0.032 - travel * 0.012, rawAcross * 0.021) + vec2(-3.1, 0.8));
  float shearCurrent = perlin(vec2(rawAlong * 0.066, rawAcross * 0.052) + vec2(4.2, 1.3));
  float alongWind = rawAlong + broadCurrent * 2.8 + crossCurrent * 0.85;
  float acrossWind = rawAcross + broadCurrent * 1.15 + shearCurrent * 0.6;

  float packetNoise = perlin(vec2(
    rawAlong * 0.043 - travel * 0.018,
    rawAcross * 0.057 + crossCurrent * 0.7
  ));
  float currentSpeed = 0.86 + broadCurrent * 0.13 + crossCurrent * 0.07;
  float longPhase = alongWind * 0.17 * currentSpeed
    + acrossWind * (0.025 + crossCurrent * 0.018);
  float mediumPhase = alongWind * 0.38 * (0.94 + shearCurrent * 0.08)
    - acrossWind * 0.072 + broadCurrent * 1.1;
  float shortPhase = alongWind * 0.79 * (0.92 + crossCurrent * 0.1)
    + acrossWind * 0.135 + shearCurrent * 1.45;
  float capillaryPhase = alongWind * 1.42
    - acrossWind * 0.22 + packetNoise * 2.1;
  float windEnvelope = 0.45 + 0.55 * smoothstep(0.0, 0.9, uv.y);
  float wavePacket = smoothstep(-0.72, 0.68, packetNoise);
  float calmPatch = 0.48 + wavePacket * 0.52;
  float longWave = sin(longPhase) * 0.0135;
  float mediumWave = sin(mediumPhase) * 0.0064 * (0.58 + wavePacket * 0.42);
  float shortWave = sin(shortPhase) * 0.0031 * calmPatch;
  float capillaryWave = sin(capillaryPhase) * 0.00145 * wavePacket;
  float microSignal = 0.0;
  float microWaves = microWaveField(
    vec2(alongWind, acrossWind + crossCurrent * 1.25),
    microSignal
  );
  lightingHeight = (
    longWave + mediumWave + shortWave * 0.62
  ) * windEnvelope;
  float base = (longWave + mediumWave + shortWave + capillaryWave) * windEnvelope;
  base += microWaves * mix(0.72, 1.0, windEnvelope);

  float slopeSignal = abs(cos(mediumPhase)) * 0.44
    + abs(cos(shortPhase)) * 0.36
    + abs(cos(capillaryPhase)) * 0.2;
  windSignal = clamp(slopeSignal * calmPatch * 0.82 + microSignal * 0.18, 0.0, 1.0);
  return base;
}

float waterHeight(vec2 uv, float base, float pointerHeight) {

  if (uRippleAge < 0.0 && uRippleAge2 < 0.0) {
    return base + pointerHeight;
  }

  float ripple = 0.0;
  if (uRippleAge >= 0.0) {
    vec2 delta = impactDelta(uv);
    float distanceToImpact = length(delta);
    float cavityLife = 1.0 - smoothstep(0.1, 0.34, uRippleAge);
    float cavity = -exp(-pow(distanceToImpact / 0.62, 2.0))
      * cavityLife * 0.15;
    float cavityRim = exp(-pow((distanceToImpact - 0.62) * 2.1, 2.0))
      * cavityLife * 0.046;
    float reboundLife = smoothstep(0.16, 0.27, uRippleAge)
      * (1.0 - smoothstep(0.4, 0.58, uRippleAge));
    float rebound = exp(-pow(distanceToImpact / 0.5, 2.0))
      * reboundLife * 0.105;
    ripple += cavity + cavityRim + rebound;

    // Keep the Eulerian water surface and the ballistic crown joined by the
    // same raised meniscus. The splash vertex shader samples this exact field.
    float crownFormation = smoothstep(0.035, 0.17, uRippleAge);
    float crownSettle = 1.0 - smoothstep(0.64, 0.96, uRippleAge);
    float radialTravel = 1.0 - exp(-uRippleAge * 3.15);
    float crownDescent = smoothstep(0.48, 0.94, uRippleAge);
    float rimRadius = 0.19 + radialTravel * 0.88
      + max(uRippleAge - 0.34, 0.0) * 0.075;
    float sheetWidth = mix(0.13, 0.39, radialTravel)
      * mix(1.0, 0.62, crownDescent);
    float angle = atan(delta.y, delta.x);
    float rootVariation = 1.0
      + 0.042 * sin(angle * 5.0 + 0.8)
      + 0.022 * sin(angle * 9.0 - 0.45);
    float rootRadius = max(0.075, rimRadius - sheetWidth) * rootVariation;
    float meniscusWidth = mix(0.12, 0.2, radialTravel);
    float crownMeniscus = exp(-pow(
      (distanceToImpact - rootRadius) / meniscusWidth,
      2.0
    ));
    float innerShoulder = exp(-pow(distanceToImpact / max(rootRadius, 0.16), 4.0));
    ripple += (crownMeniscus * 0.043 + innerShoulder * 0.009)
      * crownFormation * crownSettle;

    // The impact wave starts after the cavity forms and cannot affect points ahead of its front.
    float propagationAge = uRippleAge - 0.1;
    if (propagationAge >= 0.0) {
      float angle = atan(delta.y, delta.x);
      float staticWarp = sin(angle * 5.0 + 0.7) * 0.035
        + perlin(delta * 0.18) * 0.025;
      float radius = propagationAge * 6.5;
      float frontDistance = distanceToImpact + staticWarp - radius;
      float reached = 1.0 - smoothstep(0.08, 0.55, frontDistance);
      float distanceBehind = max(radius - distanceToImpact, 0.0);
      float leadingRing = exp(-pow(frontDistance * 1.2, 2.0));
      float trailingWaves = sin(distanceBehind * 3.9)
        * exp(-distanceBehind * 0.66) * step(0.0, distanceBehind);
      float waveLife = smoothstep(0.0, 0.12, propagationAge)
        * exp(-propagationAge * 0.58);
      ripple += (leadingRing * 0.064 + trailingWaves * 0.032)
        * reached * waveLife * uImpactStrength;
    }
  }

  if (uRippleAge2 >= 0.0) {
    vec2 delta = impactDelta(uv);
    float distanceToImpact = length(delta);
    float angle = atan(delta.y, delta.x);
    float radius = 0.8 + uRippleAge2 * 6.0;
    float frontDistance = distanceToImpact - radius;
    float reached = 1.0 - smoothstep(0.06, 0.5, frontDistance);
    float angularBreakup = 0.86 + 0.14 * sin(angle * 7.0 + 0.35);
    float leadingRing = exp(-pow(frontDistance * 1.32, 2.0));
    float distanceBehind = max(radius - distanceToImpact, 0.0);
    float trailingWave = sin(distanceBehind * 4.15)
      * exp(-distanceBehind * 0.9) * step(0.0, distanceBehind);
    float waveLife = smoothstep(0.0, 0.14, uRippleAge2)
      * exp(-uRippleAge2 * 0.95);
    ripple += (leadingRing * 0.045 + trailingWave * 0.018)
      * reached * angularBreakup * waveLife * uImpactStrength2;
  }

  return base + ripple + pointerHeight;
}

float rippleCrest(vec2 uv) {
  if (uRippleAge < 0.0 && uRippleAge2 < 0.0) {
    return 0.0;
  }

  float crest = 0.0;
  if (uRippleAge >= 0.0) {
    vec2 delta = impactDelta(uv);
    float distanceToImpact = length(delta);
    float propagationAge = uRippleAge - 0.1;
    if (propagationAge >= 0.0) {
      float angle = atan(delta.y, delta.x);
      float staticWarp = sin(angle * 5.0 + 0.7) * 0.035
        + perlin(delta * 0.18) * 0.025;
      float radius = propagationAge * 6.5;
      float frontDistance = distanceToImpact + staticWarp - radius;
      float reached = 1.0 - smoothstep(0.08, 0.55, frontDistance);
      float waveFront = exp(-pow(frontDistance * 1.2, 2.0));
      float waveLife = smoothstep(0.0, 0.12, propagationAge)
        * exp(-propagationAge * 0.58);
      crest += waveFront * reached * waveLife * uImpactStrength;
    }
  }
  if (uRippleAge2 >= 0.0) {
    vec2 delta = impactDelta(uv);
    float distanceToImpact = length(delta);
    float angle = atan(delta.y, delta.x);
    float radius = 0.8 + uRippleAge2 * 6.0;
    float frontDistance = distanceToImpact - radius;
    float reached = 1.0 - smoothstep(0.06, 0.5, frontDistance);
    float angularBreakup = 0.86 + 0.14 * sin(angle * 7.0 + 0.35);
    float waveFront = exp(-pow(frontDistance * 1.32, 2.0));
    float waveLife = smoothstep(0.0, 0.14, uRippleAge2)
      * exp(-uRippleAge2 * 0.95);
    crest += waveFront * reached * angularBreakup
      * waveLife * uImpactStrength2;
  }
  return min(crest, 1.0);
}

vec4 sampleWaveState(vec2 sampleUv) {
  ivec2 dimensions = textureSize(uWaveState, 0);
  ivec2 maximum = dimensions - ivec2(1);
  vec2 pixel = clamp(sampleUv, vec2(0.0), vec2(1.0))
    * vec2(dimensions) - 0.5;
  ivec2 base = ivec2(floor(pixel));
  vec2 blend = fract(pixel);
  vec4 bottomLeft = texelFetch(uWaveState, clamp(base, ivec2(0), maximum), 0);
  vec4 bottomRight = texelFetch(
    uWaveState,
    clamp(base + ivec2(1, 0), ivec2(0), maximum),
    0
  );
  vec4 topLeft = texelFetch(
    uWaveState,
    clamp(base + ivec2(0, 1), ivec2(0), maximum),
    0
  );
  vec4 topRight = texelFetch(
    uWaveState,
    clamp(base + ivec2(1), ivec2(0), maximum),
    0
  );
  return mix(
    mix(bottomLeft, bottomRight, blend.x),
    mix(topLeft, topRight, blend.x),
    blend.y
  );
}

void main() {
  float windSignal = 0.0;
  float lightingHeight = 0.0;
  float base = windSurface(vUv, windSignal, lightingHeight);
  vec4 waveState = sampleWaveState(vUv);
  float height = base + waveState.r * 0.32;
  float crest = clamp(waveState.a * 0.1, 0.0, 1.0);
  // Alpha excludes impact, capillary, and radial micro waves. Lighting follows
  // a coherent -X flow while the complete surface keeps its smaller details.
  outColor = vec4(
    0.5 + height * 0.45,
    crest,
    windSignal,
    0.5 + lightingHeight * 0.45
  );
}
