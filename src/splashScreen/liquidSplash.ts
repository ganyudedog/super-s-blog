import * as THREE from 'three';
import fullscreenVertexShader from './water/fullscreen.vert';
import particleVertexShader from './water/splash-particle.vert';
import depthFragmentShader from './water/splash-depth.frag';
import thicknessFragmentShader from './water/splash-thickness.frag';
import smoothFragmentShader from './water/splash-smooth.frag';
import compositeFragmentShader from './water/splash-composite.frag';

export const SPLASH_GRAVITY = 9.8;
export const SPLASH_DURATION = 1.7;
export const DROPLET_RIPPLE_COUNT = 16;

/**
 * Where the splash hands momentum back to the surface (seconds after the
 * impact, world units). The ripple solution is built from the same numbers,
 * so the rings start where the crown and the jet actually fall back.
 */
export const SPLASH_RIPPLE_SOURCES = {
  impact: { speed: 1.0, radius: 0.5, start: 0 },
  crownReturn: { speed: 0.3, radius: 1.1, width: 0.4, start: 0.55 },
  jetReturn: { speed: 0.45, radius: 0.3, start: 1.12 },
} as const;

const EMPTY_DEPTH = 10000;
const SMOOTHING_RADIUS = 0.085;
const SMOOTHING_DEPTH_FALLOFF = 0.07;
const SMOOTHING_ITERATIONS = 1;
const MIN_PIXEL_RADIUS = 1.1;
const BOUNDS_RADIUS = 3.4;
const BOUNDS_HEIGHT = 2.3;
// Fastest launches (horizontal, vertical) bound how far liquid can be early on.
const BOUNDS_GROWTH = { radius: 5.8, height: 6.4 };
const SCISSOR_MARGIN = 16;

// Neighbouring launches must stay within about one particle diameter until
// the sheet is meant to tear, around half a second in.
const SHEET_COLUMNS = 150;
const SHEET_LAYERS = 32;
const SHEET_EMISSION = 0.24;
const SHEET_DRAG = 0.22;
const RIM_RADIUS = 0.28;
const RIM_VERTICAL_SPEED = 3.9;
const RIM_RADIAL_SPEED = 1.8;
const FINGER_COUNT = 17;
const JET_START = 0.36;
const JET_EMISSION = 0.15;
const JET_COUNT = 120;
const SPRAY_COUNT = 360;

interface Flight {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
}

interface Launch {
  start: THREE.Vector3;
  velocity: THREE.Vector3;
  time: number;
  radius: number;
  drag: number;
}

interface SplashParticles {
  launch: Float32Array;
  velocity: Float32Array;
  params: Float32Array;
  count: number;
  dropletRipples: THREE.Vector4[];
}

export interface LiquidSplash {
  /** xy: landing offset from the impact, z: landing time, w: Froude scale. */
  readonly dropletRipples: readonly THREE.Vector4[];
  setSize(width: number, height: number): void;
  compile(): Promise<void>;
  render(age: number, background: THREE.Texture): void;
  dispose(): void;
}

interface LiquidSplashOptions {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Impact point on the waterline; read every frame. */
  origin: THREE.Vector3;
  lightPosition: THREE.Vector3;
  environment: THREE.Texture;
  fullscreenGeometry: THREE.BufferGeometry;
  fullscreenCamera: THREE.Camera;
}

const createRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const amount = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
};

// Mirrors the closed-form flight in splash-particle.vert.
const fly = (start: THREE.Vector3, velocity: THREE.Vector3, drag: number, age: number, out: Flight) => {
  const decay = Math.exp(-drag * age);
  const travel = (1 - decay) / drag;
  const terminal = -SPLASH_GRAVITY / drag;
  out.position.set(
    start.x + velocity.x * travel,
    start.y + terminal * age + (velocity.y - terminal) * travel,
    start.z + velocity.z * travel,
  );
  out.velocity.set(velocity.x * decay, terminal + (velocity.y - terminal) * decay, velocity.z * decay);
  return out;
};

const landingTime = ({ start, velocity, drag }: Launch) => {
  const flight: Flight = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };
  let low = 0.02;
  let high = 4;
  if (fly(start, velocity, drag, high, flight).position.y > 0) return null;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    fly(start, velocity, drag, middle, flight);
    if (flight.velocity.y > 0 || flight.position.y > 0) low = middle;
    else high = middle;
  }
  return high;
};

/**
 * A deep-pool drop impact built from stateless ballistic particles: a crown
 * sheet fed from the crater rim, rim fingers that pinch off into drops, fine
 * spray, and the Worthington jet that rises when the crater collapses.
 */
