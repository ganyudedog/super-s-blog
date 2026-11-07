precision highp float;

uniform sampler2D uSource;

out vec4 outColor;

void main() {
  outColor = texelFetch(uSource, ivec2(gl_FragCoord.xy), 0);
}
