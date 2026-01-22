import React from "react";

type TimeBreakdownMin = Record<string, number>;

type SimResult = {
  scenarioName: string;

  roundsPerHeading: number[];
  roundsPerDayAvg: number;
  advancePerHeadingMPerDayAvg: number;

  systemRoundsPerDay: number;
  systemAdvanceMPerDay: number;

  breakdown: TimeBreakdownMin;
};

type Props = {
  result: SimResult | null;
};


function fmt(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export default function ResultsPanel({ result }: Props) {
  if (!result) {
    return (
      <div style={{ padding: 12 }}>
        <h2 style={{ margin: "0 0 8px 0" }}>Results</h2>
        <div style={{ opacity: 0.75 }}>Run a scenario to see results.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ margin: "0 0 4px 0" }}>Results</h2>
        <div style={{ opacity: 0.8 }}>{result.scenarioName}</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>Avg rounds / day</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(result.roundsPerDayAvg, 2)}</div>
        </div>

        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>System rounds / day</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(result.systemRoundsPerDay, 2)}</div>
        </div>

        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>Advance / heading (m/day)</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {fmt(result.advancePerHeadingMPerDayAvg, 2)}
          </div>
        </div>

        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <div style={{ opacity: 0.75, marginBottom: 4 }}>System advance (m/day)</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmt(result.systemAdvanceMPerDay, 2)}</div>
        </div>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px 0" }}>Time breakdown (min/day)</h3>

        {/* This is defensive because TimeBreakdownMin might be a map or an array depending on your model */}
        {Array.isArray((result as any).breakdown) ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(result as any).breakdown.map((b: any, idx: number) => (
              <li key={idx}>
                <b>{String(b.label ?? b.name ?? "Item")}:</b> {fmt(Number(b.minutesPerDay ?? b.minutes ?? 0), 1)}
              </li>
            ))}
          </ul>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {Object.entries(result.breakdown as any).map(([k, v]) => (
              <li key={k}>
                <b>{k}:</b> {fmt(Number(v), 1)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
