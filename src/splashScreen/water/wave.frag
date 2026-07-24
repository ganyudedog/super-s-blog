precision highp float;

in vec2 vUv;

out vec4 outColor;

uniform sampler2D uPreviousState;
uniform vec2 uTexel;
uniform vec2 uWaterSize;
uniform float uTime;
uniform float uDeltaTime;
uniform float uWaveStiffness;
uniform float uDamping;
uniform vec2 uImpactCenter;
uniform float uImpactStart;
uniform float uImpactStrength;

float impactImpulse(vec2 uv) {
  float age = uTime - uImpactStart;
  if (age < 0.0 || age > 0.13) return 0.0;

  vec2 delta = (uv - uImpactCenter) * uWaterSize;
  float brush = exp(-pow(length(delta) / 2.5, 2.0));
  float envelope = 1.0 - smoothstep(0.0, 0.13, age);
  return -brush * envelope * uImpactStrength * 0.82;
}

void main() {
  vec4 centerState = texture(uPreviousState, vUv);
  float height = centerState.r;
  float velocity = centerState.g;
  float restOffset = centerState.b;
  float left = texture(uPreviousState, vUv - vec2(uTexel.x, 0.0)).r;
  float right = texture(uPreviousState, vUv + vec2(uTexel.x, 0.0)).r;
  float down = texture(uPreviousState, vUv - vec2(0.0, uTexel.y)).r;
  float up = texture(uPreviousState, vUv + vec2(0.0, uTexel.y)).r;
  float laplacian = left + right + down + up - 4.0 * height;

  velocity += laplacian * uWaveStiffness * uDeltaTime;
  restOffset *= exp(-2.75 * uDeltaTime);
  velocity += (restOffset - height) * 14.0 * uDeltaTime;
  velocity += impactImpulse(vUv);
  velocity *= exp(-uDamping * uDeltaTime);
  height += velocity * uDeltaTime;

  float edgeDistance = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float edgeAbsorption = smoothstep(0.0, 0.055, edgeDistance);
  velocity *= mix(0.76, 1.0, edgeAbsorption);
  height *= mix(0.985, 1.0, edgeAbsorption);

  float localEnergy = abs(velocity) * 0.45 + abs(laplacian) * 3.2;
  float generatedFoam = smoothstep(0.58, 1.35, localEnergy);
  float foam = max(centerState.a * exp(-4.8 * uDeltaTime), generatedFoam);

  outColor = vec4(
    clamp(height, -0.24, 0.24),
    clamp(velocity, -2.2, 2.2),
    clamp(restOffset, -0.035, 0.01),
    clamp(foam, 0.0, 1.0)
  );
}
