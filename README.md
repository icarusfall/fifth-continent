# The Fifth Continent

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A single-player, browser-based god/builder game about smuggling, logistics, and
the two kinds of magic you can use to hide a crime. Design spec and build brief:
[the-fifth-continent-spec.md](./the-fifth-continent-spec.md).

## Status: Milestone 2 — The Crime ✅ (awaiting review)

Twelve sheep, one cart, two roads — and now a third way, across the open
marsh to the shingle, where nobody counts what crosses.

**The crime (spec §6.9):** once the first rent has been felt, a lugger stands
off the shingle on night ∩ falling tide — a walking window the tide gauge
already forecasts, so every run is a timed bet. The Dutchman pays four times
the insulting Ryne price for fleece and sells jenever, tea, and lace from a
finite hold. No credit. The same cart carries both legs; bidirectionality is
discovered as margin, not presented as a feature. The cutting house is the
first player-sited building — placing it generates marsh tracks to the farm,
the shingle, and Ryne, so siting the triangle is the decision — and the depth
of the cut (gentle / standard / deep) trades volume against quality tier.
Ryne buys at fixed prices behind a daily appetite per good: dumping hits a
wall, the first crude taste of §17's second ceiling. Overproof jenever has no
legal buyer at all.

**The squeeze (spec §6.8):** rent is 120 coin every six days, collected at
dawn; perfect lawful play earns 144. Come up short and the agent distrains
sheep at valuation. Lose the flock, lose the tenancy. One good night on the
shingle out-earns a lawful week — the headless smuggler bot ends day 20 with
~6× the lawful ceiling, and the game never says the word "crime" out loud.

Not yet built (by design — see spec §12): the Revenue, cover & heat (route
exposure and storage are recorded, not yet consumed), combat, the trees, the
moving-price market model (§17).

## Run it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 88 tests incl. replay determinism + 2×200 headless games
npm run headless   # play 3 scripted days in Node, no browser
npm run headless 1740 20 smuggler   # twenty days of the Dutchman's argument
```

## Architecture (the rules that matter)

- **The sim is a pure function.** `tick(state, actions) → state` in
  [src/sim](./src/sim). No side effects, no `Date.now()`, no `Math.random()` —
  all randomness comes from a seeded PRNG carried in the state. Zero React
  imports in `/src/sim`; it runs headlessly in Node.
- **A full game is `(seed, actionLog)`.** Replays are byte-identical
  (tested). Saves store both state and action log in localStorage.
- **All balance numbers live in [src/sim/balance.ts](./src/sim/balance.ts).**
  Never inline a magic number.
- **The map is hand-authored** ([src/sim/map.ts](./src/sim/map.ts)) — a 40×30
  tile grid plus a node/edge logistics graph. Roads are edges with capacity,
  latency, exposure, and conditions (the low road is `tideLocked`).
- Rendering is React + SVG reading sim state (M1; the layered-canvas renderer
  of spec §15 comes when entity counts demand it). State container: Zustand
  ([src/state/store.ts](./src/state/store.ts)).

## Deploy

Static Vite build — on Vercel, import the repo, framework preset **Vite**,
done. `npm run build` outputs `dist/`.
