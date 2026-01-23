// src/engine/simulate.ts
import type { Scenario, SimulationResult, Stage, StageRun } from "../models/types";

export interface SimulateOptions {
  /** Simulation horizon in days. Deterministic: same inputs => same outputs. */
  simDays: number;

  /** Scheduled hours per shift. Default 8. */
  hoursPerShift?: number;

  /** If true, record every StageRun event. Default true. */
  recordRuns?: boolean;
}

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;

function assertScenario(s: Scenario): void {
  if (!s.name) throw new Error("Scenario.name is required");
  if (!Number.isFinite(s.headings) || s.headings <= 0) throw new Error("Scenario.headings must be > 0");
  if (!Number.isFinite(s.shiftsPerDay) || s.shiftsPerDay <= 0) throw new Error("Scenario.shiftsPerDay must be > 0");
  if (!Number.isFinite(s.advancePerRoundM) || s.advancePerRoundM <= 0) throw new Error("Scenario.advancePerRoundM must be > 0");
  if (!Array.isArray(s.stages) || s.stages.length === 0) throw new Error("Scenario.stages must be a non-empty array");
  for (const st of s.stages) {
    if (!st.id) throw new Error("Stage.id is required");
    if (!st.name) throw new Error("Stage.name is required");
    if (!Number.isFinite(st.durationMin) || st.durationMin <= 0) {
      throw new Error(`Stage.durationMin must be > 0 (stage ${st.id})`);
    }
  }
  if (!Number.isFinite(s.reEntryDelayMin) || s.reEntryDelayMin < 0) throw new Error("Scenario.reEntryDelayMin must be >= 0");
  if (!Number.isFinite(s.blastLockoutMin) || s.blastLockoutMin < 0) throw new Error("Scenario.blastLockoutMin must be >= 0");
}

function totalRoundDuration(stages: Stage[]): number {
  return stages.reduce((sum, st) => sum + st.durationMin, 0);
}

/**
 * Shift calendar helpers:
 * - Shifts start at day boundary (t=0) and repeat each day.
 * - Within a day, shifts occupy [0, shiftsPerDay*shiftMinutes). Any remaining time is off-shift.
 */
function dayIndex(tMin: number): number {
  return Math.floor(tMin / MIN_PER_DAY);
}

function withinDay(tMin: number): number {
  return tMin - dayIndex(tMin) * MIN_PER_DAY;
}

function shiftIndexWithinDay(within: number, shiftMinutes: number): number {
  return Math.floor(within / shiftMinutes);
}

function isWithinScheduledShifts(within: number, shiftMinutes: number, shiftsPerDay: number): boolean {
  return within >= 0 && within < shiftsPerDay * shiftMinutes;
}

function shiftEndTime(tMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  const d = dayIndex(tMin);
  const w = withinDay(tMin);

  if (!isWithinScheduledShifts(w, shiftMinutes, shiftsPerDay)) {
    // If outside scheduled shifts, "end" is next day's first shift end (we won't work here anyway)
    return (d + 1) * MIN_PER_DAY + shiftMinutes;
  }

  const si = shiftIndexWithinDay(w, shiftMinutes);
  return d * MIN_PER_DAY + (si + 1) * shiftMinutes;
}

/** Next shift boundary at or after tMin (if already on boundary, returns tMin). */
function nextShiftBoundary(tMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  const d = dayIndex(tMin);
  const w = withinDay(tMin);

  // Outside scheduled shifts => next day's first shift start
  if (!isWithinScheduledShifts(w, shiftMinutes, shiftsPerDay)) {
    return (d + 1) * MIN_PER_DAY;
  }

  const si = shiftIndexWithinDay(w, shiftMinutes);
  const start = d * MIN_PER_DAY + si * shiftMinutes;

  if (tMin === start) return tMin;

  const next = start + shiftMinutes;
  // If next boundary exceeds the last scheduled shift, jump to next day
  if (withinDay(next) >= shiftsPerDay * shiftMinutes) {
    return (d + 1) * MIN_PER_DAY;
  }
  return next;
}

/** If tMin is in off-shift, push to next day's first shift start. */
function normalizeToWorkingTime(tMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  const d = dayIndex(tMin);
  const w = withinDay(tMin);

  if (isWithinScheduledShifts(w, shiftMinutes, shiftsPerDay)) return tMin;

  return (d + 1) * MIN_PER_DAY;
}

/**
 * Fit a stage start into the current shift:
 * - If stage fits fully before shift end, keep tMin.
 * - Otherwise defer stage to the next shift boundary (no partial-stage work).
 *
 * Works for BOTH policies (Option 1): work only occurs during scheduled shifts.
 */
function fitStageIntoShift(
  tMin: number,
  durationMin: number,
  shiftMinutes: number,
  shiftsPerDay: number
): number {
  tMin = normalizeToWorkingTime(tMin, shiftMinutes, shiftsPerDay);
  const end = tMin + durationMin;
  const shiftEnd = shiftEndTime(tMin, shiftMinutes, shiftsPerDay);

  if (end <= shiftEnd) return tMin;

  // Defer whole stage to next shift boundary
  return nextShiftBoundary(shiftEnd, shiftMinutes, shiftsPerDay);
}

