import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Game } from "@funded/shared";

export function loadGame(path: string): Game | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const g = JSON.parse(raw) as Game;
    if (!g || typeof g !== "object" || !g.phase || !g.teams || !g.players) return null;
    return g;
  } catch (e) {
    console.warn(`[persist] could not load ${path}:`, (e as Error).message);
    return null;
  }
}

/** Debounced atomic writer: many changes per second collapse into one write. */
export function createSaver(path: string, delayMs = 150) {
  let timer: NodeJS.Timeout | null = null;
  let pending: Game | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const game = pending;
    pending = null;
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(game));
      renameSync(tmp, path);
    } catch (e) {
      console.warn(`[persist] could not save ${path}:`, (e as Error).message);
    }
  };

  return {
    save(game: Game) {
      pending = game;
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}
