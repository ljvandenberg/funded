import { randomUUID } from "node:crypto";
import {
  CASE_BY_ID,
  CONFIG,
  ERROR_MESSAGES,
  DEFAULT_DECISIONS,
  caseForTeamNumber,
  isLaunched,
  launchesAt,
  playersOfTeam,
  sortTeamIds,
  teamIsFull,
  totalAlloc,
  type Ack,
  type DecisionField,
  type ErrorCode,
  type Game,
  type Phase,
  type Player,
  type PlayerId,
  type Settings,
  type Team,
  type TeamId,
} from "@funded/shared";

export class GameError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
    this.code = code;
  }
}

export function toAck(e: unknown): Ack {
  if (e instanceof GameError) return { ok: false, code: e.code, message: e.message };
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, code: "INVALID", message };
}

export function defaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    teamCount: CONFIG.defaultTeams,
    maxPerTeam: CONFIG.maxPerTeam,
    buildSeconds: CONFIG.buildSeconds,
    marketSeconds: CONFIG.marketSeconds,
    launchDelaySeconds: CONFIG.launchDelaySeconds,
    coinsPerPlayer: CONFIG.coinsPerPlayer,
    goalFractions: { ...CONFIG.goalFractions },
    rewardCost: { ...CONFIG.rewardCost },
    multipliers: { ...CONFIG.multipliers },
    prePledgeFraction: CONFIG.prePledgeFraction,
    pinSeconds: CONFIG.pinSeconds,
    ...overrides,
  };
}

export function makeTeam(n: number): Team {
  return {
    id: `t${n}`,
    caseId: caseForTeamNumber(n).id,
    captainId: null,
    decisions: { goal: null, rewards: null, network: null, prep: null, pitch: "" },
    lockedIn: false,
    launchedAt: null,
    lastSharedAt: null,
    shares: [],
  };
}

export function makeTeams(count: number): Record<TeamId, Team> {
  const teams: Record<TeamId, Team> = {};
  for (let i = 1; i <= count; i++) teams[`t${i}`] = makeTeam(i);
  return teams;
}

export function createGame(settings: Partial<Settings> = {}, now = Date.now()): Game {
  const s = defaultSettings(settings);
  return {
    id: randomUUID(),
    createdAt: now,
    phase: "LOBBY",
    phaseStartedAt: now,
    phaseEndsAt: null,
    timerExpired: false,
    marketOpenedAt: null,
    settings: s,
    totalCoins: null,
    players: {},
    teams: makeTeams(s.teamCount),
    pledges: {},
    revealStep: 0,
  };
}

const GOALS = ["low", "medium", "high"] as const;
const REWARDS = ["modest", "generous"] as const;
const NETWORKS = ["back", "share"] as const;
const PREPS = ["now", "audience"] as const;

export interface StoreEvent {
  type: "toast";
  playerId: PlayerId;
  text: string;
}

/**
 * Holds the authoritative game state. Every mutation validates its inputs,
 * throws a GameError on rejection, and calls `onChange` on success.
 */
export class GameStore {
  game: Game;
  onChange: () => void = () => {};
  onEvent: (e: StoreEvent) => void = () => {};

  constructor(initial?: Game) {
    this.game = initial ?? createGame();
  }

  private changed() {
    this.onChange();
  }

  // ---------- helpers ----------

  player(id: PlayerId | undefined | null): Player {
    const p = id ? this.game.players[id] : undefined;
    if (!p) throw new GameError("NOT_FOUND", "Player not found");
    return p;
  }

  team(id: TeamId | undefined | null): Team {
    const t = id ? this.game.teams[id] : undefined;
    if (!t) throw new GameError("NOT_FOUND", "Team not found");
    return t;
  }

  private requireCaptain(playerId: PlayerId): { player: Player; team: Team } {
    const player = this.player(playerId);
    const team = this.team(player.teamId);
    if (team.captainId !== player.id) throw new GameError("NOT_CAPTAIN");
    return { player, team };
  }

  private requireBuildOpen() {
    if (this.game.phase !== "BUILD") throw new GameError("WRONG_PHASE");
    if (this.game.timerExpired) throw new GameError("BUILD_CLOSED");
  }

  private requireMarketOpen() {
    if (this.game.phase !== "MARKET" || this.game.timerExpired) throw new GameError("MARKET_CLOSED");
  }

