import { DebugSimulationTest } from "./ui/DebugSimulationTest";

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <header>
        <h1 style={{ margin: 0 }}>Multiblast</h1>
        <p style={{ marginTop: 8 }}>
          Simulation engine + scenario model are wired. UI is now a clean shell.
        </p>
      </header>

      {/* Temporary debug panel (safe to remove later) */}
      <DebugSimulationTest />
    </div>
  );
}
