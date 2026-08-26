import Hls from 'hls.js';

const HLS_MIME = 'application/vnd.apple.mpegurl';
const START_BUFFER_SECONDS = 6;
const controllers = new WeakMap<HTMLVideoElement, Hls | null>();
const listenerControllers = new WeakMap<HTMLVideoElement, AbortController>();
const upgradeControllers = new WeakMap<HTMLVideoElement, AbortController>();
const originalObjectUrls = new WeakMap<HTMLVideoElement, string>();

function bufferedAhead(video: HTMLVideoElement) {
  const position = video.currentTime;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) - 0.1 <= position && position <= video.buffered.end(index)) {
      return Math.max(0, video.buffered.end(index) - position);
    }
  }
  return 0;
}

function setPlaybackState(video: HTMLVideoElement, state: 'buffering' | 'playing') {
  video.dataset.playbackState = state;
  const layer = video.closest<HTMLElement>('[data-background-reveal]');
  if (layer) layer.dataset.videoState = state;
}

function playWhenBuffered(video: HTMLVideoElement) {
  if (video.dataset.playbackStarted === 'true') return;
  const remaining = Number.isFinite(video.duration)
    ? Math.max(0.75, video.duration - video.currentTime)
    : START_BUFFER_SECONDS;
  if (bufferedAhead(video) < Math.min(START_BUFFER_SECONDS, remaining)) return;

  video.dataset.playbackStarted = 'true';
  void video.play().catch(() => {
    delete video.dataset.playbackStarted;
    setPlaybackState(video, 'buffering');
  });
}

function bindPlaybackGate(video: HTMLVideoElement) {
  const controller = new AbortController();
  listenerControllers.set(video, controller);
  const { signal } = controller;

  setPlaybackState(video, 'buffering');
  video.addEventListener('progress', () => playWhenBuffered(video), { passive: true, signal });
  video.addEventListener('canplay', () => playWhenBuffered(video), { passive: true, signal });
  video.addEventListener('loadedmetadata', () => playWhenBuffered(video), { passive: true, signal });
  video.addEventListener('playing', () => setPlaybackState(video, 'playing'), { passive: true, signal });
  video.addEventListener('waiting', () => {
    setPlaybackState(video, 'buffering');
  }, { passive: true, signal });
}

function waitForMediaEvent(
  video: HTMLVideoElement,
  eventName: 'loadeddata' | 'loadedmetadata' | 'seeked',
  signal: AbortSignal,
  timeoutMs = 8000,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleReady);
      video.removeEventListener('error', handleError);
      signal.removeEventListener('abort', handleAbort);
    };
    const finish = (callback: () => void) => {
      cleanup();
      callback();
    };
    const handleReady = () => finish(resolve);
    const handleError = () => finish(() => reject(video.error ?? new Error('Unable to decode the original video.')));
    const handleAbort = () => finish(() => reject(new DOMException('Video upgrade aborted.', 'AbortError')));
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error(`Timed out waiting for ${eventName}.`))),
      timeoutMs,
    );

    video.addEventListener(eventName, handleReady, { once: true });
    video.addEventListener('error', handleError, { once: true });
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function validateOriginalVideo(objectUrl: string, currentTime: number, signal: AbortSignal) {
  const probe = document.createElement('video');
  probe.muted = true;
  probe.playsInline = true;
  probe.preload = 'auto';
  probe.src = objectUrl;

  try {
    const metadataReady = waitForMediaEvent(probe, 'loadedmetadata', signal);
    probe.load();
    await metadataReady;
    const frameReady = waitForMediaEvent(probe, 'loadeddata', signal);
    await frameReady;
    const targetTime = Number.isFinite(probe.duration) && probe.duration > 0
      ? currentTime % probe.duration
      : 0;
    if (targetTime > 0.05) {
      const seeked = waitForMediaEvent(probe, 'seeked', signal);
      probe.currentTime = targetTime;
      await seeked;
    }
  } finally {
    probe.removeAttribute('src');
    probe.load();
  }
}

