import * as THREE from 'three';
import fullscreenVertexShader from './water/fullscreen.vert';
import rippleLutFragmentShader from './water/ripple-lut.frag';
import { SPLASH_GRAVITY, SPLASH_RIPPLE_SOURCES } from './liquidSplash';

export const RIPPLE_RADIUS_RANGE = 12;
export const RIPPLE_DURATION = 4.5;
const LUT_WIDTH = 320;
const LUT_HEIGHT = 96;
// Each row integrates the full spectrum for every radius; small chunks keep
// the build under a couple of milliseconds per frame on integrated GPUs.
const ROWS_PER_CHUNK = 4;
const WAVENUMBER_SAMPLES = 160;
const MAX_WAVENUMBER = 14;
const VISCOSITY = 0.0035;

export interface ImpactRippleLut {
  readonly texture: THREE.Texture;
  /** x: radius range, y: duration, z/w: texel counts along radius and time. */
  readonly size: THREE.Vector4;
  readonly ready: boolean;
  compile(): Promise<void>;
  buildChunk(): void;
  buildAll(): void;
  dispose(): void;
}

/**
 * Tabulates the axisymmetric surface response to the splash as height and
 * radial slope over (radius, time). Built once on the GPU, a few rows per
 * frame, then sampled per pixel by the water shader.
 */
export function createImpactRippleLut(
  renderer: THREE.WebGLRenderer,
  fullscreenGeometry: THREE.BufferGeometry,
  fullscreenCamera: THREE.Camera,
): ImpactRippleLut {
  const target = new THREE.WebGLRenderTarget(LUT_WIDTH, LUT_HEIGHT, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.name = 'impact-ripple-lut';
  target.scissorTest = true;

  const { impact, crownReturn, jetReturn } = SPLASH_RIPPLE_SOURCES;
  const material = new THREE.RawShaderMaterial({
    vertexShader: fullscreenVertexShader,
    fragmentShader: rippleLutFragmentShader,
    uniforms: {
      uLutSize: { value: new THREE.Vector4(RIPPLE_RADIUS_RANGE, RIPPLE_DURATION, LUT_WIDTH, LUT_HEIGHT) },
      uGravity: { value: SPLASH_GRAVITY },
      uViscosity: { value: VISCOSITY },
      uMaxWavenumber: { value: MAX_WAVENUMBER },
      uWavenumberSamples: { value: WAVENUMBER_SAMPLES },
      uImpactSource: { value: new THREE.Vector3(impact.speed, impact.radius, impact.start) },
      uRingSource: {
        value: new THREE.Vector4(crownReturn.speed, crownReturn.radius, crownReturn.width, crownReturn.start),
      },
      uJetSource: { value: new THREE.Vector3(jetReturn.speed, jetReturn.radius, jetReturn.start) },
    },
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(fullscreenGeometry, material));
  let rowsBuilt = 0;

  const renderRows = (rows: number) => {
    const rowCount = Math.min(rows, LUT_HEIGHT - rowsBuilt);
    if (rowCount <= 0) return;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    target.scissor.set(0, rowsBuilt, LUT_WIDTH, rowCount);
    renderer.setRenderTarget(target);
    renderer.render(scene, fullscreenCamera);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    rowsBuilt += rowCount;
  };

  return {
    texture: target.texture,
    size: material.uniforms.uLutSize.value,
    get ready() {
      return rowsBuilt >= LUT_HEIGHT;
    },
    async compile() {
      const previousTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      const pending = renderer.compileAsync(scene, fullscreenCamera);
      renderer.setRenderTarget(previousTarget);
      await pending;
    },
    buildChunk() {
      renderRows(ROWS_PER_CHUNK);
    },
    buildAll() {
      renderRows(LUT_HEIGHT);
    },
    dispose() {
      material.dispose();
      target.dispose();
    },
  };
}
