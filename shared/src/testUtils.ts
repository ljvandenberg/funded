import { CONFIG } from "./config";
import { caseForTeamNumber } from "./cases";
import type { Game, Player, Settings, Team, TeamId } from "./types";

export function defaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    teamCount: CONFIG.defaultTeams,
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

export function makePlayer(id: string, teamId: TeamId, extra: Partial<Player> = {}): Player {
  return {
    id,
    name: id,
    teamId,
    isCaptain: false,
    isBot: false,
    connected: true,
    lastSeen: 0,
    joinedAt: 0,
    late: false,
    sharedTeamId: null,
    ...extra,
  };
}

export function makeGame(overrides: Partial<Game> = {}, teamCount = 4): Game {
  return {
    id: "test",
    createdAt: 0,
    phase: "LOBBY",
    phaseStartedAt: null,
    phaseEndsAt: null,
    timerExpired: false,
    marketOpenedAt: null,
    settings: defaultSettings({ teamCount }),
    totalCoins: null,
    players: {},
    teams: makeTeams(teamCount),
    pledges: {},
    revealStep: 0,
    ...overrides,
  };
}
