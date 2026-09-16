import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server, type Socket } from "socket.io";
import { CONFIG, type Ack, type PlayerId, type Phase } from "@funded/shared";
import { BotRunner } from "./bots";
import { GameError, GameStore, defaultSettings, toAck } from "./game";
import { createSaver, loadGame } from "./persist";
import { startTimers } from "./timers";

const PORT = Number(process.env.PORT) || 3000;
const HOST_PIN = process.env.HOST_PIN || "1234";
const DATA_FILE = process.env.DATA_FILE || join(process.cwd(), "data", "game.json");
const DEMO_BOTS = Number(process.env.DEMO_BOTS) || 0;
const PUBLIC_URL = process.env.PUBLIC_URL || "";

if (!process.env.HOST_PIN) {
  console.warn("[funded] HOST_PIN is not set; using the default PIN 1234. Set HOST_PIN in production.");
}

// ---------- state ----------

const restored = loadGame(DATA_FILE);
// Older saves may lack newer settings; fill them with defaults.
if (restored) restored.settings = { ...defaultSettings(), ...restored.settings };
const store = new GameStore(restored ?? undefined);
if (restored) console.log(`[funded] restored game ${restored.id} in phase ${restored.phase}`);

const saver = createSaver(DATA_FILE);

// ---------- http ----------

