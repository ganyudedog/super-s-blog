'use client';

import { useState, useRef, useCallback } from 'react';
import WaterDrop from './WaterDrop';
import { WaterSurface, type WaterSurfaceHandle } from './WaterSurface';

interface SplashScreenProps {
  onComplete?: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'drop' | 'ripple'>('drop');
  const surfaceRef = useRef<WaterSurfaceHandle>(null);

  const handleImpact = useCallback(() => {
    surfaceRef.current?.addRipple(0.5, 0.5);
    setPhase('ripple');
  }, []);

  const handleDropDone = useCallback(() => {
    setTimeout(() => onComplete?.(), 3500);
  }, [onComplete]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        overflow: 'hidden',
        perspective: '800px',
        perspectiveOrigin: '50% 40%',
      }}
    >
      {/* 夜空背景 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, #020617 0%, #0a0f1e 40%, #0a1628 100%)',
        }}
      />

      {/* 水面层 — 倾斜，全屏可见 */}
      <div
        style={{
          position: 'absolute',
          top: '15%',
          left: 0,
          right: 0,
          bottom: 0,
          transform: 'rotateX(58deg)',
          transformOrigin: 'center top',
          transformStyle: 'preserve-3d',
        }}
      >
        <WaterSurface ref={surfaceRef} />
      </div>

      {/* 星空点缀 */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {Array.from({ length: 30 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 40}%`,
              width: `${1 + Math.random() * 2}px`,
              height: `${1 + Math.random() * 2}px`,
              borderRadius: '50%',
              background: '#e2e8f0',
              opacity: 0.3 + Math.random() * 0.7,
              animation: `starTwinkle ${2 + Math.random() * 3}s ease-in-out infinite`,
              animationDelay: `${Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      {/* 水滴 */}
      <WaterDrop onImpact={handleImpact} onDone={handleDropDone} />
    </div>
  );
}
