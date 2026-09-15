import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Big-screen audio: a music loop while the market is open, plus one-shot
 * effects. Browsers refuse to play audio until the page has been clicked, so
 * `enable()` must be called from a user gesture; the choice is remembered.
 */
const KEY = "funded.sound";
const FILES = {
  music: "/audio/market-loop.mp3",
  funded: "/audio/funded.mp3",
  share: "/audio/share.mp3",
} as const;

let enabled = false;
let unlocked = false;
let music: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function wantsSound(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function ensureMusic() {
  if (!music) {
    music = new Audio(FILES.music);
    music.loop = true;
    music.volume = 0.35;
    music.preload = "auto";
  }
  return music;
}

export function isSoundEnabled() {
  return enabled;
}

export function useSoundEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => enabled,
  );
}

/** Call from a click handler. */
export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (on) {
    unlocked = true;
    // A silent play/pause inside the gesture unlocks later programmatic plays.
    const m = ensureMusic();
    m.play().then(() => { if (!musicWanted) m.pause(); }).catch(() => {});
    if (musicWanted) playMusic();
  } else {
    stopMusic();
  }
  notify();
}

let musicWanted = false;

export function playMusic() {
  musicWanted = true;
  if (!enabled || !unlocked) return;
  const m = ensureMusic();
  if (m.paused) m.play().catch(() => {});
}

export function stopMusic() {
  musicWanted = false;
  if (!music || music.paused) return;
  // Short fade so the loop doesn't cut off harshly.
  const m = music;
  const start = m.volume;
  const t0 = performance.now();
  const fade = () => {
    const p = Math.min(1, (performance.now() - t0) / 700);
    m.volume = start * (1 - p);
    if (p < 1 && !musicWanted) requestAnimationFrame(fade);
    else if (!musicWanted) {
      m.pause();
      m.currentTime = 0;
      m.volume = start;
    } else m.volume = start;
  };
  requestAnimationFrame(fade);
}

export function sfx(name: "funded" | "share", volume = 0.9) {
  if (!enabled || !unlocked) return;
  const a = new Audio(FILES[name]);
  a.volume = volume;
  a.play().catch(() => {});
}

/** Remembers the user's earlier choice, but playback still needs one click. */
export function useSoundPreference(): { remembered: boolean } {
  const [remembered] = useState(wantsSound);
  return { remembered };
}

/** Keeps the music in sync with the market phase. */
export function useMarketMusic(marketOpen: boolean) {
  const soundOn = useSoundEnabled();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (marketOpen && soundOn) playMusic();
    else if (!marketOpen && wasOpen.current) stopMusic();
    wasOpen.current = marketOpen;
  }, [marketOpen, soundOn]);
  useEffect(() => () => stopMusic(), []);
}
