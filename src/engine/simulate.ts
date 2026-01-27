// src/engine/simulate.ts
import type { Scenario, BlastTiming, Resources } from "../models/defaultScenario";

/* =========================
   Public exports
   ========================= */

export interface SimulationKpis {
  simDays: number;

  roundsCompletedTotal: number;
  roundsCompletedPerHeading: number;

  metresAdvancedTotal: number;
  metresAdvancedPerHeading: number;

  roundsPerDayTotal: number;
  metresPerDayTotal: number;

  headingUtilization: number; // avg busy fraction per heading
}

export type GanttStage =
  | "DRILL"
  | "CHARGE"
  | "BLAST_READY"
  | "REENTRY"
  | "WAITING_FOR_BLAST"
  | "MUCK"
  | "SUPPORT";

export interface GanttInterval {
  headingId: string;
  stage: GanttStage;
  startMin: number;
  endMin: number;
}

export interface SimulationDetailedResult {
  kpis: SimulationKpis;
  simMinutes: number;
  intervals: GanttInterval[];
}

/** Canonical simulation entry point (new API) */
export function simulate(s: Scenario): SimulationKpis {
  const { kpis } = runEngine(s, { captureTimeline: false });
  return kpis;
}

/** Detailed run (for Gantt/timeline) */
export function simulateDetailed(s: Scenario): SimulationDetailedResult {
  const { kpis, simMinutes, intervals } = runEngine(s, { captureTimeline: true });
  return { kpis, simMinutes, intervals };
}

/**
 * Back-compat wrapper for old UI:
 * - if includeGantt/includeTimeline: return { kpis, simMinutes, intervals }
 * - else return { kpis } so UI can always do result.kpis
 *
 * IMPORTANT:
 * - legacyOptions.hoursPerShift drives scheduled shift length (8h/12h) for end-of-shift blasting logic.
 * - s.shift.shiftDurationMin is workable time before shift change.
 * - shift change window = scheduledShiftMin - shiftDurationMin.
 * - blast crews are consumed by CHARGE; blasting is instantaneous.
 */
export function simulateScenario(legacyScenario: any, legacyOptions?: any): any {
  const normalized = normalizeScenarioForEngine(legacyScenario, legacyOptions);

  if (legacyOptions?.includeGantt || legacyOptions?.includeTimeline) {
    return simulateDetailed(normalized);
  }
  return { kpis: simulate(normalized) };
}

/* =========================
   Internal state
   ========================= */

type Stage = GanttStage;

interface HeadingState {
  id: string;
  stage: Stage;
  remainingMin: number; // countdown for work stages AND gating stages
  busyMin: number;
  roundsCompleted: number;
  metresAdvanced: number;
}

interface RunOptions {
  captureTimeline: boolean;
}

interface RunResult {
  kpis: SimulationKpis;
  simMinutes: number;
  intervals: GanttInterval[];
}

type ResourceKey = keyof Resources;
type ResourcePool = Resources;

const REENTRY_MIN_MIDSHIFT = 30;

/* =========================
   Engine runner
   ========================= */

function runEngine(s: Scenario, opts: RunOptions): RunResult {
  validateScenario(s);

  const simMinutes = s.simDays * 24 * 60;
  const tickMin = s.tickMin;

  const headings: HeadingState[] = Array.from({ length: s.headings }, (_, i) => newHeading(`H${i + 1}`, s));

  // --- timeline capture ---
  const intervals: GanttInterval[] = [];
  const openByHeading = new Map<string, { stage: Stage; startMin: number }>();

  const closeAndOpenIfStageChanged = (h: HeadingState, nowMin: number) => {
    if (!opts.captureTimeline) return;

    const open = openByHeading.get(h.id);
    if (!open) {
      openByHeading.set(h.id, { stage: h.stage, startMin: nowMin });
      return;
    }

    if (open.stage !== h.stage) {
      intervals.push({ headingId: h.id, stage: open.stage, startMin: open.startMin, endMin: nowMin });
      openByHeading.set(h.id, { stage: h.stage, startMin: nowMin });
    }
  };

  if (opts.captureTimeline) {
    for (const h of headings) openByHeading.set(h.id, { stage: h.stage, startMin: 0 });
  }

  for (let nowMin = 0; nowMin < simMinutes; nowMin += tickMin) {
    // reset available resources each tick
    const avail: ResourcePool = makeResourcePool(s);

    // Advance each heading if it can acquire the resource for its current stage
    for (const h of headings) {
      const beforeStage = h.stage;

      advanceHeadingByTick(h, nowMin, tickMin, s, avail);

      if (opts.captureTimeline && h.stage !== beforeStage) {
        // stage change effective end-of-tick
        closeAndOpenIfStageChanged(h, nowMin + tickMin);
      }
    }
  }

  if (opts.captureTimeline) {
    for (const h of headings) {
      const open = openByHeading.get(h.id);
      if (open) intervals.push({ headingId: h.id, stage: open.stage, startMin: open.startMin, endMin: simMinutes });
    }
  }

  const kpis = computeKpis(headings, s, simMinutes);
  assertSimulationProgress(kpis, s);

  return { kpis, simMinutes, intervals };
}