const buildSplashParticles = (): SplashParticles => {
  const random = createRandom(0x5eed1e);
  const launches: number[] = [];
  const velocities: number[] = [];
  const params: number[] = [];
  const rippleDrops: Launch[] = [];
  const push = (launch: Launch, aeration: number, thinning: number) => {
    launches.push(launch.start.x, launch.start.y, launch.start.z, launch.time);
    velocities.push(launch.velocity.x, launch.velocity.y, launch.velocity.z, launch.radius);
    params.push(launch.drag, aeration, thinning, 0);
  };
  const launchOf = (start: THREE.Vector3, velocity: THREE.Vector3, time: number, radius: number, drag: number): Launch => ({
    start: start.clone(),
    velocity: velocity.clone(),
    time,
    radius,
    drag,
  });

  const fingers = Array.from({ length: FINGER_COUNT }, (_, index) => ({
    angle: ((index + 0.5 + (random() - 0.5) * 0.7) / FINGER_COUNT) * Math.PI * 2,
    width: mix(0.05, 0.09, random()),
    strength: mix(0.55, 1, random()),
  }));
  const fingerProfile = (angle: number) => fingers.reduce((profile, finger) => {
    const delta = Math.atan2(Math.sin(angle - finger.angle), Math.cos(angle - finger.angle));
    return Math.max(profile, finger.strength * Math.exp(-((delta / finger.width) ** 2)));
  }, 0);

  const start = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const flight: Flight = { position: new THREE.Vector3(), velocity: new THREE.Vector3() };

  // Crown sheet: the earliest liquid leaves the rim fastest and becomes the
  // crown edge; later liquid forms the slower, thicker base.
  for (let layer = 0; layer < SHEET_LAYERS; layer += 1) {
    for (let column = 0; column < SHEET_COLUMNS; column += 1) {
      const sheet = Math.min((layer + random() * 0.85) / SHEET_LAYERS, 1);
      const angle = ((column + random() * 0.9) / SHEET_COLUMNS) * Math.PI * 2;
      const finger = fingerProfile(angle) * (1 - smoothstep(0, 0.22, sheet));
      const launchRadius = RIM_RADIUS + 0.3 * sheet;
      const verticalSpeed = mix(RIM_VERTICAL_SPEED, 0.9, sheet)
        * (1 + 0.2 * finger)
        * (1 + (random() - 0.5) * 0.04);
      const radialSpeed = mix(RIM_RADIAL_SPEED, 0.55, sheet) * (1 + 0.1 * finger);
      start.set(Math.cos(angle) * launchRadius, 0, Math.sin(angle) * launchRadius);
      velocity.set(Math.cos(angle) * radialSpeed, verticalSpeed, Math.sin(angle) * radialSpeed);
      push(
        launchOf(start, velocity, sheet * SHEET_EMISSION, mix(0.04, 0.046, sheet), SHEET_DRAG),
        0.06 + 0.4 * smoothstep(0.6, 1, sheet),
        0.25,
      );
    }
  }

  // Fingers stretch into ligaments that separate into drops on their own,
  // because each fragment leaves with a slightly different speed.
  fingers.forEach((finger) => {
    outward.set(Math.cos(finger.angle), 0, Math.sin(finger.angle));
    const rimStart = outward.clone().multiplyScalar(RIM_RADIUS);
    const rimVelocity = outward.clone()
      .multiplyScalar(RIM_RADIAL_SPEED * (1 + 0.1 * finger.strength))
      .setY(RIM_VERTICAL_SPEED * (1 + 0.2 * finger.strength));
    const ligamentTime = mix(0.07, 0.12, random());
    fly(rimStart, rimVelocity, SHEET_DRAG, ligamentTime, flight);
    for (let fragment = 0; fragment < 5; fragment += 1) {
      velocity.copy(flight.velocity)
        .multiplyScalar(1 + 0.05 * fragment)
        .addScaledVector(outward, 0.06 * fragment);
      const launch = launchOf(flight.position, velocity, ligamentTime, mix(0.03, 0.042, fragment / 4), 0.2);
      push(launch, 0.04, 0.1);
      if (fragment === 4) rippleDrops.push(launch);
    }
    for (let drop = 0; drop < 2; drop += 1) {
      const dropTime = mix(0.15, 0.3, random());
      fly(rimStart, rimVelocity, SHEET_DRAG, dropTime, flight);
      velocity.copy(flight.velocity)
        .multiplyScalar(mix(1.12, 1.3, random()))
        .addScaledVector(outward, 0.25);
      velocity.x += (random() - 0.5) * 0.3;
      velocity.y += (random() - 0.5) * 0.3;
      velocity.z += (random() - 0.5) * 0.3;
      const launch = launchOf(flight.position, velocity, dropTime, mix(0.036, 0.054, random()), 0.18);
      push(launch, 0.02, 0);
      rippleDrops.push(launch);
    }
  });

  // Fine spray thrown from the crater rim at the moment of impact.
  for (let index = 0; index < SPRAY_COUNT; index += 1) {
    const angle = random() * Math.PI * 2;
    const elevation = mix(0.5, 1.25, random());
    const speed = mix(3.2, 6.4, random() ** 1.5);
    const launchRadius = RIM_RADIUS + 0.02 + (random() - 0.5) * 0.08;
    start.set(Math.cos(angle) * launchRadius, 0.03, Math.sin(angle) * launchRadius);
    velocity.set(
      Math.cos(angle) * Math.cos(elevation) * speed,
      Math.sin(elevation) * speed,
      Math.sin(angle) * Math.cos(elevation) * speed,
    );
    push(launchOf(start, velocity, random() * 0.06, mix(0.008, 0.016, random()), 1.0), 0, 0);
  }

  // Worthington jet: the collapsing crater shoots a column straight up; its
  // fast leading liquid pinches off as a separate drop at the top.
  for (let index = 0; index < JET_COUNT; index += 1) {
    const column = index / (JET_COUNT - 1);
    start.set((random() - 0.5) * 0.04, -0.02, (random() - 0.5) * 0.04);
    velocity.set(
      0.05 + (random() - 0.5) * 0.06,
      index === 0 ? 4.5 : mix(4.3, 1.2, column ** 0.6),
      -0.03 + (random() - 0.5) * 0.06,
    );
    const launch = launchOf(
      start,
      velocity,
      JET_START + column * JET_EMISSION,
      index === 0 ? 0.08 : mix(0.065, 0.048, column),
      0.12,
    );
    push(launch, mix(0.1, 0.45, column), 0);
    if (index === 0) rippleDrops.push(launch);
  }

  const dropletRipples = rippleDrops
    .flatMap((launch) => {
      const flightTime = landingTime(launch);
      if (flightTime === null) return [];
      fly(launch.start, launch.velocity, launch.drag, flightTime, flight);
      // A falling drop opens a crater a little wider than itself.
      const scale = (launch.radius * 1.8) / SPLASH_RIPPLE_SOURCES.impact.radius;
      return [{
        radius: launch.radius,
        ripple: new THREE.Vector4(flight.position.x, flight.position.z, launch.time + flightTime, scale),
      }];
    })
    .sort((a, b) => b.radius - a.radius)
    .slice(0, DROPLET_RIPPLE_COUNT)
    .map((entry) => entry.ripple);

  return {
    launch: new Float32Array(launches),
    velocity: new Float32Array(velocities),
    params: new Float32Array(params),
    count: launches.length / 4,
    dropletRipples,
  };
};

