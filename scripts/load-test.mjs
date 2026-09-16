// Simulates N real players against a running FUNDED server.
// Usage: URL=https://... PLAYERS=25 [HOST_PIN=1234] [DURATION=600] node scripts/load-test.mjs
// With HOST_PIN it drives the phases itself; without, it waits for the host console.
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const N = Number(process.env.PLAYERS || 25);
const HOST_PIN = process.env.HOST_PIN || "";
const DURATION = Number(process.env.DURATION || 600) * 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const stats = { acks: [], errors: 0, stateMsgs: 0, stateBytes: 0, disconnects: 0, joined: 0, coins: 0, shares: 0, locks: 0 };
const players = [];
let latest = null;

function emit(s, ev, payload) {
  const start = Date.now();
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; stats.errors++; resolve({ ok: false, message: "timeout" }); } }, 10000);
    s.emit(ev, payload, (ack) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      stats.acks.push(Date.now() - start);
      if (ack && ack.ok === false) stats.errors++;
      resolve(ack ?? { ok: true });
    });
  });
}

function summary() {
  const a = [...stats.acks].sort((x, y) => x - y);
  const q = (p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0;
  return `acks=${a.length} p50=${q(0.5)}ms p95=${q(0.95)}ms max=${a[a.length - 1] ?? 0}ms errors=${stats.errors} states=${stats.stateMsgs} (${(stats.stateBytes / 1024 / 1024).toFixed(1)} MB) disconnects=${stats.disconnects} coins=${stats.coins} shares=${stats.shares} locks=${stats.locks}`;
}

// ---- host (optional) ----
let host = null;
if (HOST_PIN) {
  host = io(URL, { transports: ["websocket"] });
  await new Promise((r) => host.on("connect", r));
  const a = await emit(host, "host:auth", { pin: HOST_PIN });
  if (!a.ok) { log("host auth failed:", a.message); process.exit(1); }
  log("host authenticated");
}

// ---- players ----
async function makePlayer(i) {
  const s = io(URL, { transports: ["websocket"], reconnection: true });
  const p = { i, s, id: null, name: `Load ${i + 1}`, teamId: null, decided: false, placed: 0, shared: false, nextCoinAt: 0, shareAt: 0 };
  s.on("state", (g) => { stats.stateMsgs++; if (i === 0) { stats.stateBytes += JSON.stringify(g).length * N; latest = g; } p.game = g; });
  s.on("disconnect", () => stats.disconnects++);
  await new Promise((r) => s.on("connect", r));
  const teams = Object.keys(p.game?.teams ?? latest?.teams ?? { t1: 1 });
  const teamId = teams[i % teams.length];
  const ack = await emit(s, "join", { name: p.name, teamId });
  if (ack.ok) { p.id = ack.playerId; p.teamId = teamId; stats.joined++; }
  else log(`join failed for ${p.name}: ${ack.message}`);
  return p;
}

log(`connecting ${N} players to ${URL}`);
const tJoin = Date.now();
for (let i = 0; i < N; i++) players.push(await makePlayer(i));
log(`${stats.joined}/${N} joined in ${Date.now() - tJoin} ms · ${summary()}`);
if (!HOST_PIN) log("No HOST_PIN: press Start Round 1 / Open the market / Close market & reveal in the host console; players will react.");

// ---- per-phase behaviour ----
async function tick() {
  const g = latest;
  if (!g) return;
  const now = Date.now();
  for (const p of players) {
    if (!p.id || !g.players[p.id]) continue;
    const me = g.players[p.id];
    const team = g.teams[me.teamId];
    if (g.phase === "BUILD" && !g.timerExpired && me.isCaptain && !team.lockedIn && !p.decided) {
      if (!p.decideAt) p.decideAt = now + rand(3000, 15000);
      if (now < p.decideAt) continue;
      p.decided = true;
      await emit(p.s, "setDecision", { field: "goal", value: pick(["low", "medium", "high"]) });
      await emit(p.s, "setDecision", { field: "rewards", value: pick(["modest", "generous"]) });
      await emit(p.s, "setDecision", { field: "network", value: pick(["back", "share"]) });
      await emit(p.s, "setDecision", { field: "prep", value: pick(["now", "audience"]) });
      await emit(p.s, "setPitch", { pitch: `Load-test pitch from ${p.name}` });
      const a = await emit(p.s, "lockIn", { locked: true });
      if (a.ok) stats.locks++;
    }
    if (g.phase === "MARKET" && !g.timerExpired) {
      if (!p.shareAt) { p.shareAt = now + rand(10000, 60000); p.nextCoinAt = now + rand(2000, 8000); }
      // Track our own allocation so a lagging state snapshot never makes us send a stale (lower) count.
      p.alloc ??= { ...(g.pledges[p.id]?.alloc ?? {}) };
      const alloc = p.alloc;
      const placed = Object.values(alloc).reduce((x, y) => x + y, 0);
      const launched = Object.values(g.teams).filter((t) => t.launchedAt != null || (t.decisions.prep ?? "now") === "now");
      const targets = launched.filter((t) => !(t.id === me.teamId && (t.decisions.network ?? "back") === "share"));
      if (placed < g.settings.coinsPerPlayer && now >= p.nextCoinAt && targets.length) {
        const t = pick(targets);
        alloc[t.id] = (alloc[t.id] ?? 0) + 1;
        const a = await emit(p.s, "setPledge", { alloc: { ...alloc } });
        if (a.ok) stats.coins++; else { alloc[t.id]--; if (!alloc[t.id]) delete alloc[t.id]; log(`pledge rejected for ${p.name}: ${a.message}`); }
        p.nextCoinAt = now + rand(3000, 9000);
      }
      const shareable = launched.filter((t) => t.id !== me.teamId);
      if (!p.shared && !me.sharedTeamId && now >= p.shareAt && shareable.length) {
        p.shared = true;
        const a = await emit(p.s, "share", { teamId: pick(shareable).id });
        if (a.ok) stats.shares++;
      }
    }
  }
}

// ---- host driver (optional) ----
let hostStep = 0;
async function driveHost() {
  if (!host || !latest) return;
  const g = latest;
  const elapsed = (Date.now() - t0) / 1000;
  if (g.phase === "LOBBY" && hostStep === 0 && elapsed > 5) { hostStep = 1; log("host: Start Round 1"); await emit(host, "host:setPhase", { phase: "BUILD" }); }
  if (g.phase === "BUILD" && hostStep === 1) {
    const all = Object.values(g.teams).every((t) => t.lockedIn);
    if (all || elapsed > 60) { hostStep = 2; log("host: Open the market"); await emit(host, "host:setPhase", { phase: "MARKET" }); }
  }
  if (g.phase === "MARKET" && hostStep === 2 && (g.timerExpired || (g.marketOpenedAt && Date.now() - g.marketOpenedAt > 100000))) {
    hostStep = 3; log("host: Close market & reveal"); await emit(host, "host:setPhase", { phase: "REVEAL" });
    for (let s = 1; s <= Object.keys(g.teams).length + 3; s++) { await new Promise((r) => setTimeout(r, 800)); await emit(host, "host:revealStep", { step: s }); }
    log("host: revealed everything");
  }
}

let lastPhase = null;
const loop = setInterval(async () => {
  try {
    await tick();
    await driveHost();
    if (latest && latest.phase !== lastPhase) { lastPhase = latest.phase; log(`phase → ${latest.phase} · ${summary()}`); }
  } catch (e) { stats.errors++; log("tick error", e.message); }
}, 500);
const report = setInterval(() => log(summary()), 15000);

async function finish(reason) {
  clearInterval(loop); clearInterval(report);
  log(`finishing (${reason}) · ${summary()}`);
  // Leave teams so the lobby is clean afterwards.
  await Promise.all(players.map((p) => (p.id ? emit(p.s, "leaveTeam", {}) : null)));
  log("all load players left their teams");
  process.exit(0);
}
process.on("SIGINT", () => finish("interrupted"));
setTimeout(() => finish("duration reached"), DURATION);
const waitDone = setInterval(() => {
  if (latest?.phase === "REVEAL" && (!host || hostStep === 3) && latest.revealStep >= Object.keys(latest.teams).length + 3) { clearInterval(waitDone); setTimeout(() => finish("reveal complete"), 3000); }
}, 1000);
