'use client';

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import {
  Application,
  Mesh,
  MeshGeometry,
  Shader,
  GlProgram,
} from 'pixi.js';
import vertSrc from './shaders/water.vert';
import fragSrc from './shaders/water.frag';

const MAX_RIPPLES = 8;

interface Ripple {
  x: number;
  y: number;
  time: number;
}

export interface WaterSurfaceHandle {
  addRipple: (x: number, y: number) => void;
}

export const WaterSurface = forwardRef<WaterSurfaceHandle>(function _WaterSurface(_props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ripplesRef = useRef<Ripple[]>([]);
  const startTimeRef = useRef(performance.now() / 1000);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;

    (async () => {
      const app = new Application();
      await app.init({
        canvas,
        resizeTo: canvas.parentElement ?? window,
        backgroundAlpha: 0,
        antialias: false,
      });
      if (disposed) { app.destroy(true); return; }

      const w = app.screen.width;
      const h = app.screen.height;

      // fullscreen quad in clip coords (-1 to 1)
      const geometry = new MeshGeometry({
        positions: new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });

      const shader = new Shader({
        glProgram: GlProgram.from({ vertex: vertSrc, fragment: fragSrc }),
        resources: {
          uTime:          { value: 0,                                 type: 'f32' },
          uRippleCenters: { value: new Float32Array(MAX_RIPPLES * 2), type: 'vec2<f32>' },
          uRippleTimes:   { value: new Float32Array(MAX_RIPPLES),     type: 'f32' },
          uRippleCount:   { value: 0,                                 type: 'i32' },
          uLightPos:      { value: [0.35, -0.7, 0.55],               type: 'vec3<f32>' },
          uResolution:    { value: [w, h],                            type: 'vec2<f32>' },
        },
      });

      const mesh = new Mesh({ geometry, shader });
      app.stage.addChild(mesh);

      app.ticker.add(() => {
        const now = performance.now() / 1000;
        const elapsed = now - startTimeRef.current;
        const rips = ripplesRef.current;

        ripplesRef.current = rips.filter((r) => elapsed - r.time < 4.5);

        const count = Math.min(rips.length, MAX_RIPPLES);
        const cx = new Float32Array(MAX_RIPPLES * 2);
        const tx = new Float32Array(MAX_RIPPLES);
        for (let i = 0; i < count; i++) {
          cx[i * 2]     = rips[i].x;
          cx[i * 2 + 1] = rips[i].y;
          tx[i]         = rips[i].time;
        }

        shader.resources.uTime          = elapsed;
        shader.resources.uRippleCenters = cx;
        shader.resources.uRippleTimes   = tx;
        shader.resources.uRippleCount   = count;
      });
    })();

    return () => { disposed = true; };
  }, []);

  useImperativeHandle(ref, () => ({
    addRipple(x: number, y: number) {
      ripplesRef.current.push({ x, y, time: performance.now() / 1000 - startTimeRef.current });
    },
  }));

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />;
});
