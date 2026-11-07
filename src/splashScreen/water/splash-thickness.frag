precision highp float;

uniform vec3 uViewUp;

in vec2 vCorner;
in float vRadius;
in float vHeight;
in float vAeration;
in float vCoverage;

out vec4 outColor;

void main() {
  float radiusSquared = dot(vCorner, vCorner);
  if (radiusSquared > 1.0) discard;
  vec3 sphereNormal = vec3(vCorner, sqrt(1.0 - radiusSquared));
  if (vHeight + dot(sphereNormal, uViewUp) * vRadius < 0.0) discard;
  float chord = 2.0 * sphereNormal.z * vRadius * vCoverage;
  outColor = vec4(chord, chord * vAeration, 0.0, 0.0);
}
