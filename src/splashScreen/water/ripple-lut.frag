precision highp float;

out vec4 outColor;

// x: radius range, y: duration, z/w: texel counts along radius and time.
uniform vec4 uLutSize;
uniform float uGravity;
uniform float uViscosity;
uniform float uMaxWavenumber;
uniform int uWavenumberSamples;
// x: initial downward surface speed, y: radius, z: start time.
uniform vec3 uImpactSource;
// x: initial downward surface speed, y: ring radius, z: ring width, w: start time.
uniform vec4 uRingSource;
// x: initial downward surface speed, y: radius, z: start time.
uniform vec3 uJetSource;

// Rational and asymptotic Bessel approximations (Numerical Recipes, 2nd ed.).
float besselJ0(float x) {
  float ax = abs(x);
  if (ax < 8.0) {
    float y = x * x;
    float numerator = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7
      + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    float denominator = 57568490411.0 + y * (1029532985.0 + y * (9494680.718
      + y * (59272.64853 + y * (267.8532712 + y))));
    return numerator / denominator;
  }
  float z = 8.0 / ax;
  float y = z * z;
  float shifted = ax - 0.785398164;
  float p = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4
    + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  float q = -0.1562499995e-1 + y * (0.1430488765e-3
    + y * (-0.6911147651e-5 + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return sqrt(0.636619772 / ax) * (cos(shifted) * p - z * sin(shifted) * q);
}

float besselJ1(float x) {
  float ax = abs(x);
  if (ax < 8.0) {
    float y = x * x;
    float numerator = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1
      + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    float denominator = 144725228442.0 + y * (2300535178.0 + y * (18583304.74
      + y * (99447.43394 + y * (376.9991397 + y))));
    return numerator / denominator;
  }
  float z = 8.0 / ax;
  float y = z * z;
  float shifted = ax - 2.356194491;
  float p = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4
    + y * (0.2457520174e-5 + y * -0.240337019e-6)));
  float q = 0.04687499995 + y * (-0.2002690873e-3
    + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  float result = sqrt(0.636619772 / ax) * (cos(shifted) * p - z * sin(shifted) * q);
  return x < 0.0 ? -result : result;
}

// Height response of one wavenumber to a surface that is pushed down while at
// rest (linear deep-water waves, omega^2 = g k, with viscous decay).
float impulseResponse(float k, float omega, float age) {
  if (age <= 0.0) return 0.0;
  return sin(omega * age) / omega * exp(-2.0 * uViscosity * k * k * age);
}

// Each texel stores the axisymmetric solution (height, d height / d radius)
// as a Hankel integral over wavenumbers: rg = impact, ba = crown and jet
// falling back.
void main() {
  vec2 texel = floor(gl_FragCoord.xy);
  float radius = texel.x / (uLutSize.z - 1.0) * uLutSize.x;
  float age = texel.y / (uLutSize.w - 1.0) * uLutSize.y;
  float dk = uMaxWavenumber / float(uWavenumberSamples);
  float impactScale = -uImpactSource.x * 0.5 * uImpactSource.y * uImpactSource.y;
  float ringScale = -uRingSource.x * uRingSource.y * uRingSource.z * 1.7724539;
  float jetScale = -uJetSource.x * 0.5 * uJetSource.y * uJetSource.y;
  vec2 impact = vec2(0.0);
  vec2 secondary = vec2(0.0);
  for (int index = 0; index < uWavenumberSamples; index += 1) {
    float k = (float(index) + 0.5) * dk;
    float omega = sqrt(uGravity * k);
    vec2 basis = vec2(besselJ0(k * radius), -k * besselJ1(k * radius)) * k * dk;
    impact += basis * impactScale
      * exp(-0.25 * k * k * uImpactSource.y * uImpactSource.y)
      * impulseResponse(k, omega, age - uImpactSource.z);
    secondary += basis * (
      ringScale * besselJ0(k * uRingSource.y)
        * exp(-0.25 * k * k * uRingSource.z * uRingSource.z)
        * impulseResponse(k, omega, age - uRingSource.w)
      + jetScale
        * exp(-0.25 * k * k * uJetSource.y * uJetSource.y)
        * impulseResponse(k, omega, age - uJetSource.z)
    );
  }
  outColor = vec4(impact, secondary);
}