const app = express();
app.disable("x-powered-by");
app.get("/healthz", (_req, res) => res.json({ ok: true, phase: store.game.phase }));
app.get("/config.json", (_req, res) => res.json({ publicUrl: PUBLIC_URL }));

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "..", "..", "client", "dist");
if (existsSync(distDir)) {
  // Hashed assets may be cached; index.html must always be fresh so a redeploy
  // never leaves phones on an old build.
  app.use(
    express.static(distDir, {
      index: false,
      maxAge: "1h",
      setHeaders: (res, path) => {
        if (path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get(["/", "/host", "/screen"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(join(distDir, "index.html"));
  });
} else {
  app.get("/", (_req, res) =>
    res
      .type("text")
      .send("FUNDED server running. Client build not found; run `npm run dev` for development."),
  );
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
  // Full-state broadcasts are ~15 KB of very repetitive JSON; deflate cuts that by ~80%.
  perMessageDeflate: { threshold: 1024 },
});

// ---------- broadcast (throttled) ----------

let broadcastTimer: NodeJS.Timeout | null = null;
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    io.emit("state", store.game);
  }, CONFIG.broadcastIntervalMs);
}

store.onChange = () => {
  broadcast();
  saver.save(store.game);
};

const playerSockets = new Map<PlayerId, Set<string>>();

store.onEvent = (e) => {
  if (e.type === "toast") {
    for (const sid of playerSockets.get(e.playerId) ?? []) io.to(sid).emit("toast", { text: e.text });
  }
};

// ---------- sockets ----------

type AckFn = (ack: Ack) => void;

function respond(socket: Socket, ack: AckFn | undefined, fn: () => Ack | void) {
  try {
    const r = fn() ?? { ok: true };
    ack?.(r);
  } catch (e) {
    const a = toAck(e);
    if (!(e instanceof GameError)) console.error("[socket]", e);
    ack?.(a);
    if (!a.ok) socket.emit("error", { code: a.code, message: a.message });
  }
}

function requirePlayer(socket: Socket): PlayerId {
  const pid = socket.data.playerId as PlayerId | undefined;
  if (!pid || !store.game.players[pid]) throw new GameError("NOT_FOUND", "You are not in the game");
  return pid;
}

function requireHost(socket: Socket) {
  if (!socket.data.isHost) throw new GameError("NOT_HOST");
}

function bindPlayer(socket: Socket, playerId: PlayerId) {
  const prev = socket.data.playerId as PlayerId | undefined;
  if (prev && prev !== playerId) unbindPlayer(socket);
  socket.data.playerId = playerId;
  let set = playerSockets.get(playerId);
  if (!set) playerSockets.set(playerId, (set = new Set()));
  set.add(socket.id);
}

function unbindPlayer(socket: Socket) {
  const pid = socket.data.playerId as PlayerId | undefined;
  if (!pid) return;
  const set = playerSockets.get(pid);
  set?.delete(socket.id);
  if (!set || set.size === 0) {
    playerSockets.delete(pid);
    store.setConnected(pid, false, Date.now());
  }
  socket.data.playerId = undefined;
}

io.on("connection", (socket) => {
  socket.emit("serverTime", { now: Date.now() });
  socket.emit("state", store.game);

  socket.on("join", (payload: { playerId?: string; name: string; teamId: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      const p = store.join(payload ?? ({} as never), Date.now());
      bindPlayer(socket, p.id);
      return { ok: true, playerId: p.id };
    }),
  );

  socket.on("resume", (payload: { playerId: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      const p = store.resume(payload?.playerId, Date.now());
      bindPlayer(socket, p.id);
      return { ok: true, playerId: p.id };
    }),
  );

  socket.on("leaveTeam", (_payload: unknown, ack?: AckFn) =>
    respond(socket, ack, () => {
      const pid = requirePlayer(socket);
      unbindPlayer(socket);
      store.leaveTeam(pid, Date.now());
    }),
  );

  socket.on("makeCaptain", (payload: { playerId: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      const actor = socket.data.isHost ? "host" : requirePlayer(socket);
      store.makeCaptain(actor, payload?.playerId, Date.now());
    }),
  );

  socket.on("setDecision", (payload: { field: string; value: string | null }, ack?: AckFn) =>
    respond(socket, ack, () => {
      store.setDecision(requirePlayer(socket), payload?.field as never, payload?.value ?? null, Date.now());
    }),
  );

  socket.on("setPitch", (payload: { pitch: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      store.setPitch(requirePlayer(socket), payload?.pitch ?? "", Date.now());
    }),
  );

  socket.on("lockIn", (payload: { locked: boolean }, ack?: AckFn) =>
    respond(socket, ack, () => {
      store.lockIn(requirePlayer(socket), !!payload?.locked, Date.now());
    }),
  );

  socket.on("setPledge", (payload: { alloc: Record<string, number> }, ack?: AckFn) =>
    respond(socket, ack, () => {
      store.setPledge(requirePlayer(socket), payload?.alloc ?? {}, Date.now());
    }),
  );

  socket.on("share", (payload: { teamId: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      store.share(requirePlayer(socket), payload?.teamId, Date.now());
    }),
  );

  // ----- host -----

  socket.on("host:auth", (payload: { pin: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      if (String(payload?.pin ?? "") !== HOST_PIN) throw new GameError("BAD_PIN");
      socket.data.isHost = true;
      socket.join("hosts");
    }),
  );

  socket.on("host:setSettings", (payload: Record<string, unknown>, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.setSettings(payload ?? {}, Date.now());
    }),
  );

  socket.on("host:setPhase", (payload: { phase: Phase }, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.setPhase(payload?.phase, Date.now());
    }),
  );

  socket.on("host:addTime", (payload: { seconds: number }, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.addTime(payload?.seconds ?? 30);
    }),
  );

  socket.on("host:revealStep", (payload: { step?: number; delta?: number }, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      if (payload?.delta != null) store.setRevealStep(store.game.revealStep + Number(payload.delta));
      else store.setRevealStep(payload?.step ?? 0);
    }),
  );

  socket.on("host:kick", (payload: { playerId: string }, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.kick(payload?.playerId, Date.now());
      for (const sid of playerSockets.get(payload.playerId) ?? []) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.data.playerId = undefined;
          s.emit("toast", { text: "The host removed you from the game" });
        }
      }
      playerSockets.delete(payload.playerId);
    }),
  );

  socket.on("host:addBots", (payload: { count?: number }, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.addBots(payload?.count ?? 30, Date.now());
    }),
  );

  socket.on("host:removeBots", (_payload: unknown, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.removeBots(Date.now());
    }),
  );

  socket.on("host:reset", (_payload: unknown, ack?: AckFn) =>
    respond(socket, ack, () => {
      requireHost(socket);
      store.reset(Date.now());
      playerSockets.clear();
      for (const s of io.sockets.sockets.values()) s.data.playerId = undefined;
    }),
  );

  socket.on("disconnect", () => {
    unbindPlayer(socket);
  });
});

// ---------- timers, bots ----------

const stopTimers = startTimers(store, io);
const bots = new BotRunner(store);
const botTimer = setInterval(() => {
  try {
    bots.tick(Date.now());
  } catch (e) {
    console.error("[bots]", e);
  }
}, 500);

if (DEMO_BOTS > 0) {
  const g = store.game;
  const existing = Object.values(g.players).filter((p) => p.isBot).length;
  if (g.phase === "LOBBY" && existing === 0) {
    store.addBots(DEMO_BOTS, Date.now());
    console.log(`[funded] demo mode: added ${DEMO_BOTS} bots`);
  }
}

// Mark everyone disconnected on boot; they flip back as sockets resume.
for (const p of Object.values(store.game.players)) if (!p.isBot) p.connected = false;

httpServer.listen(PORT, () => {
  console.log(`[funded] listening on http://localhost:${PORT}  (host PIN: ${HOST_PIN})`);
});

function shutdown() {
  stopTimers();
  clearInterval(botTimer);
  saver.flushNow();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
