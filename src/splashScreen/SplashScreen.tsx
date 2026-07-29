import { lazy, Suspense, useEffect, useState } from 'react';
import {
  detectWaterCompatibility,
  type WaterCompatibilityProfile,
} from './waterCompatibility';

const WaterScene = lazy(() => import('./WaterScene'));
const PointerWaterLayer = lazy(() => import('./PointerWaterLayer'));

interface SplashScreenProps {
  onComplete?: () => void;
  intro?: boolean;
}

interface CompatibilityFallbackDetail {
  scope?: 'all' | 'pointer';
}

function exposeCompatibilityProfile(profile: WaterCompatibilityProfile) {
  const stage = document.querySelector<HTMLElement>('[data-home-stage]');
  document.documentElement.dataset.waterMode = profile.mode;
  if (stage) {
    stage.dataset.waterMode = profile.mode;
    stage.dataset.pointerWater = String(profile.pointerWater);
    stage.dataset.waterCompatibilityReason = profile.reason;
    stage.dataset.waterRenderer = profile.renderer;
  }
  console.info('[SplashScreen] compatibility profile', profile);
}

export default function SplashScreen({ onComplete, intro = false }: SplashScreenProps) {
  const [profile, setProfile] = useState<WaterCompatibilityProfile | null>(null);

  useEffect(() => {
    const redirectFromIntro = () => {
      if (!intro || window.location.pathname !== '/') return;
      const search = import.meta.env.DEV ? window.location.search : '';
      window.location.replace(`/index${search}`);
    };
    let nextProfile: WaterCompatibilityProfile;
    try {
      nextProfile = detectWaterCompatibility();
    } catch (error) {
      console.error('[SplashScreen] compatibility probe failed', error);
      nextProfile = {
        mode: 'compatibility',
        mainWater: false,
        pointerWater: false,
        reason: 'runtime-failure',
        renderer: 'probe-failed',
      };
    }
    exposeCompatibilityProfile(nextProfile);
    setProfile(nextProfile);

    if (nextProfile.mode === 'compatibility') redirectFromIntro();

    const handleRuntimeFallback = (event: Event) => {
      const detail = (event as CustomEvent<CompatibilityFallbackDetail>).detail;
      setProfile((currentProfile) => {
        if (!currentProfile) return currentProfile;
        if (detail?.scope === 'pointer' && currentProfile.mainWater) {
          const pointerFallback = { ...currentProfile, pointerWater: false };
          exposeCompatibilityProfile(pointerFallback);
          return pointerFallback;
        }
        const compatibilityFallback: WaterCompatibilityProfile = {
          mode: 'compatibility',
          mainWater: false,
          pointerWater: false,
          reason: 'runtime-failure',
          renderer: currentProfile.renderer,
        };
        exposeCompatibilityProfile(compatibilityFallback);
        redirectFromIntro();
        return compatibilityFallback;
      });
    };
    window.addEventListener('water:compatibility-fallback', handleRuntimeFallback);
    return () => {
      window.removeEventListener('water:compatibility-fallback', handleRuntimeFallback);
    };
  }, [intro]);

  if (!profile) return null;

  if (!profile.mainWater) {
    return profile.pointerWater ? (
      <Suspense fallback={null}>
        <PointerWaterLayer />
      </Suspense>
    ) : null;
  }

  return (
    <div className="water-stage">
      <div
        className="water-night-backdrop"
        data-water-night
        style={{ opacity: intro ? 1 : 0 }}
      />
      <Suspense fallback={null}>
        <WaterScene intro={intro} onComplete={onComplete} />
        {profile.pointerWater && <PointerWaterLayer />}
      </Suspense>
    </div>
  );
}
