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
  outColor = vec4(uColor * sprite.rgb, alpha);
}
