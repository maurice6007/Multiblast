// src/models/defaultScenario.ts

export type BlastTiming = "midshift" | "endOfShift";

export interface Scenario {
  simDays: number;
  tickMin: number;

  headings: number;
  metresPerRound: number;

  shift: {
    shiftDurationMin: number;
    blastTiming: BlastTiming;
  };

  durations: {
    drill: number;
    charge: number;
    muck: number;
  };
}

export const defaultScenario: Scenario = {
  simDays: 30,
  tickMin: 5,

  headings: 2,
  metresPerRound: 3.8,

  shift: {
    shiftDurationMin: 720,
    blastTiming: "endOfShift",
  },

  durations: {
    drill: 180,
    charge: 60,
    muck: 240,
  },
};
