import { CONFIG } from "./config";
import { CASE_BY_ID, OBJECTIVE_LABEL } from "./cases";
import type {
  Badge,
  CampaignResult,
  DecisionField,
  Decisions,
  Game,
  GoalLevel,
  InvestorBreakdown,
  InvestorResult,
  Lesson,
  NetworkChoice,
  Player,
  PlayerId,
  PrepChoice,
  Results,
  RewardsLevel,
  Settings,
  Team,
  TeamId,
} from "./types";

export const DEFAULT_DECISIONS: {
  goal: GoalLevel;
  rewards: RewardsLevel;
  network: NetworkChoice;
  prep: PrepChoice;
} = {
  goal: "low",
  rewards: "modest",
  network: "back",
  prep: "now",
};

export function teamNumber(teamId: TeamId): number {
  return parseInt(teamId.replace(/^t/, ""), 10) || 0;
}

export function sortTeamIds(ids: TeamId[]): TeamId[] {
  return [...ids].sort((a, b) => teamNumber(a) - teamNumber(b));
}

/** Number of coins in play: fixed at market open, otherwise a live estimate. */
export function estimateTotalCoins(game: Game): number {
  if (game.totalCoins != null) return game.totalCoins;
  return Object.keys(game.players).length * game.settings.coinsPerPlayer;
}

export function goalCoins(level: GoalLevel, totalCoins: number, settings: Settings): number {
  return Math.ceil(settings.goalFractions[level] * totalCoins);
}

export function goalMultiplier(level: GoalLevel, settings: Settings): number {
  return settings.multipliers[level];
}

export function campaignMultiplier(
  level: GoalLevel,
  rewards: RewardsLevel,
  settings: Settings,
): number {
  return goalMultiplier(level, settings) + (rewards === "generous" ? settings.multipliers.generousBonus : 0);
}

export function shareCoinsFor(network: NetworkChoice): number {
  return CONFIG.shareCoins[network];
}

export function resolvedDecisions(d: Decisions, blurb: string): {
  goal: GoalLevel;
  rewards: RewardsLevel;
  network: NetworkChoice;
  prep: PrepChoice;
  pitch: string;
} {
  return {
    goal: d.goal ?? DEFAULT_DECISIONS.goal,
    rewards: d.rewards ?? DEFAULT_DECISIONS.rewards,
    network: d.network ?? DEFAULT_DECISIONS.network,
    prep: d.prep ?? DEFAULT_DECISIONS.prep,
    pitch: d.pitch.trim() || blurb,
  };
}

export function launchesAt(team: Team, game: Game): number | null {
  const prep = team.decisions.prep ?? DEFAULT_DECISIONS.prep;
  if (prep !== "audience" || game.marketOpenedAt == null) return null;
  return game.marketOpenedAt + game.settings.launchDelaySeconds * 1000;
}

export function isLaunched(team: Team, game: Game): boolean {
  if (game.marketOpenedAt == null) return false;
  const prep = team.decisions.prep ?? DEFAULT_DECISIONS.prep;
  if (prep === "now") return true;
  return team.launchedAt != null;
}

