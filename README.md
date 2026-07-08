# Voyage Manager

A modern, browser-based **maritime voyage estimator** — a web re-implementation of
the classic VBA-coded Excel "voyage calculation" spreadsheet used across the
shipping and chartering industry.

Enter a vessel's speed/consumption profile, the sailing legs, the port calls, and
the commercial terms, and the app instantly computes steaming time, bunker
consumption and cost, freight revenue net of commissions, total voyage costs,
**profit/loss**, and the **Time Charter Equivalent (TCE)** per day — exactly the
outputs a chartering desk needs when evaluating a fixture.

> No Excel/VBA source file was supplied with this repository, so the calculation
> logic reproduces the standard, well-established voyage-estimator model that such
> spreadsheets implement. See [Calculation model](#calculation-model) for the exact
> formulas — they are easy to adjust in `src/lib/calc.ts` if your workbook differs.

## Features

- **Voyage estimator** — real-time recalculation as you type.
- **Vessel particulars** — DWT, laden/ballast speed, at-sea and in-port fuel consumption.
- **Sailing legs** — per-leg distance, laden/ballast condition, canal/transit costs.
- **Port calls** — turn time and disbursements for load/discharge/other ports.
- **Commercial terms** — per-MT or lumpsum freight, address & brokerage commission,
  bunker prices, daily opex/hire, misc costs, weather (sea) margin.
- **Results breakdown** — time & distance, bunkers, revenue, costs, and result,
  with headline profit, TCE/day and result/day.
- **Multiple voyages** — create, duplicate, and delete estimates; everything is
  saved locally in your browser (localStorage).
- Clean, responsive UI (desktop and mobile).

## Calculation model

Ported from the typical VBA voyage-estimator workbook (`src/lib/calc.ts`):

```
sea days (per leg) = distance / (speed × 24) × (1 + seaMargin%)
main fuel @ sea     = totalSeaDays × mainConsumption/day
aux fuel @ sea      = totalSeaDays × auxConsumption/day
port fuel           = totalPortDays × portConsumption/day   (billed as aux)
bunker cost         = mainFuel × mainPrice + auxFuel × auxPrice

gross freight       = quantity × rate     (or the lumpsum)
commission          = gross × (address% + brokerage%)
net freight         = gross − commission

voyage costs        = bunkers + port costs + transit/canal + misc
opex                = totalVoyageDays × dailyOpex
total costs         = voyage costs + opex

voyage surplus      = net freight − voyage costs
TCE / day           = voyage surplus / totalVoyageDays
profit              = net freight − total costs
```

## Tech stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite 6](https://vite.dev/) build tooling
- [Tailwind CSS 4](https://tailwindcss.com/) styling
- No backend — state persists in the browser via `localStorage`

## Getting started

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check and build for production (outputs to dist/)
npm run preview  # preview the production build
npm run lint     # run ESLint
```

## Project structure

```
src/
├─ lib/
│  ├─ types.ts       # domain types (Vessel, Voyage, VoyageLeg, PortCall, results)
│  ├─ calc.ts        # the voyage-estimator calculation engine (VBA logic port)
│  ├─ factory.ts     # default/sample voyage builders
│  ├─ storage.ts     # localStorage persistence
│  └─ format.ts      # currency/number/date formatting
├─ components/       # UI: forms, editors, results panel, sidebar
├─ App.tsx           # app shell & state management
└─ main.tsx          # entry point
```
