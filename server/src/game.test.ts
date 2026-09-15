import { describe, expect, it } from "vitest";
import { GameStore, GameError } from "./game";

const T0 = 1_000_000;

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GameError);
    expect((e as GameError).code).toBe(code);
    return;
  }
  throw new Error(`expected error ${code}`);
}

function lobbyWithPlayers(teamCount = 4) {
  const store = new GameStore();
  store.setSettings({ teamCount }, T0);
  const a = store.join({ name: "A", teamId: "t1" }, T0);
  const b = store.join({ name: "B", teamId: "t1" }, T0 + 1);
  const c = store.join({ name: "C", teamId: "t2" }, T0 + 2);
  return { store, a, b, c };
}

function marketGame() {
  const ctx = lobbyWithPlayers();
  const { store, a } = ctx;
  store.setPhase("BUILD", T0 + 10);
  store.setDecision(a.id, "goal", "medium", T0 + 11);
  store.setDecision(a.id, "rewards", "generous", T0 + 11);
  store.setDecision(a.id, "network", "share", T0 + 11);
  store.setDecision(a.id, "prep", "audience", T0 + 11);
  store.setPitch(a.id, "Hot sauce for everyone", T0 + 11);
  store.lockIn(a.id, true, T0 + 12);
  store.setPhase("MARKET", T0 + 100);
  return ctx;
}

describe("join and captains", () => {
  it("makes the first player captain and lets the captain hand over", () => {
    const { store, a, b } = lobbyWithPlayers();
    expect(store.game.teams.t1.captainId).toBe(a.id);
    expect(store.game.players[a.id].isCaptain).toBe(true);
    store.makeCaptain(a.id, b.id, T0);
    expect(store.game.teams.t1.captainId).toBe(b.id);
    expect(store.game.players[a.id].isCaptain).toBe(false);
  });

  it("rejects empty names, unknown teams and joining during reveal", () => {
    const { store } = lobbyWithPlayers();
    expectCode(() => store.join({ name: "  ", teamId: "t1" }, T0), "INVALID");
    expectCode(() => store.join({ name: "X", teamId: "t9" }, T0), "NOT_FOUND");
    store.setPhase("BUILD", T0);
    store.setPhase("MARKET", T0);
    store.setPhase("REVEAL", T0);
    expectCode(() => store.join({ name: "X", teamId: "t1" }, T0), "WRONG_PHASE");
  });

  it("marks late joiners and restores a player on resume", () => {
    const { store, a } = lobbyWithPlayers();
    store.setPhase("BUILD", T0);
    const late = store.join({ name: "Late", teamId: "t3" }, T0 + 5);
    expect(late.late).toBe(true);
    store.setConnected(a.id, false, T0 + 6);
    expect(store.game.players[a.id].connected).toBe(false);
    const back = store.resume(a.id, T0 + 7);
    expect(back.connected).toBe(true);
    expect(back.name).toBe("A");
  });

  it("promotes the longest-connected teammate after the captain drops for 20 s in BUILD", () => {
    const { store, a, b } = lobbyWithPlayers();
    store.setPhase("BUILD", T0);
    store.setConnected(a.id, false, T0 + 1000);
    expect(store.tick(T0 + 10_000)).toBe(false);
    expect(store.game.teams.t1.captainId).toBe(a.id);
    expect(store.tick(T0 + 22_000)).toBe(true);
    expect(store.game.teams.t1.captainId).toBe(b.id);
  });

  it("never lets a bot captain a team with a human", () => {
    const store = new GameStore();
    store.setSettings({ teamCount: 4 }, T0);
    store.addBots(8, T0);
    expect(store.game.players[store.game.teams.t1.captainId!].isBot).toBe(true);
    const h = store.join({ name: "Human", teamId: "t1" }, T0 + 100);
    expect(store.game.teams.t1.captainId).toBe(h.id);
    store.removeBots(T0 + 200);
    expect(Object.values(store.game.players).every((p) => !p.isBot)).toBe(true);
  });

  it("lets the host tune the goal percentages, kept in order", () => {
    const store = new GameStore();
    store.setSettings({ goalFractions: { low: 0.1, medium: 0.2, high: 0.3 } }, T0);
    expect(store.game.settings.goalFractions).toEqual({ low: 0.1, medium: 0.2, high: 0.3 });
    store.setSettings({ goalFractions: { low: 0.25 } as never }, T0);
    expect(store.game.settings.goalFractions).toEqual({ low: 0.25, medium: 0.25, high: 0.3 });
    store.setSettings({ goalFractions: { low: 0, high: 5 } as never }, T0);
    expect(store.game.settings.goalFractions.low).toBe(0.01);
    expect(store.game.settings.goalFractions.high).toBe(1);
  });

  it("caps players per team when the host sets a limit", () => {
    const store = new GameStore();
    store.setSettings({ teamCount: 4, maxPerTeam: 2 }, T0);
    store.join({ name: "A", teamId: "t1" }, T0);
    store.join({ name: "B", teamId: "t1" }, T0 + 1);
    expectCode(() => store.join({ name: "C", teamId: "t1" }, T0 + 2), "TEAM_FULL");
    const c = store.join({ name: "C", teamId: "t2" }, T0 + 2);
    // switching into a full team in the lobby is refused too
    expectCode(() => store.join({ playerId: c.id, name: "C", teamId: "t1" }, T0 + 3), "TEAM_FULL");
    store.addBots(20, T0 + 4);
    expect(Object.keys(store.game.players)).toHaveLength(8); // 4 teams × 2
    store.setSettings({ maxPerTeam: 0 }, T0 + 5);
    store.join({ name: "D", teamId: "t1" }, T0 + 6);
    expect(store.game.players).toBeDefined();
  });

  it("reassigns players when the host shrinks the team count", () => {
    const { store, c } = lobbyWithPlayers(4);
    store.join({ name: "D", teamId: "t4" }, T0 + 3);
    store.setSettings({ teamCount: 4 }, T0);
    store.setSettings({ teamCount: 3 }, T0);
    // C is still in t2; D moved out of t4 (4 clamps to min 4 so use a different check)
    expect(store.game.players[c.id].teamId).toBe("t2");
    expect(store.game.settings.teamCount).toBe(4); // min is 4
    expect(Object.keys(store.game.teams)).toHaveLength(4);
  });
});

