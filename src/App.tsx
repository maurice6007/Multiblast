// src/App.tsx
import React from "react";
import DebugSimulationTest from "./ui/DebugSimulationTest";

export default function App() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Top bar */}
      <header className="border-b border-gray-200">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <div className="text-lg font-semibold">MultiBlast</div>
            <div className="text-sm text-gray-500">Simulation sandbox</div>
          </div>

          <div className="text-sm text-gray-500">
            {/* placeholder for later: scenario presets / export buttons */}
          </div>
        </div>
      </header>

      {/* Main */}
      <main>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <DebugSimulationTest />
        </div>
      </main>

      {/* Footer (optional) */}
      <footer className="border-t border-gray-200">
        <div className="mx-auto max-w-6xl px-6 py-4 text-xs text-gray-500">
          Local dev • Engine: <span className="font-mono">src/engine/simulate.ts</span>
        </div>
      </footer>
    </div>
  );
}