/** Milliseconds left on the phase timer, never negative. */
export function remainingMs(game: Game, now: number): number {
  if (game.phaseEndsAt == null) return 0;
  return Math.max(0, game.phaseEndsAt - now);
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function inputsOpen(game: Game, phase: Game["phase"]): boolean {
  return game.phase === phase && !game.timerExpired;
}

export function marketIsOpen(game: Game): boolean {
  return inputsOpen(game, "MARKET");
}

export function totalAlloc(alloc: Record<TeamId, number>): number {
  return Object.values(alloc).reduce((a, b) => a + (b || 0), 0);
}

export function teamIsFull(game: Game, teamId: TeamId): boolean {
  const max = game.settings.maxPerTeam || 0;
  return max > 0 && playersOfTeam(game, teamId).length >= max;
}

export function playersOfTeam(game: Game, teamId: TeamId): Player[] {
  return Object.values(game.players)
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

/**
 * The single source of truth for every number on every screen. Pure: the
 * server, the phones, the host console and the big screen all call it with
 * the same state and the same `now` and therefore agree.
 */
export function computeResults(game: Game, now: number): Results {
  const s = game.settings;
  const totalCoins = estimateTotalCoins(game);
  const campaignOrder = sortTeamIds(Object.keys(game.teams));
  const marketOpened = game.marketOpenedAt != null;
  const campaigns: Record<TeamId, CampaignResult> = {};

  for (const teamId of campaignOrder) {
    const team = game.teams[teamId];
    const c = CASE_BY_ID[team.caseId];
    const d = resolvedDecisions(team.decisions, c.blurb);
    const goal = goalCoins(d.goal, totalCoins, s);
    const launched = isLaunched(team, game);
    const launchAt = launchesAt(team, game);
    const shares = team.shares.length;
    const shareCoins = shares * shareCoinsFor(d.network);
    const prePledge = d.prep === "audience" && launched ? Math.ceil(s.prePledgeFraction * goal) : 0;

    let placed = 0;
    let own = 0;
    const backerSet = new Set<PlayerId>();
    for (const pledge of Object.values(game.pledges)) {
      const coins = pledge.alloc[teamId] || 0;
      if (coins <= 0) continue;
      const player = game.players[pledge.playerId];
      if (!player) continue;
      placed += coins;
      if (player.teamId === teamId) own += coins;
      else backerSet.add(player.id);
    }
    const raised = placed + shareCoins + prePledge;
    const external = raised - own;
    const backers = backerSet.size;
    const funded = marketOpened && goal > 0 && raised >= goal;
    const rewardCost = s.rewardCost[d.rewards];
    const net = funded ? Math.round(raised * (1 - rewardCost)) : 0;
    const ownSharePct = raised > 0 ? Math.round((100 * own) / raised) : 0;

    let score = 0;
    if (funded) {
      if (c.objective === "capital") score = net;
      else if (c.objective === "validation") score = external;
      else score = CONFIG.marketingWeights.backer * backers + CONFIG.marketingWeights.share * shares;
    }

    const pinCandidates: number[] = [];
    if (d.prep === "audience" && team.launchedAt != null) pinCandidates.push(team.launchedAt);
    if (team.lastSharedAt != null) pinCandidates.push(team.lastSharedAt);
    const pinnedUntil = pinCandidates.length ? Math.max(...pinCandidates) + s.pinSeconds * 1000 : null;
    const pinned = pinnedUntil != null && now < pinnedUntil && game.phase === "MARKET";
    const isNew =
      d.prep === "audience" && team.launchedAt != null && now < team.launchedAt + s.pinSeconds * 1000;

    const badges: Badge[] = [];
    if (d.prep === "audience" && launched) badges.push("Video");
    if (d.rewards === "generous") badges.push("Top rewards");
    if (d.network === "share") badges.push("Spread the word");
    if (isNew && game.phase === "MARKET") badges.push("New");

    const sharedBy = team.shares
      .map((pid) => game.players[pid]?.name)
      .filter((n): n is string => !!n);

    campaigns[teamId] = {
      teamId,
      teamNumber: teamNumber(teamId),
      caseId: c.id,
      name: c.name,
      blurb: c.blurb,
      pitch: d.pitch,
      objective: c.objective,
      objectiveText: c.objectiveText,
      goalLevel: d.goal,
      rewardsLevel: d.rewards,
      network: d.network,
      prep: d.prep,
      goal,
      multiplier: campaignMultiplier(d.goal, d.rewards, s),
      rewardCost,
      launched,
      launchesAt: launchAt,
      pinnedUntil,
      pinned,
      isNew,
      badges,
      shares,
      sharedBy,
      shareCoins,
      prePledge,
      placed,
      raised,
      own,
      external,
      backers,
      funded,
      net,
      ownSharePct,
      score,
      progress: goal > 0 ? raised / goal : 0,
    };
  }

  const teamLeaderboard = [...campaignOrder].sort((a, b) => {
    const ca = campaigns[a];
    const cb = campaigns[b];
    if (cb.score !== ca.score) return cb.score - ca.score;
    if (cb.raised !== ca.raised) return cb.raised - ca.raised;
    return ca.teamNumber - cb.teamNumber;
  });
  const teamRank: Record<TeamId, number> = {};
  teamLeaderboard.forEach((id, i) => (teamRank[id] = i + 1));

  const investors: Record<PlayerId, InvestorResult> = {};
  for (const player of Object.values(game.players)) {
    const pledge = game.pledges[player.id];
    const breakdown: InvestorBreakdown[] = [];
    let ret = 0;
    let coinsPlaced = 0;
    let coinsEarning = 0;
    if (pledge) {
      for (const teamId of campaignOrder) {
        const coins = pledge.alloc[teamId] || 0;
        if (coins <= 0) continue;
        const camp = campaigns[teamId];
        const isOwn = player.teamId === teamId;
        const multiplier = camp.funded && !isOwn ? camp.multiplier : 0;
        const r = coins * multiplier;
        ret += r;
        coinsPlaced += coins;
        if (multiplier > 0) coinsEarning += coins;
        breakdown.push({
          teamId,
          campaignName: camp.name,
          coins,
          funded: camp.funded,
          multiplier,
          ret: r,
          own: isOwn,
        });
      }
    }
    investors[player.id] = {
      playerId: player.id,
      name: player.name,
      teamId: player.teamId,
      isBot: player.isBot,
      ret: Math.round(ret * 10) / 10,
      coinsPlaced,
      coinsWasted: s.coinsPerPlayer - coinsEarning,
      breakdown,
      rank: 0,
    };
  }
  const investorLeaderboard = Object.keys(investors).sort((a, b) => {
    const ia = investors[a];
    const ib = investors[b];
    if (ib.ret !== ia.ret) return ib.ret - ia.ret;
    if (ia.coinsWasted !== ib.coinsWasted) return ia.coinsWasted - ib.coinsWasted;
    const pa = game.players[a];
    const pb = game.players[b];
    if (pa.isBot !== pb.isBot) return pa.isBot ? 1 : -1;
    return pa.joinedAt - pb.joinedAt;
  });
  investorLeaderboard.forEach((id, i) => (investors[id].rank = i + 1));

  const lessons = pickLessons(campaigns, campaignOrder, marketOpened);

  return {
    totalCoins,
    campaigns,
    campaignOrder,
    teamLeaderboard,
    teamRank,
    investors,
    investorLeaderboard,
    lessons,
  };
}

function pickLessons(
  campaigns: Record<TeamId, CampaignResult>,
  order: TeamId[],
  marketOpened: boolean,
): Lesson[] {
  const lessons: Lesson[] = [];
  if (!marketOpened) return lessons;
  const all = order.map((id) => campaigns[id]);

  // Lesson 1: funded campaign with the highest own share (>= 50%).
  const fundedByOwn = all
    .filter((c) => c.funded && c.ownSharePct >= 50)
    .sort((a, b) => b.ownSharePct - a.ownSharePct);
  if (fundedByOwn.length) {
    const c = fundedByOwn[0];
    lessons.push({
      key: "funded-not-validated",
      title: "Funded, but not validated",
      text: `${c.name} hit its goal, but ${c.ownSharePct}% came from its own team.`,
      teamId: c.teamId,
    });
  }

  // Lesson 2: the narrowest miss, or the High goal that got funded.
  const misses = all
    .filter((c) => !c.funded && c.raised > 0)
    .sort((a, b) => a.goal - a.raised - (b.goal - b.raised));
  const fundedHigh = all
    .filter((c) => c.funded && c.goalLevel === "high")
    .sort((a, b) => b.raised - a.raised);
  if (misses.length) {
    const c = misses[0];
    lessons.push({
      key: "goal-decides",
      title: "The goal decides everything",
      text: `${c.name} raised ${c.raised} of ${c.goal} coins and walks away with nothing.`,
      teamId: c.teamId,
    });
  } else if (fundedHigh.length) {
    const c = fundedHigh[0];
    lessons.push({
      key: "goal-decides",
      title: "The goal decides everything",
      text: `${c.name} dared to set a High goal of ${c.goal}, hit it, and pays backers ${c.multiplier.toFixed(1)}×.`,
      teamId: c.teamId,
    });
  }
  return lessons;
}

/** Card order for phones and the big screen: pinned first, then by team number. */
export function orderedCampaigns(results: Results): CampaignResult[] {
  const list = results.campaignOrder.map((id) => results.campaigns[id]);
  return list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) return (b.pinnedUntil ?? 0) - (a.pinnedUntil ?? 0);
    return a.teamNumber - b.teamNumber;
  });
}