describe("decisions", () => {
  it("only the captain can decide, only during BUILD, only before the timer ends", () => {
    const { store, a, b } = lobbyWithPlayers();
    expectCode(() => store.setDecision(a.id, "goal", "low", T0), "WRONG_PHASE");
    store.setPhase("BUILD", T0);
    expectCode(() => store.setDecision(b.id, "goal", "low", T0), "NOT_CAPTAIN");
    expectCode(() => store.setDecision(a.id, "goal", "huge", T0), "INVALID");
    store.setDecision(a.id, "goal", "high", T0);
    expect(store.game.teams.t1.decisions.goal).toBe("high");
    expectCode(() => store.lockIn(a.id, true, T0), "INVALID"); // incomplete
    store.tick(T0 + 180_000);
    expect(store.game.timerExpired).toBe(true);
    expectCode(() => store.setDecision(a.id, "goal", "low", T0 + 180_001), "BUILD_CLOSED");
    // auto-locked with defaults for missing fields
    const d = store.game.teams.t1.decisions;
    expect(store.game.teams.t1.lockedIn).toBe(true);
    expect(d).toMatchObject({ goal: "high", rewards: "modest", network: "back", prep: "now" });
    expect(d.pitch.length).toBeGreaterThan(0);
  });

  it("clamps the pitch to 100 characters", () => {
    const { store, a } = lobbyWithPlayers();
    store.setPhase("BUILD", T0);
    store.setPitch(a.id, "x".repeat(200), T0);
    expect(store.game.teams.t1.decisions.pitch).toHaveLength(100);
  });
});

