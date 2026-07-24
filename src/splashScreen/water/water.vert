precision highp float;

in vec3 position;
in vec2 uv;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D uHeightMap;
uniform vec2 uHeightTexel;
uniform float uHeightScale;

out vec2 vUv;
out vec3 vWorldPosition;
out vec3 vWorldNormal;
out float vSlope;
out float vRippleCrest;
out float vPointerFoam;

float decodeHeight(vec2 sampleUv) {
  return (texture(uHeightMap, sampleUv).r - 0.5) / 0.45 * uHeightScale;
}

void main() {
  vUv = uv;

  float height = decodeHeight(uv);
  float heightLeft = decodeHeight(uv - vec2(uHeightTexel.x, 0.0));
  float heightRight = decodeHeight(uv + vec2(uHeightTexel.x, 0.0));
  float heightDown = decodeHeight(uv - vec2(0.0, uHeightTexel.y));
  float heightUp = decodeHeight(uv + vec2(0.0, uHeightTexel.y));

  vec3 displaced = position;
  displaced.z += height;

  vec3 localNormal = normalize(vec3(
    -(heightRight - heightLeft) * 22.0,
    -(heightUp - heightDown) * 22.0,
    2.0
  ));

  vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
  vSlope = clamp(length(vec2(
    heightRight - heightLeft,
    heightUp - heightDown
  )) * 42.0, 0.0, 1.0);
  vec4 heightSample = texture(uHeightMap, uv);
  vRippleCrest = heightSample.g;
  vPointerFoam = heightSample.a;

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
