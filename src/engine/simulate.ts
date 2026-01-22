import type { Scenario, SimulationResult, Stage, StageRun } from "../models/types";

export interface SimulateOptions {
  simDays: number;
  hoursPerShift?: number;
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
    return (d + 1) * MIN_PER_DAY + shiftMinutes;
  }

  const si = shiftIndexWithinDay(w, shiftMinutes);
  return d * MIN_PER_DAY + (si + 1) * shiftMinutes;
}
function nextShiftBoundary(tMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  const d = dayIndex(tMin);
  const w = withinDay(tMin);

  if (!isWithinScheduledShifts(w, shiftMinutes, shiftsPerDay)) {
    return (d + 1) * MIN_PER_DAY;
  }

  const si = shiftIndexWithinDay(w, shiftMinutes);
  const start = d * MIN_PER_DAY + si * shiftMinutes;

  if (tMin === start) return tMin;

  const next = start + shiftMinutes;
  if (withinDay(next) >= shiftsPerDay * shiftMinutes) {
    return (d + 1) * MIN_PER_DAY;
  }
  return next;
}
function normalizeToWorkingTime(tMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  const d = dayIndex(tMin);
  const w = withinDay(tMin);
  if (isWithinScheduledShifts(w, shiftMinutes, shiftsPerDay)) return tMin;
  return (d + 1) * MIN_PER_DAY;
}
function fitStageIntoShift(tMin: number, durationMin: number, shiftMinutes: number, shiftsPerDay: number): number {
  tMin = normalizeToWorkingTime(tMin, shiftMinutes, shiftsPerDay);
  const end = tMin + durationMin;
  const shiftEnd = shiftEndTime(tMin, shiftMinutes, shiftsPerDay);
  if (end <= shiftEnd) return tMin;
  return nextShiftBoundary(shiftEnd, shiftMinutes, shiftsPerDay);
}
function applyPolicyRoundStart(tProposed: number, scenario: Scenario, shiftMinutes: number): number {
  if (scenario.policy !== "END_OF_SHIFT_ONLY") return tProposed;
  const t = normalizeToWorkingTime(tProposed, shiftMinutes, scenario.shiftsPerDay);
  return nextShiftBoundary(t, shiftMinutes, scenario.shiftsPerDay);
}

/** ✅ Named export (this is what App.tsx imports) */
export function simulateScenario(scenario: Scenario, options: SimulateOptions): SimulationResult {
  assertScenario(scenario);

  const simDays = options.simDays;
  if (!Number.isFinite(simDays) || simDays <= 0) throw new Error("options.simDays must be > 0");

  const hoursPerShift = options.hoursPerShift ?? 8;
  if (!Number.isFinite(hoursPerShift) || hoursPerShift <= 0) throw new Error("options.hoursPerShift must be > 0");

  const recordRuns = options.recordRuns ?? true;

  const horizonMin = simDays * MIN_PER_DAY;
  const shiftMinutes = hoursPerShift * MIN_PER_HOUR;

  const headingTime: number[] = Array.from({ length: scenario.headings }, () => 0);
  const headingReentryAllowedAt: number[] = Array.from({ length: scenario.headings }, () => 0);

  const runs: StageRun[] = [];
  const roundDur = totalRoundDuration(scenario.stages);
  let roundsCompletedTotal = 0;

  for (let h = 0; h < scenario.headings; h++) {
    let roundIndex = 0;

    while (true) {
      let t = Math.max(headingTime[h], headingReentryAllowedAt[h]);
      t = applyPolicyRoundStart(t, scenario, shiftMinutes);

      if (t >= horizonMin) break;
      if (t + roundDur > horizonMin) break;

      for (const st of scenario.stages) {
        t = Math.max(t, headingReentryAllowedAt[h]);

        if (scenario.policy === "END_OF_SHIFT_ONLY") {
          t = fitStageIntoShift(t, st.durationMin, shiftMinutes, scenario.shiftsPerDay);
        }

        const startMin = t;
        const endMin = startMin + st.durationMin;

        if (endMin > horizonMin) {
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

  const availableMinPerHeading = simDays * scenario.shiftsPerDay * shiftMinutes;
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
