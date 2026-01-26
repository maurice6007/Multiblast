// src/sim/simulate.ts
// Clean, deterministic simulation with blast timing:
// - "midshift"  => Immediate (as soon as ready)
// - "endOfShift" => Fire at end of current shift
//
// NOTE: "midshift" = blast immediately when ready (NOT middle of shift)

export type BlastTiming = "midshift" | "endOfShift";

export interface ShiftConfig {
  shiftDurationMin: number; // e.g. 720 for 12h
  blastTiming: BlastTiming;
}

export interface RoundDurationsMin {
  drill: number;
  charge: number;
  muck: number;
  // Optional extra fixed delays you may want later:
  // ventReentry: number;
}

export interface Scenario {
  simDays: number;
  tickMin: number; // recommended 1, 5, or 10
  headings: number;

  metresPerRound: number;

  shift: ShiftConfig;
  durations: RoundDurationsMin;
}

export interface SimulationKpis {
  simDays: number;

  roundsCompletedTotal: number;
  roundsCompletedPerHeading: number;

  metresAdvancedTotal: number;
  metresAdvancedPerHeading: number;

  roundsPerDayTotal: number;
  metresPerDayTotal: number;

  headingUtilization: number; // busy time / total time per heading
}

type Stage = "DRILL" | "CHARGE" | "BLAST_READY" | "WAITING_FOR_BLAST" | "MUCK";

interface HeadingState {
  id: string;
  stage: Stage;
  remainingMin: number; // remaining time in current stage (if applicable)
  busyMin: number; // accumulated "working" minutes (utilization numerator)
  roundsCompleted: number;
  metresAdvanced: number;
}

interface PendingBlast {
  headingId: string;
  scheduledAtMin: number;
}

