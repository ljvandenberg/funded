import { describe, expect, it } from "vitest";
import { computeResults, goalCoins, orderedCampaigns, revealView } from "./compute";
import { defaultSettings, makeGame, makePlayer } from "./testUtils";
import type { Game } from "./types";

const T0 = 1_000_000;

/** Market game with 4 teams, 4 players (20 coins), all campaigns launched now. */
function marketGame(): Game {
  const g = makeGame({ phase: "MARKET", marketOpenedAt: T0, phaseStartedAt: T0, phaseEndsAt: T0 + 180_000 });
  for (let i = 1; i <= 4; i++) {
    const pid = `p${i}`;
    g.players[pid] = makePlayer(pid, `t${i}`, { isCaptain: true, name: `Player ${i}` });
    g.teams[`t${i}`].captainId = pid;
    g.teams[`t${i}`].launchedAt = T0;
  }
  g.totalCoins = 20;
  return g;
}

describe("goal rounding", () => {
  it("rounds goals up", () => {
    const s = defaultSettings();
    expect(goalCoins("low", 165, s)).toBe(15);
    expect(goalCoins("medium", 165, s)).toBe(25);
    expect(goalCoins("high", 165, s)).toBe(40);
    expect(goalCoins("low", 20, s)).toBe(2);
    expect(goalCoins("medium", 20, s)).toBe(3);
    expect(goalCoins("high", 20, s)).toBe(5);
  });

  it("uses a live estimate before the market opens", () => {
    const g = makeGame();
    g.players.a = makePlayer("a", "t1");
    g.players.b = makePlayer("b", "t1");
    const r = computeResults(g, T0);
    expect(r.totalCoins).toBe(10);
    expect(r.campaigns.t1.goal).toBe(1); // ceil(0.09 * 10)
  });
});

describe("raising and funding", () => {
  it("raised == goal is funded; one short is not", () => {
    const g = marketGame();
    g.teams.t1.decisions.goal = "medium"; // 3 coins
    g.pledges.p2 = { playerId: "p2", alloc: { t1: 3 }, updatedAt: T0 };
    let r = computeResults(g, T0);
    expect(r.campaigns.t1.raised).toBe(3);
    expect(r.campaigns.t1.funded).toBe(true);

    g.pledges.p2.alloc.t1 = 2;
    r = computeResults(g, T0);
    expect(r.campaigns.t1.funded).toBe(false);
    expect(r.campaigns.t1.net).toBe(0);
    expect(r.campaigns.t1.score).toBe(0);
  });

  it("separates own and external coins and counts backers from other teams only", () => {
    const g = marketGame();
    g.players.p5 = makePlayer("p5", "t1");
    g.pledges.p1 = { playerId: "p1", alloc: { t1: 2 }, updatedAt: T0 }; // own
    g.pledges.p5 = { playerId: "p5", alloc: { t1: 1 }, updatedAt: T0 }; // own
    g.pledges.p2 = { playerId: "p2", alloc: { t1: 2 }, updatedAt: T0 };
    g.pledges.p3 = { playerId: "p3", alloc: { t1: 1 }, updatedAt: T0 };
    const c = computeResults(g, T0).campaigns.t1;
    expect(c.placed).toBe(6);
    expect(c.own).toBe(3);
    expect(c.external).toBe(3);
    expect(c.backers).toBe(2);
    expect(c.ownSharePct).toBe(50);
  });

  it("adds share coins (1× or 2×) and pre-pledges", () => {
    const g = marketGame();
    g.teams.t1.shares = ["p2", "p3"];
    g.teams.t1.decisions.network = "back";
    expect(computeResults(g, T0).campaigns.t1.shareCoins).toBe(2);
    g.teams.t1.decisions.network = "share";
    expect(computeResults(g, T0).campaigns.t1.shareCoins).toBe(4);

    g.teams.t2.decisions.prep = "audience";
    g.teams.t2.decisions.goal = "high"; // 5
    g.teams.t2.launchedAt = null;
    let c2 = computeResults(g, T0).campaigns.t2;
    expect(c2.launched).toBe(false);
    expect(c2.prePledge).toBe(0);
    expect(c2.launchesAt).toBe(T0 + 40_000);
    g.teams.t2.launchedAt = T0 + 40_000;
    c2 = computeResults(g, T0 + 41_000).campaigns.t2;
    expect(c2.launched).toBe(true);
    expect(c2.prePledge).toBe(1); // ceil(0.2 * 5)
    expect(c2.external).toBe(1);
    expect(c2.backers).toBe(0);
    expect(c2.badges).toContain("Video");
    expect(c2.badges).toContain("New");
    expect(c2.pinned).toBe(true);
    expect(computeResults(g, T0 + 80_000).campaigns.t2.pinned).toBe(false);
  });
});

