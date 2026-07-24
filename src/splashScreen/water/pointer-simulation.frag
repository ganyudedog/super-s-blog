precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPreviousState;
uniform vec2 uTexel;
uniform vec2 uViewportSize;
const int MAX_STROKES_PER_STEP = 8;
uniform vec2 uStrokeStarts[MAX_STROKES_PER_STEP];
uniform vec2 uStrokeEnds[MAX_STROKES_PER_STEP];
uniform float uStrokeStrengths[MAX_STROKES_PER_STEP];
uniform int uStrokeCount;
uniform float uDeltaTime;

float strokeDensity(
  vec2 uv,
  vec2 strokeStart,
  vec2 strokeEnd,
  float strokeStrength
) {
  vec2 point = uv * uViewportSize;
  vec2 start = strokeStart * uViewportSize;
  vec2 end = strokeEnd * uViewportSize;
  vec2 segment = end - start;
  float segmentLengthSquared = max(dot(segment, segment), 0.0001);
  float projection = clamp(
    dot(point - start, segment) / segmentLengthSquared,
    0.0,
    1.0
  );
  vec2 nearest = start + segment * projection;
  float distanceToSegment = length(point - nearest);
  return exp(-pow(distanceToSegment / 15.0, 2.0))
    * clamp(strokeStrength, 0.0, 1.0);
}

void main() {
  vec2 center = texture(uPreviousState, vUv).rg;
  vec2 north = texture(uPreviousState, vUv + vec2(0.0, uTexel.y)).rg;
  vec2 south = texture(uPreviousState, vUv - vec2(0.0, uTexel.y)).rg;
  vec2 east = texture(uPreviousState, vUv + vec2(uTexel.x, 0.0)).rg;
  vec2 west = texture(uPreviousState, vUv - vec2(uTexel.x, 0.0)).rg;
  vec2 northeast = texture(uPreviousState, vUv + uTexel).rg;
  vec2 northwest = texture(
    uPreviousState,
    vUv + vec2(-uTexel.x, uTexel.y)
  ).rg;
  vec2 southeast = texture(
    uPreviousState,
    vUv + vec2(uTexel.x, -uTexel.y)
  ).rg;
  vec2 southwest = texture(uPreviousState, vUv - uTexel).rg;
  vec2 blurred = (
    4.0 * center
      + 2.0 * (north + south + east + west)
      + northeast + northwest + southeast + southwest
  ) / 16.0;

  float injection = 0.0;
  for (int index = 0; index < MAX_STROKES_PER_STEP; index += 1) {
    if (index >= uStrokeCount) break;
    injection = max(
      injection,
      strokeDensity(
        vUv,
        uStrokeStarts[index],
        uStrokeEnds[index],
        uStrokeStrengths[index]
      )
    );
  }

  // The core keeps its shape while the halo diffuses farther. Injection uses
  // a target density instead of addition, so adjoining segments cannot build
  // brighter beads at their shared endpoints.
  vec2 state = vec2(
    mix(center.r, blurred.r, 0.28),
    mix(center.g, blurred.g, 0.62)
  );
  float injectedDensity = smoothstep(0.0, 0.92, injection);
  state.r = max(state.r, injectedDensity * 0.82);
  state.g = max(state.g, injectedDensity * 0.58);
  state.g = max(state.g, state.r * 0.48);
  state.r *= exp(-1.08 * uDeltaTime);
  state.g *= exp(-0.68 * uDeltaTime);

  float edgeDistance = min(
    min(vUv.x, 1.0 - vUv.x),
    min(vUv.y, 1.0 - vUv.y)
  );
  float edgeAbsorption = smoothstep(0.0, 0.03, edgeDistance);
  state *= mix(0.9, 1.0, edgeAbsorption);
  outColor = vec4(
    clamp(state, 0.0, 1.0),
    0.0,
    1.0
  );
}
