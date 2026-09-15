/**
 * Builds a finished game (REVEAL phase) with 3 humans + 30 bots by simulating
 * the whole session with a synthetic clock, and writes it to a game.json.
 * Usage: npx tsx scripts/make-fixture.ts /tmp/funded-test/game.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GameStore } from "../server/src/game";
import { BotRunner } from "../server/src/bots";

const out = process.argv[2] || "/tmp/funded-test/game.json";
/** "market" stops 30 s into a live market so the server keeps it running. */
const mode = process.argv[3] || "reveal";
/** In market mode an optional 4th argument sets how many seconds have already been simulated. */
const marketSeconds = mode === "market" ? Number(process.argv[4] || 30) : 180;
let now = Date.now() - (mode === "market" ? 45 + marketSeconds : 10 * 60) * 1000;
const store = new GameStore();
store.setSettings({ teamCount: 7 }, now);
const anna = store.join({ name: "Anna", teamId: "t1" }, now);
store.join({ name: "Bram", teamId: "t1" }, now + 1);
const cas = store.join({ name: "Cas", teamId: "t2" }, now + 2);
store.addBots(30, now + 3);
const bots = new BotRunner(store);

now += 5000;
store.setPhase("BUILD", now);
store.setDecision(anna.id, "goal", "high", now);
store.setDecision(anna.id, "rewards", "generous", now);
store.setDecision(anna.id, "network", "share", now);
store.setDecision(anna.id, "prep", "audience", now);
store.setPitch(anna.id, "Rotterdam heat in a bottle. Back us and taste it first.", now);
store.lockIn(anna.id, true, now);
store.setDecision(cas.id, "goal", "low", now);
store.setDecision(cas.id, "rewards", "modest", now);
store.setDecision(cas.id, "network", "back", now);
store.setDecision(cas.id, "prep", "now", now);
store.setPitch(cas.id, "The party game that tests how Dutch you really are.", now);
store.lockIn(cas.id, true, now);
if (mode === "build") {
  // Stop right after Round 1 starts, with the timer running for real.
  const g = store.game;
  g.phaseStartedAt = Date.now();
  g.phaseEndsAt = Date.now() + g.settings.buildSeconds * 1000;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(g));
  console.log(`wrote ${out}: phase BUILD, anna=${anna.id} bram=${Object.values(g.players).find((p) => p.name === "Bram")!.id}`);
  process.exit(0);
}
for (let i = 0; i < 40; i++) {
  now += 1000;
  store.tick(now);
  bots.tick(now);
}
store.setPhase("MARKET", now);
const launchedNow = Object.values(store.game.teams).filter((t) => t.launchedAt != null && t.id !== "t2").map((t) => t.id);
try {
  store.setPledge(cas.id, { t2: 2, [launchedNow[0] ?? "t3"]: 3 }, now + 1000);
} catch {
  store.setPledge(cas.id, { t2: 2 }, now + 1000);
}
for (let i = 0; i < marketSeconds; i++) {
  now += 1000;
  store.tick(now);
  bots.tick(now);
  if (i === 45) {
    try {
      store.setPledge(anna.id, { t3: 3, t5: 2 }, now);
      store.share(cas.id, "t1", now);
      store.share(anna.id, "t4", now);
    } catch {
      /* depends on random bot choices */
    }
  }
}
if (mode !== "market") store.setPhase("REVEAL", now);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(store.game));
console.log(`wrote ${out}: ${Object.keys(store.game.players).length} players, phase ${store.game.phase}, anna=${anna.id} cas=${cas.id}`);
