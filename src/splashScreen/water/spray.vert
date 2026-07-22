precision highp float;

in vec3 position;
in vec2 uv;
in vec3 instancePosition;
in float instanceAlpha;
in float instanceScale;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;

out vec2 vUv;
out float vAlpha;

void main() {
  vec4 centerView = viewMatrix * vec4(instancePosition, 1.0);
  centerView.xy += vec2(position.x, position.y * 1.12) * instanceScale;
  vUv = uv;
  vAlpha = instanceAlpha;
  gl_Position = projectionMatrix * centerView;
}
