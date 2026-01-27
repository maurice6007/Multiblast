// src/ui/DebugSimulationTest.tsx
import React, { useMemo, useState } from "react";
import { simulateScenario } from "../engine/simulate";
import GanttChart from "./GanttChart";

function pretty(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}

function safeParseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

function fmt(n: any, digits = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function clampInt(n: any, min = 0, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.floor(v));
}

function clampNum(n: any, min = 0, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, v);
}

/**
 * Canonical scenario template (engine-ish shape)
 */
const STARTER_SCENARIO: any = {
  name: "Starter Scenario",
  headings: 3,
  simDays: 30,
  tickMin: 5,
  metresPerRound: 3.0,

  shift: {
    shiftDurationMin: 480, // workable time before shift change
    blastTiming: "endOfShift", // "midshift" | "endOfShift"
  },

  durations: {
    drill: 180,
    charge: 60,
    muck: 240,
    support: 120,
  },

  resources: {
    drillRigs: 2,
    lhds: 1,
    supportCrews: 1,
    blastCrews: 1,
  },

  support: {
    jumboBolting: false,
  },
};

export default function DebugSimulationTest() {
  const [scenarioText, setScenarioText] = useState<string>(pretty(STARTER_SCENARIO));

  // Run controls
  const [simDays, setSimDays] = useState<number>(30);
  const [shiftsPerDay, setShiftsPerDay] = useState<2 | 3>(3);
  const [recordRuns, setRecordRuns] = useState<boolean>(true);

  // Output
  const [parseError, setParseError] = useState<string>("");
  const [runError, setRunError] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const parsed = useMemo(() => safeParseJson(scenarioText), [scenarioText]);

  // Derived scheduled shift length (8h or 12h)
  const hoursPerShift = useMemo(() => 24 / shiftsPerDay, [shiftsPerDay]);

  // Canonical object for UI controls even if JSON is malformed
  const uiScenario = useMemo(() => {
    if (!parsed.ok) return normalizeScenario(STARTER_SCENARIO);
    return normalizeScenario(parsed.value);
  }, [parsed]);

  function patchScenario(patch: (obj: any) => void) {
    const p = safeParseJson(scenarioText);
    const base = p.ok ? deepClone(p.value) : deepClone(uiScenario);
    patch(base);
    const normalized = normalizeScenario(base);
    setScenarioText(pretty(normalized));
  }

  function validateOnly() {
    setRunError("");
    setResult(null);

    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError("");

    try {
      // wrapper reads legacyOptions.hoursPerShift for scheduled shift length
      simulateScenario(parsed.value, { simDays: 1, hoursPerShift, recordRuns: false });
      setRunError("");
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
    }
  }

  function onRun() {
    setRunError("");
    setResult(null);

    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError("");

    try {
      const r = simulateScenario(parsed.value, {
        simDays,
        hoursPerShift,
        recordRuns,
        includeGantt: true,
      });
      setResult(r);
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
      console.error(e);
    }
  }

  // Result shape: either {kpis, simMinutes, intervals} or legacy KPI-only
  const kpis = result?.kpis ?? result;

  // Gantt should show ONLY the run window (simDays), stretched to full width
  const viewMinutes = simDays * 24 * 60;

  const intervalsAll = result?.intervals ?? [];
  const intervals = useMemo(() => {
    return intervalsAll
      .map((seg: any) => {
        const startMin = Math.max(0, seg.startMin);
        const endMin = Math.min(viewMinutes, seg.endMin);
        if (endMin <= startMin) return null;
        return { ...seg, startMin, endMin };
      })
      .filter(Boolean);
  }, [intervalsAll, viewMinutes]);

  const blastTimingValue =
    uiScenario.shift.blastTiming === "midshift" || uiScenario.shift.blastTiming === "endOfShift"
      ? uiScenario.shift.blastTiming
      : "endOfShift";

  const jumboBolting = !!uiScenario.support?.jumboBolting;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Simulation Debug UI</h2>

        <button onClick={validateOnly} style={btnStyle}>
          Validate
        </button>

        <button onClick={onRun} style={btnStyle}>
          Run
        </button>

        <button
          onClick={() => {
            setScenarioText(pretty(STARTER_SCENARIO));
            setSimDays(STARTER_SCENARIO.simDays ?? 30);
          }}
          style={{ ...btnStyle, marginLeft: "auto" }}
        >
          Reset template
        </button>
      </div>

      {/* Global run controls */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Field label="Simrun days">
          <input
            type="number"
            value={simDays}
            min={1}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value) || 1);
              setSimDays(v);
              // keep JSON in sync so engine honours simDays (via Scenario)
              patchScenario((obj) => {
                obj.simDays = v;
              });
            }}
            style={inputStyle}
          />
        </Field>

        <Field label="Shifts per day">
          <div style={{ display: "grid", gap: 6 }}>
            <select
              value={shiftsPerDay}
              onChange={(e) => setShiftsPerDay(Number(e.target.value) as 2 | 3)}
              style={inputStyle}
            >
              <option value={2}>2 × 12h</option>
              <option value={3}>3 × 8h</option>
            </select>
            <div style={{ fontSize: 11, opacity: 0.7 }}>Scheduled shift length: {hoursPerShift}h</div>
          </div>
        </Field>

        <Field label="Blasting">
          <select
            value={blastTimingValue}
            onChange={(e) =>
              patchScenario((obj) => {
                obj.shift = obj.shift ?? {};
                obj.shift.blastTiming = e.target.value;
              })
            }
            style={inputStyle}
          >
            <option value="midshift">ASAP (midshift)</option>
            <option value="endOfShift">End of shift</option>
          </select>
        </Field>

        <Field label="recordRuns">
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={recordRuns} onChange={(e) => setRecordRuns(e.target.checked)} />
            <span style={{ opacity: 0.85 }}>Keep per-stage run log</span>
          </label>
        </Field>
      </div>

      {/* Main layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 0.75fr", gap: 12 }}>
        {/* Scenario controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>Geometry &amp; Resolution</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Core levers for capacity + timeline fidelity</div>
            </div>

            <div style={grid2Style}>
              <Field label="Headings">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={uiScenario.headings}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.headings = clampInt(e.target.value, 1, 1);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Advance / round (m)">
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={uiScenario.metresPerRound}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.metresPerRound = clampNum(e.target.value, 0.1, 0.1);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Tick (min)">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={uiScenario.tickMin}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.tickMin = clampInt(e.target.value, 1, 1);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              {/* Workable time before shift change (kept intentionally) */}
              <Field label="Shift duration (workable min)">
                <input
                  type="number"
                  min={1}
                  step={10}
                  value={uiScenario.shift.shiftDurationMin}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.shift = obj.shift ?? {};
                      obj.shift.shiftDurationMin = clampInt(e.target.value, 1, 480);
                    })
                  }
                  style={inputStyle}
                />
              </Field>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>Resources</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Counts available per tick</div>
            </div>

            <div style={grid2Style}>
              <Field label="Drill rigs">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.resources.drillRigs}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.resources = obj.resources ?? {};
                      obj.resources.drillRigs = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="LHDs">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.resources.lhds}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.resources = obj.resources ?? {};
                      obj.resources.lhds = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Support crews">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.resources.supportCrews}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.resources = obj.resources ?? {};
                      obj.resources.supportCrews = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                  disabled={jumboBolting}
                  title={jumboBolting ? "Disabled: Support uses drill rigs when Jumbo bolting is on." : undefined}
                />
              </Field>

              <Field label="Blast crews (charging)">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.resources.blastCrews}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.resources = obj.resources ?? {};
                      obj.resources.blastCrews = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <div style={{ gridColumn: "1 / -1" }}>
                <Field label="Jumbo bolting">
                  <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={jumboBolting}
                      onChange={(e) =>
                        patchScenario((obj) => {
                          obj.support = obj.support ?? {};
                          obj.support.jumboBolting = e.target.checked;
                        })
                      }
                    />
                    <span style={{ opacity: 0.9 }}>
                      When enabled, <b>Support consumes Drill rigs</b> (no separate support crews).
                    </span>
                  </label>
                </Field>
              </div>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 800 }}>Durations</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Minutes per stage</div>
            </div>

            <div style={grid2Style}>
              <Field label="Drill (min)">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.durations.drill}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.durations = obj.durations ?? {};
                      obj.durations.drill = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Charge (min)">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.durations.charge}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.durations = obj.durations ?? {};
                      obj.durations.charge = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Muck (min)">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.durations.muck}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.durations = obj.durations ?? {};
                      obj.durations.muck = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>

              <Field label="Support (min)">
                <input
                  type="number"
                  min={0}
                  value={uiScenario.durations.support}
                  onChange={(e) =>
                    patchScenario((obj) => {
                      obj.durations = obj.durations ?? {};
                      obj.durations.support = clampInt(e.target.value, 0, 0);
                    })
                  }
                  style={inputStyle}
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Validation + KPIs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Validation</div>

            {!parsed.ok ? (
              <div style={errorBoxStyle}>
                <b>JSON parse error</b>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{parsed.error}</div>
              </div>
            ) : parseError ? (
              <div style={errorBoxStyle}>
                <b>JSON parse error</b>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{parseError}</div>
              </div>
            ) : runError ? (
              <div style={errorBoxStyle}>
                <b>Scenario validation / run error</b>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{runError}</div>
              </div>
            ) : (
              <div style={{ opacity: 0.8 }}>{parsed.ok ? "JSON looks valid. Click Validate or Run." : "Fix JSON errors above."}</div>
            )}
          </div>

          <div style={panelStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>KPIs (after run)</div>
            {kpis ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                <KpiCard title="Rounds total" value={fmt(kpis.roundsCompletedTotal, 0)} />
                <KpiCard title="Rounds / day (total)" value={fmt(kpis.roundsPerDayTotal, 2)} />
                <KpiCard title="Metres total" value={fmt(kpis.metresAdvancedTotal, 1)} />
                <KpiCard title="Metres / day (total)" value={fmt(kpis.metresPerDayTotal, 2)} />
                <KpiCard title="Rounds / heading" value={fmt(kpis.roundsCompletedPerHeading, 2)} />
                <KpiCard title="Heading utilization" value={fmt(kpis.headingUtilization * 100, 1) + "%"} />
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>Run the simulation to populate KPIs.</div>
            )}
          </div>
        </div>
      </div>

      {/* Gantt */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div style={{ fontWeight: 800 }}>Gantt</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Viewing 0 → {simDays} days</div>
        </div>

        {intervals.length ? (
          <GanttChart simMinutes={viewMinutes} intervals={intervals} shiftsPerDay={shiftsPerDay} />
        ) : (
          <div style={{ opacity: 0.7 }}>No timeline returned. Ensure engine returns intervals when includeGantt=true.</div>
        )}
      </div>

      {/* Advanced */}
      <details style={{ ...panelStyle, padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, opacity: 0.85 }}>Scenario JSON (advanced)</summary>
        <pre style={{ ...preStyle, marginTop: 10 }}>{scenarioText}</pre>
      </details>

      <details style={{ ...panelStyle, padding: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, opacity: 0.85 }}>Raw result (JSON)</summary>
        <pre style={{ ...preStyle, marginTop: 10 }}>{result ? pretty(result).slice(0, 40000) : "Run to see output."}</pre>
      </details>
    </div>
  );
}

