type SfxName = 'ui_tap' | 'tick' | 'timeup' | 'correct' | 'wrong' | 'reveal' | 'score';

const SOUND_FILES: Record<SfxName, string> = {
  ui_tap: '/assets/sfx/ui_tap.mp3',
  tick: '/assets/sfx/tick.mp3',
  timeup: '/assets/sfx/timeup.mp3',
  correct: '/assets/sfx/correct.mp3',
  wrong: '/assets/sfx/wrong.mp3',
  reveal: '/assets/sfx/reveal.mp3',
  score: '/assets/sfx/score.mp3',
};

const bufferCache = new Map<SfxName, AudioBuffer>();
const loadingCache = new Map<SfxName, Promise<AudioBuffer | null>>();
const unlockListeners = new Set<() => void>();
let unlocked = false;
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const AudioClass: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioClass) return null;
  audioCtx = new AudioClass();
  return audioCtx;
}

export function isSoundUnlocked() {
  const ctx = getAudioContext();
  return unlocked || (ctx?.state === 'running' && ctx.state !== 'suspended');
}

export function unlockSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  if (!unlocked) {
    unlocked = true;
    unlockListeners.forEach((cb) => cb());
  }
}

export function onSoundUnlocked(cb: () => void) {
  unlockListeners.add(cb);
  return () => unlockListeners.delete(cb);
}

async function loadBuffer(name: SfxName): Promise<AudioBuffer | null> {
  const existing = bufferCache.get(name);
  if (existing) return existing;
  const pending = loadingCache.get(name);
  if (pending) return pending;
  const ctx = getAudioContext();
  if (!ctx) return null;
  const promise = fetch(SOUND_FILES[name])
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data))
    .then((buffer) => {
      bufferCache.set(name, buffer);
      return buffer;
    })
    .catch((err) => {
      console.warn('Failed to load sound', name, err);
      return null;
    });
  loadingCache.set(name, promise);
  const result = await promise;
  return result;
}

export async function playSfx(name: SfxName, opts?: { volume?: number; rate?: number }) {
  if (!isSoundUnlocked()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const buffer = await loadBuffer(name);
  if (!buffer) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (opts?.rate) {
    source.playbackRate.value = opts.rate;
  }
  const gain = ctx.createGain();
  gain.gain.value = Math.min(1, Math.max(0, (opts?.volume ?? 1) * 0.6));
  source.connect(gain).connect(ctx.destination);
  source.start();
}
