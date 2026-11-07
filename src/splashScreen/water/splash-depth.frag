precision highp float;

uniform mat4 projectionMatrix;
// World up expressed in view space.
uniform vec3 uViewUp;

in vec2 vCorner;
in vec3 vViewCenter;
in float vRadius;
in float vHeight;

out vec4 outColor;

void main() {
  float radiusSquared = dot(vCorner, vCorner);
  if (radiusSquared > 1.0) discard;
  vec3 sphereNormal = vec3(vCorner, sqrt(1.0 - radiusSquared));
  // The part of a droplet below the waterline is hidden by the surface.
  if (vHeight + dot(sphereNormal, uViewUp) * vRadius < 0.0) discard;
  vec3 viewPosition = vViewCenter + sphereNormal * vRadius;
  vec4 clipPosition = projectionMatrix * vec4(viewPosition, 1.0);
  gl_FragDepth = clipPosition.z / clipPosition.w * 0.5 + 0.5;
  outColor = vec4(-viewPosition.z, 0.0, 0.0, 1.0);
}
