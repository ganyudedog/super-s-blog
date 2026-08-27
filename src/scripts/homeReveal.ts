interface WaterRevealDetail {
  impactAge?: number;
  light?: { x: number; y: number };
}

const HAND_ANCHOR = { x: 0.46, y: 0.22 };
const VIDEO_POSITION = { x: 0.54, y: 0.5 };
const VIDEO_REVEAL_DURATION = 1.15;
const TOP_BAR_REVEAL_AT = 0.28;
const SIDE_PANELS_REVEAL_AT = 0.5;
const ROUTE_PANEL_REVEAL_AT = 0.72;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function projectVideoPoint(video: HTMLVideoElement, x: number, y: number) {
  const videoBounds = video.getBoundingClientRect();
  const viewportWidth = videoBounds.width || window.innerWidth;
  const viewportHeight = videoBounds.height || window.innerHeight;
  const videoWidth = video.videoWidth || 1920;
  const videoHeight = video.videoHeight || 1080;
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);
  const displayWidth = videoWidth * scale;
  const displayHeight = videoHeight * scale;
  const offsetX = (viewportWidth - displayWidth) * VIDEO_POSITION.x;
  const offsetY = (viewportHeight - displayHeight) * VIDEO_POSITION.y;

  return {
    x: offsetX + x * displayWidth,
    y: offsetY + y * displayHeight,
  };
}

function waitForDecodedVideoFrame(video: HTMLVideoElement, timeoutMs: number) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('playing', handleReady);
      resolve(ready);
    };
    const handleReady = () => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return;
      if ('requestVideoFrameCallback' in video) {
        video.requestVideoFrameCallback(() => finish(true));
      } else {
        finish(true);
      }
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('playing', handleReady);
    handleReady();
  });
}

