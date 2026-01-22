import { useMemo } from "react";
import type { Scenario, Stage } from "../models/types";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

type Props = {
  scenario: Scenario;
  onChange: (s: Scenario) => void;
};

function getStageLabel(stage: Stage): string {
  const s: any = stage;
  return String(s.name ?? s.label ?? s.title ?? "");
}

function getStageMinutes(stage: Stage): number {
  const s: any = stage;
  const v = s.minutes ?? s.durationMin ?? s.durationMinutes ?? s.timeMin ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function ScenarioEditor({ scenario, onChange }: Props) {
  const stages = useMemo(() => (scenario as any).stages ?? [], [scenario]) as Stage[];

  const set = (patch: Partial<Scenario>) => onChange({ ...(scenario as any), ...patch });

  const updateStage = (id: string, patch: Partial<Stage>) => {
    const next = stages.map((st: any) => (st.id === id ? { ...st, ...patch } : st));
    set({ stages: next } as any);
  };

  const addStage = () => {
    const newStage: any = { id: uid(), name: "New stage", minutes: 0 };
    set({ stages: [...stages, newStage] } as any);
  };

  const removeStage = (id: string) => {
    set({ stages: stages.filter((s: any) => s.id !== id) } as any);
  };

  const setBlastStage = (id: string) => {
    // We don’t know your exact Scenario schema, so set common possibilities safely.
    // If your types include one of these, it will “just work”.
    const patch: any = {
      blastStageId: id,
      blastStage: id,
      blastStageIndex: stages.findIndex((s: any) => s.id === id),
    };
    onChange({ ...(scenario as any), ...patch });
  };

  const scenarioName = String((scenario as any).scenarioName ?? (scenario as any).name ?? "");

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0 }}>Scenario</h2>
        <button type="button" onClick={addStage}>
          + Add stage
        </button>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontWeight: 600 }}>Scenario name</label>
        <input
          value={scenarioName}
          onChange={(e) => {
            const v = e.target.value;
            // support either scenarioName or name depending on your model
            if ("scenarioName" in (scenario as any)) set({ scenarioName: v } as any);
            else set({ name: v } as any);
          }}
          placeholder="e.g., Base Case"
        />
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {stages.length === 0 ? (
          <div style={{ opacity: 0.7 }}>No stages yet. Click “Add stage”.</div>
        ) : (
          stages.map((st: any, idx: number) => {
            const id = String(st.id ?? `${idx}`);
            const label = getStageLabel(st);
            const minutes = getStageMinutes(st);

            return (
              <div
                key={id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 10,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 700 }}>
                    Stage {idx + 1}{" "}
                    <span style={{ fontWeight: 400, opacity: 0.7 }}>
                      (id: {id})
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => setBlastStage(id)}>
                      Set as blast stage
                    </button>
                    <button type="button" onClick={() => removeStage(id)}>
                      Remove
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontWeight: 600 }}>Label</label>
                    <input
                      value={label}
                      onChange={(e) => updateStage(id, ({ name: e.target.value } as any) as Partial<Stage>)}
                      placeholder="e.g., Drill"
                    />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontWeight: 600 }}>Minutes</label>
                    <input
                      type="number"
                      value={minutes}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateStage(id, ({ minutes: Number.isFinite(n) ? n : 0 } as any) as Partial<Stage>);
                      }}
                      min={0}
                      step={1}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