export function simulate(s: Scenario): SimulationKpis {
  validateScenario(s);

  const simMinutes = s.simDays * 24 * 60;
  const tickMin = s.tickMin;

  const headings: HeadingState[] = Array.from({ length: s.headings }, (_, i) =>
    newHeading(`H${i + 1}`, s)
  );

  const pendingBlasts: PendingBlast[] = [];

  for (let nowMin = 0; nowMin < simMinutes; nowMin += tickMin) {
    // 1) Fire any pending end-of-shift blasts that are due
    executePendingBlasts(nowMin, pendingBlasts, headings, s);

    // 2) Advance each heading by one tick
    for (const h of headings) {
      advanceHeadingByTick(h, nowMin, tickMin, pendingBlasts, s);
    }
  }

  const kpis = computeKpis(headings, s, simMinutes);
assertSimulationProgress(kpis, s);
return kpis;


/* ----------------------------- Core behavior ----------------------------- */

function advanceHeadingByTick(
  h: HeadingState,
  nowMin: number,
  tickMin: number,
  pendingBlasts: PendingBlast[],
  s: Scenario
) {
  // Count utilization only when actively doing work (drill/charge/muck).
  const isWorking =
    h.stage === "DRILL" || h.stage === "CHARGE" || h.stage === "MUCK";

  if (isWorking) h.busyMin += tickMin;

  // If we're in BLAST_READY, handle blast timing gate once, then move on.
  if (h.stage === "BLAST_READY") {
    onBlastReady(h, nowMin, pendingBlasts, s);
    // After onBlastReady, stage will be MUCK (immediate blast) or WAITING_FOR_BLAST
    return;
  }

  // WAITING_FOR_BLAST does nothing until a scheduled blast fires.
  if (h.stage === "WAITING_FOR_BLAST") return;

  // DRILL / CHARGE / MUCK: decrement remaining and transition when done.
  if (h.remainingMin > 0) {
    h.remainingMin = Math.max(0, h.remainingMin - tickMin);
  }

  if (h.remainingMin > 0) return;

  // Transition on completion
  switch (h.stage) {
    case "DRILL":
      h.stage = "CHARGE";
      h.remainingMin = s.durations.charge;
      break;

    case "CHARGE":
      h.stage = "BLAST_READY";
      h.remainingMin = 0;
      // BLAST_READY will be handled next tick (or immediately if you prefer;
      // but doing it here can cause re-entrancy. Keeping it in next tick is safer.)
      break;

    case "MUCK":
      // Round completes at end of mucking
      completeRound(h, s);
      // Start next round
      h.stage = "DRILL";
      h.remainingMin = s.durations.drill;
      break;

    default:
      // no-op
      break;
  }
}

function onBlastReady(
  h: HeadingState,
  nowMin: number,
  pendingBlasts: PendingBlast[],
  s: Scenario
) {
  if (s.shift.blastTiming === "midshift") {
    // Immediate (as soon as ready)
    doBlast(h, s);
    return;
  }

  // End of shift: hold until shift end
  const shiftEnd = shiftEndMin(nowMin, s.shift.shiftDurationMin);

  // Avoid duplicate scheduling if BLAST_READY is revisited
  const exists = pendingBlasts.some((b) => b.headingId === h.id);
  if (!exists) pendingBlasts.push({ headingId: h.id, scheduledAtMin: shiftEnd });

  // Move into explicit waiting state so the rest of the sim doesn't treat it as active work
  h.stage = "WAITING_FOR_BLAST";
  h.remainingMin = 0;
}

function executePendingBlasts(
  nowMin: number,
  pendingBlasts: PendingBlast[],
  headings: HeadingState[],
  s: Scenario
) {
  if (pendingBlasts.length === 0) return;

  // Fire all blasts that are due
  const due: PendingBlast[] = [];
  for (const b of pendingBlasts) {
    if (b.scheduledAtMin <= nowMin) due.push(b);
  }
  if (due.length === 0) return;

  for (const b of due) {
    const h = headings.find((x) => x.id === b.headingId);
    if (!h) continue;

    // Only fire if still waiting; if state changed, ignore
    if (h.stage === "WAITING_FOR_BLAST") {
      doBlast(h, s);
    }
  }

  // Remove fired/expired
  for (const b of due) {
    const idx = pendingBlasts.findIndex((x) => x.headingId === b.headingId);
    if (idx >= 0) pendingBlasts.splice(idx, 1);
  }
}

function doBlast(h: HeadingState, s: Scenario) {
  // Blast itself is instantaneous in this clean version.
  // If you later model blast window, venting, re-entry etc, insert stage(s) here.
  h.stage = "MUCK";
  h.remainingMin = s.durations.muck;
}

function completeRound(h: HeadingState, s: Scenario) {
  h.roundsCompleted += 1;
  h.metresAdvanced += s.metresPerRound;
}

/* ----------------------------- KPIs & helpers ---------------------------- */

function computeKpis(
  headings: HeadingState[],
  s: Scenario,
  simMinutes: number
): SimulationKpis {
  const totalRounds = headings.reduce((acc, h) => acc + h.roundsCompleted, 0);
  const totalMetres = headings.reduce((acc, h) => acc + h.metresAdvanced, 0);

  const roundsPerHeading = s.headings > 0 ? totalRounds / s.headings : 0;
  const metresPerHeading = s.headings > 0 ? totalMetres / s.headings : 0;

  const roundsPerDayTotal = s.simDays > 0 ? totalRounds / s.simDays : 0;
  const metresPerDayTotal = s.simDays > 0 ? totalMetres / s.simDays : 0;

  // Utilization: average busy% per heading
  const utilAvg =
    s.headings > 0
      ? headings.reduce((acc, h) => acc + h.busyMin / simMinutes, 0) / s.headings
      : 0;

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

function shiftStartMin(nowMin: number, shiftDurationMin: number): number {
  return Math.floor(nowMin / shiftDurationMin) * shiftDurationMin;
}

function shiftEndMin(nowMin: number, shiftDurationMin: number): number {
  return shiftStartMin(nowMin, shiftDurationMin) + shiftDurationMin;
}

function validateScenario(s: Scenario) {
  if (s.simDays <= 0) throw new Error("simDays must be > 0");
  if (s.tickMin <= 0) throw new Error("tickMin must be > 0");
  if (s.headings <= 0) throw new Error("headings must be > 0");
  if (s.metresPerRound <= 0) throw new Error("metresPerRound must be > 0");

  if (s.shift.shiftDurationMin <= 0)
    throw new Error("shift.shiftDurationMin must be > 0");

  if (s.durations.drill < 0 || s.durations.charge < 0 || s.durations.muck < 0)
    throw new Error("durations must be >= 0");

  if (s.shift.blastTiming !== "midshift" && s.shift.blastTiming !== "endOfShift")
    throw new Error("shift.blastTiming invalid");
}

function assertSimulationProgress(kpis: SimulationKpis, s: Scenario) {
  if (s.simDays >= 1 && kpis.roundsCompletedTotal === 0) {
    throw new Error(
      [
        "Simulation produced zero completed rounds.",
        "Deadlock or invalid timing configuration.",
        `blastTiming=${s.shift.blastTiming}`,
        `headings=${s.headings}`,
        `durations(drill=${s.durations.drill}, charge=${s.durations.charge}, muck=${s.durations.muck})`,
        `shiftDurationMin=${s.shift.shiftDurationMin}`,
        `tickMin=${s.tickMin}`,
      ].join(" ")
    );
  }
}



{
  if (s.simDays >= 1 && kpis.roundsCompletedTotal === 0) {
    throw new Error(
      [
        "Simulation produced zero completed rounds.",
        "This indicates a deadlock or invalid timing configuration.",
        `blastTiming=${s.shift.blastTiming}`,
        `headings=${s.headings}`,
        `durations(drill=${s.durations.drill}, charge=${s.durations.charge}, muck=${s.durations.muck})`,
        `shiftDurationMin=${s.shift.shiftDurationMin}`,
        `tickMin=${s.tickMin}`
      ].join(" ")
    );
  }
}
}