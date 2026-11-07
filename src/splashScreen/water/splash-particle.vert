precision highp float;

in vec3 position;
// xyz: launch position relative to the impact (y = 0 is the waterline), w: launch time.
in vec4 aLaunch;
// xyz: launch velocity, w: radius.
in vec4 aVelocity;
// x: linear drag, y: aeration, z: thinning while the sheet stretches.
in vec4 aParams;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uOrigin;
uniform float uAge;
uniform float uGravity;
// Pixels per world unit at a view depth of one.
uniform float uPixelScale;
uniform float uMinPixelRadius;
// The depth pass draws slightly fatter spheres to close pinholes between
// neighbours; thickness keeps the true size.
uniform float uRadiusScale;

out vec2 vCorner;
out vec3 vViewCenter;
out float vRadius;
out float vHeight;
out float vAeration;
out float vCoverage;

void main() {
  float age = uAge - aLaunch.w;
  float drag = aParams.x;
  // Closed-form ballistic flight with linear drag, so no per-frame state is stored.
  vec3 terminalVelocity = vec3(0.0, -uGravity / drag, 0.0);
  vec3 offset = aLaunch.xyz + terminalVelocity * age
    + (aVelocity.xyz - terminalVelocity) * (1.0 - exp(-drag * age)) / drag;
  float radius = aVelocity.w * (1.0 - aParams.z * smoothstep(0.12, 0.6, age)) * uRadiusScale;

  vCorner = position.xy;
  vViewCenter = vec3(0.0);
  vRadius = 0.0;
  vHeight = -1.0;
  vAeration = aParams.y;
  vCoverage = 0.0;
  if (age < 0.0 || offset.y < -radius) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec4 viewCenter = viewMatrix * vec4(uOrigin + offset, 1.0);
  float depth = max(-viewCenter.z, 0.1);
  float pixelRadius = radius * uPixelScale / depth;
  float drawRadius = max(radius, uMinPixelRadius * depth / uPixelScale);
  vViewCenter = viewCenter.xyz;
  vRadius = drawRadius;
  vHeight = offset.y;
  vCoverage = clamp(pixelRadius / uMinPixelRadius, 0.0, 1.0);
  gl_Position = projectionMatrix * (viewCenter + vec4(position.xy * drawRadius, 0.0, 0.0));
}
