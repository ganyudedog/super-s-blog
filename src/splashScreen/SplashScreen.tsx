import WaterScene from './WaterScene';
import PointerWaterLayer from './PointerWaterLayer';

interface SplashScreenProps {
  onComplete?: () => void;
  intro?: boolean;
}

export default function SplashScreen({ onComplete, intro = false }: SplashScreenProps) {
  return (
    <div className="water-stage">
      <div
        className="water-night-backdrop"
        data-water-night
        style={{ opacity: intro ? 1 : 0 }}
      />
      <WaterScene intro={intro} onComplete={onComplete} />
      <PointerWaterLayer />
    </div>
  );
}
