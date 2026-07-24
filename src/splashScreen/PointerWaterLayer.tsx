import { useEffect } from 'react';
import * as THREE from 'three';
import pointerSimulationFragmentShader from './water/pointer-simulation.frag?raw';
import pointerSimulationVertexShader from './water/pointer-simulation.vert?raw';
import pointerSurfaceFragmentShader from './water/pointer-surface.frag?raw';

const FIXED_STEP = 1 / 60;
const MAX_STEPS = 3;
const MAX_STROKES_PER_STEP = 8;
const MAX_PENDING_STROKES = 48;

interface PendingStroke {
  start: THREE.Vector2;
  end: THREE.Vector2;
  strength: number;
}

function getSimulationDimensions(width: number, height: number) {
  const longEdge = width < 768 ? 256 : 384;
  if (width >= height) {
    return {
      width: longEdge,
      height: Math.max(128, Math.round(longEdge * height / Math.max(width, 1))),
    };
  }
  return {
    width: Math.max(128, Math.round(longEdge * width / Math.max(height, 1))),
    height: longEdge,
  };
}

export default function PointerWaterLayer() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: 'default',
      premultipliedAlpha: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.dataset.pointerWaterLayer = 'true';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483000',
    });
    document.body.appendChild(canvas);

    const viewportSize = new THREE.Vector2(window.innerWidth, window.innerHeight);
    renderer.setSize(viewportSize.x, viewportSize.y, false);
    let simulationDimensions = getSimulationDimensions(
      viewportSize.x,
      viewportSize.y,
    );
    const createStateTarget = (width: number, height: number) => (
      new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
      })
    );

    let readTarget = createStateTarget(
      simulationDimensions.width,
      simulationDimensions.height,
    );
    let writeTarget = createStateTarget(
      simulationDimensions.width,
      simulationDimensions.height,
    );
    const clearState = () => {
      renderer.setRenderTarget(readTarget);
      renderer.clear();
      renderer.setRenderTarget(writeTarget);
      renderer.clear();
      renderer.setRenderTarget(null);
      renderer.clear();
    };
    clearState();

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    const simulationUniforms = {
      uPreviousState: { value: readTarget.texture },
      uTexel: {
        value: new THREE.Vector2(
          1 / simulationDimensions.width,
          1 / simulationDimensions.height,
        ),
      },
      uViewportSize: { value: viewportSize },
      uStrokeStarts: {
        value: Array.from(
          { length: MAX_STROKES_PER_STEP },
          () => new THREE.Vector2(),
        ),
      },
      uStrokeEnds: {
        value: Array.from(
          { length: MAX_STROKES_PER_STEP },
          () => new THREE.Vector2(),
        ),
      },
      uStrokeStrengths: {
        value: Array.from({ length: MAX_STROKES_PER_STEP }, () => 0),
      },
      uStrokeCount: { value: 0 },
      uDeltaTime: { value: FIXED_STEP },
    };
    const simulationMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pointerSimulationVertexShader,
      fragmentShader: pointerSimulationFragmentShader,
      uniforms: simulationUniforms,
      depthTest: false,
      depthWrite: false,
    });
    const simulationScene = new THREE.Scene();
    simulationScene.add(new THREE.Mesh(quadGeometry, simulationMaterial));

    const surfaceUniforms = {
      uState: { value: readTarget.texture },
      uFoamGain: { value: 1.16 },
    };
    const surfaceMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: pointerSimulationVertexShader,
      fragmentShader: pointerSurfaceFragmentShader,
      uniforms: surfaceUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const displayScene = new THREE.Scene();
    displayScene.add(new THREE.Mesh(quadGeometry, surfaceMaterial));

    const pendingStrokes: PendingStroke[] = [];
    let animationFrame = 0;
    let lastFrameTime = 0;
    let accumulator = 0;
    let activeUntil = 0;
    let previousX = Number.NaN;
    let previousY = Number.NaN;
    let previousTime = -Infinity;

    const runSimulationStep = () => {
      const strokeCount = Math.min(
        pendingStrokes.length,
        MAX_STROKES_PER_STEP,
      );
      simulationUniforms.uStrokeCount.value = strokeCount;
      for (let index = 0; index < strokeCount; index += 1) {
        const stroke = pendingStrokes.shift();
        if (!stroke) break;
        simulationUniforms.uStrokeStarts.value[index].copy(stroke.start);
        simulationUniforms.uStrokeEnds.value[index].copy(stroke.end);
        simulationUniforms.uStrokeStrengths.value[index] = stroke.strength;
      }

      simulationUniforms.uPreviousState.value = readTarget.texture;
      renderer.setRenderTarget(writeTarget);
      renderer.render(simulationScene, camera);
      const previousReadTarget = readTarget;
      readTarget = writeTarget;
      writeTarget = previousReadTarget;
      surfaceUniforms.uState.value = readTarget.texture;
    };

    const renderFrame = (time: number) => {
      const deltaTime = lastFrameTime > 0
        ? Math.min((time - lastFrameTime) / 1000, 0.05)
        : FIXED_STEP;
      lastFrameTime = time;
      accumulator = Math.min(accumulator + deltaTime, FIXED_STEP * MAX_STEPS);
      let steps = 0;
      while (accumulator >= FIXED_STEP && steps < MAX_STEPS) {
        runSimulationStep();
        accumulator -= FIXED_STEP;
        steps += 1;
      }

      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(displayScene, camera);

      if (time < activeUntil || pendingStrokes.length > 0) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      } else {
        animationFrame = 0;
        lastFrameTime = 0;
        accumulator = 0;
        clearState();
      }
    };

    const ensureAnimation = () => {
      if (animationFrame === 0) {
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const now = performance.now();
      if (
        !Number.isFinite(previousX)
        || now - previousTime > 150
      ) {
        previousX = event.clientX;
        previousY = event.clientY;
        previousTime = now;
        return;
      }

      const distance = Math.hypot(
        event.clientX - previousX,
        event.clientY - previousY,
      );
      if (distance < 2) return;
      pendingStrokes.push({
        start: new THREE.Vector2(
          previousX / viewportSize.x,
          1 - previousY / viewportSize.y,
        ),
        end: new THREE.Vector2(
          event.clientX / viewportSize.x,
          1 - event.clientY / viewportSize.y,
        ),
        // A stable target density prevents event timing from turning stroke
        // junctions into bright beads.
        strength: 0.88,
      });
      if (pendingStrokes.length > MAX_PENDING_STROKES) {
        pendingStrokes.splice(0, pendingStrokes.length - MAX_PENDING_STROKES);
      }

      previousX = event.clientX;
      previousY = event.clientY;
      previousTime = now;
      activeUntil = now + 2200;
      ensureAnimation();
    };

    const handlePointerLeave = () => {
      previousX = Number.NaN;
      previousY = Number.NaN;
      previousTime = -Infinity;
    };

    const handleResize = () => {
      viewportSize.set(window.innerWidth, window.innerHeight);
      renderer.setSize(viewportSize.x, viewportSize.y, false);
      const nextDimensions = getSimulationDimensions(
        viewportSize.x,
        viewportSize.y,
      );
      if (
        nextDimensions.width !== simulationDimensions.width
        || nextDimensions.height !== simulationDimensions.height
      ) {
        readTarget.dispose();
        writeTarget.dispose();
        simulationDimensions = nextDimensions;
        readTarget = createStateTarget(
          simulationDimensions.width,
          simulationDimensions.height,
        );
        writeTarget = createStateTarget(
          simulationDimensions.width,
          simulationDimensions.height,
        );
        simulationUniforms.uPreviousState.value = readTarget.texture;
        simulationUniforms.uTexel.value.set(
          1 / simulationDimensions.width,
          1 / simulationDimensions.height,
        );
        surfaceUniforms.uState.value = readTarget.texture;
      }
      pendingStrokes.length = 0;
      previousX = Number.NaN;
      previousY = Number.NaN;
      previousTime = -Infinity;
      clearState();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('resize', handleResize);
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      readTarget.dispose();
      writeTarget.dispose();
      quadGeometry.dispose();
      simulationMaterial.dispose();
      surfaceMaterial.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return null;
}
