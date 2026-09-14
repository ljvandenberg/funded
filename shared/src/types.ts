export type Phase = "LOBBY" | "BUILD" | "MARKET" | "REVEAL";
export type TeamId = string; // "t1".."t8"
export type PlayerId = string; // uuid

export type GoalLevel = "low" | "medium" | "high";
export type RewardsLevel = "modest" | "generous";
export type NetworkChoice = "back" | "share";
export type PrepChoice = "now" | "audience";
export type Objective = "capital" | "validation" | "marketing";

export type DecisionField = "goal" | "rewards" | "network" | "prep";

export interface Settings {
  teamCount: number; // 4..8
  buildSeconds: number;
  marketSeconds: number;
  launchDelaySeconds: number;
  coinsPerPlayer: number;
  goalFractions: { low: number; medium: number; high: number };
  rewardCost: { modest: number; generous: number };
  multipliers: { low: number; medium: number; high: number; generousBonus: number };
  prePledgeFraction: number;
  pinSeconds: number;
}

export interface Decisions {
  goal: GoalLevel | null;
  rewards: RewardsLevel | null;
  network: NetworkChoice | null;
  prep: PrepChoice | null;
  pitch: string;
}

export interface Team {
  id: TeamId;
  caseId: string;
  captainId: PlayerId | null;
  decisions: Decisions;
  lockedIn: boolean;
  /** Set when an audience-building campaign unlocks (or at market open for "launch now"). */
  launchedAt: number | null;
  /** Drives the 30 s pin after a share. */
  lastSharedAt: number | null;
  /** Players from other teams who shared this campaign. */
  shares: PlayerId[];
}

export interface Player {
  id: PlayerId;
  name: string;
  teamId: TeamId;
  isCaptain: boolean;
  isBot: boolean;
  connected: boolean;
  lastSeen: number;
  joinedAt: number;
  late: boolean;
  /** The one campaign this player shared, if any. */
  sharedTeamId: TeamId | null;
}

export interface Pledge {
  playerId: PlayerId;
  alloc: Record<TeamId, number>;
  updatedAt: number;
}

export interface Game {
  id: string;
  createdAt: number;
  phase: Phase;
  phaseStartedAt: number | null;
  phaseEndsAt: number | null; // epoch ms, server clock
  /** True once the phase timer ran out; inputs are locked, phase stays. */
  timerExpired: boolean;
  marketOpenedAt: number | null;
  settings: Settings;
  /** Fixed at the moment the market opens. */
  totalCoins: number | null;
  players: Record<PlayerId, Player>;
  teams: Record<TeamId, Team>;
  pledges: Record<PlayerId, Pledge>;
  /** Big-screen reveal sequence. 0 = nothing revealed yet. */
  revealStep: number;
}

export interface Case {
  id: string;
  name: string;
  blurb: string;
  objective: Objective;
  objectiveText: string;
}

export type Badge = "Video" | "Top rewards" | "Spread the word" | "New";

export interface CampaignResult {
  teamId: TeamId;
  teamNumber: number;
  caseId: string;
  name: string;
  blurb: string;
  pitch: string;
  objective: Objective;
  objectiveText: string;
  goalLevel: GoalLevel;
  rewardsLevel: RewardsLevel;
  network: NetworkChoice;
  prep: PrepChoice;
  goal: number;
  /** Investor multiplier if funded (goal multiplier + generous bonus). */
  multiplier: number;
  rewardCost: number;
  launched: boolean;
  launchesAt: number | null;
  pinnedUntil: number | null;
  pinned: boolean;
  isNew: boolean;
  badges: Badge[];
  shares: number;
  sharedBy: string[];
  shareCoins: number;
  prePledge: number;
  placed: number;
  raised: number;
  own: number;
  external: number;
  backers: number;
  funded: boolean;
  net: number;
  ownSharePct: number;
  score: number;
  progress: number; // raised / goal, may exceed 1
}

export interface InvestorBreakdown {
  teamId: TeamId;
  campaignName: string;
  coins: number;
  funded: boolean;
  multiplier: number;
  ret: number;
  own: boolean;
}

export interface InvestorResult {
  playerId: PlayerId;
  name: string;
  teamId: TeamId;
  isBot: boolean;
  ret: number;
  coinsPlaced: number;
  coinsWasted: number;
  breakdown: InvestorBreakdown[];
  rank: number;
}

export interface Lesson {
  key: "funded-not-validated" | "goal-decides";
  title: string;
  text: string;
  teamId: TeamId;
}

export interface Results {
  totalCoins: number;
  campaigns: Record<TeamId, CampaignResult>;
  campaignOrder: TeamId[];
  teamLeaderboard: TeamId[];
  teamRank: Record<TeamId, number>;
  investors: Record<PlayerId, InvestorResult>;
  investorLeaderboard: PlayerId[];
  lessons: Lesson[];
}

export interface AckOk {
  ok: true;
  playerId?: PlayerId;
}
export interface AckErr {
  ok: false;
  code: string;
  message: string;
}
export type Ack = AckOk | AckErr;