/** Normalizes any scenario-ish object into the canonical UI shape (so inputs never crash). */
function normalizeScenario(partial: any) {
  const s = partial ?? {};
  const shift = s.shift ?? {};
  const durations = s.durations ?? {};
  const resources = s.resources ?? {};
  const supportCfg = s.support ?? {};

  const headings = clampInt(s.headings, 1, 3);

  return {
    simDays: clampInt(s.simDays, 1, 30),
    tickMin: clampInt(s.tickMin, 1, 5),
    headings,
    metresPerRound: clampNum(s.metresPerRound, 0.1, 3.0),

    shift: {
      shiftDurationMin: clampInt(shift.shiftDurationMin, 1, 480),
      blastTiming:
        shift.blastTiming === "midshift" || shift.blastTiming === "endOfShift" ? shift.blastTiming : "endOfShift",
    },

    durations: {
      drill: clampInt(durations.drill, 0, 180),
      charge: clampInt(durations.charge, 0, 60),
      muck: clampInt(durations.muck, 0, 240),
      support: clampInt(durations.support ?? 0, 0, 120),
    },

    resources: {
      drillRigs: clampInt(resources.drillRigs ?? headings, 0, headings),
      lhds: clampInt(resources.lhds ?? 1, 0, 1),
      supportCrews: clampInt(resources.supportCrews ?? 1, 0, 1),
      blastCrews: clampInt(resources.blastCrews ?? 1, 0, 1),
    },

    support: {
      jumboBolting: !!(supportCfg.jumboBolting ?? s.jumboBolting ?? false),
    },
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      {children}
    </div>
  );
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 14, padding: 12, background: "white" }}>
      <div style={{ fontSize: 12, opacity: 0.75 }}>{title}</div>
      <div style={{ fontSize: 18, fontWeight: 750, marginTop: 6 }}>{value}</div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.65)",
};

const grid2Style: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "white",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.2)",
  cursor: "pointer",
  background: "white",
};

const errorBoxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "rgba(255,0,0,0.08)",
  border: "1px solid rgba(255,0,0,0.25)",
};

const preStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "rgba(0,0,0,0.04)",
  overflow: "auto",
  maxHeight: 420,
  fontSize: 12,
  whiteSpace: "pre-wrap",
};
