# Multiblast
Estimating advance rates for various development mining scenarios
Mining Advance Scenario Simulator

A lightweight simulation app for estimating development advance rates in underground mining under different blasting policies, shift configurations, and cycle assumptions.

This project is designed as a vibe coding exercise: fast iteration, transparent assumptions, and safe versioning using GitHub.

🚀 Purpose

The goal of this app is to help answer questions like:

How much advance can I expect per heading and across the system?

How do results change if I:

blast at will vs end-of-shift only?

run 2 vs 3 shifts per day?

change drilling, mucking, or support durations?

Where is time being lost due to blast windows, shift boundaries, or re-entry delays?

The app is intended for scenario comparison, not detailed equipment dispatching.

🧠 What This App Does

For a given scenario, the app:

Simulates a development mining cycle made up of user-defined stages

Applies blasting policy constraints

Accounts for shift structure

Calculates:

rounds per day

advance per day (per heading and system-wide)

efficiency and lost time breakdown

📥 Inputs
Required Inputs

Number of headings

Shifts per day

Shift length (or assumed as 24 ÷ shifts)

Advance per blast (m/round)

Mining cycle stages, each with:

name (e.g. Drill, Charge, Blast, Muck, Support)

duration (minutes or hours)

Blasting Policy Options

Blast at will
→ blasting can occur at any time once charging is complete. If Blast at will is selected, the other headings need to pause all work while blasting continues for one hour.

End-of-shift only
→ blasting is constrained to shift boundaries and is subject to re-entry periods

Optional Constraints

Post-blast re-entry delay = 30 minutes

Maximum blasts per day

Shift change downtime (future enhancement)

📤 Outputs

For each scenario, the app reports:

Rounds per day per heading

Advance per day per heading (m/day)

Total system advance (m/day)

Efficiency metrics

Lost time breakdown, including:

waiting for blast windows

waiting for shift end

re-entry delays

Scenarios can be compared side-by-side.

🧮 Simulation Approach

The model uses a deterministic timeline simulation:

Each heading is simulated independently over a 24-hour day

Cycle stages execute sequentially

When a blast stage is reached:

blast timing is adjusted based on the selected policy

Shift boundaries and waiting time are explicitly modeled

Completed rounds are counted and converted to advance

This approach is:

transparent

explainable

easy to extend later

🧩 Assumptions

Fixed advance per blast

Fixed cycle durations (no randomness in MVP)

No shared equipment constraints (jumbos, LHDs, crews)

No congestion or haulage interference

These are intentional simplifications for fast scenario testing.

🛠 Tech Stack (Planned / Current)

Frontend: React + TypeScript

Charts: Recharts

State: local component state

Persistence: localStorage

Version control: GitHub

(Exact stack may evolve as part of the exercise.)

🗂 Repository Structure
mining-advance-sim/
├── README.md
├── docs/
│   └── design.md
├── src/
│   ├── sim/        # simulation logic
│   ├── ui/         # input & results components
│   └── models/     # scenario & result types
└── tests/

🔁 Version Control Philosophy

This repo follows a safe, incremental Git workflow:

main is always runnable

small, frequent commits

feature branches for major changes

scenario logic kept separate from UI

Commit message style

feat: new functionality

fix: bug fixes

docs: documentation updates

refactor: cleanup / restructuring

Example:

feat: add end-of-shift blasting constraint

🎯 MVP Definition of Done

The MVP is complete when:

A user can define a mining cycle with variable durations

Shifts per day are configurable

Blast-at-will and end-of-shift-only policies are supported

Advance rates and efficiency metrics are produced

Two scenarios can be compared

Scenarios can be exported/imported as JSON

🔮 Future Enhancements

Shared resource constraints (jumbos, LHD fleets)

Multi-day steady-state simulation

Monte Carlo durations

Scenario batch sweeps & sensitivity plots

Stope sequencing and backfill constraints

📌 Why This Exists

This project is deliberately simple, explicit, and transparent.

It’s meant to:

explore mining logic through code

test assumptions quickly

compare operational policies

and serve as a foundation for more realistic models later
