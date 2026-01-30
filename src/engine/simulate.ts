// src/engine/simulate.ts
import type { Scenario, BlastTiming } from "../models/defaultScenario";

/* =========================
   Public exports
   ========================= */

/** Resources a heading can be waiting for (used for Gantt WAITING_FOR_RESOURCE) */
export type WaitForResource = "drillRigs" | "lhds" | "supportCrews" | "blastCrews";

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
  | "SUPPORT"
  | "WAITING_FOR_RESOURCE";

export interface GanttInterval {
  headingId: string;
  stage: GanttStage;
  startMin: number;
  endMin: number;
  /** Only set when stage === "WAITING_FOR_RESOURCE" */
  waitFor?: WaitForResource;
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
  const normalized = normalizeScenarioForEngine(legacyScenario, legacyOptions);

  if (legacyOptions?.includeGantt || legacyOptions?.includeTimeline) {
    return simulateDetailed(normalized);
  }
  return { kpis: simulate(normalized) };
}

/* =========================
   Internal state
   ========================= */

type WorkStage = Exclude<GanttStage, "WAITING_FOR_RESOURCE">;

interface HeadingState {
  id: string;
  stage: WorkStage;
  remainingMin: number;
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

/** Local resource shape (do NOT rely on external types) */
type ResourceKey = WaitForResource;
type ResourcePool = Record<ResourceKey, number>;

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
  const openByHeading = new Map<string, { stage: GanttStage; startMin: number; waitFor?: ResourceKey }>();

  const openIfMissing = (hid: string, stage: GanttStage, nowMin: number, waitFor?: ResourceKey) => {
    if (!opts.captureTimeline) return;
    if (!openByHeading.has(hid)) openByHeading.set(hid, { stage, startMin: nowMin, waitFor });
  };

  const closeAndOpen = (hid: string, nextStage: GanttStage, nextWaitFor: ResourceKey | undefined, atMin: number) => {
    if (!opts.captureTimeline) return;

    const open = openByHeading.get(hid);
    if (!open) {
      openByHeading.set(hid, { stage: nextStage, startMin: atMin, waitFor: nextWaitFor });
      return;
    }

    const stageChanged = open.stage !== nextStage;
    const waitChanged = open.waitFor !== nextWaitFor;

    if (!stageChanged && !waitChanged) return;

    intervals.push({
      headingId: hid,
      stage: open.stage,
      startMin: open.startMin,
      endMin: atMin,
      waitFor: open.waitFor,
    });

    openByHeading.set(hid, { stage: nextStage, startMin: atMin, waitFor: nextWaitFor });
  };

  if (opts.captureTimeline) {
    for (const h of headings) openByHeading.set(h.id, { stage: h.stage, startMin: 0 });
  }

  for (let nowMin = 0; nowMin < simMinutes; nowMin += tickMin) {
    // reset available resources each tick (shared across headings for this tick)
    const avail = makeResourcePool(s);

    for (const h of headings) {
      const logicalStageBefore = h.stage;

      // attempt to advance (may be blocked)
      const progressed = advanceHeadingByTick(h, nowMin, tickMin, s, avail);

      // If blocked on a work stage, compute which resource we are waiting for.
      const waitFor: ResourceKey | undefined =
        progressed ? undefined : (resourceForWorkStage(logicalStageBefore, s) ?? undefined);

      // Display either the logical stage, or WAITING_FOR_RESOURCE if blocked on a resource.
      const displayStage: GanttStage = progressed ? h.stage : waitFor ? "WAITING_FOR_RESOURCE" : h.stage;
      const nextWaitFor = displayStage === "WAITING_FOR_RESOURCE" ? waitFor : undefined;

      if (opts.captureTimeline) {
        const open = openByHeading.get(h.id);
        const currentOpenStage = open?.stage ?? h.stage;
        const currentOpenWaitFor = open?.waitFor;

        openIfMissing(h.id, currentOpenStage, nowMin, currentOpenWaitFor);

        // split interval when stage OR waitFor changes
        if (displayStage !== currentOpenStage || nextWaitFor !== currentOpenWaitFor) {
          closeAndOpen(h.id, displayStage, nextWaitFor, nowMin + tickMin);
        }
      }
    }
  }

  if (opts.captureTimeline) {
    for (const h of headings) {
      const open = openByHeading.get(h.id);
      if (open) {
        intervals.push({
          headingId: h.id,
          stage: open.stage,
          startMin: open.startMin,
          endMin: simMinutes,
          waitFor: open.waitFor,
        });
      }
    }
  }

  const kpis = computeKpis(headings, s, simMinutes);
  assertSimulationProgress(s, headings);

  return { kpis, simMinutes, intervals };
}

/* =========================
   Core simulation logic
   ========================= */

/**
 * Returns:
 *  - true  = progressed this tick (worked or advanced a timer or changed stage)
 *  - false = blocked waiting for a resource for this stage
 */