/**
 * Screen-space fluid rendering: particles are splatted as spheres, their
 * nearest depth is smoothed into one surface, and the composite shades it as
 * water refracting the live frame behind it.
 */
export function createLiquidSplash({
  renderer,
  camera,
  origin,
  lightPosition,
  environment,
  fullscreenGeometry,
  fullscreenCamera,
}: LiquidSplashOptions): LiquidSplash {
  const particles = buildSplashParticles();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1.1, -1.1, 0,
    1.1, -1.1, 0,
    1.1, 1.1, 0,
    -1.1, 1.1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aLaunch', new THREE.InstancedBufferAttribute(particles.launch, 4));
  geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(particles.velocity, 4));
  geometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(particles.params, 4));
  geometry.instanceCount = particles.count;

  const particleUniforms = {
    uOrigin: { value: origin },
    uAge: { value: 0 },
    uGravity: { value: SPLASH_GRAVITY },
    uPixelScale: { value: 1 },
    uMinPixelRadius: { value: MIN_PIXEL_RADIUS },
    uViewUp: { value: new THREE.Vector3(0, 1, 0) },
  };
  const depthMaterial = new THREE.RawShaderMaterial({
    vertexShader: particleVertexShader,
    fragmentShader: depthFragmentShader,
    uniforms: { ...particleUniforms, uRadiusScale: { value: 1.25 } },
    glslVersion: THREE.GLSL3,
    depthTest: true,
    depthWrite: true,
  });
  const thicknessMaterial = new THREE.RawShaderMaterial({
    vertexShader: particleVertexShader,
    fragmentShader: thicknessFragmentShader,
    uniforms: { ...particleUniforms, uRadiusScale: { value: 1 } },
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const depthScene = new THREE.Scene();
  const thicknessScene = new THREE.Scene();
  const depthMesh = new THREE.Mesh(geometry, depthMaterial);
  const thicknessMesh = new THREE.Mesh(geometry, thicknessMaterial);
  depthMesh.frustumCulled = false;
  thicknessMesh.frustumCulled = false;
  depthScene.add(depthMesh);
  thicknessScene.add(thicknessMesh);

  const createDepthTarget = (name: string, depthBuffer: boolean) => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.FloatType,
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer,
      stencilBuffer: false,
    });
    target.texture.name = name;
    target.scissorTest = true;
    return target;
  };
  const depthTarget = createDepthTarget('splash-particle-depth', true);
  const smoothTargets = [
    createDepthTarget('splash-smooth-depth-a', false),
    createDepthTarget('splash-smooth-depth-b', false),
  ];
  const thicknessTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  thicknessTarget.texture.name = 'splash-thickness';
  thicknessTarget.scissorTest = true;
  const passTargets = [depthTarget, thicknessTarget, ...smoothTargets];

  const smoothUniforms = {
    uDepth: { value: depthTarget.texture as THREE.Texture },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uWorldRadius: { value: SMOOTHING_RADIUS },
    uPixelScale: particleUniforms.uPixelScale,
    uDepthFalloff: { value: SMOOTHING_DEPTH_FALLOFF },
    uEmptyDepth: { value: EMPTY_DEPTH },
  };
  const smoothMaterial = new THREE.RawShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: smoothFragmentShader,
    uniforms: smoothUniforms,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
  const smoothScene = new THREE.Scene();
  smoothScene.add(new THREE.Mesh(fullscreenGeometry, smoothMaterial));

  const compositeUniforms = {
    uDepth: { value: smoothTargets[1].texture },
    uThickness: { value: thicknessTarget.texture },
    uBackground: { value: null as THREE.Texture | null },
    uEnvironment: { value: environment },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uProjectionScale: { value: new THREE.Vector2(1, 1) },
    uViewToWorld: { value: new THREE.Matrix3() },
    uLightViewPosition: { value: new THREE.Vector3() },
    uLightColor: { value: new THREE.Color(0.78, 0.9, 1.0) },
    uWaterTint: { value: new THREE.Color(0.05, 0.2, 0.3) },
    uEmptyDepth: { value: EMPTY_DEPTH },
    uDepthDiscontinuity: { value: 0.15 },
  };
  const compositeMaterial = new THREE.RawShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: compositeFragmentShader,
    uniforms: compositeUniforms,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(fullscreenGeometry, compositeMaterial));

  const emptyDepthColor = new THREE.Color().setRGB(EMPTY_DEPTH, EMPTY_DEPTH, EMPTY_DEPTH);
  const black = new THREE.Color(0, 0, 0);
  const savedClearColor = new THREE.Color();
  const drawingBufferSize = new THREE.Vector2();
  const scissor = new THREE.Vector4();
  const savedScissor = new THREE.Vector4();
  const corner = new THREE.Vector3();

  // Clear colours are converted for the bound target, so the caller's colour
  // is restored only after its own target is bound again.
  const withPassState = (draw: () => void) => {
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.getClearColor(savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    try {
      draw();
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(savedClearColor, savedClearAlpha);
      renderer.autoClear = previousAutoClear;
    }
  };

  const clearTarget = (target: THREE.WebGLRenderTarget) => {
    renderer.setRenderTarget(target);
    if (target === thicknessTarget) {
      renderer.setClearColor(black, 0);
      renderer.clear(true, false, false);
    } else {
      renderer.setClearColor(emptyDepthColor, 1);
      renderer.clear(true, target.depthBuffer, false);
    }
  };

  // Every pass is scissored to the screen area the liquid can have reached.
  const updateScissor = (age: number, width: number, height: number) => {
    const reach = Math.min(BOUNDS_RADIUS, 0.45 + BOUNDS_GROWTH.radius * age);
    const rise = Math.min(BOUNDS_HEIGHT, 0.45 + BOUNDS_GROWTH.height * age);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let index = 0; index < 8; index += 1) {
      corner.set(
        origin.x + (index & 1 ? reach : -reach),
        origin.y + (index & 2 ? rise : -0.1),
        origin.z + (index & 4 ? reach : -reach),
      ).project(camera);
      const x = (corner.x * 0.5 + 0.5) * width;
      const y = (corner.y * 0.5 + 0.5) * height;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const left = THREE.MathUtils.clamp(Math.floor(minX) - SCISSOR_MARGIN, 0, width);
    const bottom = THREE.MathUtils.clamp(Math.floor(minY) - SCISSOR_MARGIN, 0, height);
    const right = THREE.MathUtils.clamp(Math.ceil(maxX) + SCISSOR_MARGIN, 0, width);
    const top = THREE.MathUtils.clamp(Math.ceil(maxY) + SCISSOR_MARGIN, 0, height);
    scissor.set(left, bottom, Math.max(right - left, 0), Math.max(top - bottom, 0));
  };

  const smoothPass = (source: THREE.Texture, target: THREE.WebGLRenderTarget, x: number, y: number) => {
    smoothUniforms.uDepth.value = source;
    smoothUniforms.uDirection.value.set(x, y);
    target.scissor.copy(scissor);
    renderer.setRenderTarget(target);
    renderer.render(smoothScene, fullscreenCamera);
  };

  return {
    dropletRipples: particles.dropletRipples,

    setSize(width, height) {
      compositeUniforms.uResolution.value.set(width, height);
      withPassState(() => {
        passTargets.forEach((target) => {
          target.setSize(width, height);
          target.scissor.set(0, 0, width, height);
          clearTarget(target);
        });
      });
    },

    async compile() {
      const pending: Array<Promise<unknown>> = [];
      withPassState(() => {
        renderer.setRenderTarget(depthTarget);
        pending.push(renderer.compileAsync(depthScene, camera));
        renderer.setRenderTarget(thicknessTarget);
        pending.push(renderer.compileAsync(thicknessScene, camera));
        renderer.setRenderTarget(smoothTargets[0]);
        pending.push(renderer.compileAsync(smoothScene, fullscreenCamera));
        renderer.setRenderTarget(null);
        pending.push(renderer.compileAsync(compositeScene, fullscreenCamera));
      });
      await Promise.all(pending);
    },

    render(age, background) {
      if (age < 0 || age > SPLASH_DURATION) return;
      renderer.getDrawingBufferSize(drawingBufferSize);
      updateScissor(age, drawingBufferSize.x, drawingBufferSize.y);
      if (scissor.z === 0 || scissor.w === 0) return;

      particleUniforms.uAge.value = age;
      particleUniforms.uPixelScale.value = camera.projectionMatrix.elements[5] * drawingBufferSize.y * 0.5;
      particleUniforms.uViewUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
      compositeUniforms.uBackground.value = background;
      compositeUniforms.uProjectionScale.value.set(
        camera.projectionMatrix.elements[0],
        camera.projectionMatrix.elements[5],
      );
      compositeUniforms.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
      compositeUniforms.uLightViewPosition.value
        .copy(lightPosition)
        .applyMatrix4(camera.matrixWorldInverse);

      const outputTarget = renderer.getRenderTarget();
      withPassState(() => {
        depthTarget.scissor.copy(scissor);
        clearTarget(depthTarget);
        renderer.render(depthScene, camera);

        thicknessTarget.scissor.copy(scissor);
        clearTarget(thicknessTarget);
        renderer.render(thicknessScene, camera);

        let source: THREE.Texture = depthTarget.texture;
        for (let iteration = 0; iteration < SMOOTHING_ITERATIONS; iteration += 1) {
          smoothPass(source, smoothTargets[0], 1, 0);
          smoothPass(smoothTargets[0].texture, smoothTargets[1], 0, 1);
          source = smoothTargets[1].texture;
        }
      });

      renderer.setRenderTarget(outputTarget);
      const pixelRatio = renderer.getPixelRatio();
      const previousAutoClear = renderer.autoClear;
      const previousScissorTest = renderer.getScissorTest();
      renderer.getScissor(savedScissor);
      renderer.autoClear = false;
      renderer.setScissor(
        scissor.x / pixelRatio,
        scissor.y / pixelRatio,
        scissor.z / pixelRatio,
        scissor.w / pixelRatio,
      );
      renderer.setScissorTest(true);
      renderer.render(compositeScene, fullscreenCamera);
      renderer.setScissor(savedScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.autoClear = previousAutoClear;
    },

    dispose() {
      geometry.dispose();
      depthMaterial.dispose();
      thicknessMaterial.dispose();
      smoothMaterial.dispose();
      compositeMaterial.dispose();
      passTargets.forEach((target) => target.dispose());
    },
  };
}
