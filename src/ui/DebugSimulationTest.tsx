// src/ui/DebugSimulationTest.tsx
import React, { useMemo, useState } from "react";

import { defaultScenario as importedDefaultScenario } from "../models/defaultScenario";
import type { Scenario, BlastTiming } from "../models/defaultScenario";
import { simulate } from "../engine/simulate";

type BlastTimingUiOption = { value: BlastTiming; label: string };

const BLAST_TIMING_OPTIONS: BlastTimingUiOption[] = [
  { value: "midshift", label: "Immediate (as soon as ready)" },
  { value: "endOfShift", label: "End of shift" },
];

// Adapter so UI never crashes even if scenario shape drifts during refactors
function normalizeScenario(partial: any): Scenario {
  const s = partial ?? {};
  const shift = s.shift ?? {};
  const durations = s.durations ?? {};

  return {
    simDays: Number.isFinite(s.simDays) ? s.simDays : 30,
    tickMin: Number.isFinite(s.tickMin) ? s.tickMin : 5,
    headings: Number.isFinite(s.headings) ? s.headings : 2,
    metresPerRound: Number.isFinite(s.metresPerRound) ? s.metresPerRound : 3.8,

    shift: {
      shiftDurationMin: Number.isFinite(shift.shiftDurationMin) ? shift.shiftDurationMin : 720,
      blastTiming:
        shift.blastTiming === "midshift" || shift.blastTiming === "endOfShift"
          ? shift.blastTiming
          : "endOfShift",
    },

    durations: {
      drill: Number.isFinite(durations.drill) ? durations.drill : 180,
      charge: Number.isFinite(durations.charge) ? durations.charge : 60,
      muck: Number.isFinite(durations.muck) ? durations.muck : 240,
    },
  };
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 px-5 py-3">
        <div className="text-sm font-semibold text-gray-900">{title}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-center gap-3">
      <div className="text-sm text-gray-600">{label}</div>
      {children}
    </div>
  );
}

function NumberInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      type="number"
      className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-200"
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-200"
    />
  );
}

function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        "h-9 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900",
        "hover:bg-gray-50 active:bg-gray-100",
        className,
      ].join(" ")}
    />
  );
}

export default function DebugSimulationTest() {
  const [scenario, setScenario] = useState<Scenario>(() =>
    normalizeScenario(deepClone(importedDefaultScenario))
  );

  const result = useMemo(() => {
    try {
      const kpis = simulate(scenario);
      return { ok: true as const, kpis };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [scenario]);

  const setBlastTiming = (timing: BlastTiming) => {
    setScenario((s) => normalizeScenario({ ...s, shift: { ...s.shift, blastTiming: timing } }));
  };

  const setShiftDuration = (v: number) => {
    setScenario((s) => normalizeScenario({ ...s, shift: { ...s.shift, shiftDurationMin: v } }));
  };

  const setTopLevel = (
    key: "simDays" | "tickMin" | "headings" | "metresPerRound",
    v: number
  ) => setScenario((s) => normalizeScenario({ ...s, [key]: v }));

  const setDuration = (key: keyof Scenario["durations"], v: number) => {
    setScenario((s) => normalizeScenario({ ...s, durations: { ...s.durations, [key]: v } }));
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xl font-semibold text-gray-900">Debug Simulation</div>
            <div className="text-sm text-gray-600">Engine smoke test + scenario controls</div>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => setScenario(normalizeScenario(deepClone(importedDefaultScenario)))}>
              Reset defaults
            </Button>
            <Button onClick={() => setScenario((s) => normalizeScenario({ ...s, simDays: 2 }))}>
              Fast run (2 days)
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Scenario">
            <div className="space-y-3">
              <Field label="Blast timing">
                <Select
                  value={scenario.shift.blastTiming}
                  onChange={(e) => setBlastTiming(e.target.value as BlastTiming)}
                >
                  {BLAST_TIMING_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Shift duration (min)">
                <NumberInput
                  value={scenario.shift.shiftDurationMin}
                  onChange={(e) => setShiftDuration(Number(e.target.value))}
                />
              </Field>

              <div className="my-2 border-t border-gray-200" />

              <Field label="Sim days">
                <NumberInput
                  value={scenario.simDays}
                  onChange={(e) => setTopLevel("simDays", Number(e.target.value))}
                />
              </Field>

              <Field label="Tick (min)">
                <NumberInput
                  value={scenario.tickMin}
                  onChange={(e) => setTopLevel("tickMin", Number(e.target.value))}
                />
              </Field>

              <Field label="Headings">
                <NumberInput
                  value={scenario.headings}
                  onChange={(e) => setTopLevel("headings", Number(e.target.value))}
                />
              </Field>

              <Field label="Metres / round">
                <NumberInput
                  step="0.1"
                  value={scenario.metresPerRound}
                  onChange={(e) => setTopLevel("metresPerRound", Number(e.target.value))}
                />
              </Field>

              <div className="my-2 border-t border-gray-200" />

              <Field label="Drill (min)">
                <NumberInput
                  value={scenario.durations.drill}
                  onChange={(e) => setDuration("drill", Number(e.target.value))}
                />
              </Field>

              <Field label="Charge (min)">
                <NumberInput
                  value={scenario.durations.charge}
                  onChange={(e) => setDuration("charge", Number(e.target.value))}
                />
              </Field>

              <Field label="Muck (min)">
                <NumberInput
                  value={scenario.durations.muck}
                  onChange={(e) => setDuration("muck", Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>

          <Card title="Result">
            {!result.ok ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <div className="mb-1 font-semibold">Simulation error</div>
                <div className="whitespace-pre-wrap">{result.error}</div>
              </div>
            ) : (
              <pre className="max-h-[520px] overflow-auto rounded-xl bg-gray-100 p-3 text-xs leading-5 text-gray-900">
                {JSON.stringify(result.kpis, null, 2)}
              </pre>
            )}
          </Card>

          <Card title="Scenario JSON">
            <pre className="max-h-[520px] overflow-auto rounded-xl bg-gray-100 p-3 text-xs leading-5 text-gray-900">
              {JSON.stringify(scenario, null, 2)}
            </pre>
          </Card>
        </div>
      </div>
    </div>
  );
}
