import WaterScene from './WaterScene';

interface SplashScreenProps {
  onComplete?: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: '#02050b',
        overflow: 'hidden',
        zIndex: 9999
      }}
    >
      <WaterScene onComplete={onComplete} />
    </div>
  );
}
