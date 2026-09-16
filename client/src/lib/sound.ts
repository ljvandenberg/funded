import { useEffect, useRef, useSyncExternalStore } from "react";
import { serverNow } from "./socket";

/**
 * Big-screen audio: a music loop while the market is open, plus one-shot
 * effects. Sound is on by default. Browsers block audio until the page has
 * received a click or key press, so until then the screen shows a hint and
 * the first gesture anywhere on the page unlocks playback.
 */
const KEY = "funded.sound";
const FILES = {
  lobby: "/audio/lobby-loop.mp3",
  build: "/audio/build-loop.mp3",
  market: "/audio/market-loop.mp3",
  funded: "/audio/funded.mp3",
  share: "/audio/share.mp3",
  close: "/audio/close.mp3",
  reveal: "/audio/reveal.mp3",
  fanfare: "/audio/fanfare.mp3",
  fail: "/audio/fail.mp3",
} as const;

export type MusicTrack = "lobby" | "build" | "market";
const MUSIC_VOLUME: Record<MusicTrack, number> = { lobby: 0.26, build: 0.26, market: 0.44 };

let enabled = readPreference();
let unlocked = false;
/** The track that should be playing right now, or null for silence. */
let musicWanted: MusicTrack | null = null;
let currentTrack: MusicTrack | null = null;
let music: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readPreference(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

function ensureMusic() {
  if (!music) {
    music = new Audio();
    music.loop = true;
    music.preload = "auto";
  }
  return music;
}

function loadTrack(track: MusicTrack) {
  const m = ensureMusic();
  if (currentTrack !== track) {
    m.src = FILES[track];
    m.currentTime = 0;
    currentTrack = track;
  }
  m.volume = MUSIC_VOLUME[track];
  return m;
}

/** Try to start playback; succeeds silently if the browser already trusts this page. */
function attemptUnlock() {
  if (unlocked || !enabled) return;
  const m = loadTrack(musicWanted ?? "lobby");
  m.play()
    .then(() => {
      unlocked = true;
      if (!musicWanted) {
        m.pause();
        m.currentTime = 0;
      }
      notify();
    })
    .catch(() => {
      /* blocked until a gesture */
    });
}

function onGesture() {
  if (!enabled || unlocked) return;
  attemptUnlock();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
}

export function useSoundState(): { enabled: boolean; unlocked: boolean } {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (enabled ? (unlocked ? "on" : "blocked") : "off"),
  );
  return { enabled: snap !== "off", unlocked: snap === "on" };
}

/** Called from the toggle button (a gesture, so it also unlocks). */
export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (on) attemptUnlock();
  else stopMusic();
  notify();
}

/** Switch to a track (or null for silence). Fades the old one out first. */
export function setMusic(track: MusicTrack | null) {
  if (track === musicWanted) return;
  const previous = musicWanted;
  musicWanted = track;
  if (!track) {
    fadeOut();
    return;
  }
  if (!enabled) return;
  if (!unlocked) {
    attemptUnlock();
    return;
  }
  if (previous && music && !music.paused) {
    fadeOut(() => startTrack(track));
  } else {
    startTrack(track);
  }
}

function startTrack(track: MusicTrack) {
  if (musicWanted !== track) return;
  const m = loadTrack(track);
  m.play().catch(() => {});
}

function fadeOut(done?: () => void) {
  if (!music || music.paused) {
    done?.();
    return;
  }
  const m = music;
  const start = m.volume;
  const t0 = performance.now();
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / 700);
    m.volume = start * (1 - p);
    if (p < 1) requestAnimationFrame(step);
    else {
      m.pause();
      m.currentTime = 0;
      m.volume = start;
      done?.();
    }
  };
  requestAnimationFrame(step);
}

export function stopMusic() {
  setMusic(null);
}

export function sfx(name: "funded" | "share" | "close" | "reveal" | "fanfare" | "fail", volume = 0.9) {
  if (!enabled || !unlocked) return;
  if (volume > 1) {
    playBoosted(name, volume);
    return;
  }
  const a = new Audio(FILES[name]);
  a.volume = volume;
  a.play().catch(() => {});
}

/** Web Audio lets a one-shot go past the element volume ceiling of 1.0. */
let audioCtx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

function getBuffer(name: keyof typeof FILES): Promise<AudioBuffer> {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  let p = buffers.get(name);
  if (!p) {
    p = fetch(FILES[name])
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b));
    buffers.set(name, p);
  }
  return p;
}

function playBoosted(name: keyof typeof FILES, gain: number) {
  try {
    getBuffer(name)
      .then((buffer) => {
        const ctx = audioCtx!;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(g).connect(ctx.destination);
        src.start();
      })
      .catch(() => {
        const a = new Audio(FILES[name]);
        a.volume = 1;
        a.play().catch(() => {});
      });
  } catch {
    const a = new Audio(FILES[name]);
    a.volume = 1;
    a.play().catch(() => {});
  }
}

/** How long before the market timer ends the closing boom starts, so its peak lands on 0:00. */
export const CLOSE_LEAD_MS = 2000;
export const CLOSE_GAIN = 1.5;

/**
 * Picks the track for the phase: lobby, Round 1, open market; silence otherwise.
 * The closing boom is scheduled CLOSE_LEAD_MS before the market timer ends;
 * if the host closes early it plays at once.
 */
export function usePhaseMusic(track: MusicTrack | null, marketOpen: boolean, marketEndsAt: number | null) {
  const { enabled: soundOn, unlocked: ok } = useSoundState();
  const wasOpen = useRef(false);
  const closePlayedFor = useRef<number | null>(null);
  useEffect(() => {
    setMusic(soundOn ? track : null);
  }, [track, soundOn, ok]);
  useEffect(() => {
    if (!marketOpen || marketEndsAt == null) return;
    const delay = marketEndsAt - serverNow() - CLOSE_LEAD_MS;
    if (delay < -CLOSE_LEAD_MS) return; // the timer already ran out
    const t = setTimeout(() => {
      closePlayedFor.current = marketEndsAt;
      sfx("close", CLOSE_GAIN);
    }, Math.max(0, delay));
    return () => clearTimeout(t);
  }, [marketOpen, marketEndsAt]);
  useEffect(() => {
    if (!marketOpen && wasOpen.current && closePlayedFor.current !== marketEndsAt) {
      closePlayedFor.current = marketEndsAt;
      sfx("close", CLOSE_GAIN);
    }
    wasOpen.current = marketOpen;
  }, [marketOpen, marketEndsAt]);
  useEffect(() => {
    // Decode the boom ahead of time so it starts without delay.
    if (soundOn && ok) getBuffer("close").catch(() => {});
  }, [soundOn, ok]);
  useEffect(() => () => setMusic(null), []);
}
