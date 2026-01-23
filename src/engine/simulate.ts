// src/engine/simulate.ts
// Deterministic shift-aware, blast-lockout-aware simulator with shared (contention) resources.
// Resources are shared across headings and cannot work simultaneously on multiple headings.

export type Policy = "END_OF_SHIFT_ONLY" | "IMMEDIATE";

export interface Stage {
  id: string;
  name: string;
  durationMin: number;
  isBlast?: boolean;

  /**
   * Optional explicit resource mapping. If omitted, we infer from stage.id:
   *  - contains "DRILL"  -> DRILL_RIG
   *  - contains "MUCK"   -> LHD
   *  - contains "CHARGE" -> CHARGING_CREW
   */
  resourceKey?: ResourceKey;
}

export interface Scenario {
  name: string;
  policy: Policy;

  headings: number;
  shiftsPerDay: number;
  advancePerRoundM: number;

  reEntryDelayMin: number;
  blastLockoutMin: number;

  stages: Stage[];
}

export interface StageRun {
  headingIndex: number;
  roundIndex: number;
  stageId: string;
  stageName: string;
  startMin: number;
  endMin: number;
  meta?: { isBlast?: boolean; resourceKey?: ResourceKey; resourceUnitIndex?: number };
}

export interface ResourceUtilization {
  resourceKey: ResourceKey;
  units: number;
  busyMin: number;
  availableMin: number;
  utilization: number; // 0..1
}

export interface SimulationResult {
  scenarioName: string;
  policy: Policy;
  minutesPerDay: number;
  shiftMinutes: number;
  runs: StageRun[];
  resourceUtilization: ResourceUtilization[];
  kpis: {
    simDays: number;

    roundsCompletedTotal: number;
    roundsCompletedPerHeading: number;

    metresAdvancedTotal: number;
    metresAdvancedPerHeading: number;

    roundsPerDayTotal: number;
    metresPerDayTotal: number;

    headingUtilization: number; // average across headings based on scheduled minutes
  };
}

export type ResourceKey =
  | "DRILL_RIG"
  | "LHD"
  | "CHARGING_CREW"
  | "SUPPORT_CREW";


export interface SimulateOptions {
  /** Simulation horizon in days. Deterministic: same inputs => same outputs. */
  simDays: number;

  /** Scheduled hours per shift. Default 8. */
  hoursPerShift?: number;

  /** If true, record every StageRun event. Default true. */
  recordRuns?: boolean;

  /**
   * Shared resources across headings. If a stage requires a resource and capacity is missing/0, we throw.
   * Stages infer requirements by stage.id unless stage.resourceKey is set explicitly.
   */
  resources?: {
  drillRigs?: number;
  lhds?: number;
  chargingCrews?: number;
  supportCrews?: number;
};

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
 * Policy meaning:
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

// ---------------- Resource mapping + pool ----------------

function inferResourceKey(stageId: string): ResourceKey | null {
  const s = stageId.toUpperCase();
  if (s.includes("DRILL")) return "DRILL_RIG";
  if (s.includes("MUCK") || s.includes("LHD")) return "LHD";
  if (s.includes("CHARGE")) return "CHARGING_CREW";
  if (s.includes("SUPPORT") || s.includes("BOLT") || s.includes("SHOT")) return "SUPPORT_CREW";
  return null;
}


function getStageResourceKey(stage: Stage): ResourceKey | null {
  if (stage.resourceKey === "DRILL_RIG" || stage.resourceKey === "LHD" || stage.resourceKey === "CHARGING_CREW") {
    return stage.resourceKey;
  }
  return inferResourceKey(String(stage.id ?? ""));
}

function getCapacityFor(key: ResourceKey, options: SimulateOptions): number {
  const r = options.resources ?? {};

  if (key === "DRILL_RIG") return r.drillRigs ?? 0;
  if (key === "LHD") return r.lhds ?? 0;
  if (key === "CHARGING_CREW") return r.chargingCrews ?? 0;
  if (key === "SUPPORT_CREW") return r.supportCrews ?? 0;

  return 0;
}



type Pool = { key: ResourceKey; avail: number[]; busyMin: number };

function ensurePool(pools: Map<ResourceKey, Pool>, key: ResourceKey, options: SimulateOptions) {
  if (pools.has(key)) return;
  const cap = getCapacityFor(key, options);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(
      `No capacity provided for resource ${key}. Set options.resources (e.g., drillRigs/lhds/chargingCrews).`
    );
  }
  pools.set(key, { key, avail: Array.from({ length: cap }, () => 0), busyMin: 0 });
}