  /** Picks a captain for a team if it lacks a valid one. Humans before bots, earliest joined first. */
  ensureCaptain(teamId: TeamId, now: number): PlayerId | null {
    const team = this.team(teamId);
    const members = playersOfTeam(this.game, teamId);
    const current = team.captainId ? this.game.players[team.captainId] : undefined;
    if (current && current.teamId === teamId) {
      // A bot must never captain a team with a human in it.
      if (current.isBot && members.some((m) => !m.isBot)) {
        return this.setCaptain(teamId, this.pickCaptain(members, now)!.id);
      }
      return current.id;
    }
    const pick = this.pickCaptain(members, now);
    return this.setCaptain(teamId, pick ? pick.id : null);
  }

  private pickCaptain(members: Player[], _now: number): Player | undefined {
    const humans = members.filter((m) => !m.isBot);
    const pool = humans.length ? humans : members;
    const connected = pool.filter((m) => m.connected);
    const list = connected.length ? connected : pool;
    return [...list].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  }

  private setCaptain(teamId: TeamId, playerId: PlayerId | null): PlayerId | null {
    const team = this.team(teamId);
    const previous = team.captainId;
    team.captainId = playerId;
    for (const p of Object.values(this.game.players)) {
      if (p.teamId === teamId) p.isCaptain = p.id === playerId;
    }
    if (playerId && playerId !== previous) {
      const p = this.game.players[playerId];
      if (p && !p.isBot) this.onEvent({ type: "toast", playerId, text: "You are now captain" });
    }
    return playerId;
  }

  // ---------- player actions ----------

  join(input: { playerId?: string; name: string; teamId: string }, now: number, isBot = false): Player {
    const g = this.game;
    if (g.phase === "REVEAL") throw new GameError("WRONG_PHASE", "The game is over. Wait for the host to open the lobby.");
    const name = (input.name ?? "").trim().slice(0, CONFIG.nameMaxLength);
    if (!name) throw new GameError("INVALID", "Please enter your name");
    const team = this.team(input.teamId);

    const existing = input.playerId ? g.players[input.playerId] : undefined;
    if (existing) {
      // Re-join: keep the record, allow a team switch only in the lobby.
      existing.name = name;
      existing.connected = true;
      existing.lastSeen = now;
      if (existing.teamId !== team.id && g.phase === "LOBBY") {
        if (teamIsFull(g, team.id)) throw new GameError("TEAM_FULL");
        const oldTeam = existing.teamId;
        existing.teamId = team.id;
        this.ensureCaptain(oldTeam, now);
      }
      this.ensureCaptain(existing.teamId, now);
      this.changed();
      return existing;
    }

    if (teamIsFull(g, team.id)) throw new GameError("TEAM_FULL");
    const id = input.playerId && /^[\w-]{8,64}$/.test(input.playerId) ? input.playerId : randomUUID();
    const player: Player = {
      id,
      name,
      teamId: team.id,
      isCaptain: false,
      isBot,
      connected: true,
      lastSeen: now,
      joinedAt: now,
      late: g.phase !== "LOBBY",
      sharedTeamId: null,
    };
    g.players[id] = player;
    this.ensureCaptain(team.id, now);
    this.changed();
    return player;
  }

  resume(playerId: string, now: number): Player {
    const p = this.player(playerId);
    p.connected = true;
    p.lastSeen = now;
    this.ensureCaptain(p.teamId, now);
    this.changed();
    return p;
  }

  setConnected(playerId: PlayerId, connected: boolean, now: number) {
    const p = this.game.players[playerId];
    if (!p) return;
    p.connected = connected;
    p.lastSeen = now;
    this.changed();
  }

  removePlayer(playerId: PlayerId, now: number) {
    const g = this.game;
    const p = g.players[playerId];
    if (!p) return;
    delete g.players[playerId];
    delete g.pledges[playerId];
    for (const t of Object.values(g.teams)) {
      const i = t.shares.indexOf(playerId);
      if (i >= 0) t.shares.splice(i, 1);
    }
    this.ensureCaptain(p.teamId, now);
    this.changed();
  }

  leaveTeam(playerId: PlayerId, now: number) {
    this.player(playerId);
    this.removePlayer(playerId, now);
  }

  makeCaptain(actorId: PlayerId | "host", targetId: PlayerId, now: number) {
    const target = this.player(targetId);
    if (actorId !== "host") {
      const { team } = this.requireCaptain(actorId);
      if (target.teamId !== team.id) throw new GameError("INVALID", "That player is not in your team");
    }
    this.setCaptain(target.teamId, target.id);
    this.changed();
    void now;
  }