function advanceHeadingByTick(
  h: HeadingState,
  nowMin: number,
  tickMin: number,
  s: Scenario,
  avail: ResourcePool
): boolean {
  // Gate stages (no resources)
  if (h.stage === "BLAST_READY") {
    onBlastReady(h, nowMin, tickMin, s);
    return true;
  }

  if (h.stage === "REENTRY") {
    if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
    if (h.remainingMin === 0) {
      h.stage = "MUCK";
      h.remainingMin = s.durations.muck;
    }
    return true;
  }

  if (h.stage === "WAITING_FOR_BLAST") {
    if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
    if (h.remainingMin === 0) {
      h.stage = "MUCK";
      h.remainingMin = s.durations.muck;
    }
    return true;
  }

  // Work stage: must acquire resource (if any)
  const key = resourceForWorkStage(h.stage, s);
  if (key) {
    if (avail[key] <= 0) return false;
    avail[key] -= 1;
  }

  // Work happens this tick
  h.busyMin += tickMin;

  if (h.remainingMin > 0) h.remainingMin = Math.max(0, h.remainingMin - tickMin);
  if (h.remainingMin > 0) return true;

  switch (h.stage) {
    case "DRILL":
      h.stage = "CHARGE";
      h.remainingMin = s.durations.charge;
      return true;

    case "CHARGE":
      h.stage = "BLAST_READY";
      h.remainingMin = 0;
      return true;

    case "MUCK": {
      const support = Number.isFinite((s.durations as any).support) ? Number((s.durations as any).support) : 0;
      if (support > 0) {
        h.stage = "SUPPORT";
        h.remainingMin = support;
      } else {
        completeRound(h, s);
        h.stage = "DRILL";
        h.remainingMin = s.durations.drill;
      }
      return true;
    }

    case "SUPPORT":
      completeRound(h, s);
      h.stage = "DRILL";
      h.remainingMin = s.durations.drill;
      return true;

    default:
      return true;
  }
}

/**
 * BLAST_READY handler.
 * - midshift: blast instantaneous → REENTRY(30 min) → MUCK
 * - endOfShift: blast at shift change → WAITING_FOR_BLAST until shift end → MUCK
 */
function onBlastReady(h: HeadingState, nowMin: number, tickMin: number, s: Scenario): void {
  if (s.shift.blastTiming === "midshift") {
    h.stage = "REENTRY";
    h.remainingMin = REENTRY_MIN_MIDSHIFT;
    return;
  }

  const { workEnd, shiftEnd } = shiftBoundaries(nowMin, s);

  if (nowMin >= workEnd) {
    h.stage = "WAITING_FOR_BLAST";
    h.remainingMin = Math.max(0, shiftEnd - (nowMin + tickMin));
    return;
  }

  if (h.remainingMin <= 0) {
    h.remainingMin = Math.max(0, workEnd - nowMin);
  } else {
    h.remainingMin = Math.max(0, h.remainingMin - tickMin);
  }

  if (h.remainingMin === 0) {
    h.stage = "WAITING_FOR_BLAST";
    h.remainingMin = Math.max(0, shiftEnd - (nowMin + tickMin));
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
  const r = (s as any).resources ?? {};
  return {
    drillRigs: clampNonNegInt(r.drillRigs ?? s.headings),
    lhds: clampNonNegInt(r.lhds ?? s.headings),
    supportCrews: clampNonNegInt(r.supportCrews ?? s.headings),
    blastCrews: clampNonNegInt(r.blastCrews ?? 1),
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

function resourceForWorkStage(stage: WorkStage, s: Scenario): ResourceKey | null {
  switch (stage) {
    case "DRILL":
      return "drillRigs";
    case "CHARGE":
      return "blastCrews";
    case "MUCK":
      return "lhds";
    case "SUPPORT":
      return isJumboBoltingEnabled(s) ? "drillRigs" : "supportCrews";
    default:
      return null;
  }
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

  const supportVal = (s.durations as any).support;
  if (supportVal !== undefined && (!Number.isFinite(supportVal) || Number(supportVal) < 0)) {
    throw new Error("durations.support must be >= 0 if provided");
  }

  const resources = (s as any).resources;
  if (resources) {
    for (const k of ["drillRigs", "lhds", "supportCrews", "blastCrews"] as const) {
      const v = (resources as any)[k];
      if (!Number.isFinite(v) || v < 0) throw new Error(`resources.${k} must be >= 0`);
    }
  }
}

function assertSimulationProgress(s: Scenario, headings: HeadingState[]): void {
  const totalBusy = headings.reduce((a, h) => a + h.busyMin, 0);
  if (s.simDays >= 1 && totalBusy === 0) {
    throw new Error("Simulation produced zero work (deadlock: no resources available to perform any stage).");
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

  const resourcesSrc = (s as any).resources ?? {};
  const resources: any = {
    drillRigs: pickNumber(resourcesSrc.drillRigs, s.drillRigs) ?? headings,
    lhds: pickNumber(resourcesSrc.lhds, s.lhds) ?? headings,
    supportCrews: pickNumber(resourcesSrc.supportCrews, s.supportCrews) ?? headings,
    blastCrews: pickNumber(resourcesSrc.blastCrews, s.blastCrews) ?? 1,
  };

  const hoursPerShiftOpt = legacyOptions?.hoursPerShift;
  const scheduledShiftMin =
    Number.isFinite(hoursPerShiftOpt) && Number(hoursPerShiftOpt) > 0
      ? Number(hoursPerShiftOpt) * 60
      : pickNumber((shiftSrc as any).scheduledShiftMin, s.scheduledShiftMin, s.shiftScheduledMin) ?? shiftDurationMin;

  const shiftObj: any = { shiftDurationMin, blastTiming, scheduledShiftMin };

  const jumboBolting =
    ((s as any).support?.jumboBolting ?? s.jumboBolting ?? (s as any).supportConfig?.jumboBolting ?? false) === true;

  return {
    simDays: pickNumber(s.simDays, s.days, s.simulationDays) ?? 30,
    tickMin: pickNumber(s.tickMin, s.dtMin, s.timeStepMin, s.stepMin) ?? 5,
    headings,
    metresPerRound: pickNumber(s.metresPerRound, s.advancePerRound, s.advanceM, s.mPerRound) ?? 3.8,
    shift: shiftObj,
    durations: { drill, charge, muck, support } as any,
    resources,
    support: { jumboBolting },
  } as any as Scenario;
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
  const workEnd = shiftStart + workable;
  const shiftEnd = shiftStart + sched;

  return { shiftStart, workEnd, shiftEnd, sched, workable };
}
