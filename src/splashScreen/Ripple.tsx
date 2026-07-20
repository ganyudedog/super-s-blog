'use client';

import { useEffect, useState } from 'react';

interface RippleProps {
  active: boolean;
  onDone?: () => void;
}

export default function Ripple({ active, onDone }: RippleProps) {
  const [rings, setRings] = useState<number[]>([]);

  useEffect(() => {
    if (!active) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setRings((p) => [...p.slice(-4), i]);
    }, 350);
    const stop = setTimeout(() => { clearInterval(id); onDone?.(); }, 2500);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [active, onDone]);

  if (!active) return null;

  return (
    <div style={{ position: 'absolute', left: '50%', top: '58%', transform: 'translate(-50%,-50%)' }}>
      {rings.map((id) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: '120px',
            height: '40px',
            marginLeft: '-60px',
            marginTop: '-20px',
            borderRadius: '50%',
            border: '1.5px solid rgba(147,197,253,0.6)',
            animation: 'rippleExpand 1.4s ease-out forwards',
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '8px',
          height: '8px',
          marginLeft: '-4px',
          marginTop: '-4px',
          borderRadius: '50%',
          background: '#60a5fa',
          animation: 'ripplePulse 0.6s ease-out',
        }}
      />
    </div>
  );
}