  setDecision(playerId: PlayerId, field: DecisionField, value: string | null, _now: number) {
    this.requireBuildOpen();
    const { team } = this.requireCaptain(playerId);
    const valid: Record<DecisionField, readonly string[]> = {
      goal: GOALS,
      rewards: REWARDS,
      network: NETWORKS,
      prep: PREPS,
    };
    if (!(field in valid)) throw new GameError("INVALID", "Unknown decision");
    if (value !== null && !valid[field].includes(value)) throw new GameError("INVALID", "Unknown option");
    (team.decisions as unknown as Record<string, string | null>)[field] = value;
    this.changed();
  }

  setPitch(playerId: PlayerId, pitch: string, _now: number) {
    this.requireBuildOpen();
    const { team } = this.requireCaptain(playerId);
    team.decisions.pitch = String(pitch ?? "").replace(/\s+/g, " ").slice(0, CONFIG.pitchMaxLength);
    this.changed();
  }

  lockIn(playerId: PlayerId, locked: boolean, _now: number) {
    this.requireBuildOpen();
    const { team } = this.requireCaptain(playerId);
    if (locked) {
      const d = team.decisions;
      if (!d.goal || !d.rewards || !d.network || !d.prep || !d.pitch.trim()) {
        throw new GameError("INVALID", "Make all four decisions and write a pitch first");
      }
    }
    team.lockedIn = locked;
    this.changed();
  }

  setPledge(playerId: PlayerId, allocInput: Record<string, unknown>, now: number) {
    this.requireMarketOpen();
    const g = this.game;
    const player = this.player(playerId);
    if (!allocInput || typeof allocInput !== "object") throw new GameError("INVALID");
    const alloc: Record<TeamId, number> = {};
    for (const [teamId, raw] of Object.entries(allocInput)) {
      const team = g.teams[teamId];
      if (!team) throw new GameError("NOT_FOUND", "Unknown campaign");
      const coins = Number(raw);
      if (!Number.isInteger(coins) || coins < 0) throw new GameError("INVALID");
      if (coins === 0) continue;
      if (!isLaunched(team, g)) throw new GameError("CAMPAIGN_LOCKED");
      if (team.id === player.teamId) {
        const network = team.decisions.network ?? DEFAULT_DECISIONS.network;
        if (network === "share") throw new GameError("OWN_NETWORK_SHARE");
      }
      alloc[teamId] = coins;
    }
    if (totalAlloc(alloc) > g.settings.coinsPerPlayer) throw new GameError("OVER_BUDGET");
    // Coins are final: a campaign's count can only go up.
    const before = g.pledges[playerId]?.alloc ?? {};
    for (const [teamId, coins] of Object.entries(before)) {
      if ((alloc[teamId] ?? 0) < coins) throw new GameError("NO_REFUND");
    }
    g.pledges[playerId] = { playerId, alloc, updatedAt: now };
    this.changed();
  }

  share(playerId: PlayerId, teamId: TeamId, now: number) {
    this.requireMarketOpen();
    const player = this.player(playerId);
    const team = this.team(teamId);
    if (player.sharedTeamId) throw new GameError("ALREADY_SHARED");
    if (team.id === player.teamId) throw new GameError("OWN_CAMPAIGN");
    if (!isLaunched(team, this.game)) throw new GameError("CAMPAIGN_LOCKED");
    player.sharedTeamId = team.id;
    if (!team.shares.includes(playerId)) team.shares.push(playerId);
    team.lastSharedAt = now;
    this.changed();
  }

  // ---------- host actions ----------