export function initHomeReveal() {
  const stage = document.querySelector<HTMLElement>('[data-home-stage]');
  if (!stage || stage.dataset.revealBound === 'true') return;
  stage.dataset.revealBound = 'true';
  const traceReveal = (phase: string, detail: Record<string, unknown> = {}) => {
    console.info(`[HomeReveal][timing] ${JSON.stringify({
      phase,
      pageMs: Math.round(performance.now() * 10) / 10,
      ...detail,
    })}`);
  };
  traceReveal('initialized', { pathname: window.location.pathname });

  const video = document.querySelector<HTMLVideoElement>('#background-video');
  const bootSurface = document.querySelector<HTMLElement>('[data-home-boot]');
  const background = document.querySelector<HTMLElement>('[data-background-reveal]');
  const topBar = document.querySelector<HTMLElement>('[data-reveal-top]');
  const leftPanel = document.querySelector<HTMLElement>('[data-reveal-left]');
  const rightPanel = document.querySelector<HTMLElement>('[data-reveal-right]');
  const routePanel = document.querySelector<HTMLElement>('[data-reveal-route]');

  stage.inert = true;
  const hideBootSurface = () => bootSurface?.classList.add('is-hidden');
  if (document.querySelector('[data-first-frame="true"]')) hideBootSurface();
  window.addEventListener('water:first-frame', hideBootSurface, { once: true });
  if (video) {
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.controls = false;
    video.addEventListener('error', () => stage.classList.add('has-video-error'));
  }

  let revealed = false;
  let finished = false;
  let sceneFallback = 0;
  const revealAnimations = new Set<Animation>();
  const animateReveal = (
    element: HTMLElement,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
    onFinish?: () => void,
  ) => {
    const animation = element.animate(keyframes, { fill: 'both', ...options });
    revealAnimations.add(animation);
    animation.onfinish = () => {
      revealAnimations.delete(animation);
      onFinish?.();
    };
    return animation;
  };
  const finishReveal = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(sceneFallback);
    revealAnimations.forEach((animation) => animation.cancel());
    revealAnimations.clear();
    hideBootSurface();
    const nightBackdrop = document.querySelector<HTMLElement>('[data-water-night]');
    if (background) {
      background.style.clipPath = 'inset(0% 0% 0% 0%)';
      background.style.opacity = '1';
    }
    if (nightBackdrop) nightBackdrop.style.opacity = '0';
    if (topBar) {
      topBar.style.transform = 'translateY(0)';
      topBar.style.opacity = '1';
    }
    if (leftPanel) {
      leftPanel.style.transform = 'translateX(0)';
      leftPanel.style.opacity = '1';
      leftPanel.style.filter = 'blur(0px)';
    }
    if (rightPanel) {
      rightPanel.style.transform = 'translateX(0)';
      rightPanel.style.opacity = '1';
      rightPanel.style.filter = 'blur(0px)';
    }
    if (routePanel) {
      routePanel.style.transform = 'translate(0, 0) scale(1)';
      routePanel.style.opacity = '1';
    }
    stage.dataset.revealState = 'ready';
    stage.dataset.videoRevealState = 'ready';
    stage.dataset.routeRevealState = 'ready';
    stage.inert = false;
    topBar?.classList.add('is-lit');
    leftPanel?.classList.add('is-lit');
    rightPanel?.classList.add('is-lit');
    routePanel?.classList.add('is-lit');
    window.dispatchEvent(new CustomEvent('home:revealed'));
    traceReveal('finished');
  };

  const startReveal = async (detail: WaterRevealDetail = {}) => {
    if (revealed) return;
    revealed = true;
    stage.dataset.revealState = 'waiting-video';
    if (video) {
      const mobile = window.matchMedia('(max-width: 767px)').matches;
      void waitForDecodedVideoFrame(video, mobile ? 1600 : 2400).then((videoFrameReady) => {
        stage.dataset.videoFrameReady = String(videoFrameReady);
        stage.dataset.videoPlaybackState = videoFrameReady ? 'ready' : 'pending';
      });
    }
    stage.dataset.revealState = 'running';
    stage.dataset.videoRevealState = 'running';
    stage.style.setProperty('--scene-light-x', `${detail.light?.x ?? 0}%`);
    stage.style.setProperty('--scene-light-y', `${detail.light?.y ?? 0}%`);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nightBackdrop = document.querySelector<HTMLElement>('[data-water-night]');
    const targets = [background, topBar, leftPanel, rightPanel, routePanel].filter(Boolean);
    if (reducedMotion) {
      targets.forEach((target) => {
        if (!target) return;
        target.style.removeProperty('transform');
        target.style.removeProperty('filter');
        target.style.removeProperty('clip-path');
        target.style.opacity = '1';
      });
      if (background) background.style.clipPath = 'inset(0% 0% 0% 0%)';
      if (nightBackdrop) nightBackdrop.style.opacity = '0';
      finishReveal();
      return;
    }

    let routeFromX = 0;
    let routeFromY = 36;
    let routeOrigin = '50% 20%';
    if (video && routePanel) {
      const hand = projectVideoPoint(video, HAND_ANCHOR.x, HAND_ANCHOR.y);
      const bounds = routePanel.getBoundingClientRect();
      const centerX = bounds.left + bounds.width * 0.5;
      const centerY = bounds.top + bounds.height * 0.3;
      routeFromX = clamp((hand.x - centerX) * 0.16, -72, 72);
      routeFromY = clamp((hand.y - centerY) * 0.16 + 28, -16, 72);
      routeOrigin = `${clamp(hand.x - bounds.left, 0, bounds.width)}px ${clamp(
        hand.y - bounds.top,
        0,
        bounds.height,
      )}px`;
    }

    if (background) {
      animateReveal(
        background,
        [
          { clipPath: 'inset(100% 0% 0% 0%)', opacity: 0.4 },
          { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1 },
        ],
        { duration: VIDEO_REVEAL_DURATION * 1000, easing: 'ease-in-out' },
        () => { stage.dataset.videoRevealState = 'ready'; },
      );
    }
    if (nightBackdrop) {
      animateReveal(
        nightBackdrop,
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 1100, easing: 'ease-in-out' },
      );
    }
    if (topBar) {
      animateReveal(
        topBar,
        [
          { transform: 'translateY(-110%)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: 680, delay: TOP_BAR_REVEAL_AT * 1000, easing: 'ease-out' },
      );
    }
    if (leftPanel) {
      animateReveal(
        leftPanel,
        [
          { transform: 'translateX(-64px)', opacity: 0, filter: 'blur(10px)' },
          { transform: 'translateX(0)', opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 700, delay: SIDE_PANELS_REVEAL_AT * 1000, easing: 'ease-out' },
      );
    }
    if (rightPanel) {
      animateReveal(
        rightPanel,
        [
          { transform: 'translateX(64px)', opacity: 0, filter: 'blur(10px)' },
          { transform: 'translateX(0)', opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 700, delay: SIDE_PANELS_REVEAL_AT * 1000, easing: 'ease-out' },
      );
    }
    if (routePanel) {
      window.setTimeout(() => {
        if (!finished) stage.dataset.routeRevealState = 'running';
      }, ROUTE_PANEL_REVEAL_AT * 1000);
      animateReveal(
        routePanel,
        [
          {
            transform: `translate(${routeFromX}px, ${routeFromY}px) scale(0.94)`,
            opacity: 0,
            transformOrigin: routeOrigin,
          },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ],
        { duration: 820, delay: ROUTE_PANEL_REVEAL_AT * 1000, easing: 'ease-out' },
        () => { stage.dataset.routeRevealState = 'ready'; },
      );
    }
    window.setTimeout(finishReveal, 1800);
  };

  const onWaterReveal = (event: Event) => {
    window.clearTimeout(sceneFallback);
    traceReveal('water-reveal-received');
    void startReveal((event as CustomEvent<WaterRevealDetail>).detail ?? {});
  };
  window.addEventListener('water:reveal', onWaterReveal, { once: true });

  const startFallbackReveal = () => {
    traceReveal('fallback-fired');
    stage.dataset.waterIntroSkipped = 'true';
    window.dispatchEvent(new CustomEvent('water:intro-skip'));
    void startReveal();
  };
  const armSceneFallback = () => {
    window.clearTimeout(sceneFallback);
    traceReveal('impact-fallback-armed', { timeoutMs: 5000 });
    sceneFallback = window.setTimeout(startFallbackReveal, 5000);
  };
  window.addEventListener('water:intro-start', () => {
    window.clearTimeout(sceneFallback);
    traceReveal('intro-start-received');
  }, { once: true });
  window.addEventListener('water:impact', () => {
    traceReveal('impact-received');
    armSceneFallback();
  }, { once: true });

  // Keep the page usable only when WebGL fails before the intro can start.
  sceneFallback = window.setTimeout(startFallbackReveal, 12000);
  traceReveal('initial-fallback-armed', { timeoutMs: 12000 });
}