/* =========================
   Core simulation logic (resource-constrained)
   ========================= */

function advanceHeadingByTick(h: HeadingState, nowMin: number, tickMin: number, s: Scenario, avail: ResourcePool): void {
  // Gate stages (no resources)
  if (h.stage === "BLAST_READY") {
    onBlastReady(h, nowMin, tickMin, s);
    return;
  }

  if (h.stage === "REENTRY") {
    if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
    if (h.remainingMin === 0) {
      h.stage = "MUCK";
      h.remainingMin = s.durations.muck;
    }
    return;
  }

  if (h.stage === "WAITING_FOR_BLAST") {
    if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
    if (h.remainingMin === 0) {
      h.stage = "MUCK";
      h.remainingMin = s.durations.muck;
    }
    return;
  }

  // Determine if this stage needs a resource to do work
  const rKey = resourceForWorkStage(h.stage, s);
  const canWorkThisTick = rKey ? tryConsume(avail, rKey) : true;

  if (!canWorkThisTick) return;

  // Work happens this tick
  h.busyMin += tickMin;

  if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
  if (h.remainingMin > 0) return;

  switch (h.stage) {
    case "DRILL":
      h.stage = "CHARGE";
      h.remainingMin = s.durations.charge;
      return;

    case "CHARGE":
      // Charging consumes blast crews. Blast is instantaneous and handled by BLAST_READY gating.
      h.stage = "BLAST_READY";
      h.remainingMin = 0;
      return;

    case "MUCK": {
      const support = Number.isFinite(s.durations.support) ? (s.durations.support as number) : 0;
      if (support > 0) {
        h.stage = "SUPPORT";
        h.remainingMin = support;
      } else {
        completeRound(h, s);
        h.stage = "DRILL";
        h.remainingMin = s.durations.drill;
      }
      return;
    }

    case "SUPPORT":
      completeRound(h, s);
      h.stage = "DRILL";
      h.remainingMin = s.durations.drill;
      return;

    default:
      return;
  }
}

/**
 * BLAST_READY handler.
 * - midshift (ASAP): blast instantaneous → REENTRY(30 min) → MUCK
 * - endOfShift: blast occurs during shift change; re-entry is engulfed by shift change window:
 *      WAITING_FOR_BLAST = scheduledShiftMin - shiftDurationMin
 *
 * End-of-shift modeled as:
 *  - BLAST_READY counts down to workEnd (start of shift change)
 *  - then WAITING_FOR_BLAST counts down to shiftEnd (next shift start) → MUCK
 */
function onBlastReady(h: HeadingState, nowMin: number, tickMin: number, s: Scenario): void {
  if (s.shift.blastTiming === "midshift") {
    h.stage = "REENTRY";
    h.remainingMin = REENTRY_MIN_MIDSHIFT;
    return;
  }

  const { workEnd, shiftEnd } = shiftBoundaries(nowMin, s);

  // If we are already in shift change window, transition to waiting immediately
  if (nowMin >= workEnd) {
    h.stage = "WAITING_FOR_BLAST";
    const effectiveNow = nowMin + tickMin;
    h.remainingMin = Math.max(0, shiftEnd - effectiveNow);
    return;
  }

  // Still in workable time: remain BLAST_READY until shift change starts.
  // Use remainingMin as countdown to workEnd.
  if (h.remainingMin <= 0) {
    h.remainingMin = Math.max(0, workEnd - nowMin);
  } else {
    h.remainingMin = Math.max(0, h.remainingMin - tickMin);
  }

  if (h.remainingMin === 0) {
    h.stage = "WAITING_FOR_BLAST";
    const effectiveNow = nowMin + tickMin;
    h.remainingMin = Math.max(0, shiftEnd - effectiveNow);
  }
}

function completeRound(h: HeadingState, s: Scenario): void {
  h.roundsCompleted += 1;
  h.metresAdvanced += s.metresPerRound;
}

/* =========================
   Resources
   ========================= */

function makeResourcePool(s: Scenario): ResourcePool {
  const r = s.resources ?? {
    drillRigs: s.headings,
    lhds: s.headings,
    supportCrews: s.headings,
    blastCrews: 1,
  };

  return {
    drillRigs: clampNonNegInt(r.drillRigs),
    lhds: clampNonNegInt(r.lhds),
    supportCrews: clampNonNegInt(r.supportCrews),
    blastCrews: clampNonNegInt(r.blastCrews),
  };
}

