# The Fifth Continent

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A single-player, browser-based god/builder game about smuggling, logistics, and
the two kinds of magic you can use to hide a crime. Design spec and build brief:
[the-fifth-continent-spec.md](./the-fifth-continent-spec.md).

**406 tests green · save v25 · M5½ complete · the clean-sheet UI pass shipped.**

---

## Status: the clean-sheet UI pass ✅ (then M6)

Phone-led, on the dark ink look tidied, in six commits (spec §20, §15.2).
The header is gone: the map fills the screen and the chrome floats — a thin
instrument strip up top (meters appear only when the world gives them
something to say), a bottom bar in the thumb zone. Below 800px every menu
rises as a bottom sheet with the camera easing the place into view above
its own card; a desktop keeps the dock, the spine tab, and the anchored
popovers — same components either side of the line. The overlays became the
promised one-keystroke reading: off → yours (limewash) → theirs (the gossip
stains in Revenue blue) → both, the gap legible as colour disagreement; Tab
cycles it. And §15.2's semantic zoom landed: County (marks, names, traffic
as ribbon thickness — the Revenue's own graphic language), Parish, Yard,
with hysteresis. Long menus fold under their headings; every staged flow
offers a way out on every step; the phone's log is a one-line ticker that
opens into a sheet. GameMap.tsx was split from 3,000 lines into the canvas
shell plus eight menu files. Nothing touches GameState — no save bump.

Earlier: **M5½d — the round, and the meters learn to speak ✅**

Three playtest reports, one pass (spec §6.18, §6.19).

**The raid said nothing.** *"Fully fortified, ten men, still lost."* Measured
against the engine, that was the model working exactly as M5½c specified — its
published ceilings are for **twelve** men. Ten behind full stone hold twelve;
the Company musters fourteen. A second report was 24 Dragoons against twelve,
where every Call loses and only the retreat saves the men. No numbers were
re-tuned. What was missing was a mouth: `defenceCeiling()` asks
`simulateBattle` *itself* how large a force a garrison turns back, so the card
can never drift from the fight it describes. The raid card now states what
these men hold, and on dry ground what the same men would hold **behind a cut
channel** — naming the verb the player has not used. It also says where the
garrison actually *is*: the first report was ten men at the farm while the
Company took the cutting house. The result card writes down faction, muster,
garrison and ground, so the next play report carries its own evidence.

**The heat had no exit.** National Heat decays at 0.995 a dawn and Publication
ratchets its floor upward for ever, so the Dragoon threshold was a one-way
door: soldiers every nine days against a ceiling of five, for the rest of the
game. A *drain* was drafted and rejected — players make every maximum-heat
choice, and nobody deduces the mechanic that lowers a meter. So the cap does
the work. `NATIONAL_HEAT_CAP` is applied **after** the regional spill, so no
road routes around it: soldiers are no longer a consequence of smuggling well,
and must wait on an act the game names aloud (§7). The Crown's muster is capped
too, as M5½c capped the Company — otherwise the cap merely moves the doom clock
down a rung. It is set where **ten men behind water hold it and twelve behind
dry stone do not**, so the answer stays *dig*. The quiet season survives,
demoted to a bonus: four days without a sale and London cools faster.

**The round.** A Steam Lighter that can only ply shingle↔Ryne could be given no
order at all — the beach keeps no store, and the old four-beat sentence bought
only at the turn-around. A standing order is now a **list of stops**, run as a
loop: the player names places, and the verbs are inferred — a market sells, the
shingle deals over the gunwale, a store unloads. Two rules carry it. Only the
stop he is *bound for* acts, because the dispatcher paths across the whole
graph and shingle→Ryne walks by way of the farm; without that, an owling round
drops its lace in the wool barn every lap. And he waits only at the round's
first pick-up — waiting wherever a load fails to appear strands the owl on the
beach every night the lugger misses. The **stock gate is gone**: a stop may
name any good the player knows of, shown as *"none there today"* when the store
is empty, because an order is a sentence about the future. And every step of
the picker can be left — the old one offered a way out on step one only.

---

## How it got here

**M5½c — the water fights back.** Prepared ground is **frontage**: a dug
channel at the foot of the walls admits five abreast, and a crossing is *held,
never owned* — it counts only while there are men enough to man it. The works
give alpha, the water gives the frontage, the men give depth. Three rungs, each
with its own answer: the Company by works and men, the Water Guard by the
water, the Dragoons by nothing you can post. Plus the fourth Call, **Cut the
Crossing** — break your own bank and everyone not yet across stays across, then
the water takes the level back: the channel undug, its grazing drowned, the
tub-boat's road broken, and the parish saw whose spade did it. The strongest
verb in the milestone costs you the milestone.

