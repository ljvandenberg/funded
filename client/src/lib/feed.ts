import { useMemo, useRef } from "react";
import { CASE_BY_ID, computeResults, type Game } from "@funded/shared";

export interface FeedEvent {
  id: number;
  kind: "coin" | "share" | "launch" | "funded" | "join" | "lock";
  text: string;
  at: number;
}

let nextId = 1;

/**
 * Derives a live event feed from consecutive game states: who backed what,
 * who shared, launches, and the moment a campaign gets funded.
 */
export function useFeed(game: Game, max = 6): FeedEvent[] {
  const prev = useRef<Game | null>(null);
  const events = useRef<FeedEvent[]>([]);

  return useMemo(() => {
    const p = prev.current;
    prev.current = game;
    if (!p || p.id !== game.id || p.phase !== game.phase) {
      events.current = [];
      return events.current;
    }
    const now = Date.now();
    const fresh: FeedEvent[] = [];
    const name = (id: string) => game.players[id]?.name ?? "Someone";
    const camp = (teamId: string) => CASE_BY_ID[game.teams[teamId]?.caseId]?.name ?? teamId;

    if (game.phase === "LOBBY" || game.phase === "BUILD") {
      for (const id of Object.keys(game.players)) {
        if (!p.players[id]) fresh.push({ id: nextId++, kind: "join", text: `${name(id)} joined Team ${game.players[id].teamId.slice(1)}`, at: now });
      }
    }
    if (game.phase === "BUILD") {
      for (const t of Object.values(game.teams)) {
        if (t.lockedIn && !p.teams[t.id]?.lockedIn) fresh.push({ id: nextId++, kind: "lock", text: `${camp(t.id)} locked in`, at: now });
      }
    }
    if (game.phase === "MARKET") {
      for (const pl of Object.values(game.pledges)) {
        const before = p.pledges[pl.playerId]?.alloc ?? {};
        for (const [teamId, coins] of Object.entries(pl.alloc)) {
          const delta = coins - (before[teamId] ?? 0);
          if (delta > 0) fresh.push({ id: nextId++, kind: "coin", text: `${name(pl.playerId)} backed ${camp(teamId)}${delta > 1 ? ` ×${delta}` : ""}`, at: now });
        }
      }
      for (const t of Object.values(game.teams)) {
        const pt = p.teams[t.id];
        if (!pt) continue;
        for (const pid of t.shares) {
          if (!pt.shares.includes(pid)) fresh.push({ id: nextId++, kind: "share", text: `${name(pid)} shared ${camp(t.id)}`, at: now });
        }
        if (t.launchedAt != null && pt.launchedAt == null && (t.decisions.prep ?? "now") === "audience") {
          fresh.push({ id: nextId++, kind: "launch", text: `${camp(t.id)} just launched`, at: now });
        }
      }
      const rNow = computeResults(game, now);
      const rPrev = computeResults(p, now);
      for (const id of rNow.campaignOrder) {
        if (rNow.campaigns[id].funded && !rPrev.campaigns[id]?.funded) {
          fresh.push({ id: nextId++, kind: "funded", text: `${camp(id)} is FUNDED`, at: now });
        }
      }
    }
    if (fresh.length) events.current = [...fresh.reverse(), ...events.current].slice(0, max);
    return events.current;
  }, [game, max]);
}