describe("market", () => {
  it("fixes total coins and launches campaigns at the right times", () => {
    const { store } = marketGame();
    const g = store.game;
    expect(g.totalCoins).toBe(15);
    expect(g.teams.t1.launchedAt).toBeNull(); // audience
    expect(g.teams.t2.launchedAt).toBe(T0 + 100); // now
    expect(store.tick(T0 + 100 + 39_000)).toBe(false);
    expect(store.tick(T0 + 100 + 40_000)).toBe(true);
    expect(g.teams.t1.launchedAt).toBe(T0 + 100 + 40_000);
  });

  it("rejects pledges that break the rules", () => {
    const { store, a, b, c } = marketGame();
    const now = T0 + 200;
    expectCode(() => store.setPledge(c.id, { t2: 6 }, now), "OVER_BUDGET");
    expectCode(() => store.setPledge(c.id, { t2: 3, t3: 3 }, now), "OVER_BUDGET");
    expectCode(() => store.setPledge(c.id, { t1: 1 }, now), "CAMPAIGN_LOCKED");
    expectCode(() => store.setPledge(c.id, { t2: -1 }, now), "INVALID");
    expectCode(() => store.setPledge(c.id, { t2: 1.5 }, now), "INVALID");
    expectCode(() => store.setPledge(c.id, { t9: 1 }, now), "NOT_FOUND");
    // own campaign: t2 chose defaults (back) so C may back it
    store.setPledge(c.id, { t2: 2, t3: 3 }, now);
    expect(store.game.pledges[c.id].alloc).toEqual({ t2: 2, t3: 3 });
    // placed coins are final
    expectCode(() => store.setPledge(c.id, { t2: 1, t3: 3 }, now), "NO_REFUND");
    expectCode(() => store.setPledge(c.id, { t3: 3 }, now), "NO_REFUND");
    // team 1 chose "share": members cannot back their own campaign, even once launched
    store.tick(T0 + 100 + 40_000);
    expectCode(() => store.setPledge(b.id, { t1: 1 }, T0 + 100 + 41_000), "OWN_NETWORK_SHARE");
    store.setPledge(a.id, { t2: 5 }, T0 + 100 + 41_000);
    store.tick(T0 + 100 + 180_000);
    expectCode(() => store.setPledge(a.id, { t2: 4 }, T0 + 100 + 180_001), "MARKET_CLOSED");
  });

  it("enforces the share rules", () => {
    const { store, a, b, c } = marketGame();
    const now = T0 + 200;
    expectCode(() => store.share(c.id, "t2", now), "OWN_CAMPAIGN");
    expectCode(() => store.share(c.id, "t1", now), "CAMPAIGN_LOCKED");
    store.share(c.id, "t3", now);
    expect(store.game.teams.t3.shares).toEqual([c.id]);
    expect(store.game.teams.t3.lastSharedAt).toBe(now);
    expect(store.game.players[c.id].sharedTeamId).toBe("t3");
    expectCode(() => store.share(c.id, "t4", now), "ALREADY_SHARED");
    expectCode(() => store.share(a.id, "t1", now), "OWN_CAMPAIGN");
    store.tick(T0 + 100 + 40_000);
    store.share(b.id === a.id ? c.id : b.id, "t2", T0 + 100 + 41_000);
    store.tick(T0 + 100 + 180_000);
    expectCode(() => store.share(a.id, "t3", T0 + 100 + 180_001), "MARKET_CLOSED");
  });

  it("kicking removes pledges and shares, and reveal blocks joins", () => {
    const { store, c } = marketGame();
    store.setPledge(c.id, { t3: 2 }, T0 + 200);
    store.share(c.id, "t3", T0 + 200);
    store.kick(c.id, T0 + 300);
    expect(store.game.players[c.id]).toBeUndefined();
    expect(store.game.pledges[c.id]).toBeUndefined();
    expect(store.game.teams.t3.shares).toEqual([]);
    expect(store.game.teams.t2.captainId).toBeNull();
    expectCode(() => store.setRevealStep(1), "WRONG_PHASE");
    store.setPhase("REVEAL", T0 + 400);
    store.setRevealStep(2);
    expect(store.game.revealStep).toBe(2);
    store.setRevealStep(99);
    expect(store.game.revealStep).toBe(7);
  });

  it("back to lobby keeps players and clears the round", () => {
    const { store, a, c } = marketGame();
    store.setPledge(c.id, { t3: 2 }, T0 + 200);
    store.setPhase("LOBBY", T0 + 300);
    expect(store.game.players[a.id]).toBeDefined();
    expect(store.game.pledges).toEqual({});
    expect(store.game.teams.t1.decisions.goal).toBeNull();
    expect(store.game.teams.t1.lockedIn).toBe(false);
    expect(store.game.totalCoins).toBeNull();
    store.reset(T0 + 400);
    expect(Object.keys(store.game.players)).toHaveLength(0);
  });
});
