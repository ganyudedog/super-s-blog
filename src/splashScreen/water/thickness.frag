precision highp float;

uniform float uWaterLevel;

in vec3 vWorldPosition;
in float vViewDepth;

out vec4 outColor;

void main() {
  if (vWorldPosition.y < uWaterLevel) {
    discard;
  }
  outColor = vec4(vViewDepth, 0.0, 0.0, 1.0);
}
