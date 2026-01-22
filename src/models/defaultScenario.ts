import type { Scenario } from "./types";

export const defaultScenario: Scenario = {
  name: "Base Case",
  headings: 4,
  shiftsPerDay: 3,
  advancePerRoundM: 4.0,

  policy: "IMMEDIATE",

  reEntryDelayMin: 30,
  blastLockoutMin: 60,

  stages: [
    { id: "drill", name: "Drill", durationMin: 180 },
    { id: "charge", name: "Charge", durationMin: 60 },
    { id: "blast", name: "Blast", durationMin: 1, isBlast: true },
    { id: "muck", name: "Muck", durationMin: 240 },
    { id: "support", name: "Support", durationMin: 120 },
  ],
};
