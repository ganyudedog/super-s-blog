import Hls from 'hls.js';

const HLS_MIME = 'application/vnd.apple.mpegurl';
const controllers = new WeakMap<HTMLVideoElement, Hls | null>();

function fallbackToProgressive(video: HTMLVideoElement, source: string) {
  if (video.dataset.progressiveFallback === 'true') return;
  video.dataset.progressiveFallback = 'true';
  video.removeAttribute('src');
  video.src = source;
  video.load();
  void video.play().catch(() => undefined);
}

export function initBackgroundVideo(video: HTMLVideoElement) {
  if (controllers.has(video)) return;
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  const playlist = mobile ? video.dataset.hlsMobile : video.dataset.hlsDesktop;
  const progressive = mobile ? video.dataset.videoMobile : video.dataset.videoDesktop;
  if (!playlist || !progressive) return;

  video.dataset.sourceReady = 'true';
  video.preload = 'metadata';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;

  if (video.canPlayType(HLS_MIME)) {
    video.src = playlist;
    controllers.set(video, null);
    void video.play().catch(() => undefined);
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
    maxBufferLength: 12,
    maxMaxBufferLength: 24,
    startLevel: -1,
  });
  controllers.set(video, hls);
  hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playlist));
  hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => undefined); });
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
  const controller = controllers.get(video);
  controller?.destroy();
  controllers.delete(video);
}
