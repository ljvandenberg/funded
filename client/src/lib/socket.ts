import { io } from "socket.io-client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Ack, Game } from "@funded/shared";
import { pushToast } from "./toast";

export const socket = io({ transports: ["websocket", "polling"] });

let game: Game | null = null;
let clockOffset = 0;
let connected = false;
let hostPin: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

socket.on("connect", () => {
  connected = true;
  notify();
  // Restore sessions after a reconnect.
  const pid = getPlayerId();
  if (pid) socket.emit("resume", { playerId: pid }, () => {});
  if (hostPin) socket.emit("host:auth", { pin: hostPin }, () => {});
});
socket.on("disconnect", () => {
  connected = false;
  notify();
});
socket.on("state", (g: Game) => {
  game = g;
  notify();
});
socket.on("serverTime", ({ now }: { now: number }) => {
  clockOffset = now - Date.now();
});
socket.on("toast", ({ text }: { text: string }) => pushToast(text, "info"));

export function serverNow(): number {
  return Date.now() + clockOffset;
}

export function getGame(): Game | null {
  return game;
}

export function useGame(): Game | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => game,
  );
}

export function useConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => connected,
  );
}

/** Re-renders every `ms` and returns the server clock. */
export function useNow(ms = 500): number {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function emit(event: string, payload: unknown = {}): Promise<Ack> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, code: "TIMEOUT", message: "No answer from the server" });
    }, 6000);
    socket.emit(event, payload, (ack: Ack) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ack ?? { ok: true });
    });
  });
}

/** Emits and shows the server's error message as a toast if it fails. */
export async function act(event: string, payload: unknown = {}): Promise<Ack> {
  const ack = await emit(event, payload);
  if (!ack.ok) pushToast(ack.message, "error");
  return ack;
}

// ----- identity persistence -----

const PID_KEY = "funded.playerId";
const NAME_KEY = "funded.name";

export function getPlayerId(): string | null {
  try {
    return localStorage.getItem(PID_KEY);
  } catch {
    return null;
  }
}
export function setPlayerId(id: string | null) {
  try {
    if (id) localStorage.setItem(PID_KEY, id);
    else localStorage.removeItem(PID_KEY);
  } catch {
    /* ignore */
  }
}
export function getSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setSavedName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function setHostPin(pin: string | null) {
  hostPin = pin;
  try {
    if (pin) sessionStorage.setItem("funded.hostPin", pin);
    else sessionStorage.removeItem("funded.hostPin");
  } catch {
    /* ignore */
  }
}
export function getStoredHostPin(): string | null {
  try {
    return sessionStorage.getItem("funded.hostPin");
  } catch {
    return null;
  }
}

/** Join URL for phones: PUBLIC_URL from the server if set, else this origin. */
let publicUrl: string | null = null;
export async function getJoinUrl(): Promise<string> {
  if (publicUrl != null) return publicUrl;
  try {
    const r = await fetch("/config.json");
    const j = (await r.json()) as { publicUrl?: string };
    publicUrl = j.publicUrl?.trim() || window.location.origin;
  } catch {
    publicUrl = window.location.origin;
  }
  return publicUrl;
}
