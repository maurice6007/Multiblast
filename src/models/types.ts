// src/models/types.ts

export type ShiftPolicy = "END_OF_SHIFT_ONLY" | "IMMEDIATE";

export type StageId = string;

export interface Stage {
  id: StageId;
  name: string;
  durationMin: number;
  /** True if this stage represents a blast event (useful for safety/lockout logic). */
  isBlast?: boolean;
}

export interface Scenario {
  name: string;

  /** Number of headings/faces working in parallel. */
  headings: number;

  /** Scheduled shifts per day (e.g., 3). */
  shiftsPerDay: number;

  /** Advance per completed round (metres). */
  advancePerRoundM: number;

  /** How/when work is allowed to start relative to shift boundaries. */
  policy: ShiftPolicy;

  /** Time after a blast before re-entry is allowed (minutes). */
  reEntryDelayMin: number;

  /** Additional blast lockout window (minutes). */
  blastLockoutMin: number;

  /** Ordered list of cycle stages (drill → charge → blast → muck → support, etc.). */
  stages: Stage[];
}
