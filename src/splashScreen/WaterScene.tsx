'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import heightVertexShader from './water/height.vert';
import heightFragmentShader from './water/height.frag';
import waveFragmentShader from './water/wave.frag';
import waterVertexShader from './water/water.vert';
import waterFragmentShader from './water/water.frag';
import splashCoreVertexShader from './water/splash-core.vert';
import splashCoreFragmentShader from './water/splash-core.frag';
import splashVertexShader from './water/splash.vert';
import splashFragmentShader from './water/splash.frag';
import thicknessFragmentShader from './water/thickness.frag';
import foamFragmentShader from './water/foam.frag';
import sprayVertexShader from './water/spray.vert';
import sprayFragmentShader from './water/spray.frag';
import dropVertexShader from './water/drop.vert';
import dropFragmentShader from './water/drop.frag';

interface WaterSceneProps {
  onComplete?: () => void;
  intro?: boolean;
}

const LOG = '[WaterScene]';
const IMPACT_Z = -2;
const DROP_START_Y = 3.65;
const DROP_DELAY = 0.65;
const DROP_DURATION = 1.05;
const SECONDARY_IMPACT_DELAY = 0.78;
const REVEAL_IMPACT_AGE = 1.18;
const SPRAY_PARTICLE_COUNT = 48;
const POINTER_RIPPLE_COUNT = 12;
const POINTER_SPRAY_COUNT = 18;
const POINTER_RIPPLE_INTERVAL = 0.065;
const POINTER_RIPPLE_MIN_DISTANCE = 12;
const POINTER_STROKE_RESET_DELAY = 0.18;
const POINTER_SEGMENT_MAX_LENGTH = 5;
// Keep GPU time uniforms small enough to preserve sub-frame precision after
// the page has been open for hours. All relative timestamps are rebased with
// the same offset, so animation ages remain continuous.
const TIME_REBASE_INTERVAL_SECONDS = 256;
const WATER_WIDTH = 420;
const WATER_LENGTH = 520;
const LIGHT_SCREEN_NDC = new THREE.Vector3(-1, 1, 0.15);
const WIND_DIRECTION = new THREE.Vector2(-1, 0);
const WIND_STRENGTH = 1;

interface SprayParticle {
  angle: number;
  delay: number;
  radialSpeed: number;
  verticalSpeed: number;
  drift: number;
}

interface PointerSprayParticle {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  bornAt: number;
  lifetime: number;
  size: number;
}