export function objectiveLabel(c: CampaignResult): string {
  return OBJECTIVE_LABEL[c.objective];
}

/** Total reveal steps on the big screen: one per campaign, then 3 summary steps. */
export function revealStepCount(game: Game): number {
  return Object.keys(game.teams).length + 3;
}

export interface RevealView {
  campaignsRevealed: number;
  showTeamBoard: boolean;
  showInvestors: boolean;
  showLessons: boolean;
  done: boolean;
}

export function revealView(game: Game): RevealView {
  const n = Object.keys(game.teams).length;
  const step = game.revealStep;
  return {
    campaignsRevealed: Math.min(n, step),
    showTeamBoard: step >= n + 1,
    showInvestors: step >= n + 2,
    showLessons: step >= n + 3,
    done: step >= n + 3,
  };
}

/** Colour-coded summary of a campaign's four strategy choices, used on every screen. */
export type StrategyTone =
  | "goal-low" | "goal-medium" | "goal-high"
  | "rewards-modest" | "rewards-generous"
  | "network-back" | "network-share"
  | "prep-now" | "prep-audience";

export interface StrategyChip {
  key: "goal" | "rewards" | "network" | "prep";
  tone: StrategyTone;
  label: string;
  short: string;
}

export function strategyChips(c: {
  goalLevel: GoalLevel;
  rewardsLevel: RewardsLevel;
  network: NetworkChoice;
  prep: PrepChoice;
  multiplier: number;
  launched?: boolean;
}): StrategyChip[] {
  const goalWord = { low: "Low", medium: "Medium", high: "High" }[c.goalLevel];
  return [
    { key: "goal", tone: `goal-${c.goalLevel}`, label: `${goalWord} goal · ${c.multiplier.toFixed(1)}×`, short: `${goalWord} · ${c.multiplier.toFixed(1)}×` },
    c.rewardsLevel === "generous"
      ? { key: "rewards", tone: "rewards-generous", label: "Top rewards", short: "Top rewards" }
      : { key: "rewards", tone: "rewards-modest", label: "Modest rewards", short: "Modest" },
    c.network === "share"
      ? { key: "network", tone: "network-share", label: "Spread the word", short: "Share" }
      : { key: "network", tone: "network-back", label: "Friends back", short: "Back" },
    c.prep === "audience"
      ? { key: "prep", tone: "prep-audience", label: c.launched === false ? "Building audience" : "Video", short: "Video" }
      : { key: "prep", tone: "prep-now", label: "Launched now", short: "Now" },
  ];
}

/** The tone for a single decision value, for colouring option buttons while deciding. */
export function decisionTone(field: DecisionField, value: string | null): StrategyTone | null {
  if (!value) return null;
  return `${field}-${value}` as StrategyTone;
}
