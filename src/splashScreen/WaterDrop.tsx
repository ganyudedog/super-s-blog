'use client';

import { useEffect, useState } from 'react';

const DROP_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 42" width="30" height="42">
  <defs>
    <linearGradient id="dropGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#bfdbfe"/>
      <stop offset="30%" stop-color="#93c5fd"/>
      <stop offset="60%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M15 0 C15 0, 1 18, 1 28 C1 35, 7 42, 15 42 C23 42, 29 35, 29 28 C29 18, 15 0, 15 0Z" fill="url(#dropGrad)" filter="url(#glow)" opacity="0.9"/>
  <ellipse cx="11" cy="20" rx="3" ry="5" fill="rgba(255,255,255,0.4)" transform="rotate(-15,11,20)"/>
  <ellipse cx="10" cy="18" rx="1.5" ry="2.5" fill="rgba(255,255,255,0.7)" transform="rotate(-15,10,18)"/>
  <path d="M15 6 L15 25" stroke="rgba(255,255,255,0.12)" stroke-width="0.5" fill="none"/>
</svg>
`;

const DATA_URI = `data:image/svg+xml,${encodeURIComponent(DROP_SVG)}`;

interface WaterDropProps {
  onImpact?: () => void;
  onDone?: () => void;
}

export default function WaterDrop({ onImpact, onDone }: WaterDropProps) {
  const [phase, setPhase] = useState<'idle' | 'falling' | 'impact' | 'done'>('idle');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('falling'), 500);
    const t2 = setTimeout(() => {
      setPhase('impact');
      onImpact?.();
    }, 1500);
    const t3 = setTimeout(() => { setPhase('done'); onDone?.(); }, 1900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onImpact, onDone]);

  if (phase === 'done') return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: phase === 'idle' ? '5%' : phase === 'impact' ? '55%' : '55%',
        transform: `translateX(-50%) ${
          phase === 'impact' ? 'scale(0.5, 0.2)' :
          phase === 'falling' ? 'scale(0.95, 1.1)' :
          'scale(0.95, 0.85)'
        }`,
        width: '30px',
        height: '42px',
        opacity: phase === 'impact' ? 0 : 1,
        transition:
          'top 0.9s cubic-bezier(0.33,0,0.67,1),' +
          'opacity 0.2s,' +
          'transform 0.7s ease-out',
        filter: 'drop-shadow(0 0 10px rgba(96,165,250,0.6))',
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      <img src={DATA_URI} alt="" width={30} height={42} />
    </div>
  );
}