**M5½a/b — the survey, the spade, and the tub-boat.** Eight named channels of
Romney's old sewers lie on the map once a cutting house stands, each a
surveyor's post you can pay a crew to re-cut. Digging is slow, capital-heavy
and permanent, and every cut lands the whole ideological axis at once: Debt to
the marsh, Standing lost to a parish that calls drainage enclosure, and grazing
for two more head — because drainage manufactures pasture, and pasture
manufactures alibi. Chains of channels link the landings into **waterways**,
and a flat-bottomed tub (12 to the load, quiet as weed) rides them and nothing
else. The blue coat never rides the water; a horse does not row.

**The Wealth Clock (§6.15).** A full economic rebalance after an audit found
the wealth clock running at half the doom clock — earnings up, capital costs
down, the town thirstier, and a 200-seed CI promise that the double fortress is
day-22 money, for ever. Also live: the **Cellar Hide**, **not worth the
candle** (nobody prosecutes a pauper), the ledger's cash-flow forecast, and the
battle drawn as men rather than meters.

**M5c — Leiden.** The philosopher arrives as smuggled cargo: one night a tub is
heavier than the rest, and knocking. House him and his building becomes the
workshop. Each tier he completes seals a **letter to the societies** — send it
and the floor under national Heat rises for ever, or hold it in the strongbox
for Standing, three at most before he downs tools. The tiers: the galvanic
fence, the steam-lighter, and the Aetheric Telegraph. The wights will happily
take him.

**M5b — the wight.** The marsh notices being used. A wight-sign appears near
the most-used night crossing; trapping it binds a wight at dawn. **Debt** never
decays, and when it outruns the bound they *collect* — a person, gone at dawn,
permanent. Marsh-lantern haulers, wight-fog, and the Hollow Way.

**M5/M5a — the hub, the bench, the soft hand.** The cutting house stops being a
button and becomes a building that stores, staffs and refines two trades at
once, with a refiner running it to a standing instruction. The difficulty dial
(lowerable mid-run, never raisable) scales what is done *to* you, never your
own yields; mercy is diegetic and priced. The hired shearer completes the
hands-free lawful round, and the flock market grows alibi rather than income.

**M1–M4.** The cart, the crime, the Revenue, and Force: the node/edge
logistics graph and the two roads; the Dutchman on night ∩ falling tide and the
cutting-house triangle; Heat in two pools with a wholly deterministic Riding
Officer who counts sheep against your own declared yield; then fortification
tiers, the garrison, Lanchester attrition with morale and rout, and the
watchable battle with its three Calls.

---

## Not built yet (by design — spec §12)

- **M6 — alliances and endings**, and with them the Bound Guardian and the
  Great Sluice-Engine.
- **The countermeasure layer (§7):** bribed officers, informers, decoy runs.
  The heat cap makes one of these load-bearing — soldiers now require *a named
  act*, and violence against an officer is the act §7 has always meant.
- **The moving-price market (§17).** Prices are fixed with daily demand caps.

## Run it

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run headless 1740 20 smuggler
```

`npm run dev` plays at http://localhost:5173. `npm test` runs 406 tests,
including replay determinism and the 200-seeded-game batches. The headless
runner takes `[seed] [days] [smuggler|hub|hub-bare]` and defaults to a greedy
carter — `hub` plays a month of the cutting house as a working hub.

## Architecture (the rules that matter)

- **The sim is a pure function.** `tick(state, actions) → state` in
  [src/sim](./src/sim). No side effects, no `Date.now()`, no `Math.random()` —
  all randomness comes from a seeded PRNG carried in the state. Zero React
  imports in `/src/sim`; it runs headlessly in Node.
- **A full game is `(seed, actionLog)`.** Replays are byte-identical (tested).
  Saves store both state and action log in localStorage, and migrate forward in
  place — a family playtest is running, so no save is ever abandoned.
- **All balance numbers live in [src/sim/balance.ts](./src/sim/balance.ts).**
  Never inline a magic number.
- **The map is hand-authored** ([src/sim/map.ts](./src/sim/map.ts)) — a 40×30
  tile grid plus a node/edge logistics graph. Roads are edges with capacity,
  latency, exposure, and conditions (the low road is `tideLocked`).
- Rendering is React + SVG reading sim state (the layered-canvas renderer of
  spec §15 comes when entity counts demand it). State container: Zustand
  ([src/state/store.ts](./src/state/store.ts)).

## Deploy

Static Vite build — on Vercel, import the repo, framework preset **Vite**,
done. `npm run build` outputs `dist/`.
