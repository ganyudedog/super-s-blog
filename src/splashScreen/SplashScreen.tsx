import WaterScene from './WaterScene';

interface SplashScreenProps {
  onComplete?: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  return (
    <div className="water-stage">
      <div className="water-night-backdrop" data-water-night />
      <WaterScene onComplete={onComplete} />
    </div>
  );
}
