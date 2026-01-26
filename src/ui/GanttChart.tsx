// src/ui/GanttChart.tsx
import React from "react";
import type { GanttInterval } from "../engine/simulate";

const STAGE_LABEL: Record<string, string> = {
  DRILL: "Drill",
  CHARGE: "Charge",
  BLAST_READY: "Blast ready",
  WAITING_FOR_BLAST: "Waiting blast",
  MUCK: "Muck",
};

const STAGE_COLOR: Record<string, string> = {
  DRILL: "#bfdbfe", // light blue
  CHARGE: "#fde68a", // light amber
  BLAST_READY: "#e9d5ff", // light purple
  WAITING_FOR_BLAST: "#e5e7eb", // light gray
  MUCK: "#bbf7d0", // light green
};

export default function GanttChart({
  simMinutes,
  intervals,
}: {
  simMinutes: number;
  intervals: GanttInterval[];
}) {
  if (!intervals || intervals.length === 0) {
    return <div style={{ fontSize: 13, opacity: 0.7 }}>No timeline data.</div>;
  }

  const total = Math.max(1, simMinutes);
  const headingIds = Array.from(new Set(intervals.map((x) => x.headingId))).sort();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Timeline (0 → {simMinutes} min)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {headingIds.map((hid) => {
          const row = intervals.filter((x) => x.headingId === hid);

          return (
            <div
              key={hid}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", opacity: 0.85 }}>
                {hid}
              </div>

              <div
                style={{
                  position: "relative",
                  height: 32,
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "white",
                  overflow: "hidden",
                }}
              >
                {row.map((seg, i) => {
                  const leftPct = (seg.startMin / total) * 100;
                  const widthPct = ((seg.endMin - seg.startMin) / total) * 100;

                  return (
                    <div
                      key={i}
                      title={`${STAGE_LABEL[seg.stage] ?? seg.stage}: ${seg.startMin} → ${seg.endMin} min`}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: STAGE_COLOR[seg.stage] ?? "#e5e7eb",
                        borderRight: "1px solid rgba(255,255,255,0.8)",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, opacity: 0.8 }}>
        {Object.keys(STAGE_LABEL).map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 4,
                background: STAGE_COLOR[k] ?? "#e5e7eb",
                border: "1px solid rgba(0,0,0,0.10)",
              }}
            />
            <span>{STAGE_LABEL[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
