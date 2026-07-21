'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import heightVertexShader from './water/height.vert';
import heightFragmentShader from './water/height.frag';
import waterVertexShader from './water/water.vert';
import waterFragmentShader from './water/water.frag';

interface WaterSceneProps {
  onComplete?: () => void;
}

const LOG = '[WaterScene]';
const IMPACT_Z = -2;
const IMPACT_UV_Y = 1 / 3;
const DROP_DELAY = 0.65;
const DROP_DURATION = 1.05;
const SPLASH_COUNT = 28;
const LIGHT_SCREEN_NDC = new THREE.Vector3(-1, 1, 0.15);
const WIND_DIRECTION = new THREE.Vector2(-1, 0);
const WIND_STRENGTH = 1;

interface SplashParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
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

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    camera.position.set(0, 5.1, 7.4);
    camera.lookAt(0, 0.05, -4.2);

    const heightUniforms = {
      uTime: { value: 0 },
      uRippleAge: { value: -1 },
      uImpactStrength: { value: 1 },
      uRippleCenter: { value: new THREE.Vector2(0.5, IMPACT_UV_Y) },
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
    };
    const waterMaterial = new THREE.RawShaderMaterial({
      vertexShader: waterVertexShader,
      fragmentShader: waterFragmentShader,
      uniforms: waterUniforms,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
      fog: false,
    });
    const waterGeometry = new THREE.PlaneGeometry(70, 240, 192, 360);
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.35, -40);
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

    const splashMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x8ec8ff,
      emissive: 0x0d2947,
      roughness: 0.12,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const splashMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      splashMaterial,
      SPLASH_COUNT,
    );
    splashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    splashMesh.visible = false;
    scene.add(splashMesh);

    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0x73b6e8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ringSegments = 128;
    const ringPositions = new Float32Array((ringSegments + 1) * 3);
    for (let index = 0; index <= ringSegments; index += 1) {
      const angle = (index / ringSegments) * Math.PI * 2;
      const irregularRadius = 0.27 * (1 + Math.sin(index * 2.31) * 0.045 + Math.sin(index * 7.17) * 0.018);
      ringPositions[index * 3] = Math.cos(angle) * irregularRadius;
      ringPositions[index * 3 + 1] = 0.045;
      // Counter the camera pitch so the impact reads close to circular on screen.
      ringPositions[index * 3 + 2] = IMPACT_Z + Math.sin(angle) * irregularRadius * 2.8;
    }
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
    const splashRing = new THREE.LineLoop(ringGeometry, ringMaterial);
    splashRing.visible = false;
    scene.add(splashRing);

    const jetMaterial = splashMaterial.clone();
    const jet = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), jetMaterial);
    jet.position.set(0, 0.06, IMPACT_Z);
    jet.visible = false;
    scene.add(jet);

    const splashParticles: SplashParticle[] = [];
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    let impactTime: number | null = null;
    let impactLogged = false;
    let completionTimer: number | undefined;

    const spawnSplash = (elapsed: number) => {
      splashParticles.length = 0;
      for (let index = 0; index < SPLASH_COUNT; index += 1) {
        const angle = (index / SPLASH_COUNT) * Math.PI * 2 + Math.sin(index * 8.37) * 0.18;
        const radialSpeed = 0.75 + ((index * 17) % 11) * 0.055;
        splashParticles.push({
          position: new THREE.Vector3(0, 0.08, IMPACT_Z),
          velocity: new THREE.Vector3(
            Math.cos(angle) * radialSpeed,
            1.5 + ((index * 13) % 17) * 0.11,
            Math.sin(angle) * radialSpeed,
          ),
        });
      }
      splashMesh.visible = true;
      splashRing.visible = true;
      jet.visible = true;
      splashMaterial.opacity = 0.9;
      ringMaterial.opacity = 0.52;
      jetMaterial.opacity = 0.9;
      heightUniforms.uRippleAge.value = 0;
      impactTime = elapsed;
      console.info(`${LOG} impact`, {
        elapsed,
        worldPosition: [0, 0, IMPACT_Z],
        rippleUv: [0.5, IMPACT_UV_Y],
        lightPosition: lightPosition.toArray(),
        lightScreenNdc: LIGHT_SCREEN_NDC.toArray(),
        windDirection: WIND_DIRECTION.toArray(),
        windStrength: WIND_STRENGTH,
      });
      console.info(`${LOG} splash spawned`, { particles: SPLASH_COUNT });
      completionTimer = window.setTimeout(() => onComplete?.(), 3600);
    };

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
      const delta = Math.min(now - previousTime, 1 / 30);
      previousTime = now;

      heightUniforms.uTime.value = elapsed;
      waterUniforms.uTime.value = elapsed;

      if (elapsed >= DROP_DELAY && !dropLaunchLogged) {
        dropLaunchLogged = true;
        console.info(`${LOG} drop launched`, { delay: DROP_DELAY, duration: DROP_DURATION });
      }

      if (impactTime === null && elapsed >= DROP_DELAY) {
        const progress = Math.min((elapsed - DROP_DELAY) / DROP_DURATION, 1);
        const eased = progress * progress;
        drop.position.y = THREE.MathUtils.lerp(5.5, 0.1, eased);
        drop.scale.set(
          THREE.MathUtils.lerp(0.23, 0.2, progress),
          THREE.MathUtils.lerp(0.24, 0.28, progress),
          THREE.MathUtils.lerp(0.23, 0.2, progress),
        );
        if (progress >= 1) {
          drop.visible = false;
          spawnSplash(elapsed);
        }
      }

      if (impactTime !== null) {
        const impactAge = elapsed - impactTime;
        heightUniforms.uRippleAge.value = impactAge;

        splashParticles.forEach((particle, index) => {
          particle.velocity.y -= 5.6 * delta;
          particle.position.addScaledVector(particle.velocity, delta);
          const particleScale = Math.max(0.2, 1 - impactAge * 0.42);
          scale.setScalar(particleScale);
          matrix.compose(particle.position, quaternion, scale);
          splashMesh.setMatrixAt(index, matrix);
        });
        splashMesh.instanceMatrix.needsUpdate = true;
        splashMaterial.opacity = Math.max(0, 0.9 - impactAge * 0.48);

        splashRing.scale.setScalar(1 + impactAge * 2.4);
        ringMaterial.opacity = Math.max(0, 0.52 - impactAge * 0.3);

        jet.position.y = 0.06 + Math.sin(Math.min(impactAge / 0.65, 1) * Math.PI) * 0.85;
        jet.scale.set(0.72, 1.2 + Math.sin(Math.min(impactAge / 0.65, 1) * Math.PI) * 2.4, 0.72);
        jetMaterial.opacity = Math.max(0, 0.9 - impactAge * 1.25);

        if (!impactLogged && impactAge >= 0.5) {
          impactLogged = true;
          console.info(`${LOG} ripple propagating`, {
            age: impactAge,
            estimatedRadiusUv: impactAge * 0.24,
            heightTexture: heightTarget.texture.name,
          });
        }
      }

      renderer.setRenderTarget(heightTarget);
      renderer.render(heightScene, heightCamera);
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
      heightMaterial.dispose();
      heightQuad.geometry.dispose();
      waterGeometry.dispose();
      waterMaterial.dispose();
      drop.geometry.dispose();
      dropMaterial.dispose();
      splashMesh.geometry.dispose();
      splashMaterial.dispose();
      splashRing.geometry.dispose();
      ringMaterial.dispose();
      jet.geometry.dispose();
      jetMaterial.dispose();
      glowTexture.dispose();
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
