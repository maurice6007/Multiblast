import React, { useMemo, useState } from "react";
import { simulateScenario } from "../engine/simulate";
 // <-- adjust if your path differs

// If Scenario/SimulationResult types are exported, you can import them too.
// import type { Scenario, SimulationResult } from "../models/types";

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

/**
 * Minimal “starter” Scenario template you can edit in the UI.
 * This matches what your assertScenario() expects.
 */
const STARTER_SCENARIO = {
  name: "Starter Scenario",
  policy: "IMMEDIATE", // or "END_OF_SHIFT_ONLY"
  headings: 2,
  shiftsPerDay: 2,
  advancePerRoundM: 3.0,
  reEntryDelayMin: 30,
  blastLockoutMin: 60,
  stages: [
    { id: "DRILL", name: "Drill", durationMin: 180 },
    { id: "CHARGE", name: "Charge", durationMin: 60 },
    { id: "BLAST", name: "Blast", durationMin: 10, isBlast: true },
    { id: "MUCK", name: "Muck", durationMin: 240 },
    { id: "SUPPORT", name: "Support", durationMin: 120 },
  ],
};

export function DebugSimulationTest() {
  const [scenarioText, setScenarioText] = useState<string>(pretty(STARTER_SCENARIO));
  const [simDays, setSimDays] = useState<number>(30);
  const [hoursPerShift, setHoursPerShift] = useState<number>(8);
  const [recordRuns, setRecordRuns] = useState<boolean>(true);

  const [parseError, setParseError] = useState<string>("");
  const [runError, setRunError] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const parsed = useMemo(() => safeParseJson(scenarioText), [scenarioText]);

  function validateOnly() {
    setRunError("");
    setResult(null);

    if (!parsed.ok) {
      setParseError(parsed.error);
      return;
    }
    setParseError("");

    // simulateScenario() already calls assertScenario(), so we can validate by calling it with recordRuns=false (fast)
    try {
      simulateScenario(parsed.value, { simDays: 1, hoursPerShift, recordRuns: false });
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
      return;
    }

    setRunError("");
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
      const r = simulateScenario(parsed.value, { simDays, hoursPerShift, recordRuns });
      setResult(r);
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
      console.error(e);
    }
  }

  const kpis = result?.kpis;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Simulation Debug UI</h2>

        <button
          onClick={validateOnly}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer" }}
        >
          Validate
        </button>

        <button
          onClick={onRun}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)", cursor: "pointer" }}
        >
          Run
        </button>

        <button
          onClick={() => setScenarioText(pretty(STARTER_SCENARIO))}
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            border: "1px solid rgba(0,0,0,0.2)",
            cursor: "pointer",
            marginLeft: "auto",
          }}
        >
          Reset template
        </button>
      </div>

      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Field label="simDays">
          <input
            type="number"
            value={simDays}
            min={1}
            onChange={(e) => setSimDays(Number(e.target.value))}
            style={inputStyle}
          />
        </Field>

        <Field label="hoursPerShift">
          <input
            type="number"
            value={hoursPerShift}
            min={1}
            onChange={(e) => setHoursPerShift(Number(e.target.value))}
            style={inputStyle}
          />
        </Field>

        <Field label="recordRuns">
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={recordRuns} onChange={(e) => setRecordRuns(e.target.checked)} />
            <span style={{ opacity: 0.85 }}>Keep per-stage run log</span>
          </label>
        </Field>

        <Field label="JSON tips">
          <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.3 }}>
            Use double quotes in JSON.
            <br />
            Stages need: id, name, durationMin.
            <br />
            policy: "IMMEDIATE" or "END_OF_SHIFT_ONLY"
          </div>
        </Field>
      </div>

      {/* Editor + Errors */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Scenario (JSON)</div>
          <textarea
            value={scenarioText}
            onChange={(e) => setScenarioText(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              height: 420,
              resize: "vertical",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.14)",
              background: "rgba(0,0,0,0.03)",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Validation</div>

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
              <div style={{ opacity: 0.8 }}>
                {parsed.ok ? "JSON looks valid. Click Validate or Run." : "Fix JSON errors above."}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>KPIs (after run)</div>
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

      {/* Runs preview */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Runs preview (first 200)</div>
        {result?.runs?.length ? (
          <div style={{ overflow: "auto", maxHeight: 360 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", opacity: 0.8 }}>
                  <th style={th}>Heading</th>
                  <th style={th}>Round</th>
                  <th style={th}>Stage</th>
                  <th style={th}>Start (min)</th>
                  <th style={th}>End (min)</th>
                  <th style={th}>Dur (min)</th>
                </tr>
              </thead>
              <tbody>
                {result.runs.slice(0, 200).map((r: any, i: number) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                    <td style={td}>{r.headingIndex}</td>
                    <td style={td}>{r.roundIndex}</td>
                    <td style={td}>
                      <b>{r.stageId}</b> <span style={{ opacity: 0.75 }}>{r.stageName}</span>
                    </td>
                    <td style={td}>{fmt(r.startMin, 0)}</td>
                    <td style={td}>{fmt(r.endMin, 0)}</td>
                    <td style={td}>{fmt((r.endMin ?? 0) - (r.startMin ?? 0), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ opacity: 0.7 }}>
            No runs recorded yet. Ensure <b>recordRuns</b> is checked, then Run.
          </div>
        )}
      </div>

      {/* Raw result */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Raw result (JSON)</div>
        <pre style={preStyle}>{result ? pretty(result).slice(0, 40000) : "Run to see output."}</pre>
      </div>
    </div>
  );
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

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.14)",
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
  maxHeight: 320,
  fontSize: 12,
};

const th: React.CSSProperties = { padding: "8px 10px" };
const td: React.CSSProperties = { padding: "8px 10px" };
