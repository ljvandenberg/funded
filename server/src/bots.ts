import {
  CASE_BY_ID,
  computeResults,
  playersOfTeam,
  type Game,
  type PlayerId,
  type TeamId,
} from "@funded/shared";
import type { GameStore } from "./game";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

/**
 * Pacing. The spec's 4–12 s per coin empties 30 bot wallets before the
 * audience-building campaigns even launch (40 s), so bots spread their five
 * coins over most of the 3-minute market instead.
 */
const FIRST_COIN_MS = [5_000, 40_000] as const;
const NEXT_COIN_MS = [12_000, 40_000] as const;

const PITCHES = [
  "Back us today and be first in line when we ship.",
  "Made by a small team that cares. Every coin counts.",
  "Tested, loved, and ready for the next step. Join us.",
  "Help us go from prototype to product this year.",
  "We only need a little push to make this real.",
  "Early backers get the best rewards. Don't wait.",
];

/**
 * Drives bot players so 3–4 humans can test a full session. Bots only ever
 * act through the same store methods as humans, so every rule still applies.
 */
export class BotRunner {
  private phaseKey = "";
  private lockAt = new Map<TeamId, number>();
  private nextCoinAt = new Map<PlayerId, number>();
  private shareAt = new Map<PlayerId, number>();

  constructor(private store: GameStore) {}

  tick(now: number) {
    const g = this.store.game;
    const key = `${g.phase}:${g.phaseStartedAt}`;
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.schedule(g, now);
    }
    if (g.timerExpired) return;
    if (g.phase === "BUILD") this.tickBuild(g, now);
    else if (g.phase === "MARKET") this.tickMarket(g, now);
  }

  private bots(g: Game) {
    return Object.values(g.players).filter((p) => p.isBot);
  }

  private schedule(g: Game, now: number) {
    this.lockAt.clear();
    this.nextCoinAt.clear();
    this.shareAt.clear();
    if (g.phase === "BUILD") {
      for (const t of Object.values(g.teams)) this.lockAt.set(t.id, now + rand(10_000, 30_000));
    } else if (g.phase === "MARKET") {
      for (const b of this.bots(g)) {
        this.nextCoinAt.set(b.id, now + rand(FIRST_COIN_MS[0], FIRST_COIN_MS[1]));
        this.shareAt.set(b.id, now + rand(20_000, 120_000));
      }
    }
  }

  private tickBuild(g: Game, now: number) {
    for (const t of Object.values(g.teams)) {
      if (t.lockedIn) continue;
      const cap = t.captainId ? g.players[t.captainId] : undefined;
      if (!cap || !cap.isBot) continue; // never touch a human-led team
      const at = this.lockAt.get(t.id) ?? now;
      if (now < at) continue;
      try {
        this.store.setDecision(cap.id, "goal", pick(["low", "medium", "medium", "high"]), now);
        this.store.setDecision(cap.id, "rewards", pick(["modest", "generous"]), now);
        this.store.setDecision(cap.id, "network", pick(["back", "share"]), now);
        this.store.setDecision(cap.id, "prep", pick(["now", "audience"]), now);
        const c = CASE_BY_ID[t.caseId];
        this.store.setPitch(cap.id, `${c.name}: ${pick(PITCHES)}`, now);
        this.store.lockIn(cap.id, true, now);
      } catch (e) {
        // A human may have taken over mid-tick; try again next time.
        this.lockAt.set(t.id, now + 2000);
      }
    }
  }

  private tickMarket(g: Game, now: number) {
    const bots = this.bots(g);
    if (!bots.length) return;
    const results = computeResults(g, now);
    for (const b of bots) {
      // Ensure late-added bots get a schedule.
      if (!this.nextCoinAt.has(b.id)) this.nextCoinAt.set(b.id, now + rand(FIRST_COIN_MS[0], FIRST_COIN_MS[1]));
      if (!this.shareAt.has(b.id)) this.shareAt.set(b.id, now + rand(20_000, 120_000));

      const alloc = { ...(g.pledges[b.id]?.alloc ?? {}) };
      const placed = Object.values(alloc).reduce((a, v) => a + v, 0);
      if (placed < g.settings.coinsPerPlayer && now >= (this.nextCoinAt.get(b.id) ?? 0)) {
        const target = this.chooseCampaign(g, b.teamId, results, false);
        if (target) {
          alloc[target] = (alloc[target] ?? 0) + 1;
          try {
            this.store.setPledge(b.id, alloc, now);
          } catch {
            /* rule changed under us; skip */
          }
        }
        this.nextCoinAt.set(b.id, now + rand(NEXT_COIN_MS[0], NEXT_COIN_MS[1]));
      }

      if (!b.sharedTeamId && now >= (this.shareAt.get(b.id) ?? Infinity)) {
        const target = this.chooseCampaign(g, b.teamId, results, true);
        if (target) {
          try {
            this.store.share(b.id, target, now);
          } catch {
            /* ignore */
          }
          this.shareAt.set(b.id, Infinity);
        } else {
          this.shareAt.set(b.id, now + 5000);
        }
      }
    }
  }

  private chooseCampaign(
    g: Game,
    ownTeamId: TeamId,
    results: ReturnType<typeof computeResults>,
    forShare: boolean,
  ): TeamId | null {
    const weighted: { id: TeamId; w: number }[] = [];
    for (const id of results.campaignOrder) {
      const c = results.campaigns[id];
      if (!c.launched) continue;
      if (id === ownTeamId && (forShare || c.network === "share")) continue;
      let w = 1;
      if (c.badges.includes("Video")) w += 1.0;
      if (c.badges.includes("Top rewards")) w += 0.8;
      if (c.pinned) w += 0.7;
      if (c.badges.includes("Spread the word")) w += 0.5;
      w += 0.6 * Math.min(1, c.progress);
      if (c.goalLevel === "high") w -= 0.4;
      if (c.progress >= 1.3) w *= 0.5; // already comfortably funded: money looks elsewhere
      if (id === ownTeamId) w *= 0.6; // own campaign is a fallback, not a strategy
      if (w > 0) weighted.push({ id, w });
    }
    const total = weighted.reduce((a, x) => a + x.w, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const x of weighted) {
      r -= x.w;
      if (r <= 0) return x.id;
    }
    return weighted[weighted.length - 1].id;
  }
}

export function botTeamsSummary(g: Game): string {
  return Object.keys(g.teams)
    .map((id) => `${id}:${playersOfTeam(g, id).length}`)
    .join(" ");
}
