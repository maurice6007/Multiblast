// src/models/defaultScenario.ts

export type BlastTiming = "midshift" | "endOfShift";

export interface Resources {
  drillRigs: number;
  lhds: number;
  supportCrews: number;
  blastCrews: number;
}

export interface Scenario {
  simDays: number;
  tickMin: number;
  headings: number;
  metresPerRound: number;

  shift: {
    shiftDurationMin: number;        // workable minutes
    blastTiming: BlastTiming;
    scheduledShiftMin?: number;      // total scheduled shift length (workable + change window)
  };

  durations: {
    drill: number;
    charge: number;
    muck: number;
    support?: number;               // OPTIONAL support stage
  };

  resources?: Resources;            // OPTIONAL resource constraints

  support?: {
    jumboBolting?: boolean;         // OPTIONAL toggle
  };
}
