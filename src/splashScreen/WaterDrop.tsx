'use client';

import { useEffect, useState } from 'react';

interface WaterDropProps {
  onAnimationEnd?: () => void;
}

export default function WaterDrop({ onAnimationEnd }: WaterDropProps) {
  const [phase, setPhase] = useState<'waiting' | 'falling' | 'done'>('waiting');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('falling'), 300);
    const t2 = setTimeout(() => {
      setPhase('done');
      onAnimationEnd?.();
    }, 1300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onAnimationEnd]);

  if (phase === 'done') return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: phase === 'waiting' ? '15%' : '58%',
        transform: 'translateX(-50%)',
        width: '12px',
        height: '18px',
        background: 'linear-gradient(to bottom, #bfdbfe, #3b82f6)',
        borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
        boxShadow: '0 0 12px 2px rgba(59,130,246,0.6)',
        opacity: phase === 'waiting' ? 1 : 0,
        transition: 'top 0.8s cubic-bezier(0.33,0,0.67,1), opacity 0.2s ease-in 0.6s',
      }}
    />
  );
}
