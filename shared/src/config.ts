/**
 * All tunable numbers of the game live here. Nothing in the components is
 * hardcoded; the server copies these into `game.settings` when a game is
 * created and the host can edit the time/team values in the lobby.
 */
export const CONFIG = {
  coinsPerPlayer: 5,
  buildSeconds: 180,
  marketSeconds: 180,
  launchDelaySeconds: 40,
  pinSeconds: 30,
  prePledgeFraction: 0.2,
  goalFractions: { low: 0.09, medium: 0.15, high: 0.24 },
  rewardCost: { modest: 0.2, generous: 0.5 },
  multipliers: { low: 1.0, medium: 1.5, high: 2.0, generousBonus: 0.5 },
  marketingWeights: { backer: 2, share: 3 },
  sharesPerPlayer: 1,
  /** Virtual coins per share, keyed by the campaign's network choice. */
  shareCoins: { back: 1, share: 2 },
  pitchMaxLength: 100,
  nameMaxLength: 20,
  maxTeams: 8,
  minTeams: 4,
  /** Players per team; 0 means no limit. */
  maxPerTeam: 0,
  defaultTeams: 7,
  captainTimeoutMs: 20000,
  /** How long the big screen shows the "Just launched" banner. */
  launchBannerMs: 5000,
  /** Server-side throttle for full-state broadcasts. */
  broadcastIntervalMs: 100,
  serverTimeIntervalMs: 5000,
  tickIntervalMs: 250,
} as const;

export const ERROR_MESSAGES = {
  OVER_BUDGET: "You have no coins left",
  NO_REFUND: "Placed coins can't be taken back",
  CAMPAIGN_LOCKED: "This campaign hasn't launched yet",
  OWN_NETWORK_SHARE: "Your team chose to share, not to back",
  OWN_CAMPAIGN: "You can't share your own campaign",
  ALREADY_SHARED: "You already used your share",
  MARKET_CLOSED: "Market closed",
  NOT_CAPTAIN: "Only the captain can decide",
  BUILD_CLOSED: "Round 1 is over",
  WRONG_PHASE: "That isn't possible right now",
  NOT_FOUND: "Not found",
  INVALID: "Invalid input",
  NOT_HOST: "Host only",
  BAD_PIN: "Wrong PIN",
  TEAM_FULL: "This team is full",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