  setSettings(partial: Partial<Settings>, now: number) {
    const g = this.game;
    if (g.phase !== "LOBBY") throw new GameError("WRONG_PHASE", "Settings can only change in the lobby");
    const s = g.settings;
    const int = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    };
    if (partial.buildSeconds != null) s.buildSeconds = int(partial.buildSeconds, 30, 1800, s.buildSeconds);
    if (partial.marketSeconds != null) s.marketSeconds = int(partial.marketSeconds, 30, 1800, s.marketSeconds);
    if (partial.launchDelaySeconds != null)
      s.launchDelaySeconds = int(partial.launchDelaySeconds, 0, 600, s.launchDelaySeconds);
    if (partial.coinsPerPlayer != null) s.coinsPerPlayer = int(partial.coinsPerPlayer, 1, 20, s.coinsPerPlayer);
    if (partial.maxPerTeam != null) s.maxPerTeam = int(partial.maxPerTeam, 0, 50, s.maxPerTeam);
    if (partial.pinSeconds != null) s.pinSeconds = int(partial.pinSeconds, 5, 120, s.pinSeconds);
    if (partial.teamCount != null) {
      const count = int(partial.teamCount, CONFIG.minTeams, CONFIG.maxTeams, s.teamCount);
      if (count !== s.teamCount) this.resizeTeams(count, now);
      s.teamCount = count;
    }
    this.changed();
  }

  private resizeTeams(count: number, now: number) {
    const g = this.game;
    const existing = sortTeamIds(Object.keys(g.teams));
    for (let i = 1; i <= count; i++) {
      if (!g.teams[`t${i}`]) g.teams[`t${i}`] = makeTeam(i);
    }
    const removed = existing.filter((id) => parseInt(id.slice(1), 10) > count);
    let rr = 0;
    for (const id of removed) {
      const members = playersOfTeam(g, id);
      for (const m of members) {
        m.teamId = `t${(rr % count) + 1}`;
        m.isCaptain = false;
        rr++;
      }
      delete g.teams[id];
    }
    for (let i = 1; i <= count; i++) this.ensureCaptain(`t${i}`, now);
  }

  /** Move to a phase. Host-only. Handles all bookkeeping for the transition. */
  setPhase(phase: Phase, now: number) {
    const g = this.game;
    if (phase === g.phase) return;
    const order: Phase[] = ["LOBBY", "BUILD", "MARKET", "REVEAL"];
    if (!order.includes(phase)) throw new GameError("INVALID", "Unknown phase");

    if (phase === "LOBBY") {
      this.backToLobby(now);
    } else if (phase === "BUILD") {
      if (g.phase !== "LOBBY") throw new GameError("WRONG_PHASE", "Round 1 starts from the lobby");
      this.clearRound();
      g.phase = "BUILD";
      g.phaseStartedAt = now;
      g.phaseEndsAt = now + g.settings.buildSeconds * 1000;
      g.timerExpired = false;
    } else if (phase === "MARKET") {
      if (g.phase !== "BUILD") throw new GameError("WRONG_PHASE", "The market opens after Round 1");
      this.autoLockTeams();
      g.phase = "MARKET";
      g.phaseStartedAt = now;
      g.marketOpenedAt = now;
      g.phaseEndsAt = now + g.settings.marketSeconds * 1000;
      g.timerExpired = false;
      g.totalCoins = Object.keys(g.players).length * g.settings.coinsPerPlayer;
      for (const t of Object.values(g.teams)) {
        const prep = t.decisions.prep ?? DEFAULT_DECISIONS.prep;
        t.launchedAt = prep === "now" ? now : null;
        t.lastSharedAt = null;
        t.shares = [];
      }
      this.launchDueTeams(now);
    } else if (phase === "REVEAL") {
      if (g.phase !== "MARKET") throw new GameError("WRONG_PHASE", "Reveal comes after the market");
      g.phase = "REVEAL";
      g.phaseStartedAt = now;
      g.phaseEndsAt = null;
      g.timerExpired = true;
      g.revealStep = 0;
    }
    this.changed();
  }

  private clearRound() {
    const g = this.game;
    for (const t of Object.values(g.teams)) {
      t.decisions = { goal: null, rewards: null, network: null, prep: null, pitch: "" };
      t.lockedIn = false;
      t.launchedAt = null;
      t.lastSharedAt = null;
      t.shares = [];
    }
    for (const p of Object.values(g.players)) p.sharedTeamId = null;
    g.pledges = {};
    g.totalCoins = null;
    g.marketOpenedAt = null;
    g.revealStep = 0;
  }

  /** Back to the lobby, keeping players but clearing decisions and pledges. */
  backToLobby(now: number) {
    const g = this.game;
    this.clearRound();
    g.phase = "LOBBY";
    g.phaseStartedAt = now;
    g.phaseEndsAt = null;
    g.timerExpired = false;
    for (const p of Object.values(g.players)) p.late = false;
    this.changed();
  }

  /** Full reset: new game, no players, same settings. */
  reset(now: number) {
    const settings = this.game.settings;
    this.game = createGame(settings, now);
    this.changed();
  }

  autoLockTeams() {
    for (const t of Object.values(this.game.teams)) {
      if (t.lockedIn) continue;
      const d = t.decisions;
      d.goal = d.goal ?? DEFAULT_DECISIONS.goal;
      d.rewards = d.rewards ?? DEFAULT_DECISIONS.rewards;
      d.network = d.network ?? DEFAULT_DECISIONS.network;
      d.prep = d.prep ?? DEFAULT_DECISIONS.prep;
      if (!d.pitch.trim()) d.pitch = CASE_BY_ID[t.caseId].blurb.slice(0, CONFIG.pitchMaxLength);
      t.lockedIn = true;
    }
  }

  addTime(seconds: number) {
    const g = this.game;
    if (g.phaseEndsAt == null) throw new GameError("WRONG_PHASE", "No timer running");
    const s = Math.round(Number(seconds));
    if (!Number.isFinite(s)) throw new GameError("INVALID");
    g.phaseEndsAt = Math.max(Date.now(), g.phaseEndsAt) + s * 1000;
    if (g.phaseEndsAt > Date.now()) g.timerExpired = false;
    this.changed();
  }

  setRevealStep(step: number) {
    const g = this.game;
    if (g.phase !== "REVEAL") throw new GameError("WRONG_PHASE");
    const max = Object.keys(g.teams).length + 3;
    g.revealStep = Math.max(0, Math.min(max, Math.round(Number(step)) || 0));
    this.changed();
  }

  kick(playerId: PlayerId, now: number) {
    this.player(playerId);
    this.removePlayer(playerId, now);
  }

  addBots(count: number, now: number): Player[] {
    const g = this.game;
    if (g.phase === "REVEAL") throw new GameError("WRONG_PHASE");
    const n = Math.max(0, Math.min(60, Math.round(Number(count)) || 0));
    const teamIds = sortTeamIds(Object.keys(g.teams));
    const existingBots = Object.values(g.players).filter((p) => p.isBot).length;
    const added: Player[] = [];
    for (let i = 0; i < n; i++) {
      const idx = existingBots + i;
      const name = `Bot ${BOT_NAMES[idx % BOT_NAMES.length]}${idx >= BOT_NAMES.length ? " " + (Math.floor(idx / BOT_NAMES.length) + 1) : ""}`;
      // Fill the emptiest team first so humans' teams also get members; skip full ones.
      const open = teamIds.filter((id) => !teamIsFull(g, id));
      if (!open.length) break;
      const counts = open.map((id) => playersOfTeam(g, id).length);
      const min = Math.min(...counts);
      const teamId = open[counts.indexOf(min)];
      const p = this.join({ name, teamId, playerId: `bot-${randomUUID()}` }, now + i, true);
      added.push(p);
    }
    return added;
  }

  removeBots(now: number) {
    const bots = Object.values(this.game.players).filter((p) => p.isBot);
    for (const b of bots) this.removePlayer(b.id, now);
    this.changed();
  }

  // ---------- timer tick ----------

  /** Called every 250 ms by the server. Returns true if state changed. */
  tick(now: number): boolean {
    const g = this.game;
    let changed = false;

    if (g.phaseEndsAt != null && !g.timerExpired && now >= g.phaseEndsAt) {
      g.timerExpired = true;
      if (g.phase === "BUILD") this.autoLockTeams();
      changed = true;
    }

    if (g.phase === "MARKET" && this.launchDueTeams(now)) changed = true;

    if (g.phase === "BUILD" && !g.timerExpired) {
      for (const t of Object.values(g.teams)) {
        const cap = t.captainId ? g.players[t.captainId] : undefined;
        if (cap && !cap.connected && now - cap.lastSeen > CONFIG.captainTimeoutMs) {
          const members = playersOfTeam(g, t.id).filter((m) => m.id !== cap.id && (m.connected || m.isBot));
          const pick = this.pickCaptain(members, now);
          if (pick) {
            this.setCaptain(t.id, pick.id);
            changed = true;
          }
        }
      }
    }

    if (changed) this.changed();
    return changed;
  }

  /** Unlocks audience-building campaigns whose delay has passed. Returns true if any launched. */
  private launchDueTeams(now: number): boolean {
    const g = this.game;
    let any = false;
    for (const t of Object.values(g.teams)) {
      if (t.launchedAt != null) continue;
      const at = launchesAt(t, g);
      if (at != null && now >= at) {
        t.launchedAt = at;
        any = true;
      }
    }
    return any;
  }
}

const BOT_NAMES = [
  "Ada", "Ben", "Cleo", "Dev", "Emma", "Finn", "Gus", "Hana", "Ivo", "Juno",
  "Kai", "Lena", "Milo", "Nia", "Otto", "Pia", "Quin", "Rosa", "Sam", "Tess",
  "Uli", "Vera", "Wim", "Xia", "Yuki", "Zed", "Ana", "Bram", "Cor", "Dana",
];
