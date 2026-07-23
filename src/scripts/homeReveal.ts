import { gsap } from 'gsap';

interface WaterRevealDetail {
  impactAge?: number;
  light?: { x: number; y: number };
}

const HAND_ANCHOR = { x: 0.46, y: 0.22 };
const VIDEO_POSITION = { x: 0.54, y: 0.5 };

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function projectVideoPoint(video: HTMLVideoElement, x: number, y: number) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
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

export function initHomeReveal() {
  const stage = document.querySelector<HTMLElement>('[data-home-stage]');
  if (!stage || stage.dataset.revealBound === 'true') return;
  stage.dataset.revealBound = 'true';

  const video = document.querySelector<HTMLVideoElement>('#background-video');
  const background = document.querySelector<HTMLElement>('[data-background-reveal]');
  const topBar = document.querySelector<HTMLElement>('[data-reveal-top]');
  const leftPanel = document.querySelector<HTMLElement>('[data-reveal-left]');
  const rightPanel = document.querySelector<HTMLElement>('[data-reveal-right]');
  const routePanel = document.querySelector<HTMLElement>('[data-reveal-route]');
  const menuButton = document.querySelector<HTMLButtonElement>('.nav-menu-button');

  stage.inert = true;
  if (video) {
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.controls = false;
    void video.play().catch(() => undefined);
    video.addEventListener('error', () => stage.classList.add('has-video-error'));
  }

  menuButton?.addEventListener('click', () => {
    const open = topBar?.classList.toggle('is-menu-open') ?? false;
    menuButton.setAttribute('aria-expanded', String(open));
  });

  let revealed = false;
  const finishReveal = () => {
    stage.dataset.revealState = 'ready';
    stage.inert = false;
    topBar?.classList.add('is-lit');
    leftPanel?.classList.add('is-lit');
    rightPanel?.classList.add('is-lit');
    routePanel?.classList.add('is-lit');
    window.dispatchEvent(new CustomEvent('home:revealed'));
  };

  const startReveal = (detail: WaterRevealDetail = {}) => {
    if (revealed) return;
    revealed = true;
    stage.dataset.revealState = 'running';
    stage.style.setProperty('--scene-light-x', `${detail.light?.x ?? 0}%`);
    stage.style.setProperty('--scene-light-y', `${detail.light?.y ?? 0}%`);
    if (video) void video.play().catch(() => undefined);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nightBackdrop = document.querySelector<HTMLElement>('[data-water-night]');
    const targets = [background, topBar, leftPanel, rightPanel, routePanel].filter(Boolean);
    if (reducedMotion) {
      gsap.set(targets, { clearProps: 'transform,filter,clipPath', opacity: 1 });
      if (background) gsap.set(background, { clipPath: 'inset(0% 0% 0% 0%)' });
      if (nightBackdrop) gsap.set(nightBackdrop, { opacity: 0 });
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

    const timeline = gsap.timeline({ onComplete: finishReveal });
    if (background) {
      timeline.fromTo(
        background,
        { clipPath: 'inset(100% 0% 0% 0%)', opacity: 0.4 },
        { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, duration: 1.15, ease: 'power3.inOut' },
        0,
      );
    }
    if (nightBackdrop) {
      timeline.to(nightBackdrop, { opacity: 0, duration: 1.1, ease: 'power2.inOut' }, 0);
    }
    if (topBar) {
      timeline.fromTo(
        topBar,
        { yPercent: -110, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.68, ease: 'power3.out' },
        0.08,
      );
    }
    if (leftPanel) {
      timeline.fromTo(
        leftPanel,
        { x: -64, opacity: 0, filter: 'blur(10px)' },
        { x: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out' },
        0.28,
      );
    }
    if (rightPanel) {
      timeline.fromTo(
        rightPanel,
        { x: 64, opacity: 0, filter: 'blur(10px)' },
        { x: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power3.out' },
        0.28,
      );
    }
    if (routePanel) {
      timeline.fromTo(
        routePanel,
        {
          x: routeFromX,
          y: routeFromY,
          scale: 0.88,
          opacity: 0,
          transformOrigin: routeOrigin,
        },
        {
          x: 0,
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 0.85,
          ease: 'back.out(1.18)',
        },
        0.45,
      );
    }
  };

  const onWaterReveal = (event: Event) => {
    startReveal((event as CustomEvent<WaterRevealDetail>).detail);
  };
  window.addEventListener('water:reveal', onWaterReveal, { once: true });

  window.setTimeout(() => startReveal(), 6500);
}