async function switchToOriginalVideo(video: HTMLVideoElement, objectUrl: string, signal: AbortSignal) {
  const resumeAt = video.currentTime;
  const hls = controllers.get(video);
  setPlaybackState(video, 'buffering');
  video.dataset.originalUpgrade = 'switching';
  video.pause();
  hls?.destroy();
  controllers.set(video, null);

  video.removeAttribute('src');
  const metadataReady = waitForMediaEvent(video, 'loadedmetadata', signal);
  video.src = objectUrl;
  video.load();
  await metadataReady;

  const targetTime = Number.isFinite(video.duration) && video.duration > 0
    ? resumeAt % video.duration
    : 0;
  if (targetTime > 0.05) {
    const seeked = waitForMediaEvent(video, 'seeked', signal);
    video.currentTime = targetTime;
    await seeked;
  }

  originalObjectUrls.set(video, objectUrl);
  video.dataset.videoSource = 'original';
  video.dataset.originalUpgrade = 'ready';
  await video.play();
}

async function upgradeToOriginalVideo(video: HTMLVideoElement, source: string, signal: AbortSignal) {
  video.dataset.originalUpgrade = 'downloading';
  let objectUrl = '';
  try {
    const requestInit: RequestInit & { priority: 'low' } = {
      cache: 'force-cache',
      credentials: 'same-origin',
      signal,
      priority: 'low',
    };
    const response = await fetch(source, requestInit);
    if (!response.ok) throw new Error(`Original video request failed with ${response.status}.`);
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith('video/')) throw new Error('Original video response is invalid.');

    objectUrl = URL.createObjectURL(blob);
    await validateOriginalVideo(objectUrl, video.currentTime, signal);
    await switchToOriginalVideo(video, objectUrl, signal);
  } catch (error) {
    if (objectUrl && originalObjectUrls.get(video) !== objectUrl) URL.revokeObjectURL(objectUrl);
    if (signal.aborted) return;
    video.dataset.originalUpgrade = 'failed';
    console.warn('[BackgroundVideo] Original video upgrade failed.', error);
  }
}

function scheduleOriginalUpgrade(video: HTMLVideoElement, source: string) {
  const lifetime = listenerControllers.get(video);
  if (!lifetime) return;

  const beginUpgrade = () => {
    if (upgradeControllers.has(video)) return;
    const controller = new AbortController();
    upgradeControllers.set(video, controller);
    lifetime.signal.addEventListener('abort', () => controller.abort(), { once: true });
    void upgradeToOriginalVideo(video, source, controller.signal);
  };

  video.dataset.videoSource = 'hls';
  video.dataset.originalUpgrade = 'waiting';
  video.addEventListener('playing', beginUpgrade, { once: true, signal: lifetime.signal });
}

function fallbackToProgressive(video: HTMLVideoElement, source: string) {
  if (video.dataset.progressiveFallback === 'true') return;
  video.dataset.progressiveFallback = 'true';
  video.removeAttribute('src');
  video.src = source;
  video.load();
}

export function initBackgroundVideo(video: HTMLVideoElement) {
  if (controllers.has(video) || video.dataset.backgroundController === 'ready') return;
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  const playlist = mobile ? video.dataset.hlsMobile : video.dataset.hlsDesktop;
  const progressive = mobile ? video.dataset.videoMobile : video.dataset.videoDesktop;
  if (!playlist || !progressive) return;

  video.dataset.backgroundController = 'ready';
  video.dataset.sourceReady = 'true';
  video.preload = 'auto';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  bindPlaybackGate(video);

  if (video.canPlayType(HLS_MIME)) {
    video.src = playlist;
    controllers.set(video, null);
    scheduleOriginalUpgrade(video, progressive);
    return;
  }

  if (!Hls.isSupported()) {
    fallbackToProgressive(video, progressive);
    controllers.set(video, null);
    return;
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferSize: 12 * 1000 * 1000,
  });
  controllers.set(video, hls);
  scheduleOriginalUpgrade(video, progressive);
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playlist));
  hls.on(Hls.Events.MANIFEST_PARSED, () => playWhenBuffered(video));
  hls.on(Hls.Events.FRAG_BUFFERED, () => playWhenBuffered(video));
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      hls.startLoad();
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      hls.recoverMediaError();
      return;
    }
    hls.destroy();
    fallbackToProgressive(video, progressive);
  });
  hls.attachMedia(video);
}

export function disposeBackgroundVideo(video: HTMLVideoElement) {
  upgradeControllers.get(video)?.abort();
  upgradeControllers.delete(video);
  const controller = controllers.get(video);
  controller?.destroy();
  controllers.delete(video);
  listenerControllers.get(video)?.abort();
  listenerControllers.delete(video);
  const objectUrl = originalObjectUrls.get(video);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  originalObjectUrls.delete(video);
  delete video.dataset.backgroundController;
  delete video.dataset.playbackStarted;
}
