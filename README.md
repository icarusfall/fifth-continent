# The Fifth Continent

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A single-player, browser-based god/builder game about smuggling, logistics, and
the two kinds of magic you can use to hide a crime. Design spec and build brief:
[the-fifth-continent-spec.md](./the-fifth-continent-spec.md).

## Status: M5b — the wight ✅ (awaiting review)

**M5b (spec §6.14):** the marsh notices being used. After enough goods cross
the marsh at night a wight-sign appears near the most-used crossing — a ring
of white stones, the grass inside drowned. Trapping it (iron & salt, plus
staked sheep whose count rises with each binding) binds a wight at dawn,
deterministically; the first binding raises the wight-stone, where marsh
research and tribute live. **Debt** never decays: every use of marsh power
accrues it, each bound wight carries 60, a sheep left at the stone forgives
12 — and when the Debt outruns the bound, three dawns' grace, then they
*collect*: not a raid, not a battle — a person (the wall first, then the
payroll), gone at dawn, permanent. Nobody left to take and they take you.
The three marsh tiers: **Marsh-lantern haulers** (night moves read a tenth
as loud, +1 Debt a run), **Wight-fog** (a battle Call — the raiders fight
half-blind, and it can flip a lost fight — at 8 Debt), and **the Hollow
Way** (one marsh track leaves the world's knowing: no exposure, no
road-stops, +1 Debt every crossing, laden or empty). Ichor green enters the
palette with its owner. The 200-game pass plays discipline against greed:
tribute-keepers are never collected; the greedy lose their carter around
day 37. 276 tests green.

Earlier: **M5 — the cutting house as a working hub ✅.**

**M5 hub pass (spec §6.17):** the cutting house stops being a button and
becomes a building that stores, staffs, and refines two trades at once. Its
own store (cap 32, cover 6 — dispersal, not relief), smouching (1 tea + 1
coin → 2 bulked-tea for the cheap second market), and the fence (uncapped,
0.6×, manual only — automation may not buy its way out of the risk it was
sent into). The refiner runs the whole house at dawn to a standing
instruction — a cut depth and a smouch toggle — for 2 coin a day. The
carter grows up: the hire picker chooses its origin, the cutting house
offers the products it makes before they exist, orders carry `backTo` (the
backhaul drops at a third node on the way home, so one cart runs the whole
owling loop and contraband never enters the wool barn), and a carter who
cannot sell waits at the sated market, exposed, two days at most. The
Riding Officer gained the book audit: the dawn after each rent day the farm
is his target regardless of stains — found by the Beat-3 distribution pass,
where a hub run entirely off-farm never had its wool ledger opened and
crime-only out-earned crime-behind-an-alibi until the audit closed the
loop. The 200-game hub pass asserts the §18 claims: without the lawful leg
the barn silts and the clip rots on the sheep's backs, and the hub earns
less running hotter. 243 tests green.

Earlier: **M5a — the bench and the soft hand ✅.** (spec §6.14–6.16): the difficulty dial (gentle/fair/hard, chosen at
new game, lowerable mid-run and never raisable) scaling rent, heat gained,
and the raid muster — never the player's own yields. Mercy, diegetic and
priced: the Dutchman covers a short rent at a vig and takes half of every
sale until his book clears; the parish vouches when distraint would end the
tenancy; existential events keep their distance from one another. The hired
shearer completes the Satisfactory promise — shear, haul, sell, rent, all
hands-free — and the fully hired farm pays the rent *to the coin*. The flock
market (buy dear, sell cheap, pasture-capped) grows alibi, not lawful income:
Ryne's fleece appetite now sits just over the starting clip, so a grown
flock's surplus is owling. The research bench opens with trade tier 1, the
false-bottom cart.

Earlier: **M4 — Force ✅** (spec §6.12–6.13, §14; signed off 2026-07-17).

Earlier milestones, still standing as built — M4: fortification tiers and
the visibility trade-off, the garrison and Standing, deterministic Lanchester
attrition combat with morale and rout, the Hawksmere raid, the Crown's
escalation off national Heat, the watchable battle with the three Calls, and
the event-card system that pauses the world on the moments that matter.

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

Not yet built (by design — see spec §12): Leiden and Publication (M5c),
dykes (M5½), bribes/informers/decoys, alliances and endings (M6), the
moving-price market model (§17).

## Run it

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 243 tests incl. replay determinism + headless game batches
npm run headless   # play 3 scripted days in Node, no browser
npm run headless 1740 20 smuggler   # twenty days of the Dutchman's argument
npm run headless 1740 30 hub        # a month of the cutting house as a hub
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
