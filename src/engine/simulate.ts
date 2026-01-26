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
 */
export function simulateScenario(legacyScenario: any, legacyOptions?: any): any {
  const normalized = normalizeScenarioForEngine(legacyScenario);

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
  remainingMin: number;
  busyMin: number;
  roundsCompleted: number;
  metresAdvanced: number;
}

interface PendingBlast {
  headingId: string;
  scheduledAtMin: number;
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

/* =========================
   Engine runner
   ========================= */

function runEngine(s: Scenario, opts: RunOptions): RunResult {
  validateScenario(s);

  const simMinutes = s.simDays * 24 * 60;
  const tickMin = s.tickMin;

  const headings: HeadingState[] = Array.from({ length: s.headings }, (_, i) =>
    newHeading(`H${i + 1}`, s)
  );

  const pendingBlasts: PendingBlast[] = [];

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

    // 1) Execute any due blasts FIRST (consumes blastCrews)
    executePendingBlasts(nowMin, pendingBlasts, headings, s, avail);
    if (opts.captureTimeline) for (const h of headings) closeAndOpenIfStageChanged(h, nowMin);

    // 2) Advance each heading if it can acquire the resource for its current stage
    for (const h of headings) {
      const beforeStage = h.stage;

      advanceHeadingByTick(h, nowMin, tickMin, pendingBlasts, s, avail);

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

function advanceHeadingByTick(
  h: HeadingState,
  nowMin: number,
  tickMin: number,
  pendingBlasts: PendingBlast[],
  s: Scenario,
  avail: ResourcePool
): void {
  // Special handling when blast-ready: blasting may consume blastCrews (ASAP)
  if (h.stage === "BLAST_READY") {
    onBlastReady(h, nowMin, pendingBlasts, s, avail);
    return;
  }

  // Waiting state: no work
  if (h.stage === "WAITING_FOR_BLAST") return;

  // Determine if this stage needs a resource to do work
  const rKey = resourceForWorkStage(h.stage);
  const canWorkThisTick = rKey ? tryConsume(avail, rKey) : true;

  if (!canWorkThisTick) {
    // no resource => no progress this tick
    return;
  }

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

function onBlastReady(
  h: HeadingState,
  nowMin: number,
  pendingBlasts: PendingBlast[],
  s: Scenario,
  avail: ResourcePool
): void {
  if (s.shift.blastTiming === "midshift") {
    // ASAP / immediate, but requires blast crew to fire
    if (tryConsume(avail, "blastCrews")) {
      doBlast(h, s);
    }
    // else: stay BLAST_READY until a crew is available on a later tick
    return;
  }

  // End-of-shift gating
  const shiftEnd = shiftEndMin(nowMin, s.shift.shiftDurationMin);

  if (!pendingBlasts.some((b) => b.headingId === h.id)) {
    pendingBlasts.push({ headingId: h.id, scheduledAtMin: shiftEnd });
  }

  h.stage = "WAITING_FOR_BLAST";
  h.remainingMin = 0;
}

function executePendingBlasts(
  nowMin: number,
  pendingBlasts: PendingBlast[],
  headings: HeadingState[],
  s: Scenario,
  avail: ResourcePool
): void {
  if (pendingBlasts.length === 0) return;

  // execute in time order, stable
  pendingBlasts.sort((a, b) => a.scheduledAtMin - b.scheduledAtMin);

  const remaining: PendingBlast[] = [];

  for (const b of pendingBlasts) {
    if (b.scheduledAtMin > nowMin) {
      remaining.push(b);
      continue;
    }

    const h = headings.find((x) => x.id === b.headingId);
    if (!h) continue;

    if (h.stage !== "WAITING_FOR_BLAST") continue;

    // Need a blast crew available to execute
    if (!tryConsume(avail, "blastCrews")) {
      // no crew this tick => try again next tick (keep pending)
      remaining.push({ ...b, scheduledAtMin: nowMin + s.tickMin });
      continue;
    }

    doBlast(h, s);
  }

  pendingBlasts.length = 0;
  pendingBlasts.push(...remaining);
}

function doBlast(h: HeadingState, s: Scenario): void {
  // Blast is instantaneous; post-blast delays can be modeled as another stage later.
  h.stage = "MUCK";
  h.remainingMin = s.durations.muck;
}

function completeRound(h: HeadingState, s: Scenario): void {
  h.roundsCompleted += 1;
  h.metresAdvanced += s.metresPerRound;
}

/* =========================
   Resources
   ========================= */

function makeResourcePool(s: Scenario): ResourcePool {
  // defaults: generous but finite
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

function resourceForWorkStage(stage: Stage): ResourceKey | null {
  switch (stage) {
    case "DRILL":
      return "drillRigs";
    case "CHARGE":
      return "blastCrews";
    case "MUCK":
      return "lhds";
    case "SUPPORT":
      return "supportCrews";
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
  if (!Number.isFinite(s.shift.shiftDurationMin) || s.shift.shiftDurationMin <= 0)
    throw new Error("shift.shiftDurationMin must be > 0");
  if (s.shift.blastTiming !== "midshift" && s.shift.blastTiming !== "endOfShift")
    throw new Error("shift.blastTiming must be 'midshift' or 'endOfShift'");

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

function normalizeScenarioForEngine(input: any): Scenario {
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
    // legacy: hoursPerShift may be provided via options in the old UI; engine uses shiftDurationMin.
    (Number.isFinite(s.hoursPerShift) ? Number(s.hoursPerShift) * 60 : 480);

  const headings = pickNumber(s.headings, s.numHeadings, s.activeHeadings) ?? 2;

  const resourcesSrc = s.resources ?? {};
  const resources: Resources = {
    drillRigs: pickNumber(resourcesSrc.drillRigs, s.drillRigs) ?? headings,
    lhds: pickNumber(resourcesSrc.lhds, s.lhds) ?? headings,
    supportCrews: pickNumber(resourcesSrc.supportCrews, s.supportCrews) ?? headings,
    blastCrews: pickNumber(resourcesSrc.blastCrews, s.blastCrews) ?? 1,
  };

  return {
    simDays: pickNumber(s.simDays, s.days, s.simulationDays) ?? 30,
    tickMin: pickNumber(s.tickMin, s.dtMin, s.timeStepMin, s.stepMin) ?? 5,
    headings,
    metresPerRound: pickNumber(s.metresPerRound, s.advancePerRound, s.advanceM, s.mPerRound) ?? 3.8,

    shift: {
      shiftDurationMin,
      blastTiming,
    },

    durations: {
      drill,
      charge,
      muck,
      support,
    },

    resources,
  };
}

function pickNumber(...vals: any[]): number | undefined {
  for (const v of vals) {
    if (Number.isFinite(v)) return Number(v);
  }
  return undefined;
}

function normalizeBlastTiming(v: any): BlastTiming {
  // canonical
  if (v === "midshift" || v === "endOfShift") return v;

  // legacy strings
  if (v === "IMMEDIATE" || v === "immediate") return "midshift";
  if (v === "END_OF_SHIFT_ONLY" || v === "endOfShift") return "endOfShift";
  if (v === "end") return "endOfShift";

  // legacy booleans
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

function shiftEndMin(nowMin: number, shiftDurationMin: number): number {
  const start = Math.floor(nowMin / shiftDurationMin) * shiftDurationMin;
  return start + shiftDurationMin;
}