function allocate(pools: Map<ResourceKey, Pool>, key: ResourceKey, options: SimulateOptions, earliest: number) {
  ensurePool(pools, key, options);
  const pool = pools.get(key)!;

  // choose unit that becomes available soonest (deterministic)
  let bestIdx = 0;
  let bestAvail = pool.avail[0];

  for (let i = 1; i < pool.avail.length; i++) {
    if (pool.avail[i] < bestAvail) {
      bestAvail = pool.avail[i];
      bestIdx = i;
    }
  }

  return { start: Math.max(earliest, bestAvail), unitIndex: bestIdx };
}

function release(pools: Map<ResourceKey, Pool>, key: ResourceKey, unitIndex: number, end: number, busyAdded: number) {
  const pool = pools.get(key)!;
  pool.avail[unitIndex] = end;
  pool.busyMin += busyAdded;
}

// ---------------- Main simulate ----------------

/** Named export (UI imports this) */
export function simulateScenario(scenario: Scenario, options: SimulateOptions): SimulationResult {
  assertScenario(scenario);

  const simDays = options.simDays;
  if (!Number.isFinite(simDays) || simDays <= 0) throw new Error("options.simDays must be > 0");

  const hoursPerShift = options.hoursPerShift ?? 8;
  if (!Number.isFinite(hoursPerShift) || hoursPerShift <= 0) throw new Error("options.hoursPerShift must be > 0");

  const recordRuns = options.recordRuns ?? true;

  const horizonMin = simDays * MIN_PER_DAY;
  const shiftMinutes = hoursPerShift * MIN_PER_HOUR;

  const runs: StageRun[] = [];

  const pools = new Map<ResourceKey, Pool>();

  // Per-heading time + blast constraint
  const headingTime: number[] = Array.from({ length: scenario.headings }, () => 0);
  const headingReentryAllowedAt: number[] = Array.from({ length: scenario.headings }, () => 0);

  // Per-heading progress through rounds/stages
  const headingRoundIndex: number[] = Array.from({ length: scenario.headings }, () => 0);
  const headingStageIndex: number[] = Array.from({ length: scenario.headings }, () => 0);

  const roundDur = totalRoundDuration(scenario.stages);
  let roundsCompletedTotal = 0;

  // Global dispatcher loop: always schedule the earliest-feasible next stage across all headings.
  while (true) {
    let best:
      | null
      | {
          headingIndex: number;
          stageIndex: number;
          stage: Stage;
          startMin: number;
          resourceKey: ResourceKey | null;
          resourceUnitIndex?: number;
        } = null;

    for (let h = 0; h < scenario.headings; h++) {
      const si = headingStageIndex[h];
      const st = scenario.stages[si];
      if (!st) continue;

      // Earliest possible time considering lockouts
      let t = Math.max(headingTime[h], headingReentryAllowedAt[h]);

      // Policy applies only at start of a round; otherwise we just normalize to working time.
      if (si === 0) t = roundStartTime(t, scenario, shiftMinutes);
      else t = normalizeToWorkingTime(t, shiftMinutes, scenario.shiftsPerDay);

      if (t >= horizonMin) continue;

      // Resource constraint (if stage requires one)
      const rKey = getStageResourceKey(st);
      let unitIndex: number | undefined = undefined;

      if (rKey) {
        const alloc = allocate(pools, rKey, options, t);
        t = alloc.start;
        unitIndex = alloc.unitIndex;
      }

      // Enforce shift rule: no straddling shift end, no off-shift work
      t = fitStageIntoShift(t, st.durationMin, shiftMinutes, scenario.shiftsPerDay);

      // Check horizon feasibility
      if (t >= horizonMin) continue;
      if (t + st.durationMin > horizonMin) continue;

      if (!best || t < best.startMin) {
        best = {
          headingIndex: h,
          stageIndex: si,
          stage: st,
          startMin: t,
          resourceKey: rKey,
          resourceUnitIndex: unitIndex,
        };
      }
    }

    if (!best) break;

    const h = best.headingIndex;
    const st = best.stage;
    const startMin = best.startMin;
    const endMin = startMin + st.durationMin;

    if (recordRuns) {
      runs.push({
        headingIndex: h,
        roundIndex: headingRoundIndex[h],
        stageId: st.id,
        stageName: st.name,
        startMin,
        endMin,
        meta: {
          isBlast: !!st.isBlast,
          resourceKey: best.resourceKey ?? undefined,
          resourceUnitIndex: best.resourceUnitIndex,
        },
      });
    }

    // Reserve resource unit until stage completes
    if (best.resourceKey && best.resourceUnitIndex != null) {
      release(pools, best.resourceKey, best.resourceUnitIndex, endMin, st.durationMin);
    }

    // Blast lockout updates
    if (st.isBlast) {
      const lockout = scenario.reEntryDelayMin + scenario.blastLockoutMin;
      headingReentryAllowedAt[h] = Math.max(headingReentryAllowedAt[h], endMin + lockout);
    }

    // Advance heading clocks/progress
    headingTime[h] = endMin;
    headingStageIndex[h] += 1;

    // If completed all stages, round done
    if (headingStageIndex[h] >= scenario.stages.length) {
      headingStageIndex[h] = 0;
      headingRoundIndex[h] += 1;
      roundsCompletedTotal += 1;
    }
  }

  // KPIs
  const roundsCompletedPerHeading = roundsCompletedTotal / scenario.headings;
  const metresAdvancedTotal = roundsCompletedTotal * scenario.advancePerRoundM;
  const metresAdvancedPerHeading = metresAdvancedTotal / scenario.headings;

  const roundsPerDayTotal = roundsCompletedTotal / simDays;
  const metresPerDayTotal = metresAdvancedTotal / simDays;

  // Available time per heading is only scheduled shift minutes
  const availableMinPerHeading = simDays * scenario.shiftsPerDay * shiftMinutes;

  // Busy time per heading (sum of that heading's run durations)
  const busyMinPerHeadingArr: number[] = Array.from({ length: scenario.headings }, () => 0);
  for (const r of runs) {
    const dur = (r.endMin ?? 0) - (r.startMin ?? 0);
    if (dur > 0) busyMinPerHeadingArr[r.headingIndex] += dur;
  }

  const headingUtilization =
    availableMinPerHeading > 0
      ? busyMinPerHeadingArr.reduce((a, b) => a + Math.min(1, Math.max(0, b / availableMinPerHeading)), 0) /
        scenario.headings
      : 0;

  // Resource utilization outputs
  const resourceUtilization: ResourceUtilization[] = Array.from(pools.values()).map((p) => {
    const cap = p.avail.length;
    const availableMinTotal = simDays * scenario.shiftsPerDay * shiftMinutes * cap;
    const util = availableMinTotal > 0 ? Math.min(1, Math.max(0, p.busyMin / availableMinTotal)) : 0;
    return {
      resourceKey: p.key,
      units: cap,
      busyMin: p.busyMin,
      availableMin: availableMinTotal,
      utilization: util,
    };
  });

  return {
    scenarioName: scenario.name,
    policy: scenario.policy,
    minutesPerDay: MIN_PER_DAY,
    shiftMinutes,
    runs,
    resourceUtilization,
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
