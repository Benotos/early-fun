// Tiny synthesized UI sounds (WebAudio, no files). Only plays after a user gesture and respects mute.
export type Sfx = 'click' | 'tab' | 'success' | 'error' | 'copy' | 'whoosh' | 'on';

let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem('early:mute') === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export const isMuted = () => muted;
export function subscribeMute(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem('early:mute', v ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  if (!v) play('on');
}

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, at: number, freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

export function play(name: Sfx) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  switch (name) {
    case 'click':
      tone(c, t, 620, 0.07, 'triangle', 0.05, 420);
      break;
    case 'tab':
      tone(c, t, 420, 0.1, 'sine', 0.06, 760);
      break;
    case 'copy':
      tone(c, t, 880, 0.06, 'square', 0.025);
      tone(c, t + 0.06, 1320, 0.07, 'square', 0.025);
      break;
    case 'whoosh':
      tone(c, t, 180, 0.22, 'sawtooth', 0.025, 900);
      break;
    case 'success':
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, t + i * 0.075, f, 0.22, 'triangle', 0.055));
      break;
    case 'error':
      tone(c, t, 180, 0.16, 'sawtooth', 0.05, 110);
      break;
    case 'on':
      tone(c, t, 660, 0.08, 'sine', 0.05);
      tone(c, t + 0.07, 990, 0.1, 'sine', 0.05);
      break;
  }
}