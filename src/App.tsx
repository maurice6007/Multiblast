import { useMemo, useState } from "react";
import "./App.css";



import ResultsPanel from "./ui/ResultsPanel";
import { ScenarioEditor } from "./ui/ScenarioEditor";

import { defaultScenario } from "./models/defaultScenario";
import type { Scenario, SimResult, TimeBreakdownMin } from "./models/types";

function emptyBreakdown(): TimeBreakdownMin {
  return {} as TimeBreakdownMin;
}

export default function App() {
  const [scenario, setScenario] = useState<Scenario>(defaultScenario);

  // Temporary stub result (replace with real simulation later)
  const result: SimResult = useMemo(() => {
    const roundsPerHeading = Array.from(
      { length: scenario.headings },
      () => 2
    );

    return {
      scenarioName: scenario.name,
      roundsPerHeading,
      roundsPerDayAvg: 2.0,
      advancePerHeadingMPerDayAvg: 2.0 * scenario.advancePerRoundM,
      systemRoundsPerDay: roundsPerHeading.reduce((a, b) => a + b, 0),
      systemAdvanceMPerDay:
        roundsPerHeading.reduce((a, b) => a + b, 0) *
        scenario.advancePerRoundM,
      breakdown: emptyBreakdown(),
    };
  }, [scenario]);

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <ScenarioEditor scenario={scenario} onChange={setScenario} />
      <ResultsPanel result={result} />
    </div>
  );
}
