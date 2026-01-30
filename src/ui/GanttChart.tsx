// src/ui/GanttChart.tsx
import React from "react";
import type { GanttInterval, WaitForResource } from "../engine/simulate";

const STAGE_LABEL: Record<string, string> = {
  DRILL: "Drill",
  CHARGE: "Charge",
  BLAST_READY: "Blast ready",
  REENTRY: "Re-entry",
  WAITING_FOR_BLAST: "Waiting blast",
  MUCK: "Muck",
  SUPPORT: "Support",
  WAITING_FOR_RESOURCE: "Waiting resource",
};

const STAGE_COLOR: Record<string, string> = {
  DRILL: "#0c77f9", // blue
  CHARGE: "#fb0707", // red
  BLAST_READY: "#e9d5ff", // purple
  REENTRY: "#fdba74", // orange
  WAITING_FOR_BLAST: "#e5e7eb", // grey
  MUCK: "#13b54b", // green
  SUPPORT: "#c1996b", // brown / sand
  WAITING_FOR_RESOURCE: "#5c5b5b", // dark grey
};

const WAIT_FOR_LABEL: Record<WaitForResource, string> = {
  drillRigs: "Drill rig",
  lhds: "LHD",
  supportCrews: "Support crew",
  blastCrews: "Blast crew",
};

type Props = {
  simMinutes: number;
  intervals: GanttInterval[];
  shiftsPerDay: 2 | 3;
};

function buildShiftMarkers(simMinutes: number, shiftsPerDay: 2 | 3): number[] {
  const total = Math.max(1, simMinutes);
  const step = (24 * 60) / shiftsPerDay; // 720 or 480
  const markers: number[] = [];
  for (let t = step; t < total; t += step) markers.push(t);
  return markers;
}

function segTitle(seg: GanttInterval) {
  if (seg.stage === "WAITING_FOR_RESOURCE") {
    const w = seg.waitFor ? WAIT_FOR_LABEL[seg.waitFor] : "resource";
    return `Waiting for ${w}: ${seg.startMin} → ${seg.endMin} min`;
  }
  return `${STAGE_LABEL[seg.stage] ?? seg.stage}: ${seg.startMin} → ${seg.endMin} min`;
}

export default function GanttChart({ simMinutes, intervals, shiftsPerDay }: Props) {
  if (!intervals || intervals.length === 0) {
    return <div style={{ fontSize: 13, opacity: 0.7 }}>No timeline data.</div>;
  }

  const total = Math.max(1, simMinutes);
  const headingIds = Array.from(new Set(intervals.map((x) => x.headingId))).sort();
  const shiftMarkersMin = buildShiftMarkers(total, shiftsPerDay);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        Timeline (0 → {simMinutes} min) • Shifts/day: {shiftsPerDay}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
              <div
                style={{
                  fontSize: 13,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  opacity: 0.85,
                }}
              >
                {hid}
              </div>

              <div
                style={{
                  position: "relative",
                  height: 64, // 2× taller
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                  background: "white",
                  overflow: "hidden",
                }}
              >
                {/* Stage segments (draw first) */}
                {row.map((seg, i) => {
                  const leftPct = (seg.startMin / total) * 100;
                  const widthPct = ((seg.endMin - seg.startMin) / total) * 100;

                  return (
                    <div
                      key={i}
                      title={segTitle(seg)}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: STAGE_COLOR[seg.stage] ?? "#e5e7eb",
                        borderRight: "1px solid rgba(255,255,255,0.8)",
                        zIndex: 1,
                      }}
                    />
                  );
                })}

                {/* Shift boundary markers (draw last; on top of bars) */}
                {shiftMarkersMin.map((m, i) => {
                  const leftPct = (m / total) * 100;
                  return (
                    <div
                      key={`shift-${i}`}
                      title={`Shift boundary @ ${Math.round(m)} min`}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${leftPct}%`,
                        width: 2,
                        background: "red",
                        opacity: 0.9,
                        zIndex: 10,
                        pointerEvents: "none",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
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