/**
 * Policy meaning (Option 1):
 * - END_OF_SHIFT_ONLY: rounds can only start at shift boundary.
 * - IMMEDIATE: rounds can start any time within working time.
 * Both policies: work only during scheduled shifts.
 */
function roundStartTime(tProposed: number, scenario: Scenario, shiftMinutes: number): number {
  const tWorking = normalizeToWorkingTime(tProposed, shiftMinutes, scenario.shiftsPerDay);

  if (scenario.policy === "END_OF_SHIFT_ONLY") {
    return nextShiftBoundary(tWorking, shiftMinutes, scenario.shiftsPerDay);
  }

  // IMMEDIATE (within shifts)
  return tWorking;
}

/** ✅ Named export (this is what App/UI imports) */
export function simulateScenario(scenario: Scenario, options: SimulateOptions): SimulationResult {
  assertScenario(scenario);

  const simDays = options.simDays;
  if (!Number.isFinite(simDays) || simDays <= 0) throw new Error("options.simDays must be > 0");

  const hoursPerShift = options.hoursPerShift ?? 8;
  if (!Number.isFinite(hoursPerShift) || hoursPerShift <= 0) throw new Error("options.hoursPerShift must be > 0");

  const recordRuns = options.recordRuns ?? true;

  const horizonMin = simDays * MIN_PER_DAY;
  const shiftMinutes = hoursPerShift * MIN_PER_HOUR;

  // Per heading clock + blast constraint
  const headingTime: number[] = Array.from({ length: scenario.headings }, () => 0);
  const headingReentryAllowedAt: number[] = Array.from({ length: scenario.headings }, () => 0);

  const runs: StageRun[] = [];

  const roundDur = totalRoundDuration(scenario.stages);
  let roundsCompletedTotal = 0;

  for (let h = 0; h < scenario.headings; h++) {
    let roundIndex = 0;

    while (true) {
      // Earliest possible time considering lockouts
      let t = Math.max(headingTime[h], headingReentryAllowedAt[h]);

      // ✅ Option 1: Always respect shift schedule; policy only affects *how* we pick the start time.
      t = roundStartTime(t, scenario, shiftMinutes);

      // Stop if we can't start within horizon
      if (t >= horizonMin) break;

      // Conservative: if the full round can't fit in remaining horizon, stop
      if (t + roundDur > horizonMin) break;

      // Execute stages sequentially
      for (const st of scenario.stages) {
        // Respect blast lockouts
        t = Math.max(t, headingReentryAllowedAt[h]);

        // ✅ Option 1: Both policies only work during scheduled shifts
        // and stages cannot straddle shift end (defer whole stage).
        t = fitStageIntoShift(t, st.durationMin, shiftMinutes, scenario.shiftsPerDay);

        const startMin = t;
        const endMin = startMin + st.durationMin;

        if (endMin > horizonMin) {
          // No partials
          t = horizonMin;
          break;
        }

        if (recordRuns) {
          runs.push({
            headingIndex: h,
            roundIndex,
            stageId: st.id,
            stageName: st.name,
            startMin,
            endMin,
            meta: st.isBlast ? { isBlast: true } : undefined,
          });
        }

        if (st.isBlast) {
          const lockout = scenario.reEntryDelayMin + scenario.blastLockoutMin;
          headingReentryAllowedAt[h] = Math.max(headingReentryAllowedAt[h], endMin + lockout);
        }

        t = endMin;
      }

      // Round completed
      headingTime[h] = t;
      roundsCompletedTotal += 1;
      roundIndex += 1;
    }
  }

  const roundsCompletedPerHeading = roundsCompletedTotal / scenario.headings;
  const metresAdvancedTotal = roundsCompletedTotal * scenario.advancePerRoundM;
  const metresAdvancedPerHeading = metresAdvancedTotal / scenario.headings;

  const roundsPerDayTotal = roundsCompletedTotal / simDays;
  const metresPerDayTotal = metresAdvancedTotal / simDays;

  // Available time per heading is only the scheduled shift minutes (not full 24h if off-shift exists)
  const availableMinPerHeading = simDays * scenario.shiftsPerDay * shiftMinutes;

  // Busy time approximated as (rounds per heading) * (sum stage durations)
  const busyMinPerHeading = roundsCompletedPerHeading * roundDur;

  const headingUtilization =
    availableMinPerHeading > 0 ? Math.min(1, Math.max(0, busyMinPerHeading / availableMinPerHeading)) : 0;

  return {
    scenarioName: scenario.name,
    policy: scenario.policy,
    minutesPerDay: MIN_PER_DAY,
    shiftMinutes,
    runs,
    kpis: {
      simDays,
      roundsCompletedTotal,
      roundsCompletedPerHeading,
      metresAdvancedTotal,
      metresAdvancedPerHeading,
      roundsPerDayTotal,
      metresPerDayTotal,
      headingUtilization,
    },
  };
}
