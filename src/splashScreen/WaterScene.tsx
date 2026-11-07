'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import fullscreenVertexShader from './water/fullscreen.vert';
import heightFragmentShader from './water/height.frag';
import waterVertexShader from './water/water.vert';
import waterFragmentShader from './water/water.frag';
import blitFragmentShader from './water/blit.frag';
import dropVertexShader from './water/drop.vert';
import dropFragmentShader from './water/drop.frag';
import { createImpactRippleLut, RIPPLE_DURATION } from './impactRipple';
import { createLiquidSplash, DROPLET_RIPPLE_COUNT, SPLASH_DURATION } from './liquidSplash';

interface WaterSceneProps {
  onComplete?: () => void;
  intro?: boolean;
}

const LOG = '[WaterScene]';
const DROP_START_Y = 3.65;
const DROP_DELAY = 0.65;
const DROP_DURATION = 1.05;
const REVEAL_IMPACT_AGE = 1.18;
const COMPLETE_IMPACT_AGE = 3.6;
const HOLD_SPLASH_AGE = 0.42;
// Time uniforms are rebased to keep sub-frame float precision for hours. A
// rebase shifts the procedural wind pattern, so it should stay rare.
const TIME_REBASE_INTERVAL_SECONDS = 2048;
const WATER_WIDTH = 420;
const WATER_LENGTH = 520;
const LIGHT_SCREEN_NDC = new THREE.Vector3(-1, 1, 0.15);
// Downwind direction on the water plane (world x, z): towards screen left.
const WIND_DIRECTION = new THREE.Vector2(-1, 0);
const ACTIVE_FRAME_INTERVAL = 1 / 60;
const IDLE_FRAME_INTERVAL = 1 / 30;
// rAF timestamps jitter; without slack a 60 Hz display would skip frames.
const FRAME_INTERVAL_TOLERANCE = 0.004;

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
    const debugParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
    const debugHoldAge = (() => {
      const requestedAge = Number(debugParams?.get('waterDebugAge'));
      if (Number.isFinite(requestedAge) && requestedAge > 0) return requestedAge;
      const mode = debugParams?.get('waterDebug');
      return mode === 'hold-splash' || mode === 'hold-core' ? HOLD_SPLASH_AGE : null;
    })();
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

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      console.error(`${LOG} renderer creation failed`, error);
      console.groupEnd();
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
    renderer.autoClear = false;
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

    const fullscreenGeometry = new THREE.PlaneGeometry(2, 2);
    const fullscreenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const waterScene = new THREE.Scene();
    const overlayScene = new THREE.Scene();
    overlayScene.fog = new THREE.FogExp2(0x050911, 0.022);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 5.1, 7.4);
    camera.lookAt(0, 0.05, -4.2);

    const heightTargetSize = window.innerWidth < 768 ? 128 : 192;
    const heightTarget = new THREE.WebGLRenderTarget(heightTargetSize, heightTargetSize, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    heightTarget.texture.name = 'water-height';
    // While the drop and the splash are on screen the water is drawn here
    // first, so both can refract the live surface.
    const waterColorTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    waterColorTarget.texture.name = 'water-live-refraction';

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
    const posterImage = document.querySelector<HTMLImageElement>('[data-background-poster]');
    let posterTextureReady = false;
    const posterTexture = posterImage
      ? new THREE.Texture(posterImage)
      : new THREE.TextureLoader().load(
        '/background/WUWA-poster.jpg',
        () => { posterTextureReady = true; },
        undefined,
        () => { posterTextureReady = false; },
      );
    const handlePosterReady = () => {
      if (!posterImage?.naturalWidth) return;
      posterTexture.needsUpdate = true;
      posterTextureReady = true;
      host.dataset.posterTextureReady = 'true';
      performance.mark('water-poster-texture-ready');
    };
    const handlePosterError = () => { posterTextureReady = false; };
    if (posterImage) {
      posterImage.addEventListener('load', handlePosterReady);
      posterImage.addEventListener('error', handlePosterError);
      if (posterImage.complete) handlePosterReady();
    }
    posterTexture.colorSpace = THREE.SRGBColorSpace;
    posterTexture.minFilter = THREE.LinearFilter;
    posterTexture.magFilter = THREE.LinearFilter;
    posterTexture.generateMipmaps = false;
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

    let rippleLut = playIntro
      ? createImpactRippleLut(renderer, fullscreenGeometry, fullscreenCamera)
      : null;
    const emptyRippleTexture = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    emptyRippleTexture.needsUpdate = true;

    const waterUniforms = {
      uHeightMap: { value: heightTarget.texture },
      uHeightTexel: { value: new THREE.Vector2(1 / heightTargetSize, 1 / heightTargetSize) },
      uHeightScale: { value: 1.45 },
      uTime: { value: 0 },
      uRippleLut: { value: rippleLut?.texture ?? emptyRippleTexture },
      uRippleLutSize: { value: rippleLut?.size ?? new THREE.Vector4(1, 1, 1, 1) },
      uRippleAge: { value: -1 },
      uRippleStrength: { value: 1 },
      uRippleCenter: { value: new THREE.Vector2() },
      uDropletRipples: {
        value: Array.from({ length: DROPLET_RIPPLE_COUNT }, () => new THREE.Vector4()),
      },
      uDropletRippleStrength: { value: 0.35 },
      uDropletRippleWindow: { value: new THREE.Vector2(1, 0) },
      uLightPosition: { value: lightPosition },
      uDistantLightDirection: { value: distantLightDirection },
      uDeepColor: { value: (playIntro ? initialDeepColor : revealedDeepColor).clone() },
      uSurfaceColor: { value: (playIntro ? initialSurfaceColor : revealedSurfaceColor).clone() },
      uPreviewTexture: { value: posterTexture },
      uVideoTexture: { value: videoTexture },
      uVideoReady: { value: 0 },
      uVideoBlend: { value: 0 },
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
    const waterGeometry = new THREE.PlaneGeometry(WATER_WIDTH, WATER_LENGTH, 4, 4);
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.35, -100);
    waterScene.add(water);

    const heightUniforms = {
      uTime: { value: 0 },
      uWaterSize: { value: new THREE.Vector2(WATER_WIDTH, WATER_LENGTH) },
      uWindDirection: { value: WIND_DIRECTION.clone() },
      uWindSpeed: { value: 0.022 },
    };
    const heightMaterial = new THREE.RawShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: heightFragmentShader,
      uniforms: heightUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    const heightScene = new THREE.Scene();
    heightScene.add(new THREE.Mesh(fullscreenGeometry, heightMaterial));

    const blitMaterial = new THREE.RawShaderMaterial({
      vertexShader: fullscreenVertexShader,
      fragmentShader: blitFragmentShader,
      uniforms: { uSource: { value: waterColorTarget.texture } },
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    const blitScene = new THREE.Scene();
    blitScene.add(new THREE.Mesh(fullscreenGeometry, blitMaterial));

    const impactWorldPosition = new THREE.Vector3(0, water.position.y, -2);
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
    backgroundVideo?.addEventListener('loadedmetadata', syncVideoCover);

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
    overlayScene.add(lightGlow);

    const placeLightAtScreenOrigin = () => {
      camera.updateMatrixWorld();
      const screenTopLeft = LIGHT_SCREEN_NDC.clone().unproject(camera);
      const direction = screenTopLeft.sub(camera.position).normalize();
      lightPosition.copy(camera.position).addScaledVector(direction, 10.5);
      lightGlow.position.copy(lightPosition);
      distantLightDirection.copy(lightPosition).sub(impactWorldPosition).normalize();
    };
    placeLightAtScreenOrigin();

    const dropUniforms = {
      uSceneTexture: { value: waterColorTarget.texture },
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
    drop.position.set(0, DROP_START_Y, impactWorldPosition.z);
    drop.visible = false;
    drop.frustumCulled = false;
    drop.renderOrder = 20;
    overlayScene.add(drop);

    let splash = playIntro
      ? createLiquidSplash({
        renderer,
        camera,
        origin: impactWorldPosition,
        lightPosition,
        environment: environmentTexture,
        fullscreenGeometry,
        fullscreenCamera,
      })
      : null;

    const syncWaterMetrics = () => {
      heightUniforms.uWaterSize.value.set(
        WATER_WIDTH * water.scale.x,
        WATER_LENGTH * water.scale.y,
      );
      waterUniforms.uRippleCenter.value.set(impactWorldPosition.x, impactWorldPosition.z);
      const droplets = splash?.dropletRipples ?? [];
      droplets.forEach((ripple, index) => {
        waterUniforms.uDropletRipples.value[index].set(
          impactWorldPosition.x + ripple.x,
          impactWorldPosition.z + ripple.y,
          ripple.z,
          ripple.w,
        );
      });
      if (droplets.length > 0) {
        waterUniforms.uDropletRippleWindow.value.set(
          Math.min(...droplets.map((ripple) => ripple.z)),
          Math.max(...droplets.map((ripple) => ripple.z + RIPPLE_DURATION * Math.sqrt(ripple.w))),
        );
      }
    };
    syncWaterMetrics();
    syncVideoCover();
    console.info(`${LOG} water ready`, {
      lightPosition: lightPosition.toArray(),
      splashParticles: Boolean(splash),
      dropletRipples: splash?.dropletRipples.length ?? 0,
    });

    let impactTime: number | null = null;
    let splashAge: number | null = null;
    let introSettled = !playIntro;
    let impactResourcesStarted = false;
    let impactResourcesReady = false;
    let impactResourcesSettled: Promise<void> = Promise.resolve();
    let completionNotified = false;

    // Background compilation keeps polling its materials; disposing them (or
    // the renderer) before it settles would make that poll throw.
    const afterImpactCompile = (task: () => void) => {
      void Promise.race([
        impactResourcesSettled,
        new Promise<void>((resolve) => { window.setTimeout(resolve, 3000); }),
      ]).then(task);
    };

    // The intro plays once per mount; its buffers would otherwise hold tens of
    // megabytes of (often shared) GPU memory for the life of the page.
    const releaseIntroResources = () => {
      if (!splash && !rippleLut) return;
      const releasedSplash = splash;
      const releasedRippleLut = rippleLut;
      splash = null;
      rippleLut = null;
      splashAge = null;
      waterUniforms.uRippleLut.value = emptyRippleTexture;
      waterUniforms.uRippleAge.value = -1;
      afterImpactCompile(() => {
        releasedSplash?.dispose();
        releasedRippleLut?.dispose();
        waterColorTarget.dispose();
        traceTiming('intro-resources-released');
      });
    };

    const spawnSplash = (elapsed: number) => {
      const rippleBuiltAhead = rippleLut?.ready ?? false;
      if (rippleLut && !rippleLut.ready) rippleLut.buildAll();
      impactTime = elapsed;
      drop.visible = false;
      host.dataset.impact = 'true';
      host.dataset.splashActive = String(Boolean(splash));
      traceTiming('impact', {
        elapsed: Math.round(elapsed * 1000) / 1000,
        splashReady: impactResourcesReady,
        rippleBuiltAhead,
      });
      window.dispatchEvent(new CustomEvent('water:impact'));
      console.info(`${LOG} impact`, {
        elapsed,
        worldPosition: impactWorldPosition.toArray(),
        lightPosition: lightPosition.toArray(),
        lightScreenNdc: LIGHT_SCREEN_NDC.toArray(),
        windDirection: WIND_DIRECTION.toArray(),
      });
    };

    const drawFrame = () => {
      renderer.setRenderTarget(heightTarget);
      renderer.render(heightScene, fullscreenCamera);
      if (drop.visible || splashAge !== null) {
        renderer.setRenderTarget(waterColorTarget);
        renderer.render(waterScene, camera);
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(blitScene, fullscreenCamera);
      } else {
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(waterScene, camera);
      }
      renderer.render(overlayScene, camera);
      if (splash && splashAge !== null) splash.render(splashAge, waterColorTarget.texture);
    };

    let lastResizeWidth = 0;
    let lastResizeHeight = 0;
    let firstFrameRendered = false;
    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      if (width === lastResizeWidth && height === lastResizeHeight) return;
      lastResizeWidth = width;
      lastResizeHeight = height;
      renderer.setSize(width, height, false);
      const pixelRatio = renderer.getPixelRatio();
      const renderWidth = Math.max(1, Math.floor(width * pixelRatio));
      const renderHeight = Math.max(1, Math.floor(height * pixelRatio));
      waterColorTarget.setSize(renderWidth, renderHeight);
      splash?.setSize(renderWidth, renderHeight);
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
      if (firstFrameRendered) drawFrame();
      console.info(`${LOG} resized`, {
        width,
        height,
        aspect: camera.aspect,
        lightNdc: projectedLight.toArray(),
        impactScreen: [impactScreenX, impactScreenY],
        waterScaleX: water.scale.x,
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
    let dropLaunchLogged = false;
    let dropDrawLogged = false;
    let splashDrawLogged = false;
    let revealNotified = false;
    let introTimelineStarted = !playIntro;
    const handleIntroSkip = () => {
      if (!playIntro) return;
      traceTiming('intro-skipped', {
        splashReady: impactResourcesReady,
        timelineStarted: introTimelineStarted,
        impacted: impactTime !== null,
      });
      playIntro = false;
      introTimelineStarted = false;
      introSettled = true;
      revealNotified = true;
      impactTime = null;
      splashAge = null;
      drop.visible = false;
      host.dataset.splashActive = 'false';
      waterUniforms.uRevealProgress.value = 1;
      waterUniforms.uDeepColor.value.copy(revealedDeepColor);
      waterUniforms.uSurfaceColor.value.copy(revealedSurfaceColor);
      releaseIntroResources();
    };
    window.addEventListener('water:intro-skip', handleIntroSkip);
    let hasDecodedVideoFrame = false;
    let videoBlendValue = 0;
    let videoBlendTarget = 0;
    const handleVideoPlaying = () => {
      hasDecodedVideoFrame = true;
      videoBlendTarget = 1;
    };
    const handleVideoWaiting = () => {
      videoBlendTarget = 0;
    };
    const supportsVideoFrameCallback = Boolean(
      backgroundVideo && typeof backgroundVideo.requestVideoFrameCallback === 'function',
    );
    if (backgroundVideo && supportsVideoFrameCallback) {
      backgroundVideo.requestVideoFrameCallback(() => {
        hasDecodedVideoFrame = true;
        if (!backgroundVideo.paused) videoBlendTarget = 1;
      });
    }
    if (backgroundVideo && !supportsVideoFrameCallback && backgroundVideo.readyState >= 2) {
      hasDecodedVideoFrame = true;
    }
    backgroundVideo?.addEventListener('playing', handleVideoPlaying);
    backgroundVideo?.addEventListener('waiting', handleVideoWaiting);

    const rebaseTimeline = (elapsed: number) => {
      const offset = Math.floor(elapsed / TIME_REBASE_INTERVAL_SECONDS)
        * TIME_REBASE_INTERVAL_SECONDS;
      if (offset <= 0) return elapsed;
      startedAt += offset;
      if (impactTime !== null) impactTime -= offset;
      return elapsed - offset;
    };

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      const now = performance.now() / 1000;
      const frameInterval = introSettled ? IDLE_FRAME_INTERVAL : ACTIVE_FRAME_INTERVAL;
      if (now - lastRenderedAt < frameInterval - FRAME_INTERVAL_TOLERANCE) return;
      const frameDelta = lastRenderedAt === 0 ? frameInterval : now - lastRenderedAt;
      lastRenderedAt = now;
      const elapsed = rebaseTimeline(now - startedAt);
      const introElapsed = now - introStartedAt;

      heightUniforms.uTime.value = elapsed;
      waterUniforms.uTime.value = elapsed;
      dropUniforms.uTime.value = elapsed;
      if (backgroundVideo && !supportsVideoFrameCallback && backgroundVideo.readyState >= 2) {
        hasDecodedVideoFrame = true;
      }
      videoBlendValue = THREE.MathUtils.damp(
        videoBlendValue,
        videoBlendTarget,
        videoBlendTarget > videoBlendValue ? 8 : 16,
        frameDelta,
      );
      waterUniforms.uVideoReady.value = posterTextureReady || hasDecodedVideoFrame ? 1 : 0;
      waterUniforms.uVideoBlend.value = videoBlendValue;

      if (rippleLut && impactResourcesReady && !rippleLut.ready) rippleLut.buildChunk();

      if (playIntro && introTimelineStarted && introElapsed >= DROP_DELAY && !dropLaunchLogged) {
        dropLaunchLogged = true;
        host.dataset.dropLaunched = 'true';
        traceTiming('drop-launched', {
          introElapsed: Math.round(introElapsed * 1000) / 1000,
          splashReady: impactResourcesReady,
        });
        console.info(`${LOG} drop launched`, { delay: DROP_DELAY, duration: DROP_DURATION });
      }

      if (playIntro && introTimelineStarted && impactTime === null && introElapsed >= DROP_DELAY) {
        const progress = Math.min((introElapsed - DROP_DELAY) / DROP_DURATION, 1);
        const eased = progress * progress;
        drop.position.y = THREE.MathUtils.lerp(DROP_START_Y, 0.1, eased);
        drop.scale.setScalar(THREE.MathUtils.lerp(0.23, 0.2, progress));
        if (progress >= 1) spawnSplash(elapsed);
      }

      splashAge = null;
      if (playIntro && introTimelineStarted && impactTime !== null) {
        const measuredImpactAge = Math.max(elapsed - impactTime, 0);
        const impactAge = debugHoldAge === null
          ? measuredImpactAge
          : Math.min(measuredImpactAge, debugHoldAge);
        waterUniforms.uRippleAge.value = impactAge < RIPPLE_DURATION ? impactAge : -1;
        if (splash && impactAge <= SPLASH_DURATION) splashAge = impactAge;
        introSettled = impactAge >= RIPPLE_DURATION;
        if (introSettled) releaseIntroResources();

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

        if (!completionNotified && impactAge >= COMPLETE_IMPACT_AGE) {
          completionNotified = true;
          onComplete?.();
        }
      }

      drawFrame();

      if (drop.visible && introTimelineStarted && !dropDrawLogged) {
        dropDrawLogged = true;
        traceTiming('drop-first-draw', {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          y: Math.round(drop.position.y * 1000) / 1000,
        });
      }
      if (splashAge !== null && !splashDrawLogged) {
        splashDrawLogged = true;
        traceTiming('splash-first-draw', {
          calls: renderer.info.render.calls,
          age: Math.round(splashAge * 1000) / 1000,
          splashReady: impactResourcesReady,
        });
      }

      if (!firstFrameRendered) {
        firstFrameRendered = true;
        host.dataset.firstFrame = 'true';
        traceTiming('first-frame', {
          canvasWidth: renderer.domElement.width,
          canvasHeight: renderer.domElement.height,
        });
        window.dispatchEvent(new CustomEvent('water:first-frame'));
        console.info(`${LOG} first frame rendered`, {
          canvas: [renderer.domElement.width, renderer.domElement.height],
          passes: drop.visible ? ['height', 'water', 'refraction-blit', 'overlay'] : ['height', 'water', 'overlay'],
        });
        console.groupEnd();
      }
    };

    // Splash and ripple programs compile in the background while the drop is
    // still hanging, so nothing compiles on the impact frame.
    const prepareImpactResources = () => {
      if (disposed || impactResourcesStarted || (!rippleLut && !splash)) return;
      impactResourcesStarted = true;
      traceTiming('impact-resources-compile-start', {
        parallel: Boolean(parallelShaderCompile),
      });
      impactResourcesSettled = Promise.all([rippleLut?.compile(), splash?.compile()])
        .then(
          () => {
            if (disposed) return;
            impactResourcesReady = true;
            host.dataset.splashReady = 'true';
            traceTiming('impact-resources-ready');
          },
          (error: unknown) => console.warn(`${LOG} impact shader warmup`, error),
        );
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
        dropNdc: dropNdc.toArray().map((value) => Math.round(value * 1000) / 1000),
      });
      if (playIntro) window.dispatchEvent(new CustomEvent('water:intro-start'));
    };
    const start = () => {
      if (disposed) return;
      drop.visible = playIntro;
      startedAt = performance.now() / 1000;
      lastRenderedAt = 0;
      render();
      markSceneReady();
      if (!playIntro) return;
      startIntroTimeline();
      requestAnimationFrame(prepareImpactResources);
    };
    start();

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
      resizeObserver.disconnect();
      backgroundVideo?.removeEventListener('loadedmetadata', syncVideoCover);
      backgroundVideo?.removeEventListener('playing', handleVideoPlaying);
      backgroundVideo?.removeEventListener('waiting', handleVideoWaiting);
      posterImage?.removeEventListener('load', handlePosterReady);
      posterImage?.removeEventListener('error', handlePosterError);
      window.removeEventListener('water:intro-skip', handleIntroSkip);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.remove();
      delete host.dataset.waterSceneActive;
      const releasedSplash = splash;
      const releasedRippleLut = rippleLut;
      splash = null;
      rippleLut = null;
      afterImpactCompile(() => {
        releasedSplash?.dispose();
        releasedRippleLut?.dispose();
        heightTarget.dispose();
        waterColorTarget.dispose();
        waterGeometry.dispose();
        waterMaterial.dispose();
        heightMaterial.dispose();
        blitMaterial.dispose();
        fullscreenGeometry.dispose();
        drop.geometry.dispose();
        dropMaterial.dispose();
        emptyRippleTexture.dispose();
        glowTexture.dispose();
        environmentTexture.dispose();
        videoTexture.dispose();
        posterTexture.dispose();
        if (videoTexture !== fallbackVideoTexture) fallbackVideoTexture.dispose();
        lightGlow.material.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      });
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
