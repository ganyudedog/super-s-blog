interface ArticleAudioState {
  active: boolean;
  retryCount: number;
}

const audioStates = new WeakMap<HTMLAudioElement, ArticleAudioState>();
const playingAudios = new Set<HTMLAudioElement>();
let foregroundAudioActive = false;

function publishForegroundAudioState() {
  const active = Array.from(playingAudios).some((audio) => audio.isConnected && !audio.paused);
  if (active === foregroundAudioActive) return;
  foregroundAudioActive = active;
  document.documentElement.toggleAttribute('data-foreground-audio-active', active);
  window.dispatchEvent(new CustomEvent('foreground-audio-state', { detail: { active } }));
}

function getAudioState(audio: HTMLAudioElement) {
  const existing = audioStates.get(audio);
  if (existing) return existing;

  const state: ArticleAudioState = {
    active: false,
    retryCount: 0,
  };
  audioStates.set(audio, state);

  audio.addEventListener('play', () => {
    audio.dataset.audioState = 'playing';
    playingAudios.add(audio);
    publishForegroundAudioState();
  });
  audio.addEventListener('pause', () => {
    audio.dataset.audioState = 'paused';
    playingAudios.delete(audio);
    publishForegroundAudioState();
  });
  audio.addEventListener('waiting', () => {
    if (!audio.paused) audio.dataset.audioState = 'loading';
  });
  audio.addEventListener('canplay', () => {
    state.retryCount = 0;
    audio.dataset.audioState = audio.paused ? 'ready' : 'playing';
  });
  audio.addEventListener('error', () => {
    audio.dataset.audioState = 'error';
    if (!state.active || state.retryCount >= 1) return;
    state.retryCount += 1;
    window.setTimeout(() => {
      if (!state.active || !audio.isConnected) return;
      audio.load();
    }, 500);
  });

  return state;
}

export function activateArticleAudio(root: ParentNode = document) {
  root.querySelectorAll<HTMLAudioElement>('.article-prose audio').forEach((audio) => {
    const state = getAudioState(audio);
    if (state.active) return;
    state.active = true;
    audio.preload = 'auto';
    audio.dataset.audioState = audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
      ? 'ready'
      : 'loading';

    window.requestAnimationFrame(() => {
      if (!state.active || !audio.isConnected) return;
      const sourceInvalid = !audio.currentSrc
        || audio.networkState === HTMLMediaElement.NETWORK_EMPTY
        || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
        || (
          audio.readyState === HTMLMediaElement.HAVE_NOTHING
          && audio.networkState !== HTMLMediaElement.NETWORK_LOADING
        )
        || audio.error !== null;
      if (sourceInvalid) audio.load();
    });
  });
}

export function deactivateArticleAudio(root: ParentNode = document) {
  root.querySelectorAll<HTMLAudioElement>('.article-prose audio').forEach((audio) => {
    const state = getAudioState(audio);
    state.active = false;
    audio.pause();
    audio.dataset.audioState = 'inactive';
    playingAudios.delete(audio);
  });
  publishForegroundAudioState();
}
