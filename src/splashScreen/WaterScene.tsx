'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import heightVertexShader from './water/height.vert';
import heightFragmentShader from './water/height.frag';
import waterVertexShader from './water/water.vert';
import waterFragmentShader from './water/water.frag';
import splashVertexShader from './water/splash.vert';
import splashFragmentShader from './water/splash.frag';
import thicknessFragmentShader from './water/thickness.frag';
import foamFragmentShader from './water/foam.frag';
import sprayVertexShader from './water/spray.vert';
import sprayFragmentShader from './water/spray.frag';

interface WaterSceneProps {
  onComplete?: () => void;
}

const LOG = '[WaterScene]';
const IMPACT_Z = -2;
const DROP_DELAY = 0.65;
const DROP_DURATION = 1.05;
const SECONDARY_IMPACT_DELAY = 0.78;
const REVEAL_IMPACT_AGE = 1.18;
const SPRAY_PARTICLE_COUNT = 72;
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

export default function WaterScene({ onComplete }: WaterSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    console.groupCollapsed(`${LOG} boot`);
    console.info(`${LOG} GLSL loaded`, {
      heightVertex: heightVertexShader.length,
      heightFragment: heightFragmentShader.length,
      waterVertex: waterVertexShader.length,
      waterFragment: waterFragmentShader.length,
    });

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x07182a, 0);
    host.appendChild(renderer.domElement);

    const gl = renderer.getContext();
    console.info(`${LOG} renderer ready`, {
      webgl2: renderer.capabilities.isWebGL2,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      maxTextureSize: renderer.capabilities.maxTextureSize,
    });

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.FogExp2(0x07182a, 0.022);

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
      uWindSpeed: { value: 0.009 },
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

    const heightTargetSize = 768;
    const heightTarget = new THREE.WebGLRenderTarget(heightTargetSize, heightTargetSize, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    heightTarget.texture.name = 'splash-ripple-height';
    const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    sceneTarget.texture.name = 'splash-refraction-background';
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
      new Uint8Array([7, 24, 42, 255]),
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
    const initialDeepColor = new THREE.Color(0x08244a);
    const initialSurfaceColor = new THREE.Color(0x145284);
    const revealedDeepColor = new THREE.Color(0x174f70);
    const revealedSurfaceColor = new THREE.Color(0x4ba6bd);

    const waterUniforms = {
      uHeightMap: { value: heightTarget.texture },
      uHeightTexel: { value: new THREE.Vector2(1 / heightTargetSize, 1 / heightTargetSize) },
      uHeightScale: { value: 1.45 },
      uLightPosition: { value: lightPosition },
      uDeepColor: { value: initialDeepColor.clone() },
      uSurfaceColor: { value: initialSurfaceColor.clone() },
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
      uRippleCenter: { value: heightUniforms.uRippleCenter.value },
      uWaterSize: { value: heightUniforms.uWaterSize.value },
      uVideoTexture: { value: videoTexture },
      uVideoReady: { value: 0 },
      uVideoUvScale: { value: new THREE.Vector2(1, 1) },
      uVideoUvOffset: { value: new THREE.Vector2(0, 0) },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uRevealProgress: { value: 0 },
    };
    const waterMaterial = new THREE.RawShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: waterUniforms,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      fog: false,
    });
    const waterGeometry = new THREE.PlaneGeometry(WATER_WIDTH, WATER_LENGTH, 280, 520);
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.35, -100);
    scene.add(water);

    const impactWorldPosition = new THREE.Vector3(0, water.position.y, IMPACT_Z);
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
    };
    placeLightAtScreenOrigin();
    console.info(`${LOG} water mesh ready`, {
      vertices: waterGeometry.attributes.position.count,
      lightPosition: lightPosition.toArray(),
      impactUv: heightUniforms.uRippleCenter.value.toArray(),
    });

    const dropMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd9efff,
      emissive: 0x1c5c8d,
      emissiveIntensity: 0.22,
      roughness: 0.012,
      metalness: 0,
      transmission: 0.92,
      ior: 1.333,
      thickness: 0.34,
      attenuationColor: new THREE.Color(0x9bc9ef),
      attenuationDistance: 2.2,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
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
    const drop = new THREE.Mesh(new THREE.LatheGeometry(dropProfile, 36), dropMaterial);
    drop.scale.setScalar(0.22);
    drop.position.set(0, 5.5, IMPACT_Z);
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
    const waveMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashVertexShader,
      fragmentShader: splashFragmentShader,
      uniforms: splashUniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    waveMaterial.forceSinglePass = true;
    const crownSegments = 128;
    const crownRings = 22;
    const crownPositions: number[] = [];
    const crownTheta: number[] = [];
    const crownRadial: number[] = [];
    const crownSide: number[] = [];
    const crownRimAngle: number[] = [];
    const crownIndices: number[] = [];
    const crownRowSize = crownRings + 1;
    const crownSurfaceVertexCount = (crownSegments + 1) * crownRowSize;
    for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
      const side = sideIndex === 0 ? 1 : -1;
      for (let segment = 0; segment <= crownSegments; segment += 1) {
        const theta = (segment / crownSegments) * Math.PI * 2;
        for (let ring = 0; ring <= crownRings; ring += 1) {
          crownPositions.push(0, 0, 0);
          crownTheta.push(theta);
          crownRadial.push(ring / crownRings);
          crownSide.push(side);
          crownRimAngle.push(0);
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
    crownSurfaceGeometry.setIndex(
      crownIndices.slice(0, crownSegments * crownRings * 6),
    );

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

    const splashWave = new THREE.Mesh(crownSurfaceGeometry, waveMaterial);
    splashWave.position.copy(splashBase.position);
    splashWave.frustumCulled = false;
    splashWave.renderOrder = 10;
    splashWave.visible = false;
    splashWave.onBeforeRender = () => {
      splashUniforms.uRimMode.value = 0;
      waveMaterial.uniformsNeedUpdate = true;
    };
    scene.add(splashWave);

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
      vertexShader: splashVertexShader,
      fragmentShader: thicknessFragmentShader,
      uniforms: frontDepthUniforms,
      glslVersion: THREE.GLSL3,
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
      side: THREE.FrontSide,
    });
    const backDepthMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashVertexShader,
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
      vertexShader: splashVertexShader,
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
    let impactAnimationAge = 0;
    let impactLogged = false;
    let secondaryImpactLogged = false;
    let completionNotified = false;

    const spawnSplash = (elapsed: number) => {
      splashBase.visible = true;
      splashWave.visible = true;
      splashRim.visible = true;
      splashLigaments.visible = true;
      splashBeads.visible = true;
      splashFoam.visible = true;
      sprayParticles.visible = false;
      sprayAlphas.fill(0);
      sprayAlphaAttribute.needsUpdate = true;
      splashUniforms.uAge.value = 0;
      foamUniforms.uAge.value = 0;
      frontDepthUniforms.uAge.value = 0;
      backDepthUniforms.uAge.value = 0;
      heightUniforms.uRippleAge.value = 0;
      heightUniforms.uRippleAge2.value = -1;
      impactAnimationAge = 0;
      impactTime = elapsed;
      console.info(`${LOG} impact`, {
        elapsed,
        worldPosition: [0, 0, IMPACT_Z],
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

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      const pixelRatio = renderer.getPixelRatio();
      const renderWidth = Math.max(1, Math.floor(width * pixelRatio));
      const renderHeight = Math.max(1, Math.floor(height * pixelRatio));
      sceneTarget.setSize(renderWidth, renderHeight);
      frontDepthTarget.setSize(renderWidth, renderHeight);
      backDepthTarget.setSize(renderWidth, renderHeight);
      splashUniforms.uResolution.value.set(renderWidth, renderHeight);
      waterUniforms.uResolution.value.set(renderWidth, renderHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Keep the far left and right corners on the water at ultra-wide ratios.
      water.scale.x = Math.max(1, camera.aspect / 1.6);
      syncWaterMetrics();
      syncVideoCover();
      placeLightAtScreenOrigin();
      const projectedLight = lightPosition.clone().project(camera);
      console.info(`${LOG} resized`, {
        width,
        height,
        aspect: camera.aspect,
        lightNdc: projectedLight.toArray(),
        impactUv: heightUniforms.uRippleCenter.value.toArray(),
        waterSize: heightUniforms.uWaterSize.value.toArray(),
      });
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    let animationFrame = 0;
    let previousTime = performance.now() / 1000;
    const startedAt = previousTime;
    let firstFrame = true;
    let dropLaunchLogged = false;
    let revealNotified = false;

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      const now = performance.now() / 1000;
      const elapsed = now - startedAt;
      const frameDelta = Math.min(now - previousTime, 1 / 15);
      previousTime = now;

      heightUniforms.uTime.value = elapsed;
      waterUniforms.uTime.value = elapsed;
      splashUniforms.uTime.value = elapsed;
      foamUniforms.uTime.value = elapsed;
      waterUniforms.uRippleAge.value = heightUniforms.uRippleAge.value;
      waterUniforms.uVideoReady.value = backgroundVideo && backgroundVideo.readyState >= 2 ? 1 : 0;

      if (elapsed >= DROP_DELAY && !dropLaunchLogged) {
        dropLaunchLogged = true;
        console.info(`${LOG} drop launched`, { delay: DROP_DELAY, duration: DROP_DURATION });
      }

      if (impactTime === null && elapsed >= DROP_DELAY) {
        const progress = Math.min((elapsed - DROP_DELAY) / DROP_DURATION, 1);
        const eased = progress * progress;
        drop.position.y = THREE.MathUtils.lerp(5.5, 0.1, eased);
        drop.scale.setScalar(THREE.MathUtils.lerp(0.23, 0.2, progress));
        if (progress >= 1) {
          drop.visible = false;
          spawnSplash(elapsed);
        }
      }

      if (impactTime !== null) {
        impactAnimationAge += frameDelta;
        const impactAge = impactAnimationAge;
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
          window.dispatchEvent(new CustomEvent('water:reveal', {
            detail: {
              impactAge,
              light: { x: 0, y: 0 },
            },
          }));
          console.info(`${LOG} page reveal`, { impactAge });
        }
        splashWave.visible = impactAge < 1.38;
        splashBase.visible = splashWave.visible;
        splashRim.visible = splashWave.visible;
        splashLigaments.visible = splashWave.visible;
        splashBeads.visible = splashWave.visible;
        splashFoam.visible = impactAge < 1.3;

        sprayParticles.visible = impactAge >= 0.04 && impactAge < 1.68;
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
            sprayPositions[offset] = Math.cos(angle) * radius;
            sprayPositions[offset + 1] = particleY;
            sprayPositions[offset + 2] = IMPACT_Z + Math.sin(angle) * radius * 1.8;
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

      renderer.setRenderTarget(heightTarget);
      renderer.render(heightScene, heightCamera);
      if (splashWave.visible) {
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(frontDepthTarget);
        renderer.render(frontDepthScene, camera);
        renderer.setRenderTarget(backDepthTarget);
        renderer.render(backDepthScene, camera);
        renderer.setClearColor(0x07182a, 0);

        const baseVisible = splashBase.visible;
        const rimVisible = splashRim.visible;
        const ligamentsVisible = splashLigaments.visible;
        const beadsVisible = splashBeads.visible;
        const foamVisible = splashFoam.visible;
        const sprayVisible = sprayParticles.visible;
        splashBase.visible = false;
        splashWave.visible = false;
        splashRim.visible = false;
        splashLigaments.visible = false;
        splashBeads.visible = false;
        splashFoam.visible = false;
        sprayParticles.visible = false;
        renderer.setRenderTarget(sceneTarget);
        renderer.render(scene, camera);
        splashBase.visible = baseVisible;
        splashWave.visible = true;
        splashRim.visible = rimVisible;
        splashLigaments.visible = ligamentsVisible;
        splashBeads.visible = beadsVisible;
        splashFoam.visible = foamVisible;
        sprayParticles.visible = sprayVisible;
      }
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        console.info(`${LOG} first frame rendered`, {
          canvas: [renderer.domElement.width, renderer.domElement.height],
          passes: ['height', 'front-depth', 'back-depth', 'refraction', 'water'],
        });
        console.groupEnd();
      }
    };
    render();

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      console.error(`${LOG} WebGL context lost`);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    return () => {
      console.info(`${LOG} disposing scene`);
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      backgroundVideo?.removeEventListener('loadedmetadata', syncVideoCover);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      heightTarget.dispose();
      sceneTarget.dispose();
      frontDepthTarget.dispose();
      backDepthTarget.dispose();
      heightMaterial.dispose();
      heightQuad.geometry.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
      drop.geometry.dispose();
      dropMaterial.dispose();
      crownGeometry.dispose();
      crownSurfaceGeometry.dispose();
      rimGeometry.dispose();
      beadGeometry.dispose();
      ligamentGeometry.dispose();
      waveMaterial.dispose();
      foamMaterial.dispose();
      frontDepthMaterial.dispose();
      backDepthMaterial.dispose();
      sprayGeometry.dispose();
      sprayMaterial.dispose();
      sprayTexture.dispose();
      glowTexture.dispose();
      environmentTexture.dispose();
      videoTexture.dispose();
      if (videoTexture !== fallbackVideoTexture) fallbackVideoTexture.dispose();
      (lightGlow.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onComplete]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className="water-canvas-host"
    />
  );
}
