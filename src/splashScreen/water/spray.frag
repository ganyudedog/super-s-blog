precision highp float;

uniform sampler2D uMap;
uniform vec3 uColor;

in vec2 vUv;
in float vAlpha;

out vec4 outColor;

void main() {
  vec4 sprite = texture(uMap, vUv);
  float alpha = sprite.a * vAlpha;
  if (alpha < 0.01) {
    discard;
  }
  vec3 color = mix(uColor * 0.72, vec3(0.9, 0.97, 1.0), sprite.r * 0.55);
  outColor = vec4(color, alpha * 0.88);
}
