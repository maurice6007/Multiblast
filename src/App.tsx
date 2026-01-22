import { defaultScenario } from "./models/defaultScenario";
import { simulateScenario } from "./engine/simulate";

export default function App() {
  // Test: reduce to 2 shifts/day to force off-shift behavior
  const scenario = {
    ...defaultScenario,
    shiftsPerDay: 2,
  };

  const result = simulateScenario(scenario, {
    simDays: 7,
    hoursPerShift: 8,
    recordRuns: false,
  });

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Multiblast – Simulation Test</h1>

      <h2>Scenario</h2>
      <pre>{JSON.stringify(scenario, null, 2)}</pre>

      <h2>KPIs (7-day simulation)</h2>
      <pre>{JSON.stringify(result.kpis, null, 2)}</pre>
    </div>
  );
}
