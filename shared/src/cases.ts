import type { Case, Objective } from "./types";

export const CASES: Case[] = [
  {
    id: "fuego",
    name: "Fuego Fix",
    blurb:
      "Small-batch hot sauce from Rotterdam, three flavours, currently made in a rented kitchen.",
    objective: "capital",
    objectiveText: "You need cash for a production kitchen and food-safety certification.",
    scoreOn: "Net coins after reward costs",
  },
  {
    id: "cheese",
    name: "Cheese & Boom",
    blurb:
      "Party board game with 200 questions about the Netherlands. Prototype tested at one birthday party.",
    objective: "validation",
    objectiveText: "You need to know if strangers would buy this.",
    scoreOn: "Coins from outside your own team",
  },
  {
    id: "beacon",
    name: "Beacon",
    blurb:
      "Magnetic bike light that clicks on in one second. Works, but only friends have used it.",
    objective: "validation",
    objectiveText: "You need to know if strangers would buy this.",
    scoreOn: "Coins from outside your own team",
  },
  {
    id: "stillwater",
    name: "Still Water",
    blurb:
      "Documentary about the Wadden Sea at night. Shooting is done, edit needs finishing.",
    objective: "marketing",
    objectiveText: "You need an audience for the release.",
    scoreOn: "Reach: different backers + shares",
  },
  {
    id: "grow",
    name: "Grow",
    blurb: "Smart plant pot that waters itself. Working prototype, no factory yet.",
    objective: "capital",
    objectiveText: "You need money for the first production run.",
    scoreOn: "Net coins after reward costs",
  },
  {
    id: "beanpost",
    name: "Beanpost",
    blurb: "Coffee subscription from small roasters, one new roaster every month.",
    objective: "marketing",
    objectiveText: "You need awareness, not money.",
    scoreOn: "Reach: different backers + shares",
  },
  {
    id: "chatter",
    name: "Chatter",
    blurb: "App that teaches Dutch through real street conversations. Beta with 40 users.",
    objective: "validation",
    objectiveText: "You need to know if strangers, not just your 40 beta users, would pay for this.",
    scoreOn: "Coins from outside your own team",
  },
  {
    id: "cloudlet",
    name: "Cloudlet",
    blurb: "Kids' night light that projects a starry sky. Sells at two local shops.",
    objective: "capital",
    objectiveText: "You need cash to produce enough stock for more shops.",
    scoreOn: "Net coins after reward costs",
  },
];

export const CASE_BY_ID: Record<string, Case> = Object.fromEntries(
  CASES.map((c) => [c.id, c]),
);

export function caseForTeamNumber(n: number): Case {
  return CASES[(n - 1) % CASES.length];
}

export const OBJECTIVE_LABEL: Record<Objective, string> = {
  capital: "Capital",
  validation: "Validation",
  marketing: "Marketing",
};

export const OBJECTIVE_SHORT: Record<Objective, string> = {
  capital: "Net coins after reward costs",
  validation: "Coins from outside the team",
  marketing: "2 × backers + 3 × shares",
};