describe("objective scores", () => {
  it("capital scores net after reward costs", () => {
    const g = marketGame(); // t1 = Fuego Fix (capital)
    g.teams.t1.decisions.goal = "low"; // 2
    g.teams.t1.decisions.rewards = "generous";
    g.pledges.p2 = { playerId: "p2", alloc: { t1: 5 }, updatedAt: T0 };
    const c = computeResults(g, T0).campaigns.t1;
    expect(c.objective).toBe("capital");
    expect(c.net).toBe(3); // round(5 * 0.5)
    expect(c.score).toBe(3);
  });

  it("validation scores external coins only", () => {
    const g = marketGame(); // t2 = Cheese & Boom (validation)
    g.teams.t2.decisions.goal = "medium"; // 3
    g.pledges.p2 = { playerId: "p2", alloc: { t2: 3 }, updatedAt: T0 }; // own
    g.pledges.p1 = { playerId: "p1", alloc: { t2: 2 }, updatedAt: T0 };
    const c = computeResults(g, T0).campaigns.t2;
    expect(c.objective).toBe("validation");
    expect(c.funded).toBe(true);
    expect(c.score).toBe(2);
  });

  it("marketing scores 2×backers + 3×shares", () => {
    const g = marketGame(); // t4 = Still Water (marketing)
    g.teams.t4.decisions.goal = "low"; // 2
    g.teams.t4.shares = ["p1"];
    g.pledges.p2 = { playerId: "p2", alloc: { t4: 1 }, updatedAt: T0 };
    g.pledges.p3 = { playerId: "p3", alloc: { t4: 1 }, updatedAt: T0 };
    const c = computeResults(g, T0).campaigns.t4;
    expect(c.objective).toBe("marketing");
    expect(c.raised).toBe(3);
    expect(c.score).toBe(2 * 2 + 3 * 1);
  });
});

describe("investor returns", () => {
  it("pays goal multiplier plus generous bonus, 0 on own campaign, 0 when not funded", () => {
    const g = marketGame();
    g.teams.t1.decisions.goal = "high"; // 5, 2.0×
    g.teams.t1.decisions.rewards = "generous"; // +0.5
    g.teams.t2.decisions.goal = "low"; // 2, 1.0×
    g.teams.t3.decisions.goal = "medium"; // 3, 1.5× (will not be funded)
    g.pledges.p2 = { playerId: "p2", alloc: { t1: 3, t2: 2 }, updatedAt: T0 }; // t2 is own
    g.pledges.p3 = { playerId: "p3", alloc: { t1: 2, t3: 1 }, updatedAt: T0 }; // t3 own & unfunded
    g.pledges.p4 = { playerId: "p4", alloc: { t3: 1 }, updatedAt: T0 };
    const r = computeResults(g, T0);
    expect(r.campaigns.t1.funded).toBe(true);
    expect(r.campaigns.t2.funded).toBe(true);
    expect(r.campaigns.t3.funded).toBe(false);
    expect(r.investors.p2.ret).toBe(7.5); // 3 × 2.5, own campaign 0
    expect(r.investors.p3.ret).toBe(5);
    expect(r.investors.p4.ret).toBe(0);
    expect(r.investors.p4.coinsWasted).toBe(5);
    expect(r.investorLeaderboard[0]).toBe("p2");
    expect(r.investors.p2.rank).toBe(1);
    expect(r.investors.p2.breakdown.find((b) => b.teamId === "t2")?.own).toBe(true);
  });
});

describe("leaderboards and lessons", () => {
  it("ranks teams by score then raised, and picks the two lessons", () => {
    const g = marketGame();
    // t1 Fuego (capital) funded mostly by own team: lesson 1
    g.players.p5 = makePlayer("p5", "t1");
    g.teams.t1.decisions.goal = "medium"; // 3
    g.pledges.p1 = { playerId: "p1", alloc: { t1: 2 }, updatedAt: T0 };
    g.pledges.p5 = { playerId: "p5", alloc: { t1: 1 }, updatedAt: T0 };
    g.pledges.p2 = { playerId: "p2", alloc: { t1: 1, t3: 4 }, updatedAt: T0 };
    // t3 Beacon high goal (5) raises 4: narrow miss, lesson 2
    g.teams.t3.decisions.goal = "high";
    const r = computeResults(g, T0);
    expect(r.campaigns.t1.funded).toBe(true);
    expect(r.campaigns.t1.ownSharePct).toBe(75);
    expect(r.campaigns.t3.funded).toBe(false);
    expect(r.teamLeaderboard[0]).toBe("t1");
    expect(r.lessons.map((l) => l.key)).toEqual(["funded-not-validated", "goal-decides"]);
    expect(r.lessons[0].text).toContain("75%");
    expect(r.lessons[1].text).toContain("raised 4 of 5");
  });

  it("orders pinned cards first", () => {
    const g = marketGame();
    g.teams.t3.lastSharedAt = T0 + 10_000;
    g.teams.t3.shares = ["p1"];
    const order = orderedCampaigns(computeResults(g, T0 + 12_000)).map((c) => c.teamId);
    expect(order[0]).toBe("t3");
    expect(order.slice(1)).toEqual(["t1", "t2", "t4"]);
  });

  it("reveal view follows the step counter", () => {
    const g = marketGame();
    g.phase = "REVEAL";
    g.revealStep = 0;
    expect(revealView(g).campaignsRevealed).toBe(0);
    g.revealStep = 4;
    expect(revealView(g)).toMatchObject({ campaignsRevealed: 4, showTeamBoard: false });
    g.revealStep = 7;
    expect(revealView(g).done).toBe(true);
  });
});
