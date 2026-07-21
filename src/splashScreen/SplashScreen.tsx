import { useState, useCallback } from 'react';
import WaterDrop from './WaterDrop';
import Ripple from './Ripple';

interface SplashScreenProps {
  onComplete?: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [showRipple, setShowRipple] = useState(false);

  const handleDropComplete = useCallback(() => {
    setShowRipple(true);
    // 波纹动画完成后调用 onComplete
    setTimeout(() => {
      onComplete?.();
    }, 2000);
  }, [onComplete]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'linear-gradient(180deg, #0a1628 0%, #1a2a4a 50%, #0d1f3c 100%)',
        overflow: 'hidden',
        zIndex: 9999
      }}
    >
      {/* 水面效果 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: '55%',
          background: 'linear-gradient(180deg, rgba(30, 60, 100, 0.3) 0%, rgba(20, 40, 80, 0.6) 100%)',
          borderTop: '1px solid rgba(173, 216, 230, 0.2)'
        }}
      />

      {/* 水滴 */}
      <WaterDrop onDone={handleDropComplete} />

      {/* 波纹 */}
      <Ripple active={showRipple} />
    </div>
  );
}
