'use client';

import { useEffect, useState, useRef } from 'react';

interface RippleProps {
  active: boolean;
  onDone?: () => void;
}

interface Ring {
  id: number;
  spawnedAt: number;
}

export default function Ripple({ active, onDone }: RippleProps) {
  const [rings, setRings] = useState<Ring[]>([]);
  const counterRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!active) return;
    setRings([]);
    counterRef.current = 0;

    const spawn = () => {
      counterRef.current++;
      setRings((p) => [...p.slice(-16), { id: counterRef.current, spawnedAt: performance.now() }]);
    };

    spawn();
    const timer = setInterval(spawn, 120);
    const done = setTimeout(() => {
      clearInterval(timer);
      doneRef.current?.();
    }, 2800);

    return () => { clearInterval(timer); clearTimeout(done); };
  }, [active]);

  if (!active) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* 水面光泽层 */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '58%',
          width: '200px',
          height: '80px',
          transform: 'translate(-50%,-50%)',
          background: 'radial-gradient(ellipse, rgba(147,197,253,0.15) 0%, rgba(59,130,246,0.05) 30%, transparent 70%)',
          borderRadius: '50%',
          opacity: active ? 1 : 0,
          transition: 'opacity 0.5s',
        }}
      />

      {/* 波纹环 */}
      <div style={{ position: 'absolute', left: '50%', top: '58%', transform: 'translate(-50%,-50%)' }}>
        {rings.map((ring) => (
          <WaterRing key={ring.id} id={ring.id} />
        ))}
      </div>
    </div>
  );
}

function WaterRing({ id }: { id: number }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    const started = performance.now();
    let raf: number;

    const tick = () => {
      const elapsed = performance.now() - started;
      setT(elapsed);
      if (elapsed < 2400) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  const progress = Math.min(t / 2200, 1);
  const scale = progress * 5 + 0.1;
  const opacity = Math.max(0, 0.7 * (1 - progress) * (1 - progress));

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '100px',
        height: '30px',
        marginLeft: '-50px',
        marginTop: '-15px',
        borderRadius: '50%',
        border: 'none',
        background: `
          radial-gradient(
            ellipse at center,
            transparent 40%,
            rgba(147,197,253,${opacity * 0.5}) 60%,
            rgba(59,130,246,${opacity * 0.8}) 72%,
            rgba(147,197,253,${opacity * 0.3}) 82%,
            transparent 88%
          )
        `,
        transform: `scale(${scale})`,
        opacity: Math.min(1, progress < 0.1 ? progress * 10 : 1),
      }}
    />
  );
}
