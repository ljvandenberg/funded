import { CONFIG } from "@funded/shared";
import type { Server } from "socket.io";
import type { GameStore } from "./game";

/**
 * The server owns all clocks. Every 250 ms it lets the store expire timers,
 * launch audience-building campaigns and promote absent captains. Every 5 s
 * it tells clients the server time so countdowns match the big screen.
 */
export function startTimers(store: GameStore, io: Server) {
  const tick = setInterval(() => {
    try {
      store.tick(Date.now());
    } catch (e) {
      console.error("[timers] tick failed", e);
    }
  }, CONFIG.tickIntervalMs);

  const clock = setInterval(() => {
    io.emit("serverTime", { now: Date.now() });
  }, CONFIG.serverTimeIntervalMs);

  return () => {
    clearInterval(tick);
    clearInterval(clock);
  };
}
