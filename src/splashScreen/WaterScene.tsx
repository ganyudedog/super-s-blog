'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import heightVertexShader from './water/height.vert';
import heightFragmentShader from './water/height.frag';
import waterVertexShader from './water/water.vert';
import waterFragmentShader from './water/water.frag';
import splashVertexShader from './water/splash.vert';
import splashFragmentShader from './water/splash.frag';
import foamFragmentShader from './water/foam.frag';
import sprayVertexShader from './water/spray.vert';
import sprayFragmentShader from './water/spray.frag';

interface WaterSceneProps {
  onComplete?: () => void;
}

const LOG = '[WaterScene]';
const IMPACT_Z = -2;
// The water plane is centered at z=-80 and spans 400 world units.
const IMPACT_UV_Y = 0.305;
const DROP_DELAY = 0.65;
const DROP_DURATION = 1.05;
const SECONDARY_IMPACT_DELAY = 0.72;
const SPRAY_PARTICLE_COUNT = 72;
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
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x07182a, 1);
    host.appendChild(renderer.domElement);

    const gl = renderer.getContext();
    console.info(`${LOG} renderer ready`, {
      webgl2: renderer.capabilities.isWebGL2,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      maxTextureSize: renderer.capabilities.maxTextureSize,
    });

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07182a);
    scene.fog = new THREE.FogExp2(0x07182a, 0.022);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 5.1, 7.4);
    camera.lookAt(0, 0.05, -4.2);

    const heightUniforms = {
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
      uRippleAge2: { value: -1 },
      uImpactStrength: { value: 1 },
      uRippleCenter: { value: new THREE.Vector2(0.5, IMPACT_UV_Y) },
      uRippleCenter2: { value: new THREE.Vector2(0.502, IMPACT_UV_Y + 0.004) },
      uImpactStrength2: { value: 0.42 },
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
    console.info(`${LOG} height pass ready`, {
      size: heightTargetSize,
      textureType: 'HalfFloatType',
      colorBufferFloat: Boolean(gl.getExtension('EXT_color_buffer_float')),
    });

    const lightPosition = new THREE.Vector3();
    const waterUniforms = {
      uHeightMap: { value: heightTarget.texture },
      uHeightTexel: { value: new THREE.Vector2(1 / heightTargetSize, 1 / heightTargetSize) },
      uHeightScale: { value: 1.45 },
      uLightPosition: { value: lightPosition },
      uDeepColor: { value: new THREE.Color(0x08244a) },
      uSurfaceColor: { value: new THREE.Color(0x145284) },
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
    };
    const waterMaterial = new THREE.RawShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: waterUniforms,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      fog: false,
    });
    const waterGeometry = new THREE.PlaneGeometry(420, 520, 224, 480);
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.35, -100);
    scene.add(water);

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
      impactUv: [0.5, IMPACT_UV_Y],
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
      uSceneTexture: { value: sceneTarget.texture },
      uEnvironmentMap: { value: environmentTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uLayerOffset: { value: 0 },
    };
    const waveMaterial = new THREE.RawShaderMaterial({
      vertexShader: splashVertexShader,
      fragmentShader: splashFragmentShader,
      uniforms: splashUniforms,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
    });
    const crownSegments = 96;
    const crownRings = 18;
    const crownPositions: number[] = [];
    const crownTheta: number[] = [];
    const crownRadial: number[] = [];
    const crownSide: number[] = [];
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
    crownGeometry.setIndex(crownIndices);
    const splashWave = new THREE.Mesh(crownGeometry, waveMaterial);
    splashWave.position.set(0, water.position.y + 0.015, IMPACT_Z);
    splashWave.renderOrder = 10;
    splashWave.visible = false;
    scene.add(splashWave);

    const foamUniforms = {
      uAge: { value: 0 },
      uTime: { value: 0 },
      uLightPosition: { value: lightPosition },
      uLayerOffset: { value: 0.0035 },
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
    const splashFoam = new THREE.Mesh(crownGeometry, foamMaterial);
    splashFoam.position.copy(splashWave.position);
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
      sprayContext.scale(0.48, 1);
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
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
        delay: 0.14 + ((index * 7) % 17) * 0.012,
        radialSpeed: 0.32 + ((index * 11) % 13) * 0.032,
        verticalSpeed: 0.72 + ((index * 5) % 11) * 0.06,
        drift: Math.sin(index * 3.91) * 0.16,
      });
    }

    let impactTime: number | null = null;
    let impactAnimationAge = 0;
    let impactLogged = false;
    let secondaryImpactLogged = false;
    let completionTimer: number | undefined;

    const spawnSplash = (elapsed: number) => {
      splashWave.visible = true;
      splashFoam.visible = true;
      sprayParticles.visible = false;
      sprayAlphas.fill(0);
      sprayAlphaAttribute.needsUpdate = true;
      splashUniforms.uAge.value = 0;
      foamUniforms.uAge.value = 0;
      heightUniforms.uRippleAge.value = 0;
      heightUniforms.uRippleAge2.value = -1;
      impactAnimationAge = 0;
      impactTime = elapsed;
      console.info(`${LOG} impact`, {
        elapsed,
        worldPosition: [0, 0, IMPACT_Z],
        rippleUv: [0.5, IMPACT_UV_Y],
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
      completionTimer = window.setTimeout(() => onComplete?.(), 3600);
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      const pixelRatio = renderer.getPixelRatio();
      const renderWidth = Math.max(1, Math.floor(width * pixelRatio));
      const renderHeight = Math.max(1, Math.floor(height * pixelRatio));
      sceneTarget.setSize(renderWidth, renderHeight);
      splashUniforms.uResolution.value.set(renderWidth, renderHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Keep the far left and right corners on the water at ultra-wide ratios.
      water.scale.x = Math.max(1, camera.aspect / 1.6);
      placeLightAtScreenOrigin();
      const projectedLight = lightPosition.clone().project(camera);
      console.info(`${LOG} resized`, {
        width,
        height,
        aspect: camera.aspect,
        lightNdc: projectedLight.toArray(),
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

    const render = () => {
      animationFrame = requestAnimationFrame(render);
      const now = performance.now() / 1000;
      const elapsed = now - startedAt;
      const frameDelta = Math.min(now - previousTime, 1 / 30);
      previousTime = now;

      heightUniforms.uTime.value = elapsed;
      waterUniforms.uTime.value = elapsed;
      splashUniforms.uTime.value = elapsed;
      foamUniforms.uTime.value = elapsed;
      waterUniforms.uRippleAge.value = heightUniforms.uRippleAge.value;

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
        splashWave.visible = impactAge < 1.12;
        splashFoam.visible = impactAge < 1.08;

        sprayParticles.visible = impactAge >= 0.1 && impactAge < 1.52;
        if (sprayParticles.visible) {
          const sprayFadeIn = THREE.MathUtils.smoothstep(impactAge, 0.12, 0.34);
          const sprayFadeOut = 1 - THREE.MathUtils.smoothstep(impactAge, 1.05, 1.52);
          const globalSprayAlpha = 0.68 * sprayFadeIn * sprayFadeOut;
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
              - 0.5 * 2.2 * particleAge * particleAge;
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
            sprayAlphas[index] = globalSprayAlpha * (0.62 + (index % 5) * 0.075);
            sprayScales[index] = 0.07 + (index % 7) * 0.008;
          });
          sprayPositionAttribute.needsUpdate = true;
          sprayAlphaAttribute.needsUpdate = true;
          sprayScaleAttribute.needsUpdate = true;
        }

        if (!impactLogged && impactAge >= 0.5) {
          impactLogged = true;
          console.info(`${LOG} ripple propagating`, {
            age: impactAge,
            estimatedRadiusUv: impactAge * 0.28,
            heightTexture: heightTarget.texture.name,
          });
        }
      }

      renderer.setRenderTarget(heightTarget);
      renderer.render(heightScene, heightCamera);
      if (splashWave.visible) {
        const foamVisible = splashFoam.visible;
        const sprayVisible = sprayParticles.visible;
        splashWave.visible = false;
        splashFoam.visible = false;
        sprayParticles.visible = false;
        renderer.setRenderTarget(sceneTarget);
        renderer.render(scene, camera);
        splashWave.visible = true;
        splashFoam.visible = foamVisible;
        sprayParticles.visible = sprayVisible;
      }
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      if (firstFrame) {
        firstFrame = false;
        console.info(`${LOG} first frame rendered`, {
          canvas: [renderer.domElement.width, renderer.domElement.height],
          passes: ['height', 'water'],
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
      if (completionTimer !== undefined) window.clearTimeout(completionTimer);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      heightTarget.dispose();
      sceneTarget.dispose();
      heightMaterial.dispose();
      heightQuad.geometry.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
      drop.geometry.dispose();
      dropMaterial.dispose();
      splashWave.geometry.dispose();
      waveMaterial.dispose();
      foamMaterial.dispose();
      sprayGeometry.dispose();
      sprayMaterial.dispose();
      sprayTexture.dispose();
      glowTexture.dispose();
      environmentTexture.dispose();
      (lightGlow.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onComplete]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    />
  );
}
