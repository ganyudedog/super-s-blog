'use client';

import { useState, useCallback } from 'react';
import WaterDrop from './WaterDrop';
import Ripple from './Ripple';

interface SplashScreenProps {
  onComplete?: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'drop' | 'ripple'>('drop');

  const handleDrop = useCallback(() => setPhase('ripple'), []);
  const handleRipple = useCallback(() => onComplete?.(), [onComplete]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, #0f172a, #1e293b, #0f172a)',
        overflow: 'hidden',
      }}
    >
      <WaterDrop onAnimationEnd={handleDrop} />
      <Ripple active={phase === 'ripple'} onDone={handleRipple} />
    </div>
  );
}
