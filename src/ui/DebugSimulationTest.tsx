import React, { useMemo, useState } from "react";
import { simulateScenario } from "../engine/simulate";

const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;

type TabKey = "Editor" | "Timeline" | "Resources" | "Raw";

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

// Stable color per stageId
function hashToHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function stageColor(stageId: string): string {
  const hue = hashToHue(stageId);
  return `hsl(${hue} 70% 80%)`;
}

const STARTER_SCENARIO = {
  name: "Starter Scenario",
  policy: "IMMEDIATE", // or "END_OF_SHIFT_ONLY"
  headings: 3,
  shiftsPerDay: 2,
  advancePerRoundM: 3.0,
  reEntryDelayMin: 30,
  blastLockoutMin: 60,
  stages: [
    { id: "D", name: "Drill", durationMin: 180, resourceKey: "DRILL_RIG" },
    { id: "C", name: "Charge", durationMin: 60, resourceKey: "CHARGING_CREW" },
    { id: "BLAST", name: "Blast", durationMin: 10, isBlast: true },
    { id: "M", name: "Muck", durationMin: 240, resourceKey: "LHD" },
    { id: "SUPPORT", name: "Support", durationMin: 120, resourceKey: "SUPPORT_CREW" },
  ],
};

/** ✅ Named export (do NOT default-export this file) */
export function DebugSimulationTest() {
  const [tab, setTab] = useState<TabKey>("Editor");

  const [scenarioText, setScenarioText] = useState<string>(pretty(STARTER_SCENARIO));

  const [simDays, setSimDays] = useState<number>(30);
  const [hoursPerShift, setHoursPerShift] = useState<number>(8);
  const [recordRuns, setRecordRuns] = useState<boolean>(true);

  // Resources (shared across headings)
  const [drillRigs, setDrillRigs] = useState<number>(1);
  const [lhds, setLhds] = useState<number>(1);
  const [chargingCrews, setChargingCrews] = useState<number>(1);
  const [supportCrews, setSupportCrews] = useState<number>(1);

  // Timeline controls
  const [viewHeading, setViewHeading] = useState<number | "ALL">("ALL");
  const [viewStartDay, setViewStartDay] = useState<number>(0);
  const [viewEndDay, setViewEndDay] = useState<number>(30);

  const [runError, setRunError] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const parsed = useMemo(() => safeParseJson(scenarioText), [scenarioText]);
  const scenario = parsed.ok ? parsed.value : null;

  const headingsCount: number = useMemo(() => {
    const n = scenario?.headings;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  }, [scenario]);

  const stageIdsInScenario: string[] = useMemo(() => {
    if (!scenario?.stages) return [];
    return scenario.stages.map((s: any) => String(s.id));
  }, [scenario]);

  const runs: any[] = result?.runs ?? [];
  const kpis = result?.kpis ?? null;

  const runsByHeading = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const r of runs) {
      const h = r.headingIndex ?? 0;
      if (!map.has(h)) map.set(h, []);
      map.get(h)!.push(r);
    }
    for (const [, arr] of map.entries()) arr.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
    return map;
  }, [runs]);

  function validateOnly() {
    setRunError("");
    setResult(null);

    if (!parsed.ok) {
      setRunError(`JSON error: ${parsed.error}`);
      return;
    }

    try {
      simulateScenario(parsed.value, {
        simDays: 1,
        hoursPerShift,
        recordRuns: false,
        resources: { drillRigs, lhds, chargingCrews, supportCrews },
      });
      setRunError("");
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
    }
  }

  function onRun() {
    setRunError("");
    setResult(null);

    if (!parsed.ok) {
      setRunError(`JSON error: ${parsed.error}`);
      return;
    }

    try {
      const r = simulateScenario(parsed.value, {
        simDays,
        hoursPerShift,
        recordRuns,
        resources: { drillRigs, lhds, chargingCrews, supportCrews },
      });
      setResult(r);

      // reset view window
      setViewStartDay(0);
      setViewEndDay(simDays);

      // jump to timeline since it’s the fastest “is this working?” view
      setTab("Timeline");
    } catch (e: any) {
      setRunError(e?.message ?? String(e));
      console.error(e);
    }
  }

  // Timeline rows (windowed)
  const timelineRows = useMemo(() => {
    const startMin = viewStartDay * MIN_PER_DAY;
    const endMin = viewEndDay * MIN_PER_DAY;

    const headings =
      viewHeading === "ALL" ? Array.from({ length: headingsCount }, (_, i) => i) : [viewHeading];

    const rows = headings.map((h) => {
      const all = runsByHeading.get(h) ?? [];
      const clipped = all.filter((r) => (r.endMin ?? 0) > startMin && (r.startMin ?? 0) < endMin);
      return { headingIndex: h, runs: clipped };
    });

    return { startMin, endMin, rows };
  }, [viewStartDay, viewEndDay, headingsCount, viewHeading, runsByHeading]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Simulation UI</h2>

        <button onClick={validateOnly} style={btnStyle}>Validate</button>
        <button onClick={onRun} style={btnStyle}>Run</button>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <FieldInline label="simDays">
            <input type="number" min={1} value={simDays} onChange={(e) => setSimDays(Number(e.target.value))} style={inputStyle} />
          </FieldInline>

          <FieldInline label="hoursPerShift">
            <input type="number" min={1} value={hoursPerShift} onChange={(e) => setHoursPerShift(Number(e.target.value))} style={inputStyle} />
          </FieldInline>

          <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.85 }}>
            <input type="checkbox" checked={recordRuns} onChange={(e) => setRecordRuns(e.target.checked)} />
            recordRuns
          </label>

          <div style={{ width: 1, height: 24, background: "rgba(0,0,0,0.12)", margin: "0 6px" }} />

          <FieldInline label="Drill rigs">
            <input type="number" min={0} value={drillRigs} onChange={(e) => setDrillRigs(Number(e.target.value))} style={inputStyle} />
          </FieldInline>

          <FieldInline label="LHDs">
            <input type="number" min={0} value={lhds} onChange={(e) => setLhds(Number(e.target.value))} style={inputStyle} />
          </FieldInline>

          <FieldInline label="Charging crews">
            <input type="number" min={0} value={chargingCrews} onChange={(e) => setChargingCrews(Number(e.target.value))} style={inputStyle} />
          </FieldInline>

          <FieldInline label="Support crews">
            <input type="number" min={0} value={supportCrews} onChange={(e) => setSupportCrews(Number(e.target.value))} style={inputStyle} />
          </FieldInline>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["Editor", "Timeline", "Resources", "Raw"] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...pillStyle, background: tab === t ? "rgba(0,0,0,0.08)" : "transparent" }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {runError && (
        <div style={errorBoxStyle}>
          <b>Error</b>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{runError}</div>
        </div>
      )}

      {/* KPIs */}
      {kpis && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
          <KpiCard title="Rounds total" value={fmt(kpis.roundsCompletedTotal, 0)} />
          <KpiCard title="Rounds / day" value={fmt(kpis.roundsPerDayTotal, 2)} />
          <KpiCard title="Metres total" value={fmt(kpis.metresAdvancedTotal, 1)} />
          <KpiCard title="Metres / day" value={fmt(kpis.metresPerDayTotal, 2)} />
          <KpiCard title="Heading util (avg)" value={fmt((kpis.headingUtilization ?? 0) * 100, 1) + "%"} />
          <KpiCard title="Runs recorded" value={fmt(runs.length, 0)} />
        </div>
      )}

      {/* Editor */}
      {tab === "Editor" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Scenario (JSON)</div>
            <textarea
              value={scenarioText}
              onChange={(e) => setScenarioText(e.target.value)}
              spellCheck={false}
              style={textareaStyle}
            />
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setScenarioText(pretty(STARTER_SCENARIO))} style={btnStyle}>
                Reset template
              </button>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Tip: stages must include <b>resourceKey</b> (DRILL_RIG / LHD / CHARGING_CREW / SUPPORT_CREW) to constrain.
              </div>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Scenario check</div>
            {!parsed.ok ? (
              <div style={errorBoxStyle}>
                <b>JSON parse error</b>
                <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{parsed.error}</div>
              </div>
            ) : (
              <div style={{ opacity: 0.85, lineHeight: 1.4 }}>
                <div><b>Name:</b> {scenario?.name ?? "—"}</div>
                <div><b>Policy:</b> {scenario?.policy ?? "—"}</div>
                <div><b>Headings:</b> {scenario?.headings ?? "—"}</div>
                <div><b>Shifts/day:</b> {scenario?.shiftsPerDay ?? "—"}</div>
                <div><b>Advance/round (m):</b> {scenario?.advancePerRoundM ?? "—"}</div>
                <div style={{ marginTop: 10 }}>
                  <StageLegend stageIds={stageIdsInScenario} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline */}
      {tab === "Timeline" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={panelStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>Timeline (Gantt)</div>

              <FieldInline label="Heading">
                <select
                  value={String(viewHeading)}
                  onChange={(e) => setViewHeading(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
                  style={{ ...inputStyle, width: 110 }}
                >
                  <option value="ALL">All</option>
                  {Array.from({ length: headingsCount }, (_, i) => (
                    <option key={i} value={String(i)}>{i}</option>
                  ))}
                </select>
              </FieldInline>

              <FieldInline label="Start day">
                <input type="number" min={0} max={Math.max(0, simDays - 1)} value={viewStartDay} onChange={(e) => setViewStartDay(Number(e.target.value))} style={inputStyle} />
              </FieldInline>

              <FieldInline label="End day">
                <input type="number" min={1} max={simDays} value={viewEndDay} onChange={(e) => setViewEndDay(Number(e.target.value))} style={inputStyle} />
              </FieldInline>

              <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>
                Window: day {viewStartDay} → {viewEndDay}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <StageLegend stageIds={stageIdsInScenario} />
            </div>
          </div>

          <div style={panelStyle}>
            {!result ? (
              <div style={{ opacity: 0.7 }}>Run a simulation first.</div>
            ) : (
              <Gantt rows={timelineRows.rows} startMin={timelineRows.startMin} endMin={timelineRows.endMin} />
            )}
          </div>
        </div>
      )}

      {/* Resources */}
      {tab === "Resources" && (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Resource utilization</div>

          {!result ? (
            <div style={{ opacity: 0.7 }}>Run a simulation first.</div>
          ) : result?.resourceUtilization?.length ? (
            <div style={{ overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.8 }}>
                    <th style={th}>Resource</th>
                    <th style={th}>Units</th>
                    <th style={th}>Busy (h)</th>
                    <th style={th}>Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {result.resourceUtilization.map((r: any) => (
                    <tr key={r.resourceKey} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                      <td style={td}><b>{r.resourceKey}</b></td>
                      <td style={td}>{r.units}</td>
                      <td style={td}>{fmt(r.busyMin / 60, 1)}</td>
                      <td style={td}>{fmt(r.utilization * 100, 1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>
              No pools created. Ensure stages include <b>resourceKey</b> like DRILL_RIG/LHD/CHARGING_CREW/SUPPORT_CREW.
            </div>
          )}
        </div>
      )}

      {/* Raw */}
      {tab === "Raw" && (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Raw result JSON</div>
          <pre style={preStyle}>{result ? pretty(result).slice(0, 60000) : "Run to see output."}</pre>
        </div>
      )}
    </div>
  );
}

// ---------- Components ----------
function StageLegend({ stageIds }: { stageIds: string[] }) {
  if (!stageIds.length) return null;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {stageIds.map((id) => (
        <div key={id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 4, background: stageColor(id), border: "1px solid rgba(0,0,0,0.12)" }} />
          <span style={{ fontSize: 12, opacity: 0.85 }}>{id}</span>
        </div>
      ))}
    </div>
  );
}

function Gantt({ rows, startMin, endMin }: { rows: { headingIndex: number; runs: any[] }[]; startMin: number; endMin: number }) {
  const range = Math.max(1, endMin - startMin);
  const laneWidthPx = 1200;

  return (
    <div style={{ overflow: "auto" }}>
      <div style={{ minWidth: 220 + laneWidthPx }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <div style={{ width: 200, fontSize: 12, opacity: 0.75 }}>Heading</div>
          <div style={{ width: laneWidthPx, fontSize: 12, opacity: 0.75 }}>Time axis</div>
        </div>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.10)" }} />

        {rows.map((row) => (
          <div
            key={row.headingIndex}
            style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
          >
            <div style={{ width: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 12 }}>Heading {row.headingIndex}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{row.runs.length} runs in window</div>
            </div>

            <div style={{ position: "relative", width: laneWidthPx, height: 34, background: "rgba(0,0,0,0.03)", borderRadius: 10, border: "1px solid rgba(0,0,0,0.08)" }}>
              {Array.from({ length: 11 }, (_, i) => i).map((i) => {
                const x = (i / 10) * laneWidthPx;
                return <div key={i} style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1, background: "rgba(0,0,0,0.06)" }} />;
              })}

              {row.runs.map((r, idx) => {
                const a = Math.max(startMin, r.startMin ?? 0);
                const b = Math.min(endMin, r.endMin ?? 0);
                if (b <= a) return null;

                const left = ((a - startMin) / range) * laneWidthPx;
                const width = ((b - a) / range) * laneWidthPx;

                return (
                  <div
                    key={idx}
                    title={[
                      `${r.stageId} (${r.stageName})`,
                      `H${r.headingIndex} R${r.roundIndex}`,
                      `${fmt(r.startMin, 0)} → ${fmt(r.endMin, 0)} min`,
                      r.meta?.resourceKey ? `Resource: ${r.meta.resourceKey} [unit ${r.meta.resourceUnitIndex}]` : "",
                    ].filter(Boolean).join("\n")}
                    style={{
                      position: "absolute",
                      left,
                      top: 6,
                      height: 22,
                      width: Math.max(2, width),
                      background: stageColor(String(r.stageId ?? "STAGE")),
                      border: "1px solid rgba(0,0,0,0.14)",
                      borderRadius: 8,
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      paddingLeft: 6,
                      paddingRight: 6,
                      fontSize: 11,
                      opacity: 0.95,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {String(r.stageId ?? "")}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, opacity: 0.75 }}>{label}</span>
      {children}
    </label>
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

// ---------- Styles ----------
const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 16,
  padding: 14,
  background: "rgba(255,255,255,0.65)",
};

const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.2)",
  cursor: "pointer",
  background: "white",
};

const pillStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.14)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 10,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "white",
  width: 80,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  height: 520,
  resize: "vertical",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "rgba(0,0,0,0.03)",
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
};

const th: React.CSSProperties = { padding: "8px 10px" };
const td: React.CSSProperties = { padding: "8px 10px" };
