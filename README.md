# The Fifth Continent

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A single-player, browser-based god/builder game about smuggling, logistics, and
the two kinds of magic you can use to hide a crime. Design spec and build brief:
[the-fifth-continent-spec.md](./the-fifth-continent-spec.md).

## Status: Milestone 4 — Force ✅ (signed off; M5 design pass in spec §6.14–6.15)

**M4 (spec §6.12–6.13, §14):** fortification tiers and the visibility
trade-off, the garrison and Standing, deterministic Lanchester attrition
combat with morale and rout, the Hawksmere raid (provoked by your market
footprint), the Crown's escalation off national Heat, the watchable battle
with the three Calls, and the event-card system that pauses the world on the
moments that matter. 171 tests green.

Earlier milestones, still standing as built:

In M2 the crime works; in M3 it costs. Everything recorded since M1 — edge
exposure, time-of-day, tubs sitting still, the ditch — is finally consumed.

**The Revenue (spec §6.10):** Heat in two pools — the parish's, which cools a
little each dawn, and London's, which barely does (the doom clock). Moving
contraband, storing it past a building's cover, selling it in town, even
ditching it all heat the parish, and every act stains its nearest node with
suspicion. Past a threshold a Riding Officer arrives for good: one man, one
horse, entirely deterministic. Each dawn he rides to the sorest stain,
searches, seizes what the cover cannot hide, stops carts that share his road
— and at the farm he counts sheep against the books. The player keeps one
standing number, `declaredYield`: undeclared wool never existed and may
vanish over any gunwale; declared wool must show, and he prices every fleece
adrift. The parish talks over breakfast — a one-key gossip overlay paints
yesterday's Revenue mind on the map. The lawful carter generates exactly no
Heat, ever, and the officer never comes: the quiet verdict on honest wool.

**The wheels (spec §6.11):** carts can be bought (the yard holds three) and a
hired carter takes a standing order — load here, sell or unload there, back
again, 3 coin a day at dawn. He minds the tide and nothing else: not night,
not the blue coat. Automate the alibi; run the tubs yourself.

**The crime (spec §6.9)** and **the squeeze (§6.8)** stand as built in M1–M2:
the Dutchman on night ∩ falling tide, the cutting house triangle, Ryne's
daily appetite, rent and distraint. The 200-game smuggler bot now meets the
officer around day 10, loses the odd load to him, and still ends day 20 far
above the lawful ceiling — crime pays, and now it costs.

Not yet built (by design — see spec §12): the trees, Debt, and Publication
(M5, spec §6.14), the difficulty dial, mercy systems, shearer and flock
market (M5a, spec §6.15–6.16),
dykes (M5½), bribes/informers/decoys, alliances and endings (M6), the
moving-price market model (§17).

## Run it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 171 tests incl. replay determinism + headless game batches
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