export default function WaterScene({ onComplete, intro = false }: WaterSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const activeHost = document.querySelector<HTMLElement>('[data-water-scene-active="true"]');
    if (activeHost && activeHost !== host && activeHost.isConnected) {
      console.warn(`${LOG} duplicate mount ignored`);
      return;
    }
    host.dataset.waterSceneActive = 'true';
    let playIntro = intro
      && document.querySelector<HTMLElement>('[data-home-stage]')?.dataset.waterIntroSkipped !== 'true';
    const waterDebugMode = import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get('waterDebug')
      : null;
    const holdSplashForDiagnostics = waterDebugMode === 'hold-splash'
      || waterDebugMode === 'hold-core';
    const holdCoreSplashForDiagnostics = waterDebugMode === 'hold-core';
    const traceTiming = (stage: string, detail: Record<string, unknown> = {}) => {
      console.info(`${LOG}[timing] ${JSON.stringify({
        stage,
        pageMs: Math.round(performance.now() * 10) / 10,
        ...detail,
      })}`);
    };
    traceTiming('effect-mounted', {
      intro,
      playIntro,
      pathname: window.location.pathname,
    });

    console.groupCollapsed(`${LOG} boot`);
    console.info(`${LOG} GLSL loaded`, {
      heightVertex: heightVertexShader.length,
      heightFragment: heightFragmentShader.length,
      waterVertex: waterVertexShader.length,
      waterFragment: waterFragmentShader.length,
    });

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      console.error(`${LOG} renderer creation failed`, error);
      window.dispatchEvent(new CustomEvent('water:compatibility-fallback', {
        detail: { scope: 'all' },
      }));
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x050911, 0);
    host.appendChild(renderer.domElement);

    const gl = renderer.getContext();
    const parallelShaderCompile = gl.getExtension('KHR_parallel_shader_compile');
    console.info(`${LOG} renderer ready`, {
      webgl2: renderer.capabilities.isWebGL2,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      maxTextureSize: renderer.capabilities.maxTextureSize,
      parallelShaderCompile: Boolean(parallelShaderCompile),
    });
    traceTiming('renderer-ready', {
      webgl2: renderer.capabilities.isWebGL2,
      parallelShaderCompile: Boolean(parallelShaderCompile),
    });

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.FogExp2(0x050911, 0.022);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 5.1, 7.4);
    camera.lookAt(0, 0.05, -4.2);

    const heightUniforms = {
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
      uRippleAge2: { value: -1 },
      uImpactStrength: { value: 1 },
      uRippleCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uWaterSize: { value: new THREE.Vector2(WATER_WIDTH, WATER_LENGTH) },
      uImpactStrength2: { value: 0.62 },
      uWindDirection: { value: WIND_DIRECTION.clone() },
      uWindSpeed: { value: 0.022 },
      uPointerRipples: {
        value: Array.from(
          { length: POINTER_RIPPLE_COUNT },
          () => new THREE.Vector4(0.5, 0.5, -100, 0),
        ),
      },
      uPointerDirections: {
        value: Array.from(
          { length: POINTER_RIPPLE_COUNT },
          () => new THREE.Vector2(1, 0),
        ),
      },
      uPointerPrevious: {
        value: Array.from(
          { length: POINTER_RIPPLE_COUNT },
          () => new THREE.Vector2(0.5, 0.5),
        ),
      },
      uWaveState: { value: null as THREE.Texture | null },
    };

    const heightMaterial = new THREE.RawShaderMaterial({
      vertexShader: heightVertexShader,
      fragmentShader: heightFragmentShader,
      uniforms: heightUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    const heightScene = new THREE.Scene();
    const heightCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const heightQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), heightMaterial);
    heightScene.add(heightQuad);

    const heightTargetSize = window.innerWidth < 768 ? 128 : 192;
    const heightTarget = new THREE.WebGLRenderTarget(heightTargetSize, heightTargetSize, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    heightTarget.texture.name = 'splash-ripple-height';
    const waveTargetSize = window.innerWidth < 768 ? 256 : 384;
    const createWaveStateTarget = (name: string) => {
      const target = new THREE.WebGLRenderTarget(waveTargetSize, waveTargetSize, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      target.texture.name = name;
      return target;
    };
    let waveReadTarget = createWaveStateTarget('water-wave-state-a');
    let waveWriteTarget = createWaveStateTarget('water-wave-state-b');
    const waveUniforms = {
      uPreviousState: { value: waveReadTarget.texture },
      uTexel: { value: new THREE.Vector2(1 / waveTargetSize, 1 / waveTargetSize) },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uTime: { value: 0 },
      uDeltaTime: { value: 1 / 60 },
      uWaveStiffness: { value: 18 },
      uDamping: { value: 2.35 },
      uPointerImpulses: { value: heightUniforms.uPointerRipples.value },
      uPointerPrevious: { value: heightUniforms.uPointerPrevious.value },
      uImpactCenter: { value: heightUniforms.uRippleCenter.value },
      uImpactStart: { value: -100 },
      uImpactStrength: { value: 1 },
    };
    const waveSimulationMaterial = new THREE.RawShaderMaterial({
      vertexShader: heightVertexShader,
      fragmentShader: waveFragmentShader,
      uniforms: waveUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    const waveSimulationScene = new THREE.Scene();
    const waveSimulationCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const waveSimulationQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      waveSimulationMaterial,
    );
    waveSimulationScene.add(waveSimulationQuad);
    heightUniforms.uWaveState.value = waveReadTarget.texture;
    const initialClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const initialClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(waveReadTarget);
    renderer.clear();
    renderer.setRenderTarget(waveWriteTarget);
    renderer.clear();
    renderer.setRenderTarget(null);
    renderer.setClearColor(initialClearColor, initialClearAlpha);
    const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    sceneTarget.texture.name = 'splash-refraction-background';
    const splashWarmupTarget = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    splashWarmupTarget.texture.name = 'splash-pipeline-warmup';
    const createThicknessTarget = (name: string) => {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
      target.texture.name = name;
      return target;
    };
    const frontDepthTarget = createThicknessTarget('splash-front-depth');
    const backDepthTarget = createThicknessTarget('splash-back-depth');
    console.info(`${LOG} height pass ready`, {
      size: heightTargetSize,
      textureType: 'HalfFloatType',
      colorBufferFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    });

    const lightPosition = new THREE.Vector3();
    const backgroundVideo = document.querySelector<HTMLVideoElement>('#background-video');
    const fallbackVideoTexture = new THREE.DataTexture(
      new Uint8Array([5, 9, 17, 255]),
      1,
      1,
      THREE.RGBAFormat,
    );
    fallbackVideoTexture.needsUpdate = true;
    fallbackVideoTexture.colorSpace = THREE.SRGBColorSpace;
    const videoTexture = backgroundVideo
      ? new THREE.VideoTexture(backgroundVideo)
      : fallbackVideoTexture;
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    const distantLightDirection = new THREE.Vector3(-0.32, 0.84, 0.44).normalize();
    const initialDeepColor = new THREE.Color(0x030711);
    const initialSurfaceColor = new THREE.Color(0x0a1c2c);
    const revealedDeepColor = new THREE.Color(0x071728);
    const revealedSurfaceColor = new THREE.Color(0x17435b);
    const waterUniforms = {
      uHeightMap: { value: heightTarget.texture },
      uHeightTexel: { value: new THREE.Vector2(1 / heightTargetSize, 1 / heightTargetSize) },
      uHeightScale: { value: 1.45 },
      uLightPosition: { value: lightPosition },
      uDistantLightDirection: { value: distantLightDirection },
      uDeepColor: { value: (playIntro ? initialDeepColor : revealedDeepColor).clone() },
      uSurfaceColor: { value: (playIntro ? initialSurfaceColor : revealedSurfaceColor).clone() },
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
      uRippleCenter: { value: heightUniforms.uRippleCenter.value },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uWaveState: { value: waveReadTarget.texture },
      uWaveTexel: { value: new THREE.Vector2(1 / waveTargetSize, 1 / waveTargetSize) },
      uVideoTexture: { value: videoTexture },
      uVideoReady: { value: 0 },
      uVideoUvScale: { value: new THREE.Vector2(1, 1) },
      uVideoUvOffset: { value: new THREE.Vector2(0, 0) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uRevealProgress: { value: playIntro ? 0 : 1 },
    };
    const waterMaterial = new THREE.RawShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: waterUniforms,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      fog: false,
    });
    const compactViewport = window.innerWidth < 768;
    const waterGeometry = new THREE.PlaneGeometry(
      WATER_WIDTH,
      WATER_LENGTH,
      compactViewport ? 56 : 80,
      compactViewport ? 96 : 128,
    );
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.35, -100);
    scene.add(water);

    const impactWorldPosition = new THREE.Vector3(0, water.position.y, IMPACT_Z);
    const viewportCenter = new THREE.Vector2(0, 0);
    const impactRaycaster = new THREE.Raycaster();
    const waterSurfacePlane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -water.position.y,
    );
    const syncVideoCover = () => {
      const viewportWidth = Math.max(host.clientWidth, 1);
      const viewportHeight = Math.max(host.clientHeight, 1);
      const videoWidth = backgroundVideo?.videoWidth || 1920;
      const videoHeight = backgroundVideo?.videoHeight || 1080;
      const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
      const displayWidth = videoWidth * scale;
      const displayHeight = videoHeight * scale;
      const left = (viewportWidth - displayWidth) * 0.54;
      const top = (viewportHeight - displayHeight) * 0.5;
      waterUniforms.uVideoUvScale.value.set(
        viewportWidth / displayWidth,
        viewportHeight / displayHeight,
      );
      waterUniforms.uVideoUvOffset.value.set(
        -left / displayWidth,
        -top / displayHeight,
      );
    };
    const syncWaterMetrics = () => {
      water.updateMatrixWorld(true);
      const localImpact = water.worldToLocal(impactWorldPosition.clone());
      heightUniforms.uRippleCenter.value.set(
        localImpact.x / WATER_WIDTH + 0.5,
        localImpact.y / WATER_LENGTH + 0.5,
      );
      heightUniforms.uWaterSize.value.set(
        WATER_WIDTH * water.scale.x,
        WATER_LENGTH * water.scale.y,
      );
    };
    syncWaterMetrics();
    syncVideoCover();
    backgroundVideo?.addEventListener('loadedmetadata', syncVideoCover);

    const pointLight = new THREE.PointLight(0xa9d8ff, 150, 48, 2);
    scene.add(pointLight);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext('2d');
    if (glowContext) {
      const gradient = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(220, 242, 255, 0.95)');
      gradient.addColorStop(0.16, 'rgba(132, 198, 255, 0.55)');
      gradient.addColorStop(0.48, 'rgba(58, 127, 210, 0.16)');
      gradient.addColorStop(1, 'rgba(10, 31, 60, 0)');
      glowContext.fillStyle = gradient;
      glowContext.fillRect(0, 0, 128, 128);
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    glowTexture.colorSpace = THREE.SRGBColorSpace;

    const environmentCanvas = document.createElement('canvas');
    environmentCanvas.width = 512;
    environmentCanvas.height = 256;
    const environmentContext = environmentCanvas.getContext('2d');
    if (environmentContext) {
      const skyGradient = environmentContext.createLinearGradient(0, 0, 0, 256);
      skyGradient.addColorStop(0, '#061424');
      skyGradient.addColorStop(0.45, '#0a2945');
      skyGradient.addColorStop(1, '#174f78');
      environmentContext.fillStyle = skyGradient;
      environmentContext.fillRect(0, 0, 512, 256);

      const environmentGlow = environmentContext.createRadialGradient(30, 28, 0, 30, 28, 105);
      environmentGlow.addColorStop(0, 'rgba(220, 243, 255, 0.92)');
      environmentGlow.addColorStop(0.18, 'rgba(118, 190, 241, 0.48)');
      environmentGlow.addColorStop(0.58, 'rgba(39, 98, 153, 0.13)');
      environmentGlow.addColorStop(1, 'rgba(8, 29, 51, 0)');
      environmentContext.fillStyle = environmentGlow;
      environmentContext.fillRect(0, 0, 180, 150);

      const horizonGradient = environmentContext.createLinearGradient(0, 112, 0, 172);
      horizonGradient.addColorStop(0, 'rgba(70, 139, 184, 0)');
      horizonGradient.addColorStop(0.48, 'rgba(79, 154, 201, 0.2)');
      horizonGradient.addColorStop(1, 'rgba(8, 30, 51, 0)');
      environmentContext.fillStyle = horizonGradient;
      environmentContext.fillRect(0, 112, 512, 60);

      const cloudBands = [
        { y: 48, width: 2.8, alpha: 0.12, bend: 9 },
        { y: 72, width: 5.2, alpha: 0.09, bend: -12 },
        { y: 101, width: 3.4, alpha: 0.1, bend: 7 },
        { y: 132, width: 6.5, alpha: 0.07, bend: -8 },
      ];
      cloudBands.forEach((band, index) => {
        environmentContext.beginPath();
        environmentContext.moveTo(-20, band.y);
        environmentContext.bezierCurveTo(
          120,
          band.y + band.bend,
          330,
          band.y - band.bend * 0.7,
          532,
          band.y + (index % 2 === 0 ? 4 : -3),
        );
        environmentContext.strokeStyle = `rgba(126, 184, 218, ${band.alpha})`;
        environmentContext.lineWidth = band.width;
        environmentContext.stroke();
      });
    }
    const environmentTexture = new THREE.CanvasTexture(environmentCanvas);
    environmentTexture.colorSpace = THREE.SRGBColorSpace;
    environmentTexture.mapping = THREE.EquirectangularReflectionMapping;
    environmentTexture.wrapS = THREE.RepeatWrapping;
    environmentTexture.minFilter = THREE.LinearMipmapLinearFilter;
    environmentTexture.magFilter = THREE.LinearFilter;
    environmentTexture.generateMipmaps = true;
    const lightGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    lightGlow.scale.set(3.1, 3.1, 1);
    scene.add(lightGlow);

    const placeLightAtScreenOrigin = () => {
      camera.updateMatrixWorld();
      const screenTopLeft = LIGHT_SCREEN_NDC.clone().unproject(camera);
      const direction = screenTopLeft.sub(camera.position).normalize();
      lightPosition.copy(camera.position).addScaledVector(direction, 10.5);
      pointLight.position.copy(lightPosition);
      lightGlow.position.copy(lightPosition);
      distantLightDirection.copy(lightPosition).sub(impactWorldPosition).normalize();
    };
    placeLightAtScreenOrigin();
    console.info(`${LOG} water mesh ready`, {
      vertices: waterGeometry.attributes.position.count,
      lightPosition: lightPosition.toArray(),
      impactUv: heightUniforms.uRippleCenter.value.toArray(),
    });

    const dropUniforms = {
      uSceneTexture: { value: sceneTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
    };
    const dropMaterial = new THREE.RawShaderMaterial({
      vertexShader: dropVertexShader,
      fragmentShader: dropFragmentShader,
      uniforms: dropUniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
    });
    const dropProfile = [
      new THREE.Vector2(0.0, 0.82),
      new THREE.Vector2(0.16, 0.68),
      new THREE.Vector2(0.4, 0.4),
      new THREE.Vector2(0.62, 0.12),
      new THREE.Vector2(0.68, -0.16),
      new THREE.Vector2(0.64, -0.42),
      new THREE.Vector2(0.48, -0.63),
      new THREE.Vector2(0.25, -0.76),
      new THREE.Vector2(0.0, -0.8),
    ];
    const drop = new THREE.Mesh(
      new THREE.LatheGeometry(dropProfile, 36),
      dropMaterial,
    );
    drop.scale.setScalar(0.22);
    drop.position.set(0, DROP_START_Y, IMPACT_Z);
    drop.visible = false;
    drop.frustumCulled = false;
    drop.renderOrder = 20;
    scene.add(drop);

    const splashUniforms = {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uLightPosition: { value: lightPosition },
      uWaterColor: { value: waterUniforms.uSurfaceColor.value.clone() },
      uDeepWaterColor: { value: waterUniforms.uDeepColor.value.clone() },
      uTipWaterColor: { value: new THREE.Color(0x9edcf3) },
      uSceneTexture: { value: sceneTarget.texture },
      uEnvironmentMap: { value: environmentTexture },
      uFrontDepthMap: { value: frontDepthTarget.texture },
      uBackDepthMap: { value: backDepthTarget.texture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uHeightMap: { value: heightTarget.texture },
      uRippleCenter: { value: heightUniforms.uRippleCenter.value },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uHeightScale: { value: waterUniforms.uHeightScale.value },
      uLayerOffset: { value: 0 },
      uRimMode: { value: 0 },
      uWaterLevel: { value: water.position.y - 0.02 },
    };
    const createWaveMaterial = (
      vertexShader: string,
      fragmentShader = splashFragmentShader,
    ) => new THREE.RawShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: splashUniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const coreWaveMaterial = createWaveMaterial(
      splashCoreVertexShader,
      splashCoreFragmentShader,
    );
    coreWaveMaterial.side = THREE.DoubleSide;
    coreWaveMaterial.polygonOffset = true;
    coreWaveMaterial.polygonOffsetFactor = -1;
    coreWaveMaterial.polygonOffsetUnits = -1;
    const waveMaterial = createWaveMaterial(splashVertexShader);
    coreWaveMaterial.forceSinglePass = true;
    waveMaterial.forceSinglePass = true;
    const crownSegments = 96;
    const crownRings = 18;
    const crownPositions: number[] = [];
    const crownTheta: number[] = [];
    const crownRadial: number[] = [];
    const crownSide: number[] = [];
    const crownRimAngle: number[] = [];
    const crownCircle: number[] = [];
    const crownLobeStrength: number[] = [];
    const crownAngularDrift: number[] = [];
    const crownEdgeNoise: number[] = [];
    const crownIndices: number[] = [];
    const crownRowSize = crownRings + 1;
    const crownSurfaceVertexCount = (crownSegments + 1) * crownRowSize;
    const crownPeakValue = (
      theta: number,
      center: number,
      width: number,
      strength: number,
    ) => {
      const delta = Math.atan2(Math.sin(theta - center), Math.cos(theta - center));
      return Math.exp(-((delta / width) ** 2)) * strength;
    };
    const crownLobeValue = (theta: number) => Math.min(1, Math.max(
      crownPeakValue(theta, 0.38, 0.31, 0.82),
      crownPeakValue(theta, 1.36, 0.37, 0.56),
      crownPeakValue(theta, 2.58, 0.25, 1),
      crownPeakValue(theta, 3.35, 0.3, 0.68),
      crownPeakValue(theta, 4.68, 0.27, 0.91),
      crownPeakValue(theta, 5.72, 0.4, 0.61),
    ));
    for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
      const side = sideIndex === 0 ? 1 : -1;
      for (let segment = 0; segment <= crownSegments; segment += 1) {
        const theta = (segment / crownSegments) * Math.PI * 2;
        const circleX = Math.cos(theta);
        const circleY = Math.sin(theta);
        const lobeStrength = crownLobeValue(theta)
          * (0.97 + Math.sin(theta * 11.3 + 0.8) * 0.03);
        const angularDrift = Math.sin(theta * 3 + 0.7) * 0.042
          + Math.sin(theta * 7 - 1.1) * 0.018;
        const edgeNoise = 1
          + 0.026 * Math.sin(theta * 9 + 0.8)
          + 0.012 * Math.sin(theta * 17 - 1.1);
        for (let ring = 0; ring <= crownRings; ring += 1) {
          crownPositions.push(0, 0, 0);
          crownTheta.push(theta);
          crownRadial.push(ring / crownRings);
          crownSide.push(side);
          crownRimAngle.push(0);
          crownCircle.push(circleX, circleY);
          crownLobeStrength.push(lobeStrength);
          crownAngularDrift.push(angularDrift);
          crownEdgeNoise.push(edgeNoise);
        }
      }
    }
    for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
      const surfaceOffset = sideIndex * crownSurfaceVertexCount;
      for (let segment = 0; segment < crownSegments; segment += 1) {
        for (let ring = 0; ring < crownRings; ring += 1) {
          const a = surfaceOffset + segment * crownRowSize + ring;
          const b = a + crownRowSize;
          if (sideIndex === 0) {
            crownIndices.push(a, b, a + 1, b, b + 1, a + 1);
          } else {
            crownIndices.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
      }
    }
    for (let segment = 0; segment < crownSegments; segment += 1) {
      const topInner = segment * crownRowSize;
      const nextTopInner = topInner + crownRowSize;
      const bottomInner = crownSurfaceVertexCount + topInner;
      const nextBottomInner = crownSurfaceVertexCount + nextTopInner;
      crownIndices.push(topInner, bottomInner, nextTopInner, nextTopInner, bottomInner, nextBottomInner);

      const topOuter = topInner + crownRings;
      const nextTopOuter = nextTopInner + crownRings;
      const bottomOuter = crownSurfaceVertexCount + topOuter;
      const nextBottomOuter = crownSurfaceVertexCount + nextTopOuter;
      crownIndices.push(topOuter, nextTopOuter, bottomOuter, nextTopOuter, nextBottomOuter, bottomOuter);
    }
    const crownGeometry = new THREE.BufferGeometry();
    crownGeometry.setAttribute('position', new THREE.Float32BufferAttribute(crownPositions, 3));
    crownGeometry.setAttribute('aTheta', new THREE.Float32BufferAttribute(crownTheta, 1));
    crownGeometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(crownRadial, 1));
    crownGeometry.setAttribute('aSide', new THREE.Float32BufferAttribute(crownSide, 1));
    crownGeometry.setAttribute('aRimAngle', new THREE.Float32BufferAttribute(crownRimAngle, 1));
    crownGeometry.setAttribute('aCircle', new THREE.Float32BufferAttribute(crownCircle, 2));
    crownGeometry.setAttribute(
      'aLobeStrength',
      new THREE.Float32BufferAttribute(crownLobeStrength, 1),
    );
    crownGeometry.setAttribute(
      'aAngularDrift',
      new THREE.Float32BufferAttribute(crownAngularDrift, 1),
    );
    crownGeometry.setAttribute(
      'aEdgeNoise',
      new THREE.Float32BufferAttribute(crownEdgeNoise, 1),
    );
    crownGeometry.setIndex(crownIndices);

    const crownSurfaceGeometry = new THREE.BufferGeometry();
    const surfacePositionCount = crownSurfaceVertexCount * 3;
    crownSurfaceGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(crownPositions.slice(0, surfacePositionCount), 3),
    );
    crownSurfaceGeometry.setAttribute(
      'aTheta',
      new THREE.Float32BufferAttribute(crownTheta.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aRadial',
      new THREE.Float32BufferAttribute(crownRadial.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aSide',
      new THREE.Float32BufferAttribute(crownSide.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aRimAngle',
      new THREE.Float32BufferAttribute(crownRimAngle.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aCircle',
      new THREE.Float32BufferAttribute(crownCircle.slice(0, crownSurfaceVertexCount * 2), 2),
    );
    crownSurfaceGeometry.setAttribute(
      'aLobeStrength',
      new THREE.Float32BufferAttribute(crownLobeStrength.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aAngularDrift',
      new THREE.Float32BufferAttribute(crownAngularDrift.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setAttribute(
      'aEdgeNoise',
      new THREE.Float32BufferAttribute(crownEdgeNoise.slice(0, crownSurfaceVertexCount), 1),
    );
    crownSurfaceGeometry.setIndex(
      crownIndices.slice(0, crownSegments * crownRings * 6),
    );
    traceTiming('core-geometry-ready', {
      vertices: crownSurfaceVertexCount,
      triangles: crownSegments * crownRings * 2,
    });

    const rimTubeSegments = 10;
    const rimPositions: number[] = [];
    const rimTheta: number[] = [];
    const rimRadial: number[] = [];
    const rimSide: number[] = [];
    const rimAngles: number[] = [];
    const rimIndices: number[] = [];
    const rimRowSize = rimTubeSegments + 1;
    for (let segment = 0; segment <= crownSegments; segment += 1) {
      const theta = (segment / crownSegments) * Math.PI * 2;
      for (let tubeSegment = 0; tubeSegment <= rimTubeSegments; tubeSegment += 1) {
        rimPositions.push(0, 0, 0);
        rimTheta.push(theta);
        rimRadial.push(1);
        rimSide.push(1);
        rimAngles.push((tubeSegment / rimTubeSegments) * Math.PI * 2);
      }
    }
    for (let segment = 0; segment < crownSegments; segment += 1) {
      for (let tubeSegment = 0; tubeSegment < rimTubeSegments; tubeSegment += 1) {
        const a = segment * rimRowSize + tubeSegment;
        const b = a + rimRowSize;
        rimIndices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const rimGeometry = new THREE.BufferGeometry();
    rimGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rimPositions, 3));
    rimGeometry.setAttribute('aTheta', new THREE.Float32BufferAttribute(rimTheta, 1));
    rimGeometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(rimRadial, 1));
    rimGeometry.setAttribute('aSide', new THREE.Float32BufferAttribute(rimSide, 1));
    rimGeometry.setAttribute('aRimAngle', new THREE.Float32BufferAttribute(rimAngles, 1));
    rimGeometry.setIndex(rimIndices);

    const crownPeakAngles = [0.38, 1.36, 2.58, 3.35, 4.68, 5.72];
    const tipPeakAngles = [0.38, 2.58, 4.68, 5.72];
    const beadLatitudeSegments = 8;
    const beadLongitudeSegments = 12;
    const beadPositions: number[] = [];
    const beadTheta: number[] = [];
    const beadRadial: number[] = [];
    const beadSide: number[] = [];
    const beadAngles: number[] = [];
    const beadIndices: number[] = [];
    const beadRowSize = beadLongitudeSegments + 1;
    const beadVertexCount = (beadLatitudeSegments + 1) * beadRowSize;
    tipPeakAngles.forEach((peakTheta, peakIndex) => {
      const vertexOffset = peakIndex * beadVertexCount;
      for (let latitude = 0; latitude <= beadLatitudeSegments; latitude += 1) {
        for (let longitude = 0; longitude <= beadLongitudeSegments; longitude += 1) {
          beadPositions.push(0, 0, 0);
          beadTheta.push(peakTheta);
          beadRadial.push(latitude / beadLatitudeSegments);
          beadSide.push(1);
          beadAngles.push((longitude / beadLongitudeSegments) * Math.PI * 2);
        }
      }
      for (let latitude = 0; latitude < beadLatitudeSegments; latitude += 1) {
        for (let longitude = 0; longitude < beadLongitudeSegments; longitude += 1) {
          const a = vertexOffset + latitude * beadRowSize + longitude;
          const b = a + beadRowSize;
          beadIndices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    });
    const beadGeometry = new THREE.BufferGeometry();
    beadGeometry.setAttribute('position', new THREE.Float32BufferAttribute(beadPositions, 3));
    beadGeometry.setAttribute('aTheta', new THREE.Float32BufferAttribute(beadTheta, 1));
    beadGeometry.setAttribute('aRadial', new THREE.Float32BufferAttribute(beadRadial, 1));
    beadGeometry.setAttribute('aSide', new THREE.Float32BufferAttribute(beadSide, 1));
    beadGeometry.setAttribute('aRimAngle', new THREE.Float32BufferAttribute(beadAngles, 1));
    beadGeometry.setIndex(beadIndices);

    const ligamentLengthSegments = 14;
    const ligamentTubeSegments = 10;
    const ligamentPositions: number[] = [];
    const ligamentTheta: number[] = [];
    const ligamentRadial: number[] = [];
    const ligamentSide: number[] = [];
    const ligamentAngles: number[] = [];
    const ligamentIndices: number[] = [];
    const ligamentRowSize = ligamentTubeSegments + 1;
    const ligamentVertexCount = (ligamentLengthSegments + 1) * ligamentRowSize;
    crownPeakAngles.forEach((peakTheta, peakIndex) => {
      const vertexOffset = peakIndex * ligamentVertexCount;
      for (let lengthSegment = 0; lengthSegment <= ligamentLengthSegments; lengthSegment += 1) {
        for (let tubeSegment = 0; tubeSegment <= ligamentTubeSegments; tubeSegment += 1) {
          ligamentPositions.push(0, 0, 0);
          ligamentTheta.push(peakTheta);
          ligamentRadial.push(lengthSegment / ligamentLengthSegments);
          ligamentSide.push(1);
          ligamentAngles.push((tubeSegment / ligamentTubeSegments) * Math.PI * 2);
        }
      }
      for (let lengthSegment = 0; lengthSegment < ligamentLengthSegments; lengthSegment += 1) {
        for (let tubeSegment = 0; tubeSegment < ligamentTubeSegments; tubeSegment += 1) {
          const a = vertexOffset + lengthSegment * ligamentRowSize + tubeSegment;
          const b = a + ligamentRowSize;
          ligamentIndices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    });
    const ligamentGeometry = new THREE.BufferGeometry();
    ligamentGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(ligamentPositions, 3),
    );
    ligamentGeometry.setAttribute(
      'aTheta',
      new THREE.Float32BufferAttribute(ligamentTheta, 1),
    );
    ligamentGeometry.setAttribute(
      'aRadial',
      new THREE.Float32BufferAttribute(ligamentRadial, 1),
    );
    ligamentGeometry.setAttribute(
      'aSide',
      new THREE.Float32BufferAttribute(ligamentSide, 1),
    );
    ligamentGeometry.setAttribute(
      'aRimAngle',
      new THREE.Float32BufferAttribute(ligamentAngles, 1),
    );
    ligamentGeometry.setIndex(ligamentIndices);

    const splashBase = new THREE.Mesh(rimGeometry, waveMaterial);
    splashBase.position.set(0, water.position.y + 0.04, IMPACT_Z);
    splashBase.frustumCulled = false;
    splashBase.renderOrder = 9.8;
    splashBase.visible = false;
    splashBase.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 3;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashBase);

    const splashWave = new THREE.Mesh(crownSurfaceGeometry, coreWaveMaterial);
    splashWave.position.copy(splashBase.position);
    splashWave.frustumCulled = false;
    splashWave.renderOrder = 10;
    splashWave.visible = false;
    splashWave.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 0;
      coreWaveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashWave);

    const enhancedSplashWave = new THREE.Mesh(crownSurfaceGeometry, waveMaterial);
    enhancedSplashWave.position.copy(splashWave.position);
    enhancedSplashWave.frustumCulled = false;
    enhancedSplashWave.renderOrder = 10;
    enhancedSplashWave.visible = false;
    enhancedSplashWave.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 0;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(enhancedSplashWave);

    const splashRim = new THREE.Mesh(rimGeometry, waveMaterial);
    splashRim.position.copy(splashWave.position);
    splashRim.frustumCulled = false;
    splashRim.renderOrder = 10.2;
    splashRim.visible = false;
    splashRim.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 1;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashRim);

    const splashLigaments = new THREE.Mesh(ligamentGeometry, waveMaterial);
    splashLigaments.position.copy(splashWave.position);
    splashLigaments.frustumCulled = false;
    splashLigaments.renderOrder = 10.3;
    splashLigaments.visible = false;
    splashLigaments.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 4;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashLigaments);

    const splashBeads = new THREE.Mesh(beadGeometry, waveMaterial);
    splashBeads.position.copy(splashWave.position);
    splashBeads.frustumCulled = false;
    splashBeads.renderOrder = 10.4;
    splashBeads.visible = false;
    splashBeads.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 2;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashBeads);

    const createDepthUniforms = () => ({
      uAge: { value: 0 },
      uLayerOffset: { value: 0 },
      uRimMode: { value: 0 },
      uHeightMap: { value: heightTarget.texture },
      uRippleCenter: { value: heightUniforms.uRippleCenter.value },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uHeightScale: { value: waterUniforms.uHeightScale.value },
      uWaterLevel: { value: water.position.y - 0.02 },
    });
    const frontDepthUniforms = createDepthUniforms();
    const backDepthUniforms = createDepthUniforms();
    const frontDepthMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashCoreVertexShader,
      fragmentShader: thicknessFragmentShader,
      uniforms: frontDepthUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
      side: THREE.FrontSide,
    });
    const backDepthMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashCoreVertexShader,
      fragmentShader: thicknessFragmentShader,
      uniforms: backDepthUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
      side: THREE.BackSide,
    });
    const frontDepthScene = new THREE.Scene();
    const backDepthScene = new THREE.Scene();
    const depthShells: THREE.Mesh[] = [];
    const addDepthMeshes = (
      targetScene: THREE.Scene,
      material: THREE.RawShaderMaterial,
      uniforms: ReturnType<typeof createDepthUniforms>,
    ) => {
      const shell = new THREE.Mesh(crownGeometry, material);
      shell.position.copy(splashWave.position);
      shell.frustumCulled = false;
      shell.renderOrder = 0;
      shell.onBeforeRender = () => {
        uniforms.uRimMode.value = 0;
      };
      depthShells.push(shell);
      targetScene.add(shell);
    };
    addDepthMeshes(frontDepthScene, frontDepthMaterial, frontDepthUniforms);
    addDepthMeshes(backDepthScene, backDepthMaterial, backDepthUniforms);

    const foamUniforms = {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uLightPosition: { value: lightPosition },
      uLayerOffset: { value: 0.0035 },
      uRimMode: { value: 0 },
      uHeightMap: { value: heightTarget.texture },
      uRippleCenter: { value: heightUniforms.uRippleCenter.value },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uHeightScale: { value: waterUniforms.uHeightScale.value },
      uWaterLevel: { value: water.position.y - 0.02 },
    };
    const foamMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashCoreVertexShader,
      fragmentShader: foamFragmentShader,
      uniforms: foamUniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
    });
    const splashFoam = new THREE.Mesh(crownSurfaceGeometry, foamMaterial);
    splashFoam.position.copy(splashWave.position);
    splashFoam.frustumCulled = false;
    splashFoam.renderOrder = 11;
    splashFoam.visible = false;
    scene.add(splashFoam);

    const sprayCanvas = document.createElement('canvas');
    sprayCanvas.width = 64;
    sprayCanvas.height = 64;
    const sprayContext = sprayCanvas.getContext('2d');
    if (sprayContext) {
      sprayContext.save();
      sprayContext.translate(32, 32);
      sprayContext.scale(0.72, 1);
      const sprayGradient = sprayContext.createRadialGradient(0, 0, 0, 0, 0, 29);
      sprayGradient.addColorStop(0, 'rgba(235, 249, 255, 0.92)');
      sprayGradient.addColorStop(0.24, 'rgba(174, 224, 248, 0.68)');
      sprayGradient.addColorStop(0.62, 'rgba(92, 170, 216, 0.22)');
      sprayGradient.addColorStop(1, 'rgba(48, 120, 170, 0)');
      sprayContext.fillStyle = sprayGradient;
      sprayContext.fillRect(-64, -32, 128, 64);
      sprayContext.restore();
    }
    const sprayTexture = new THREE.CanvasTexture(sprayCanvas);
    sprayTexture.colorSpace = THREE.SRGBColorSpace;
    sprayTexture.minFilter = THREE.LinearFilter;
    sprayTexture.magFilter = THREE.LinearFilter;
    const sprayMaterial = new THREE.RawShaderMaterial({
      vertexShader: sprayVertexShader,
      fragmentShader: sprayFragmentShader,
      uniforms: {
        uMap: { value: sprayTexture },
        uColor: { value: new THREE.Color(0xc6ecff) },
      },
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const sprayPositions = new Float32Array(SPRAY_PARTICLE_COUNT * 3);
    const sprayAlphas = new Float32Array(SPRAY_PARTICLE_COUNT);
    const sprayScales = new Float32Array(SPRAY_PARTICLE_COUNT);
    const sprayGeometry = new THREE.InstancedBufferGeometry();
    sprayGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ], 3));
    sprayGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ], 2));
    sprayGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const sprayPositionAttribute = new THREE.InstancedBufferAttribute(sprayPositions, 3);
    const sprayAlphaAttribute = new THREE.InstancedBufferAttribute(sprayAlphas, 1);
    const sprayScaleAttribute = new THREE.InstancedBufferAttribute(sprayScales, 1);
    sprayPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    sprayAlphaAttribute.setUsage(THREE.DynamicDrawUsage);
    sprayScaleAttribute.setUsage(THREE.DynamicDrawUsage);
    sprayGeometry.setAttribute('instancePosition', sprayPositionAttribute);
    sprayGeometry.setAttribute('instanceAlpha', sprayAlphaAttribute);
    sprayGeometry.setAttribute('instanceScale', sprayScaleAttribute);
    sprayGeometry.instanceCount = SPRAY_PARTICLE_COUNT;
    const sprayParticles = new THREE.Mesh(sprayGeometry, sprayMaterial);
    sprayParticles.frustumCulled = false;
    sprayParticles.renderOrder = 12;
    sprayParticles.visible = false;
    scene.add(sprayParticles);

    const pointerSprayPositions = new Float32Array(POINTER_SPRAY_COUNT * 3);
    const pointerSprayAlphas = new Float32Array(POINTER_SPRAY_COUNT);
    const pointerSprayScales = new Float32Array(POINTER_SPRAY_COUNT);
    const pointerSprayGeometry = new THREE.InstancedBufferGeometry();
    pointerSprayGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ], 3));
    pointerSprayGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ], 2));
    pointerSprayGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const pointerSprayPositionAttribute = new THREE.InstancedBufferAttribute(
      pointerSprayPositions,
      3,
    );
    const pointerSprayAlphaAttribute = new THREE.InstancedBufferAttribute(
      pointerSprayAlphas,
      1,
    );
    const pointerSprayScaleAttribute = new THREE.InstancedBufferAttribute(
      pointerSprayScales,
      1,
    );
    pointerSprayPositionAttribute.setUsage(THREE.DynamicDrawUsage);
    pointerSprayAlphaAttribute.setUsage(THREE.DynamicDrawUsage);
    pointerSprayScaleAttribute.setUsage(THREE.DynamicDrawUsage);
    pointerSprayGeometry.setAttribute('instancePosition', pointerSprayPositionAttribute);
    pointerSprayGeometry.setAttribute('instanceAlpha', pointerSprayAlphaAttribute);
    pointerSprayGeometry.setAttribute('instanceScale', pointerSprayScaleAttribute);
    pointerSprayGeometry.instanceCount = POINTER_SPRAY_COUNT;
    const pointerSprayMaterial = new THREE.RawShaderMaterial({
      vertexShader: sprayVertexShader,
      fragmentShader: sprayFragmentShader,
      uniforms: {
        uMap: { value: sprayTexture },
        uColor: { value: new THREE.Color(0xf4fbff) },
      },
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const pointerSpray = new THREE.Mesh(pointerSprayGeometry, pointerSprayMaterial);
    pointerSpray.frustumCulled = false;
    pointerSpray.renderOrder = 13;
    scene.add(pointerSpray);

    const pointerSprayStates: PointerSprayParticle[] = Array.from(
      { length: POINTER_SPRAY_COUNT },
      () => ({
        origin: new THREE.Vector3(0, -100, 0),
        velocity: new THREE.Vector3(),
        bornAt: -100,
        lifetime: 0,
        size: 0,
      }),
    );
    let pointerSprayIndex = 0;
    const pointerSpraySide = new THREE.Vector3();
    const spawnPointerSpray = (
      worldPosition: THREE.Vector3,
      travelDirection: THREE.Vector3,
      strength: number,
      elapsed: number,
    ) => {
      if (strength < 0.72) return;
      const particleCount = strength > 1.05 ? 2 : 1;
      pointerSpraySide.set(-travelDirection.z, 0, travelDirection.x).normalize();
      for (let offsetIndex = 0; offsetIndex < particleCount; offsetIndex += 1) {
        const particle = pointerSprayStates[pointerSprayIndex];
        const sideSign = ((pointerSprayIndex + offsetIndex) % 2) * 2 - 1;
        const variation = (pointerSprayIndex % 5) / 4;
        particle.origin.copy(worldPosition);
        particle.origin.y = water.position.y + 0.045;
        particle.origin.addScaledVector(pointerSpraySide, sideSign * (0.025 + variation * 0.018));
        particle.velocity.copy(travelDirection).multiplyScalar(0.055 + strength * 0.035);
        particle.velocity.addScaledVector(
          pointerSpraySide,
          sideSign * (0.075 + variation * 0.045) * strength,
        );
        particle.velocity.y = 0.25 + variation * 0.12 + strength * 0.08;
        particle.bornAt = elapsed;
        particle.lifetime = 0.26 + variation * 0.1;
        particle.size = 0.016 + variation * 0.008 + strength * 0.005;
        pointerSprayIndex = (pointerSprayIndex + 1) % POINTER_SPRAY_COUNT;
      }
    };

    const sprayStates: SprayParticle[] = [];
    for (let index = 0; index < SPRAY_PARTICLE_COUNT; index += 1) {
      const sequence = (index * 0.61803398875) % 1;
      sprayStates.push({
        angle: sequence * Math.PI * 2 + Math.sin(index * 5.17) * 0.22,
        delay: 0.045 + ((index * 7) % 17) * 0.009,
        radialSpeed: 0.48 + ((index * 11) % 13) * 0.042,
        verticalSpeed: 2.25 + ((index * 5) % 11) * 0.12,
        drift: Math.sin(index * 3.91) * 0.16,
      });
    }

    let impactTime: number | null = null;
    let impactLogged = false;
    let secondaryImpactLogged = false;
    let completionNotified = false;
    let splashCoreReady = false;
    let splashCoreActive = false;
    let enhancedSplashReady = false;
    let enhancedSplashActive = false;

    const spawnSplash = (elapsed: number) => {
      enhancedSplashActive = enhancedSplashReady;
      splashCoreActive = !enhancedSplashActive && splashCoreReady;
      host.dataset.impact = 'true';
      host.dataset.splashCoreActive = String(splashCoreActive);
      host.dataset.enhancedSplashActive = String(enhancedSplashActive);
      traceTiming('impact', {
        elapsed: Math.round(elapsed * 1000) / 1000,
        coreReady: splashCoreReady,
        coreActive: splashCoreActive,
        enhancedReady: enhancedSplashReady,
        enhancedActive: enhancedSplashActive,
      });
      splashBase.visible = enhancedSplashActive;
      splashWave.visible = splashCoreActive;
      enhancedSplashWave.visible = enhancedSplashActive;
      splashRim.visible = enhancedSplashActive;
      splashLigaments.visible = enhancedSplashActive;
      splashBeads.visible = enhancedSplashActive;
      splashFoam.visible = enhancedSplashActive;
      sprayParticles.visible = false;
      sprayAlphas.fill(0);
      sprayAlphaAttribute.needsUpdate = true;
      splashUniforms.uAge.value = 0;
      foamUniforms.uAge.value = 0;
      frontDepthUniforms.uAge.value = 0;
      backDepthUniforms.uAge.value = 0;
      heightUniforms.uRippleAge.value = 0;
      heightUniforms.uRippleAge2.value = -1;
      waveUniforms.uImpactStart.value = elapsed;
      impactTime = elapsed;
      window.dispatchEvent(new CustomEvent('water:impact'));
      console.info(`${LOG} impact`, {
        elapsed,
        worldPosition: impactWorldPosition.toArray(),
        rippleUv: heightUniforms.uRippleCenter.value.toArray(),
        lightPosition: lightPosition.toArray(),
        lightScreenNdc: LIGHT_SCREEN_NDC.toArray(),
        windDirection: WIND_DIRECTION.toArray(),
        windStrength: WIND_STRENGTH,
        cavity: 'impact-cavity-height-field',
        connectedSplash: 'continuous-water-crown',
      });
      console.info(`${LOG} splash spawned`, {
        layers: ['refractive-core', 'dynamic-foam', 'billboard-spray'],
        sprayParticles: SPRAY_PARTICLE_COUNT,
      });
    };

    let lastResizeWidth = 0;
    let lastResizeHeight = 0;
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      const renderScale = 1;
      const internalWidth = Math.max(1, Math.floor(width * renderScale));
      const internalHeight = Math.max(1, Math.floor(height * renderScale));
      if (internalWidth === lastResizeWidth && internalHeight === lastResizeHeight) return;
      lastResizeWidth = internalWidth;
      lastResizeHeight = internalHeight;
      renderer.setSize(internalWidth, internalHeight, false);
      const pixelRatio = renderer.getPixelRatio();
      const renderWidth = Math.max(1, Math.floor(internalWidth * pixelRatio));
      const renderHeight = Math.max(1, Math.floor(internalHeight * pixelRatio));
      const refractionScale = width < 768 ? 0.56 : 0.62;
      sceneTarget.setSize(
        Math.max(1, Math.floor(renderWidth * refractionScale)),
        Math.max(1, Math.floor(renderHeight * refractionScale)),
      );
      splashUniforms.uResolution.value.set(renderWidth, renderHeight);
      dropUniforms.uResolution.value.set(renderWidth, renderHeight);
      waterUniforms.uResolution.value.set(renderWidth, renderHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Keep the far left and right corners on the water at ultra-wide ratios.
      water.scale.x = Math.max(1, camera.aspect / 1.6);
      impactRaycaster.setFromCamera(viewportCenter, camera);
      const centeredImpact = impactRaycaster.ray.intersectPlane(
        waterSurfacePlane,
        new THREE.Vector3(),
      );
      if (centeredImpact) {
        impactWorldPosition.copy(centeredImpact);
        drop.position.x = centeredImpact.x;
        drop.position.z = centeredImpact.z;
        const centeredSplashPosition = new THREE.Vector3(
          centeredImpact.x,
          water.position.y + 0.04,
          centeredImpact.z,
        );
        splashBase.position.copy(centeredSplashPosition);
        splashWave.position.copy(centeredSplashPosition);
        enhancedSplashWave.position.copy(centeredSplashPosition);
        splashRim.position.copy(centeredSplashPosition);
        splashLigaments.position.copy(centeredSplashPosition);
        splashBeads.position.copy(centeredSplashPosition);
        splashFoam.position.copy(centeredSplashPosition);
        depthShells.forEach((shell) => shell.position.copy(centeredSplashPosition));
      }
      syncWaterMetrics();
      syncVideoCover();
      placeLightAtScreenOrigin();
      const projectedLight = lightPosition.clone().project(camera);
      const projectedImpact = impactWorldPosition.clone().project(camera);
      const impactScreenX = (projectedImpact.x * 0.5 + 0.5) * width;
      const impactScreenY = (-projectedImpact.y * 0.5 + 0.5) * height;
      host.dataset.impactScreenX = impactScreenX.toFixed(2);
      host.dataset.impactScreenY = impactScreenY.toFixed(2);
      if (host.dataset.firstFrame === 'true') {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
      console.info(`${LOG} resized`, {
        width,
        height,
        aspect: camera.aspect,
        lightNdc: projectedLight.toArray(),
        impactScreen: [impactScreenX, impactScreenY],
        impactUv: heightUniforms.uRippleCenter.value.toArray(),
        waterSize: heightUniforms.uWaterSize.value.toArray(),
      });
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    let animationFrame = 0;
    let startedAt = performance.now() / 1000;
    let introStartedAt = startedAt;
    let lastRenderedAt = 0;
    let disposed = false;
    let firstFrame = true;
    let dropLaunchLogged = false;
    let dropDrawLogged = false;
    let splashDrawLogged = false;
    let revealNotified = false;
    let introTimelineStarted = !playIntro;
    const handleIntroSkip = () => {
      if (!playIntro) return;
      traceTiming('intro-skipped', {
        coreReady: splashCoreReady,
        timelineStarted: introTimelineStarted,
        impacted: impactTime !== null,
      });
      playIntro = false;
      introTimelineStarted = false;
      revealNotified = true;
      impactTime = null;
      drop.visible = false;
      splashBase.visible = false;
      splashWave.visible = false;
      enhancedSplashWave.visible = false;
      splashRim.visible = false;
      splashLigaments.visible = false;
      splashBeads.visible = false;
      splashFoam.visible = false;
      sprayParticles.visible = false;
      waterUniforms.uRevealProgress.value = 1;
      waterUniforms.uDeepColor.value.copy(revealedDeepColor);
      waterUniforms.uSurfaceColor.value.copy(revealedSurfaceColor);
      heightUniforms.uRippleAge.value = -1;
      heightUniforms.uRippleAge2.value = -1;
      waterUniforms.uRippleAge.value = -1;
    };
    window.addEventListener('water:intro-skip', handleIntroSkip);
    let hasDecodedVideoFrame = Boolean(backgroundVideo && backgroundVideo.readyState >= 2);
    let pointerRippleIndex = 0;
    let lastPointerRippleAt = -Infinity;
    let lastPointerX = Number.NaN;
    let lastPointerY = Number.NaN;
    let lastRippleU = Number.NaN;
    let lastRippleV = Number.NaN;
    const pointerNdc = new THREE.Vector2();
    const pointerWorldPosition = new THREE.Vector3();
    const pointerLocalPosition = new THREE.Vector3();
    const lastPointerWorldPosition = new THREE.Vector3();
    const pointerTravelDirection = new THREE.Vector3();
    let hasPointerWorldPosition = false;
    const pointerRaycaster = new THREE.Raycaster();

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || host.dataset.sceneReady !== 'true') return;
      if (playIntro && !revealNotified) return;

      const now = performance.now() / 1000;
      if (now - lastPointerRippleAt < POINTER_RIPPLE_INTERVAL) return;
      if (
        Number.isFinite(lastPointerX)
        && Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY)
          < POINTER_RIPPLE_MIN_DISTANCE
      ) return;

      const bounds = host.getBoundingClientRect();
      if (
        event.clientX < bounds.left
        || event.clientX > bounds.right
        || event.clientY < bounds.top
        || event.clientY > bounds.bottom
      ) return;

      pointerNdc.set(
        ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
        -((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
      );
      pointerRaycaster.setFromCamera(pointerNdc, camera);
      const intersection = pointerRaycaster.ray.intersectPlane(
        waterSurfacePlane,
        pointerWorldPosition,
      );
      if (!intersection) return;

      pointerLocalPosition.copy(intersection);
      water.worldToLocal(pointerLocalPosition);
      const rippleU = pointerLocalPosition.x / WATER_WIDTH + 0.5;
      const rippleV = pointerLocalPosition.y / WATER_LENGTH + 0.5;
      if (rippleU < 0 || rippleU > 1 || rippleV < 0 || rippleV > 1) return;

      if (
        !Number.isFinite(lastRippleU)
        || !Number.isFinite(lastRippleV)
        || now - lastPointerRippleAt > POINTER_STROKE_RESET_DELAY
      ) {
        lastPointerRippleAt = now;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        lastRippleU = rippleU;
        lastRippleV = rippleV;
        lastPointerWorldPosition.copy(intersection);
        hasPointerWorldPosition = true;
        return;
      }

      const waterSize = heightUniforms.uWaterSize.value;
      const direction = heightUniforms.uPointerDirections.value[pointerRippleIndex];
      direction.set(
        (rippleU - lastRippleU) * waterSize.x,
        (rippleV - lastRippleV) * waterSize.y,
      );
      if (direction.lengthSq() < 0.0001) return;
      direction.normalize();
      const screenDistance = Math.hypot(
        event.clientX - lastPointerX,
        event.clientY - lastPointerY,
      );
      const pointerSpeed = screenDistance / Math.max(now - lastPointerRippleAt, 0.016);
      const strength = THREE.MathUtils.clamp(pointerSpeed / 850, 0.55, 1.15);
      if (hasPointerWorldPosition) {
        pointerTravelDirection.copy(intersection).sub(lastPointerWorldPosition);
        pointerTravelDirection.y = 0;
        if (pointerTravelDirection.lengthSq() > 0.0001) {
          pointerTravelDirection.normalize();
          // The dedicated PointerWaterLayer already renders the continuous
          // pointer wake. Do not add a second billboard spray here: its
          // discrete particles create bright spots on top of the smooth wake.
        }
      }

      heightUniforms.uPointerRipples.value[pointerRippleIndex].set(
        rippleU,
        rippleV,
        now - startedAt,
        strength,
      );
      const segmentDeltaU = rippleU - lastRippleU;
      const segmentDeltaV = rippleV - lastRippleV;
      const segmentLength = Math.hypot(
        segmentDeltaU * waterSize.x,
        segmentDeltaV * waterSize.y,
      );
      const segmentScale = Math.min(
        1,
        POINTER_SEGMENT_MAX_LENGTH / Math.max(segmentLength, 0.0001),
      );
      heightUniforms.uPointerPrevious.value[pointerRippleIndex].set(
        rippleU - segmentDeltaU * segmentScale,
        rippleV - segmentDeltaV * segmentScale,
      );
      pointerRippleIndex = (pointerRippleIndex + 1) % POINTER_RIPPLE_COUNT;
      lastPointerRippleAt = now;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      lastRippleU = rippleU;
      lastRippleV = rippleV;
      lastPointerWorldPosition.copy(intersection);
      hasPointerWorldPosition = true;
    };

    const WAVE_STEP = 1 / 60;
    let waveAccumulator = 0;
    let waveLastElapsed = 0;

    const rebaseTimeline = (elapsed: number) => {
      const offset = Math.floor(elapsed / TIME_REBASE_INTERVAL_SECONDS)
        * TIME_REBASE_INTERVAL_SECONDS;
      if (offset <= 0) return elapsed;

      startedAt += offset;
      introStartedAt += offset;
      waveLastElapsed = Math.max(waveLastElapsed - offset, 0);
      if (impactTime !== null) impactTime -= offset;
      waveUniforms.uImpactStart.value -= offset;

      heightUniforms.uPointerRipples.value.forEach((ripple) => {
        ripple.z -= offset;
      });
      pointerSprayStates.forEach((particle) => {
        particle.bornAt -= offset;
      });

      return elapsed - offset;
    };

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      const now = performance.now() / 1000;
      if (now - lastRenderedAt < 1 / 30 - 0.001) return;
      lastRenderedAt = now;
      const elapsed = rebaseTimeline(now - startedAt);
      const introElapsed = now - introStartedAt;

      heightUniforms.uTime.value = elapsed;
      waterUniforms.uTime.value = elapsed;
      dropUniforms.uTime.value = elapsed;
      splashUniforms.uTime.value = elapsed;
      foamUniforms.uTime.value = elapsed;
      waterUniforms.uRippleAge.value = heightUniforms.uRippleAge.value;
      if (backgroundVideo && backgroundVideo.readyState >= 2) hasDecodedVideoFrame = true;
      waterUniforms.uVideoReady.value = hasDecodedVideoFrame ? 1 : 0;

      pointerSprayStates.forEach((particle, index) => {
        const age = elapsed - particle.bornAt;
        const positionOffset = index * 3;
        if (age < 0 || age >= particle.lifetime) {
          pointerSprayPositions[positionOffset] = 0;
          pointerSprayPositions[positionOffset + 1] = -100;
          pointerSprayPositions[positionOffset + 2] = 0;
          pointerSprayAlphas[index] = 0;
          pointerSprayScales[index] = 0;
          return;
        }

        pointerSprayPositions[positionOffset] = particle.origin.x + particle.velocity.x * age;
        pointerSprayPositions[positionOffset + 1] = particle.origin.y
          + particle.velocity.y * age - 0.5 * 4.8 * age * age;
        pointerSprayPositions[positionOffset + 2] = particle.origin.z + particle.velocity.z * age;
        const fadeIn = THREE.MathUtils.smoothstep(age, 0, 0.06);
        const fadeOut = 1 - THREE.MathUtils.smoothstep(
          age,
          particle.lifetime * 0.62,
          particle.lifetime,
        );
        pointerSprayAlphas[index] = fadeIn * fadeOut * 0.42;
        pointerSprayScales[index] = particle.size
          * THREE.MathUtils.lerp(0.72, 1, Math.min(age * 8, 1));
      });
      pointerSprayPositionAttribute.needsUpdate = true;
      pointerSprayAlphaAttribute.needsUpdate = true;
      pointerSprayScaleAttribute.needsUpdate = true;

      if (playIntro && !introTimelineStarted && drop.visible) {
        const idleOffset = Math.sin(elapsed * 2.1) * 0.055;
        drop.position.y = DROP_START_Y + idleOffset;
        drop.scale.setScalar(0.22 + Math.sin(elapsed * 1.7) * 0.004);
      }

      if (playIntro && introTimelineStarted && introElapsed >= DROP_DELAY && !dropLaunchLogged) {
        dropLaunchLogged = true;
        host.dataset.dropLaunched = 'true';
        traceTiming('drop-launched', {
          introElapsed: Math.round(introElapsed * 1000) / 1000,
          coreReady: splashCoreReady,
        });
        const dropWasVisible = drop.visible;
        drop.visible = false;
        renderer.setRenderTarget(sceneTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        drop.visible = dropWasVisible;
        console.info(`${LOG} drop launched`, { delay: DROP_DELAY, duration: DROP_DURATION });
      }

      if (playIntro && introTimelineStarted && impactTime === null && introElapsed >= DROP_DELAY) {
        const progress = Math.min((introElapsed - DROP_DELAY) / DROP_DURATION, 1);
        const eased = progress * progress;
        drop.position.y = THREE.MathUtils.lerp(DROP_START_Y, 0.1, eased);
        drop.scale.setScalar(THREE.MathUtils.lerp(0.23, 0.2, progress));
        if (progress >= 1) {
          drop.visible = false;
          renderer.setRenderTarget(sceneTarget);
          renderer.render(scene, camera);
          renderer.setRenderTarget(null);
          spawnSplash(elapsed);
        }
      }

      if (playIntro && introTimelineStarted && impactTime !== null) {
        const measuredImpactAge = Math.max(elapsed - impactTime, 0);
        const impactAge = holdSplashForDiagnostics
          ? Math.min(measuredImpactAge, 0.42)
          : measuredImpactAge;
        heightUniforms.uRippleAge.value = impactAge;
        waterUniforms.uRippleAge.value = impactAge;
        const secondaryAge = impactAge - SECONDARY_IMPACT_DELAY;
        heightUniforms.uRippleAge2.value = secondaryAge >= 0 ? secondaryAge : -1;
        if (secondaryAge >= 0 && !secondaryImpactLogged) {
          secondaryImpactLogged = true;
          console.info(`${LOG} secondary impact`, {
            age: impactAge,
            cause: 'returning-continuous-water-crown',
            rippleStrength: heightUniforms.uImpactStrength2.value,
          });
        }

        splashUniforms.uAge.value = impactAge;
        foamUniforms.uAge.value = impactAge;
        frontDepthUniforms.uAge.value = impactAge;
        backDepthUniforms.uAge.value = impactAge;
        const revealProgress = THREE.MathUtils.smoothstep(
          impactAge,
          REVEAL_IMPACT_AGE,
          REVEAL_IMPACT_AGE + 1.1,
        );
        waterUniforms.uRevealProgress.value = revealProgress;
        waterUniforms.uDeepColor.value.copy(initialDeepColor).lerp(revealedDeepColor, revealProgress);
        waterUniforms.uSurfaceColor.value
          .copy(initialSurfaceColor)
          .lerp(revealedSurfaceColor, revealProgress);
        if (!revealNotified && impactAge >= REVEAL_IMPACT_AGE) {
          revealNotified = true;
          traceTiming('reveal-dispatched', {
            impactAge: Math.round(impactAge * 1000) / 1000,
          });
          window.dispatchEvent(new CustomEvent('water:reveal', {
            detail: {
              impactAge,
              light: { x: 0, y: 0 },
            },
          }));
          console.info(`${LOG} page reveal`, { impactAge });
        }
        const splashAlive = impactAge < 1.38;
        splashWave.visible = splashCoreActive && splashAlive;
        enhancedSplashWave.visible = enhancedSplashActive && splashAlive;
        splashBase.visible = enhancedSplashActive && splashAlive;
        splashRim.visible = enhancedSplashActive && splashAlive;
        splashLigaments.visible = enhancedSplashActive && splashAlive;
        splashBeads.visible = enhancedSplashActive && splashAlive;
        splashFoam.visible = enhancedSplashActive && impactAge < 1.3;

        sprayParticles.visible = enhancedSplashActive
          && impactAge >= 0.04 && impactAge < 1.68;
        if (sprayParticles.visible) {
          const sprayFadeIn = THREE.MathUtils.smoothstep(impactAge, 0.04, 0.24);
          const sprayFadeOut = 1 - THREE.MathUtils.smoothstep(impactAge, 1.18, 1.68);
          const globalSprayAlpha = 0.76 * sprayFadeIn * sprayFadeOut;
          sprayStates.forEach((particle, index) => {
            const particleAge = impactAge - particle.delay;
            const offset = index * 3;
            if (particleAge <= 0) {
              sprayPositions[offset] = 0;
              sprayPositions[offset + 1] = -100;
              sprayPositions[offset + 2] = 0;
              sprayAlphas[index] = 0;
              sprayScales[index] = 0;
              return;
            }
            const angle = particle.angle + particle.drift * particleAge;
            const radius = 0.24 + particle.radialSpeed * particleAge;
            const particleY = water.position.y + 0.07
              + particle.verticalSpeed * particleAge
              - 0.5 * 9.8 * particleAge * particleAge;
            if (particleY <= water.position.y - 0.015) {
              sprayPositions[offset] = 0;
              sprayPositions[offset + 1] = -100;
              sprayPositions[offset + 2] = 0;
              sprayAlphas[index] = 0;
              sprayScales[index] = 0;
              return;
            }
            sprayPositions[offset] = impactWorldPosition.x + Math.cos(angle) * radius;
            sprayPositions[offset + 1] = particleY;
            sprayPositions[offset + 2] = impactWorldPosition.z + Math.sin(angle) * radius * 1.8;
            const particleFade = 1 - THREE.MathUtils.smoothstep(particleAge, 0.72, 1.16);
            sprayAlphas[index] = globalSprayAlpha
              * particleFade * (0.58 + (index % 5) * 0.08);
            sprayScales[index] = (0.052 + (index % 7) * 0.007)
              * THREE.MathUtils.lerp(0.72, 1, Math.min(particleAge * 5, 1));
          });
          sprayPositionAttribute.needsUpdate = true;
          sprayAlphaAttribute.needsUpdate = true;
          sprayScaleAttribute.needsUpdate = true;
        }

        if (!impactLogged && impactAge >= 0.5) {
          impactLogged = true;
          console.info(`${LOG} ripple propagating`, {
            age: impactAge,
            estimatedRadiusWorld: Math.max(impactAge - 0.1, 0) * 6.5,
            heightTexture: heightTarget.texture.name,
          });
        }

        if (!completionNotified && impactAge >= 3.6) {
          completionNotified = true;
          onComplete?.();
        }
      }

      const waveFrameDelta = Math.min(Math.max(elapsed - waveLastElapsed, 0), 0.06);
      waveLastElapsed = elapsed;
      waveAccumulator = Math.min(waveAccumulator + waveFrameDelta, WAVE_STEP * 3);
      let waveSteps = 0;
      while (waveAccumulator >= WAVE_STEP && waveSteps < 3) {
        waveUniforms.uPreviousState.value = waveReadTarget.texture;
        waveUniforms.uTime.value = elapsed - waveAccumulator + WAVE_STEP;
        waveUniforms.uDeltaTime.value = WAVE_STEP;
        renderer.setRenderTarget(waveWriteTarget);
        renderer.render(waveSimulationScene, waveSimulationCamera);
        const previousReadTarget = waveReadTarget;
        waveReadTarget = waveWriteTarget;
        waveWriteTarget = previousReadTarget;
        waveAccumulator -= WAVE_STEP;
        waveSteps += 1;
      }
      heightUniforms.uWaveState.value = waveReadTarget.texture;
      waterUniforms.uWaveState.value = waveReadTarget.texture;

      renderer.setRenderTarget(heightTarget);
      renderer.render(heightScene, heightCamera);
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      if (drop.visible && introTimelineStarted && !dropDrawLogged) {
        dropDrawLogged = true;
        traceTiming('drop-first-draw', {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          y: Math.round(drop.position.y * 1000) / 1000,
        });
      }
      if (
        impactTime !== null
        && (splashWave.visible || enhancedSplashWave.visible)
        && !splashDrawLogged
      ) {
        splashDrawLogged = true;
        traceTiming('splash-first-draw', {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          age: Math.round(splashUniforms.uAge.value * 1000) / 1000,
          mode: enhancedSplashWave.visible ? 'enhanced' : 'fallback',
        });
      }

      if (firstFrame) {
        firstFrame = false;
        host.dataset.firstFrame = 'true';
        traceTiming('first-frame', {
          canvasWidth: renderer.domElement.width,
          canvasHeight: renderer.domElement.height,
        });
        window.dispatchEvent(new CustomEvent('water:first-frame'));
        console.info(`${LOG} first frame rendered`, {
          canvas: [renderer.domElement.width, renderer.domElement.height],
          passes: ['height', 'front-depth', 'back-depth', 'refraction', 'water'],
        });
        console.groupEnd();
      }
    };
    const managedSplashMeshes = [
      splashBase,
      splashWave,
      enhancedSplashWave,
      splashRim,
      splashLigaments,
      splashBeads,
      splashFoam,
      sprayParticles,
    ];
    const enhancedSplashMeshes = [
      enhancedSplashWave,
      splashBase,
      splashRim,
      splashLigaments,
      splashBeads,
      splashFoam,
      sprayParticles,
    ];
    const enhancedSplashWarmupStages = [
      {
        label: 'enhanced-surface',
        meshes: [
          enhancedSplashWave,
          splashBase,
          splashRim,
          splashLigaments,
          splashBeads,
        ],
      },
      { label: 'enhanced-foam', meshes: [splashFoam] },
      { label: 'enhanced-spray', meshes: [sprayParticles] },
    ];
    let enhancedWarmupWorker: Worker | null = null;
    let enhancedRendererWarmupStarted = false;
    let enhancedRendererWarmupScheduled = false;
    let enhancedIdleHandle = 0;
    let enhancedIdleUsesCallback = false;
    const setWarmupVisibility = (stageMeshes: THREE.Object3D[]) => {
      const previousVisibility = managedSplashMeshes.map((mesh) => mesh.visible);
      managedSplashMeshes.forEach((mesh) => { mesh.visible = false; });
      stageMeshes.forEach((mesh) => { mesh.visible = true; });
      return () => {
        managedSplashMeshes.forEach((mesh, index) => {
          mesh.visible = previousVisibility[index];
        });
      };
    };
    const warmUpSplashStage = async (
      label: string,
      stageMeshes: THREE.Object3D[],
    ) => {
      if (disposed) return false;
      traceTiming(`${label}-compile-submit-start`, {
        meshCount: stageMeshes.length,
      });
      let restoreVisibility = setWarmupVisibility(stageMeshes);
      let compilation: Promise<unknown> | undefined;
      try {
        if (parallelShaderCompile && renderer.compileAsync) {
          compilation = renderer.compileAsync(scene, camera);
        } else {
          renderer.compile(scene, camera);
        }
        traceTiming(`${label}-compile-submitted`, {
          asynchronous: Boolean(compilation),
        });
      } catch (error) {
        console.warn(LOG + ' ' + label + ' shader warmup', error);
        traceTiming(`${label}-compile-submit-failed`);
      } finally {
        restoreVisibility();
      }

      try {
        await compilation;
        traceTiming(`${label}-compile-complete`);
      } catch (error) {
        console.warn(LOG + ' ' + label + ' shader warmup', error);
        traceTiming(`${label}-compile-failed`);
      }

      if (disposed) return false;
      const previousRenderTarget = renderer.getRenderTarget();
      restoreVisibility = setWarmupVisibility(stageMeshes);
      try {
        renderer.setRenderTarget(splashWarmupTarget);
        renderer.clear();
        renderer.render(scene, camera);
        traceTiming(`${label}-pipeline-draw-complete`);
      } catch (error) {
        console.warn(LOG + ' ' + label + ' pipeline warmup', error);
        return false;
      } finally {
        restoreVisibility();
        renderer.setRenderTarget(previousRenderTarget);
      }
      return true;
    };
    const warmUpEnhancedSplash = async (
      source: 'parallel' | 'worker-preheated' | 'deferred',
    ) => {
      if (disposed || enhancedRendererWarmupStarted) return;
      enhancedRendererWarmupScheduled = false;
      enhancedRendererWarmupStarted = true;
      traceTiming('enhanced-warmup-start', { source });
      if (source === 'parallel') {
        enhancedSplashReady = await warmUpSplashStage('enhanced', enhancedSplashMeshes);
      } else {
        enhancedSplashReady = true;
        for (const [index, stage] of enhancedSplashWarmupStages.entries()) {
          if (disposed) return;
          if (index > 0) {
            await new Promise<void>((resolve) => {
              if ('requestIdleCallback' in window) {
                enhancedIdleUsesCallback = true;
                enhancedIdleHandle = window.requestIdleCallback(
                  () => {
                    enhancedIdleHandle = 0;
                    resolve();
                  },
                  { timeout: 1400 },
                );
              } else {
                enhancedIdleUsesCallback = false;
                enhancedIdleHandle = window.setTimeout(() => {
                  enhancedIdleHandle = 0;
                  resolve();
                }, 120);
              }
            });
          }
          enhancedSplashReady = await warmUpSplashStage(stage.label, stage.meshes);
          if (!enhancedSplashReady) break;
        }
      }
      if (disposed) return;
      host.dataset.enhancedSplashReady = String(enhancedSplashReady);
      traceTiming('enhanced-warmup-finished', {
        source,
        ready: enhancedSplashReady,
      });
    };
    const scheduleEnhancedAfterReveal = (
      source: 'worker-preheated' | 'deferred',
    ) => {
      if (enhancedRendererWarmupStarted || enhancedRendererWarmupScheduled) return;
      enhancedRendererWarmupScheduled = true;
      const schedule = () => {
        if (disposed) return;
        if ('requestIdleCallback' in window) {
          enhancedIdleUsesCallback = true;
          enhancedIdleHandle = window.requestIdleCallback(
            () => {
              enhancedIdleHandle = 0;
              void warmUpEnhancedSplash(source);
            },
            { timeout: 1200 },
          );
        } else {
          enhancedIdleUsesCallback = false;
          enhancedIdleHandle = window.setTimeout(
            () => {
              enhancedIdleHandle = 0;
              void warmUpEnhancedSplash(source);
            },
            120,
          );
        }
      };
      const homeStage = document.querySelector<HTMLElement>('[data-home-stage]');
      if (homeStage?.dataset.revealState === 'ready') schedule();
      else window.addEventListener('home:revealed', schedule, { once: true });
    };
    const startEnhancedSplashWarmup = () => {
      if (disposed) return;
      if (parallelShaderCompile) {
        traceTiming('enhanced-parallel-path');
        void warmUpEnhancedSplash('parallel');
        return;
      }
      try {
        enhancedWarmupWorker = new Worker(
          new URL('./splashWarmup.worker.ts', import.meta.url),
          { type: 'module' },
        );
        enhancedWarmupWorker.onmessage = (event: MessageEvent<{
          ok: boolean;
          parallel?: boolean;
          durationMs: number;
          error?: string;
        }>) => {
          traceTiming('enhanced-worker-finished', event.data);
          enhancedWarmupWorker?.terminate();
          enhancedWarmupWorker = null;
          if (!event.data.ok) {
            scheduleEnhancedAfterReveal('deferred');
            return;
          }
          if (holdSplashForDiagnostics && !holdCoreSplashForDiagnostics) {
            void warmUpEnhancedSplash('worker-preheated').then(() => {
              if (!enhancedSplashReady || impactTime === null) return;
              splashCoreActive = false;
              enhancedSplashActive = true;
              host.dataset.splashCoreActive = 'false';
              host.dataset.enhancedSplashActive = 'true';
              traceTiming('enhanced-diagnostic-activated');
            });
            return;
          }
          // A worker context can wake the driver/compiler, but it cannot prove that
          // Three's program is cached for the main context. Never risk that compile
          // on the drop timeline when parallel compilation is unavailable.
          scheduleEnhancedAfterReveal('worker-preheated');
        };
        enhancedWarmupWorker.onerror = (event) => {
          traceTiming('enhanced-worker-failed', { message: event.message });
          enhancedWarmupWorker?.terminate();
          enhancedWarmupWorker = null;
          scheduleEnhancedAfterReveal('deferred');
        };
        enhancedWarmupWorker.postMessage({
          programs: [
            {
              name: 'splash-surface',
              vertex: splashVertexShader,
              fragment: splashFragmentShader,
            },
            {
              name: 'splash-foam',
              vertex: splashCoreVertexShader,
              fragment: foamFragmentShader,
            },
            {
              name: 'splash-spray',
              vertex: sprayVertexShader,
              fragment: sprayFragmentShader,
            },
          ],
        });
        traceTiming('enhanced-worker-started');
      } catch (error) {
        enhancedWarmupWorker?.terminate();
        enhancedWarmupWorker = null;
        traceTiming('enhanced-worker-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        scheduleEnhancedAfterReveal('deferred');
      }
    };
    const markSceneReady = () => {
      if (disposed) return;
      host.dataset.sceneReady = 'true';
      window.dispatchEvent(new CustomEvent('water:ready'));
    };
    const startIntroTimeline = () => {
      if (disposed) return;
      introStartedAt = performance.now() / 1000;
      introTimelineStarted = playIntro;
      drop.visible = playIntro;
      const dropNdc = drop.position.clone().project(camera);
      host.dataset.introTimelineStarted = String(introTimelineStarted);
      traceTiming('intro-timeline-started', {
        playIntro,
        coreReady: splashCoreReady,
        dropNdc: dropNdc.toArray().map((value) => Math.round(value * 1000) / 1000),
      });
      if (playIntro) window.dispatchEvent(new CustomEvent('water:intro-start'));
    };
    const warmUpAndStart = () => {
      managedSplashMeshes.forEach((mesh) => { mesh.visible = false; });
      if (disposed) return;
      drop.visible = playIntro;
      if (playIntro) {
        splashWave.visible = true;
        coreWaveMaterial.colorWrite = false;
      }
      startedAt = performance.now() / 1000;
      lastRenderedAt = 0;
      waveAccumulator = 0;
      waveLastElapsed = 0;
      render();
      if (playIntro) {
        splashWave.visible = false;
        coreWaveMaterial.colorWrite = true;
        splashCoreReady = true;
        host.dataset.splashCoreReady = 'true';
        traceTiming('core-first-frame-ready');
      }
      markSceneReady();
      if (!playIntro) {
        return;
      }
      startIntroTimeline();
      startEnhancedSplashWarmup();
    };
    warmUpAndStart();

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      traceTiming('context-lost');
      console.error(`${LOG} WebGL context lost`);
      window.dispatchEvent(new CustomEvent('water:compatibility-fallback', {
        detail: { scope: 'all' },
      }));
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      console.info(`${LOG} disposing scene`);
      disposed = true;
      cancelAnimationFrame(animationFrame);
      enhancedWarmupWorker?.terminate();
      if (enhancedIdleHandle) {
        if (enhancedIdleUsesCallback && 'cancelIdleCallback' in window) {
          window.cancelIdleCallback(enhancedIdleHandle);
        }
        else window.clearTimeout(enhancedIdleHandle);
      }
      resizeObserver.disconnect();
      backgroundVideo?.removeEventListener('loadedmetadata', syncVideoCover);
      window.removeEventListener('water:intro-skip', handleIntroSkip);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      heightTarget.dispose();
      waveReadTarget.dispose();
      waveWriteTarget.dispose();
      sceneTarget.dispose();
      splashWarmupTarget.dispose();
      frontDepthTarget.dispose();
      backDepthTarget.dispose();
      heightMaterial.dispose();
      heightQuad.geometry.dispose();
      waveSimulationMaterial.dispose();
      waveSimulationQuad.geometry.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
      drop.geometry.dispose();
      dropMaterial.dispose();
      crownGeometry.dispose();
      crownSurfaceGeometry.dispose();
      rimGeometry.dispose();
      beadGeometry.dispose();
      ligamentGeometry.dispose();
      coreWaveMaterial.dispose();
      waveMaterial.dispose();
      foamMaterial.dispose();
      frontDepthMaterial.dispose();
      backDepthMaterial.dispose();
      sprayGeometry.dispose();
      sprayMaterial.dispose();
      pointerSprayGeometry.dispose();
      pointerSprayMaterial.dispose();
      sprayTexture.dispose();
      glowTexture.dispose();
      environmentTexture.dispose();
      videoTexture.dispose();
      if (videoTexture !== fallbackVideoTexture) fallbackVideoTexture.dispose();
      (lightGlow.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.waterSceneActive;
    };
  }, [intro, onComplete]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="water-canvas-host"
    />
  );
}
