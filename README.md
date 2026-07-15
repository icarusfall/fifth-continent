# The Fifth Continent

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A single-player, browser-based god/builder game about smuggling, logistics, and
the two kinds of magic you can use to hide a crime. Design spec and build brief:
[the-fifth-continent-spec.md](./the-fifth-continent-spec.md).

## Status: Milestone 1½ — The Yard ✅ (awaiting review)

Twelve sheep, one cart, two roads. The low road floods at high tide; the high
road is slow and passes the Customs House. Fleece → Ryne → an insulting price.

The game opens at Walland Farm — fixed site, glowing gently until first
clicked. Shear is a player verb. Orders are given through popover menus on
the assets themselves; routes appear only once there is something to move.
Rendering is layered Canvas 2D per spec §15.1 — painterly warped terrain (no
visible grid), traced ink coastline, eased drag-pan / cursor-anchored zoom
camera.

**The squeeze (spec §6.8):** you are a tenant. Rent is 120 coin every six
days, collected at dawn; perfect lawful play earns 144. Come up short and the
agent distrains sheep at valuation — shrinking your income now and your alibi
later. Lose the flock, lose the tenancy. The tide gauge forecasts when the low
road floods and clears, so a run is a timed bet, not a coin flip.

Not yet built (by design — see spec §12): the Dutchman, the Revenue, cover &
heat, combat, the trees, the market model.

## Run it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 43 tests incl. replay determinism + 200 headless games
npm run headless   # play 3 scripted days in Node, no browser
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