function clampNonNegInt(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.floor(v));
}

function isJumboBoltingEnabled(s: Scenario): boolean {
  return (s as any)?.support?.jumboBolting === true;
}

function resourceForWorkStage(stage: Stage, s: Scenario): ResourceKey | null {
  switch (stage) {
    case "DRILL":
      return "drillRigs";
    case "CHARGE":
      // blast crews do charging-up
      return "blastCrews";
    case "MUCK":
      return "lhds";
    case "SUPPORT":
      // Jumbo bolting consumes drill rigs; otherwise use dedicated support crews
      return isJumboBoltingEnabled(s) ? "drillRigs" : "supportCrews";
    default:
      return null;
  }
}

function tryConsume(avail: ResourcePool, key: ResourceKey): boolean {
  if (avail[key] <= 0) return false;
  avail[key] -= 1;
  return true;
}

/* =========================
   KPIs
   ========================= */

function computeKpis(headings: HeadingState[], s: Scenario, simMinutes: number): SimulationKpis {
  const totalRounds = headings.reduce((a, h) => a + h.roundsCompleted, 0);
  const totalMetres = headings.reduce((a, h) => a + h.metresAdvanced, 0);

  const roundsPerHeading = totalRounds / s.headings;
  const metresPerHeading = totalMetres / s.headings;

  const roundsPerDayTotal = totalRounds / s.simDays;
  const metresPerDayTotal = totalMetres / s.simDays;

  const utilAvg = headings.reduce((a, h) => a + h.busyMin / simMinutes, 0) / s.headings;

  return {
    simDays: s.simDays,

    roundsCompletedTotal: totalRounds,
    roundsCompletedPerHeading: roundsPerHeading,

    metresAdvancedTotal: totalMetres,
    metresAdvancedPerHeading: metresPerHeading,

    roundsPerDayTotal,
    metresPerDayTotal,

    headingUtilization: utilAvg,
  };
}

/* =========================
   Validation & invariants
   ========================= */

function validateScenario(s: Scenario): void {
  if (!s) throw new Error("Scenario is undefined/null");

  if (!Number.isFinite(s.simDays) || s.simDays <= 0) throw new Error("simDays must be > 0");
  if (!Number.isFinite(s.tickMin) || s.tickMin <= 0) throw new Error("tickMin must be > 0");
  if (!Number.isFinite(s.headings) || s.headings <= 0) throw new Error("headings must be > 0");
  if (!Number.isFinite(s.metresPerRound) || s.metresPerRound <= 0) throw new Error("metresPerRound must be > 0");

  if (!s.shift) throw new Error("shift is missing");
  if (!Number.isFinite(s.shift.shiftDurationMin) || s.shift.shiftDurationMin <= 0) {
    throw new Error("shift.shiftDurationMin must be > 0");
  }
  if (s.shift.blastTiming !== "midshift" && s.shift.blastTiming !== "endOfShift") {
    throw new Error("shift.blastTiming must be 'midshift' or 'endOfShift'");
  }

  const sched = getScheduledShiftMin(s);
  if (!Number.isFinite(sched) || sched <= 0) {
    throw new Error("scheduledShiftMin must be > 0 (via legacyOptions.hoursPerShift)");
  }
  if (s.shift.shiftDurationMin > sched) throw new Error("shiftDurationMin cannot exceed scheduled shift length");

  if (!s.durations) throw new Error("durations is missing");
  if (!Number.isFinite(s.durations.drill)) throw new Error("durations.drill is missing/invalid");
  if (!Number.isFinite(s.durations.charge)) throw new Error("durations.charge is missing/invalid");
  if (!Number.isFinite(s.durations.muck)) throw new Error("durations.muck is missing/invalid");

  if (s.durations.support !== undefined && (!Number.isFinite(s.durations.support) || s.durations.support! < 0)) {
    throw new Error("durations.support must be >= 0 if provided");
  }

  if (s.resources) {
    for (const k of ["drillRigs", "lhds", "supportCrews", "blastCrews"] as const) {
      const v = (s.resources as any)[k];
      if (!Number.isFinite(v) || v < 0) throw new Error(`resources.${k} must be >= 0`);
    }
  }
}

function assertSimulationProgress(kpis: SimulationKpis, s: Scenario): void {
  if (s.simDays >= 1 && kpis.roundsCompletedTotal === 0) {
    throw new Error("Simulation produced zero completed rounds (deadlock).");
  }
}

/* =========================
   Scenario normalization (legacy UI -> engine)
   ========================= */

function normalizeScenarioForEngine(input: any, legacyOptions?: any): Scenario {
  const s = input ?? {};
  const shiftSrc = s.shift ?? s.shifts ?? s.shiftConfig ?? {};
  const durationsSrc = s.durations ?? s.roundDurations ?? s.cycle ?? s.timing ?? {};

  const drill = pickNumber(durationsSrc.drill, s.drill, s.drillMin, s.drillMinutes, s.drillTimeMin) ?? 180;
  const charge = pickNumber(durationsSrc.charge, s.charge, s.chargeMin, s.chargeMinutes, s.chargeTimeMin) ?? 60;
  const muck = pickNumber(durationsSrc.muck, s.muck, s.muckMin, s.muckMinutes, s.muckTimeMin) ?? 240;
  const support = pickNumber(durationsSrc.support, s.support, s.supportMin, s.supportMinutes) ?? 0;

  const rawBlast = shiftSrc.blastTiming ?? s.blastTiming ?? s.blastMode ?? s.blasting ?? s.policy;
  const blastTiming = normalizeBlastTiming(rawBlast);

  const shiftDurationMin =
    pickNumber(shiftSrc.shiftDurationMin, shiftSrc.durationMin, s.shiftDurationMin, s.shiftMin) ??
    (Number.isFinite(s.hoursPerShift) ? Number(s.hoursPerShift) * 60 : 480);

  const headings = pickNumber(s.headings, s.numHeadings, s.activeHeadings) ?? 2;

  const resourcesSrc = s.resources ?? {};
  const resources: Resources = {
    drillRigs: pickNumber(resourcesSrc.drillRigs, s.drillRigs) ?? headings,
    lhds: pickNumber(resourcesSrc.lhds, s.lhds) ?? headings,
    supportCrews: pickNumber(resourcesSrc.supportCrews, s.supportCrews) ?? headings,
    blastCrews: pickNumber(resourcesSrc.blastCrews, s.blastCrews) ?? 1,
  };

  // Scheduled shift length comes from legacyOptions.hoursPerShift (8h / 12h)
  const hoursPerShiftOpt = legacyOptions?.hoursPerShift;
  const scheduledShiftMin =
    Number.isFinite(hoursPerShiftOpt) && Number(hoursPerShiftOpt) > 0
      ? Number(hoursPerShiftOpt) * 60
      : pickNumber(shiftSrc.scheduledShiftMin, s.scheduledShiftMin, s.shiftScheduledMin) ?? shiftDurationMin;

  const shiftObj: any = {
    shiftDurationMin,
    blastTiming,
    scheduledShiftMin,
  };

  const jumboBolting =
    (s.support?.jumboBolting ?? s.jumboBolting ?? s.supportConfig?.jumboBolting ?? false) === true;

  const out: any = {
    simDays: pickNumber(s.simDays, s.days, s.simulationDays) ?? 30,
    tickMin: pickNumber(s.tickMin, s.dtMin, s.timeStepMin, s.stepMin) ?? 5,
    headings,
    metresPerRound: pickNumber(s.metresPerRound, s.advancePerRound, s.advanceM, s.mPerRound) ?? 3.8,

    shift: shiftObj,

    durations: {
      drill,
      charge,
      muck,
      support,
    },

    resources,

    support: {
      jumboBolting,
    },
  };

  return out as Scenario;
}

function pickNumber(...vals: any[]): number | undefined {
  for (const v of vals) {
    if (Number.isFinite(v)) return Number(v);
  }
  return undefined;
}

function normalizeBlastTiming(v: any): BlastTiming {
  if (v === "midshift" || v === "endOfShift") return v;

  if (v === "IMMEDIATE" || v === "immediate") return "midshift";
  if (v === "END_OF_SHIFT_ONLY" || v === "endOfShift") return "endOfShift";
  if (v === "end") return "endOfShift";

  if (v === true) return "midshift";
  if (v === false) return "endOfShift";

  return "endOfShift";
}

/* =========================
   Helpers
   ========================= */

function newHeading(id: string, s: Scenario): HeadingState {
  return {
    id,
    stage: "DRILL",
    remainingMin: s.durations.drill,
    busyMin: 0,
    roundsCompleted: 0,
    metresAdvanced: 0,
  };
}

function getScheduledShiftMin(s: Scenario): number {
  const v = (s.shift as any).scheduledShiftMin;
  if (!Number.isFinite(v) || v <= 0) return s.shift.shiftDurationMin;
  return Math.floor(Number(v));
}

function shiftBoundaries(nowMin: number, s: Scenario) {
  const sched = getScheduledShiftMin(s);
  const workable = Math.max(0, Math.min(sched, s.shift.shiftDurationMin));

  const shiftStart = Math.floor(nowMin / sched) * sched;
  const workEnd = shiftStart + workable; // shift change starts
  const shiftEnd = shiftStart + sched; // next shift starts

  return { shiftStart, workEnd, shiftEnd, sched, workable };
}
