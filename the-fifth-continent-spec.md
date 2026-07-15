# THE FIFTH CONTINENT — Design Spec & Build Brief

> *"The world is divided into Europe, Asia, Africa, America — and Romney Marsh."*

A top-down god/builder game about smuggling, logistics, and the two kinds of magic you can use to hide a crime.

---

## 0. BRIEF TO CLAUDE CODE

You are building a single-player, browser-based strategy/builder game. Read this entire document before writing code. **Do not build the whole thing.** Build Milestone 1 (§10) and stop for review.

**Stack (non-negotiable unless you flag a strong reason):**
- TypeScript + React + Vite
- **The simulation is a pure function.** `tick(state: GameState, actions: Action[]): GameState`. No side effects, no `Date.now()`, no `Math.random()` — all randomness from a seeded PRNG carried *in* the state. This is the single most important architectural rule in the project.
- Sim lives in `/src/sim` with **zero React imports**. It must be runnable headlessly in Node.
- Rendering: SVG or Canvas 2D. No game engine, no physics library.
- State container: Zustand, wrapping the pure sim.
- Tests: Vitest. Every formula in §6 gets a unit test. A full game must be replayable from `(seed, actionLog)` and produce a byte-identical final state.
- Persistence: serialise `GameState` to JSON → localStorage. Deployment target is Vercel (static).

**Why the purity rule matters:** this is a long-lived vibe-coded project. A deterministic, replayable, headless sim means bugs are reproducible, balance can be tested by simulating 1,000 games overnight, and future sessions can reason about the code without running it.

---

## 1. SETTING

Deliberately unmoored in time. Roughly 1740–1810, but do not research or defend any date. Nothing in the game states a year. If the fiction wants a steam engine and a matchlock in the same scene, it gets them.

- **The Gault** — the marsh. Reclaimed, drowned, reclaimed again. Sea walls are lids. Under the clay is older water and older things.
- **Ryne** — the port on the hill. Cinque-Ports-ish, silting up, quietly furious about it. Customs House, quay, the Mermaid-ish inn.
- **Applesham** — the upcountry market town. Buyers, banks, respectability.
- **the City** — never seen, never described. Prices come from there. So do Dragoons.
- **Leiden** — across the water. Where jenever, tea, lace, and natural philosophers all come from, in the same boats.

Tone: dry, mercantile, slightly menacing. Think Kipling's *A Smuggler's Song* crossed with *The Old Kingdom*. The horror is bureaucratic before it is supernatural.

---

## 2. THE CENTRAL INVERSION

In Factorio, throughput is unambiguously good. Here:

> **Throughput generates evidence. Fortification generates evidence. Everything that makes you strong makes you legible.**

The player is building a factory that must not look like a factory. Every building has:
- a **true function** (what it does for you)
- a **cover function** (what it appears to do)
- a **cover capacity** (how much illicit throughput its appearance can plausibly absorb)

A tannery stinks, so it hides a still. A church tower is entered at odd hours anyway. A farm's carts are already on that road. Push illicit flow through a building beyond its cover capacity and it **leaks**: Heat accrues and the Revenue's model of you sharpens.

Placement is therefore a puzzle of **matching illicit flow to plausible mundane flow**.

---

## 3. RESOURCES

| Resource | Notes |
|---|---|
| **Coin** | Obvious. Spending it visibly costs Cover (see Conspicuous Spend, §6.5). |
| **Goods** | Typed commodities with quality tiers (§4). |
| **Cover** | Per-building, not global. The aggregate plausibility of your operation. |
| **Heat** | Per-region + national. The Revenue's certainty. Never fully decays. |
| **Standing** | The country people. Hide tubs for free, warn you of patrols, lie to officers. Spent by violence, informing, and enclosure. At zero, someone talks. |
| **Ichor** | Wight-derived. Harvested by binding or gifted by covenant. Fuels marsh magic. |
| **Phlogiston** | Leiden-derived. Made from coal, glass, brass and nonsense. Fuels natural philosophy. |

Standing is the sleeper resource. New players ignore it and lose.

---

## 4. GOODS & PRODUCTION CHAINS

Bidirectional flow through the same chokepoints is the core logistics tension. A boat that sails empty one way halves your margin.

**OUTBOUND (owling — export of wool is the crime):**
```
Fleece --[Fulling]--> Cloth --[Packing]--> Woolpack --[BOAT]--> Coin (Leiden price, 4x domestic)
```

**INBOUND (running):**
```
Jenever (overproof, in tubs) --[Cutting: water + burnt sugar]--> "Brandy" (3 tiers by skill)
Bohea tea --[Smouching: ash & sloe leaves, dyed]--> Bulked Tea (volume x2, quality down)
Lace --[no processing]--> high value, low bulk, easy to hide
```

Refining is where margin lives — and every refining stage is another building that must be covered. The *cutting house* is the highest-value, highest-risk building in the early game.

**Quality tiers** (Rough / Fair / Gentleman's) set the Applesham and City price. Selling Rough goods to a gentleman buyer costs Standing with that buyer permanently.

---

## 5. LOGISTICS: NODES AND EDGES, NOT BELTS

**Do not build a belt/conveyor system.** Build a directed graph.

- **Nodes** = buildings, beaches, hides, the quay, town gates.
- **Edges** = routes, with four properties:
  - `capacity` (goods per run)
  - `latency` (ticks)
  - `exposure` (base Heat per unit moved)
  - `condition` (tide-locked, night-only, moon-locked, floods)

Carts, ponies, and boats are **haulers** assigned to edges. You get ~80% of the Factorio optimisation pleasure for ~20% of the simulation complexity, and the graph is what the Revenue is trying to *infer*.

**The low road floods at high tide. The high road is slow and passes the Customs House.** That single fact should teach the player everything about this game in the first ten minutes.

---

## 6. FORMULAS (implement these; tune later)

### 6.1 Cover & Leak
```
buildingLoad      = illicitUnitsThroughBuildingThisTick
coverCapacity     = base[buildingType] × coverUpgrades × standingModifier
leak              = max(0, buildingLoad - coverCapacity)
heatFromBuilding  = leak × LEAK_COEFF × (1 + fortificationVisibility)
```

### 6.2 Route exposure
```
heatFromRoute = unitsMoved × edge.exposure × timeOfDayMod × weatherMod × (1 - concealmentTech)
```
`timeOfDayMod`: night 0.4, dusk 0.7, day 1.0. `weatherMod`: fog 0.3, clear 1.0.

### 6.3 Heat decay
```
regionalHeat = regionalHeat × 0.97 per day     // decays
nationalHeat = nationalHeat × 0.995 per day    // barely decays
```
Regional heat spilling over a threshold **promotes** into national heat. National heat never resets. This is the doom clock.

### 6.4 Fortification visibility
```
fortificationVisibility = Σ(tier × VISIBILITY[techType]) / concealmentOfBuilding
```
Concealment tech (marsh) reduces it. Steam engines (Leiden) *increase* it substantially — Leiden's apparatus is enormous and visibly weird.

### 6.5 Conspicuous spend
Coin spent on non-productive assets (a fine house, a carriage, a pew) raises **regional Heat** but raises **Standing with gentry buyers**. Getting rich is itself a tell.

### 6.6 Revenue inference (see §7)
```
suspicion[node] += observedActivity × officerCompetence × (1 - bribed[officer])
```

### 6.7 M1½ — the farm, shearing, road latency
The farm is given, not chosen: the game begins at Walland Farm, on a fixed
marsh site (`FARM_SITE`). *(An earlier draft let the player site the farm
first; reversed — an empty map with one consequence-free decision taught less
than a farm that glows until first clicked. Placement machinery stays in the
map code: M2+ buildings will need it, with real trade-offs attached.)*
```
FARM_SITE         fixed, on the open marsh; farm, flock, cart and both road
                  edges exist from tick 0, and the rent clock starts at once
roadLatency       = max(1, round(pathTileLength × ticksPerTile[road]))
                  ticksPerTile: low road 0.26 (flat, direct), high 0.53 (climbs)
fleeceReady      += flockSize × FLEECE_PER_HEAD_PER_DAY at dawn (wool on the
                  sheep's backs, not in the store)
shear             farmStore.fleece += fleeceReady; fleeceReady = 0 (a player
                  verb at the farm, not an automatic process)
```
Flock numbers (size, wool ready) are shown in the farm menu; there is no
"tend" verb — a button with no formula teaches players that buttons lie.
Flock inspection gets a real home in the Ledger (§20.1) when §19.2 gives the
flock its job in M3. On a fresh game the farm pulses gently until the player
first opens its menu — the one non-diegetic affordance the opening allows
itself.

### 6.8 M1½ — rent (the first squeeze)
You are a tenant grazier. The landlord is in Applesham; his agent is punctual.
Rent is the one running cost — §19.1 stays cut (no feed, no repair chores);
this is a single number and a deadline, and it makes the domestic wool price
legible as an insult rather than an adjective.
```
RENT_AMOUNT      = 120 coin
RENT_PERIOD_DAYS = 6      // first due at dawn, RENT_PERIOD_DAYS days after placement
at each due dawn:
  paid      = min(coin, RENT_AMOUNT); coin -= paid
  shortfall = RENT_AMOUNT - paid
  seized    = min(flockSize, ceil(shortfall / SHEEP_VALUE))   // SHEEP_VALUE = 10
  flockSize -= seized     // distraint: the agent takes sheep at valuation
  if flockSize reaches 0 → the tenancy is forfeit (loss)
```
Perfect lawful play earns 144 coin per period against 120 rent. You can
survive on wool; you cannot live on it. Distraint compounds: every seized
sheep shrinks future income now and the smuggler's alibi later (§19.2).
This arithmetic is the Dutchman's opening argument in M2.

---

## 7. THE REVENUE — A LEARNING ADVERSARY

**Not a random-raid system.** The Revenue maintains its own data structure:

```ts
interface RevenueModel {
  suspicion: Map<NodeId, number>;      // where they think goods move
  watched: Set<NodeId>;                // under active observation
  informers: Set<PersonId>;            // turned members of your network
  knownEdges: Set<EdgeId>;             // routes they've mapped
  patrolSchedule: PatrolPlan;          // derived from the above
}
```

The player sees a **fogged, lagging copy** of this — the Revenue's map of you, as best your own informers can reconstruct it. This is the central UI panel and the game's best idea. Countermeasures are investments against a *specific inference*, not against a dice roll.

**Countermeasures:** decoy runs (feed them a false edge), bribed officers (blind spot in the patrol map), creeping (sink tubs on weighted ropes offshore, recover later — costs latency, kills exposure), tunnels, false-bottomed carts, the church tower.

**Escalation ladder (national heat):**
1. Riding Officer — one man, corruptible, on a horse.
2. Preventive Water Guard — a cutter offshore. Now your *boats* are the problem.
3. Coast Blockade — permanent, incorruptible, a wall of navy.
4. **Dragoons.** Military. They do not investigate. They burn things.

**Violence against officers spikes national heat catastrophically.** Killing a Riding Officer is the single fastest way to lose the game. (This is what destroyed the real Hawkhurst Gang and it should destroy the player too.)

**Customs vs Excise:** two Revenue services that loathe each other. Feed one information about the other and both are degraded. A high-skill play, available mid-game.

---

## 8. THE THREE TREES

Each tree is researched, tiered (Mega-Lo-Mania style), and **each has a fortification line, a logistics line, and a concealment line**. You will not have the resources for all three trees. Choose.

### 8.1 THE TRADE TREE (baseline — no magic)
Available from the start. Ledgers, warehouses, pack-ponies, bribes, blunderbusses, mantraps, dogs, spiked hedges, false walls, the loyalty of the parish.

*Fortification:* Dogs → Bolted doors & spiked hedge → Blunderbuss men → Gunported barn → The Fortified Farm.
*Concealment:* Cellar hide → False-bottom cart → The Church Tower → Tunnels → Bought Officer.

### 8.2 MARSH MAGIC (Ichor) — **coerced**
Unlocked by trapping and binding a **marsh-wight**. Native, unlogged, *invisible to the Revenue* — no paperwork exists for it. But binding degrades the land, and the wights keep accounts.

*Fortification:* Bog-swallow (ground opens) → Wight-fog → Hollow Ways (routes that aren't there) → The Drowning → **Bound Guardian**.
*Logistics:* Marsh-lantern haulers (move at night, exposure ×0.1) → Tide-calling → Ways Between (teleport-ish, capacity 1).
*Cost:* every use accrues **Debt**. Debt is not Heat. Debt does not decay. When Debt exceeds your bindings, the wights come and they do not raid — they *collect*, and what they take is people.

Cheap now. Mortgaged later. The cheap way to hide from the state is the way that ruins the land.

### 8.3 NATURAL PHILOSOPHY (Phlogiston) — **courted**
Unlocked by the **Leiden philosopher**, who arrives *as smuggled cargo* — he is landed in a tub, uninsured, and must be housed in a building with spare cover capacity, exactly like a cask of brandy. You did not choose him. He was in the shipment.

**Madcap steampunk, not real science.** Galvanic tubs, phlogistic condensers, the Aetheric Telegraph, mechanical owls, a steam-ram, the Great Sluice-Engine. Nothing works the way physics works and nobody in the game notices.

*Fortification:* Galvanic fence → Steam-ram → The Mechanical Owl (patrols, spots patrols) → Phlogistic Sluice-Cannon (floods the marsh at will).
*Logistics:* Steam-lighter → Pneumatic tube (Applesham line) → The Aetheric Telegraph (see the Revenue model in real time).
*Cost:* **He publishes.** He wants credit, he writes letters, the Royal Society reads them — and so does the Revenue. Every tier researched adds permanent national Heat. His apparatus is enormous and eats cover. You can suppress the letters, which costs Standing (he is well liked) and eventually costs him.

Coerce vs. court. Both are betrayals, in different directions.

---

## 9. FACTIONS, RAIDS & ALLIANCES

### The three adversaries and their orthogonal counters

| Adversary | Wants | Beaten by | Useless against them |
|---|---|---|---|
| **The Revenue** | Evidence | Cover, bribery, concealment | Force (summons Dragoons) |
| **The Hawksmere Company** | Your routes, beaches, buyers | Force | Concealment (they know who you are) |
| **The Wights** | Debts paid, land unbroken | Oath, tribute, iron & salt | Both |

**A fortified building is a visible building.** You cannot be hard against Hawksmere and invisible to the Revenue *in the same place*. Zone your empire: hidden things here, hard things there, goods routed between. This is the core spatial puzzle.

### Raid resolution
Full attrition combat. **See §14 — do not implement a single-roll siege check.**

### Alliances — each one *closes* a door

- **The Hawksmere Company.** They defend you and their strength is real. They take **30% of all inbound goods**, and you inherit their national Heat *and their crimes* — when they murder an officer, the Dragoons come for you too. Breaking the pact means war with the strongest faction on the map.
- **The Revenue.** Turn informer / buy an officer. You get a permanent blind spot in the patrol map and advance warning of raids. It costs **Standing**, hard, and it is discoverable — if the parish finds out, you lose the country people entirely, and with them every free hide on the marsh.
- **The Wights.** A covenant. They gift Ichor rather than yielding it under duress: fog, hollow ways, drowned pursuers, no Debt. But the covenanted land can **never be drained, walled, enclosed, or engined**. This hard-caps the Leiden tree and locks you out of the Engine ending.

---

## 10. THE TUTORIAL IS THE STORY

**Zero text walls. No tutorial panels.** The principle: *never introduce a mechanic before the player has a problem it solves.* Each rung is caused by the previous one. Total dialogue budget for the entire opening: **about six lines.**

1. **Cart wool to Ryne.** Twelve sheep, one cart. Teaches routes, capacity, latency — and the tide-locked low road vs the slow high road past the Customs House.
2. **The price is insulting.** The market screen shows why: wool cannot legally leave the country, and the domestic buyers know it. The player *feels* a policy without reading about one.
3. **A Dutchman on the shingle offers four times.** Night, falling tide. Your existing product is *already contraband*. The player doesn't choose to become a criminal — they choose whether to accept the actual value of their own labour. **This is the inciting incident and it is emergent, not narrated.**
4. **Your cart comes back empty.** Pure logistics pain. He offers to fill it. Bidirectionality discovered by feeling the inefficiency first.
5. **A Riding Officer appears on the coast road.** Cover is introduced as the solution to a problem the player already has. The Revenue *counts your sheep* — the fleece must match the cart. **Cover is bookkeeping.**
6. **Sheep start going missing. Lights on the marsh.** The wight arrives as a *pest*, not a power. Confronting it, the deal available is: it will hide your cargo, if you feed it. Marsh magic enters as a **logistics tool**.
7. **A tub washes up with a man inside.** Leiden. He needs housing, funding, and cover. Second tree opens.

By rung 7 the player has learned routes, tides, prices, cover, heat, bidirectional flow, and both magic systems purely by needing each one.

---

## 11. VICTORY

Three endings, one per tree. All three are, in their way, a kind of loss.

- **RESPECTABILITY.** Buy the tannery, the church, the Riding Officer, and half of Applesham. Marry up. Get your son into Parliament. Exit the game legitimate and rich, and let someone else run the marsh. *(Everything changes so that everything can stay the same.)*
- **THE FREE MARSH.** Full covenant. The sea wall opens, the Revenue drowns, the land closes behind you. You are no longer a smuggler because there is no longer a border. The marsh keeps you.
- **THE ENGINE.** Complete Leiden's Great Sluice-Engine. It is magnificent, it is absurd, and it is far too visible to hide. Nobody in the game is sure what it is for, including Leiden.

**Loss:** national Heat maxes → Dragoons. Or Standing hits zero → someone talks. Or Debt exceeds bindings → collection.

---

## 12. MILESTONES — BUILD IN THIS ORDER, STOP AT EACH

**M1 — The Cart.** *(Build this now, then stop.)*
- Pure `tick()` sim, seeded PRNG, headless-runnable, full Vitest coverage.
- Hex or square grid map of the Gault. Hand-authored, not generated. ~40×30.
- Node/edge logistics graph. One cart. Fleece → Ryne → Coin.
- Day/night, tide, and the two roads.
- Minimal SVG render + a clock. Ugly is fine. **Correct and deterministic is not optional.**
- Replay test: `(seed, actionLog)` → identical final state.

**M1½ — The Yard.** *(Interface pass, no new adversaries.)* The fixed farm at
Walland with a glow affordance on first play (§6.7), shear as a player verb,
rent and distraint (§6.8), popover menus on the assets themselves, drag-to-pan
/ cursor-anchored zoom (§15.2), painterly warped terrain (§15.3), progressive
disclosure: routes appear only once there is something to move.

**M2 — The Crime.** Dutchman, the beach, inbound goods, cutting house, quality tiers, bidirectional routing.
**M3 — The Revenue.** `RevenueModel`, suspicion inference, the fogged player-facing intel map, cover & leak, first Riding Officer.
**M4 — Force.** Hawksmere, raid resolution, fortification tiers, the visibility trade-off.
**M5 — The Trees.** Ichor and Phlogiston, Debt, Publication, the two unlock events.
**M6 — Alliances & Endings.**

---

## 13. HOUSE RULES

- Sim purity is sacred. If you find yourself importing React into `/src/sim`, you have made a mistake.
- No feature enters the game without a formula in this document. Update the document first.
- Balance numbers live in one file: `/src/sim/balance.ts`. Never inline a magic number.
- Every new mechanic ships with a headless test that plays 200 seeded games and asserts the outcome distribution is sane.
- Nothing in the game states a date. If a player asks what year it is, the answer is "the game does not say."

---

## 14. COMBAT — DETERMINISTIC ATTRITION

**Do not fake this.** Combat is a sub-tick loop *inside the pure sim*. It runs the attrition for real, emits a frame log, and the renderer plays the log back. The player watches something that genuinely happened.

```ts
interface CombatFrame {
  t: number;                    // sub-tick index
  attackers: number;            // headcount, fractional internally
  defenders: number;
  attackerMorale: number;       // 0-100
  defenderMorale: number;
  events: CombatEvent[];        // 'volley' | 'engine_fired' | 'leader_down' | 'rout' | 'reserve_committed'
}

interface CombatLog {
  frames: CombatFrame[];        // 30-50 frames
  outcome: 'attacker_rout' | 'defender_rout' | 'mutual_collapse' | 'paid_off';
  survivors: { attackers: number; defenders: number };
}
```

Render at ~150ms/frame → a battle takes 5–7 seconds to watch. Fully deterministic, fully headless-testable.

### 14.1 Lanchester — and the tech tree chooses the law

**Open ground (aimed fire, SQUARE law):**
```
dDefenders = -alpha_A * Attackers * dt
dAttackers = -alpha_D * Defenders * dt
```
Losses scale with the *enemy's headcount*. Numbers dominate superlinearly — twice the force wins four times as hard. This is what happens when Dragoons form up in a field.

**Prepared ground (unaimed fire, LINEAR law):**
```
dDefenders = -alpha_A * Attackers * Defenders * dt
dAttackers = -alpha_D * Defenders * Attackers * dt
```
Losses scale with *both* sides. Being outnumbered hurts far less, because they cannot bring numbers to bear — they are stumbling through fog on a hollow way, shooting at noises.

> **Wight-fog and Hollow Ways convert an engagement from SQUARE law to LINEAR law.** This is the entire mechanical payoff of the marsh concealment tree. Twelve marsh-farmers can genuinely destroy sixty Dragoons — but only on ground they have prepared.
>
> **The Leiden tree instead raises `alpha`** (galvanic fence, steam-ram: better kill rate per man) and fights the square law head-on. Two completely different battlefield feels, from one equation.

A tile's combat law is a property of the terrain + your placed concealment tech. Show it in the pre-battle readout.

### 14.2 Alpha values (starting point — tune in `balance.ts`)

| Force | alpha | Notes |
|---|---|---|
| Marsh farmers (militia) | 0.10 | Fowling pieces. Cheap, plentiful, they have families. |
| Smuggler crew | 0.18 | Armed, willing, experienced. |
| Riding Officer | 0.15 | |
| Hawksmere Company | 0.30 | Hard men, well armed. |
| Preventive Water Guard | 0.35 | Professionals. |
| Dragoons | 0.55 | |
| Wights | 0.40 | Ignore fortification entirely. Halved by iron & salt. |
| *Fortification bonus* | +0.05/tier | To the defender's alpha. |
| *Galvanic fence* | +0.12 | |
| *Steam-ram* | +0.20 | |
| *Bound Guardian* | +0.35 | Adds Debt every sub-tick it is active. |

### 14.3 Morale — battles end in rout, not annihilation

Real smuggler fights ended when one side ran. Attrition to zero is ahistorical *and* mechanically wasteful — every dead neighbour is a family in the parish that now hates you.

```
morale -= casualtyRateThisFrame * 6 + (leaderDown ? 25 : 0)
if (morale < breakPoint) -> ROUT
```

| Force | Break point | Feel |
|---|---|---|
| Riding Officers | 65 | One volley and they are gone. Paid, not zealous. |
| Hawksmere Company | 35 | They will take real losses first. |
| Preventive Water Guard | 25 | Professionals. |
| Marsh militia (yours) | 55 | They have farms to go back to. |
| Smuggler crew (yours) | 30 | |
| **Dragoons** | **0** | **They do not rout.** |
| **Wights** | **n/a** | **They are not alive and cannot be frightened.** |

Two rows of that table are the whole threat model. `breakPoint = 0` should be visible in the pre-battle readout and should make the player's stomach drop.

### 14.4 The three Calls — player agency inside the loop

Pure spectating is Mega-Lo-Mania's one weakness. The player gets **three Calls per battle**, queued as actions into the sub-tick loop so determinism survives.

- **Commit the Reserve** — held-back men enter at sub-tick *n*. Timing is everything: too early and they are ground down under square law; too late and morale has already broken.
- **Fire the Engine** — one-shot Sluice-Cannon / Bound Guardian. Huge alpha spike, huge Heat or Debt cost.
- **Sound Retreat** — rout *voluntarily*, before morale collapses. Cargo lost, buildings burn, but your people live. **This is usually correct and players will hate doing it.**
- **Pay Them Off** — mid-battle, Coin cost scaled to how badly you are losing. Works on the Company and on Riding Officers. Does **not** work on Dragoons or wights — and the button is rendered **greyed out**, which tells the player everything they need to know without a line of dialogue.

### 14.5 Fog of war
Under wight-fog, the **enemy counter is hidden**. You see your own losses and a shape in the murk. That is a far better use of fog than a graphical effect.

### 14.6 Consequences — combat feeds the economy
```
standingLoss  = friendlyDead * 3
nationalHeat += revenueDead * 40        // one dead officer > a year of running goods
nationalHeat += dragoonDead * 15        // they expect casualties; the offence is that you exist
debt         += guardianActiveFrames * 2
```

---

## 15. ART DIRECTION & RENDERING

### 15.1 Renderer
**Canvas 2D, layered.** Not SVG DOM — hundreds of moving entities plus a battle log playing back will choke the DOM.

- **Layer 0 (static):** terrain, water, roads. Rendered once to an offscreen canvas, redrawn only on zoom-level change or terrain edit.
- **Layer 1 (dynamic):** buildings, carts, boats, people, combat blobs. Redrawn every frame.
- **Layer 2 (overlay):** the Revenue intel map, heat heatmap, route graph. Toggled.
- **Layer 3 (UI):** React, DOM, above the canvas.

Camera is a single transform: `ctx.setTransform(zoom, 0, 0, zoom, -cam.x*zoom, -cam.y*zoom)`.

### 15.2 Navigation
Yes — scroll to zoom, **anchored on the cursor** (the world point under the pointer must not move):
```
worldBefore = screenToWorld(mouse, cam, zoom)
zoom        = clamp(zoom * (1 - deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
worldAfter  = screenToWorld(mouse, cam, zoom)
cam        += worldBefore - worldAfter
```
Also: drag-to-pan (middle mouse or space+drag), edge-scroll, and trackpad pinch (`ctrlKey` on the wheel event).

**The camera is eased.** Pan and zoom set a *target*; the camera lerps toward it
(~20%/frame) and never snaps. Terrain is painted to the static layer as soft
overlapping blobs of palette colour — the tile grid must never be visible.

**Semantic zoom / LOD — three bands, and they are a design feature, not an optimisation:**
- **Far ("the County"):** no buildings, just the route graph — flow volumes as line thickness, Heat as colour. This is the *strategic* view and it is what the Revenue's map looks like too. The player should feel the uncomfortable symmetry.
- **Mid ("the Parish"):** buildings as icons, carts as dots, tide and time visible. The default working view.
- **Near ("the Yard"):** full building art, people, animation, smoke from the still. This is where combat plays out.

### 15.3 Style
**Cartoonish, but sinister.** The reference points are the flat, thick-outlined look of *Kingdom* / *Bad North* / a Chris Riddell illustration, not Stardew pixel art. Rules:

- **Flat fills, no gradients** except water and sky.
- **Thick dark outline** — a single ink colour (`#241C18`, warm near-black), 2–3px at mid zoom, scaled with the camera.
- **Slight hand-wobble** on outlines. A tiny deterministic per-vertex jitter (seeded from tile ID, so it never shimmers) makes flat vector art look drawn rather than generated. This single trick does more for the cartoon feel than anything else.
- **Straight top-down, slight fake-3D lean** on buildings (roofs visible, one wall face). Not true isometric — it complicates the grid maths for no benefit.
- **Palette, tight and deliberate:**

| Role | Hex | Note |
|---|---|---|
| Ink | `#241C18` | All outlines |
| Marsh green | `#7C8B5E` | |
| Marsh green (dark) | `#4F5C3C` | |
| Clay / gault | `#9B8265` | |
| Water (sea) | `#4A6670` | |
| Water (dyke) | `#5E7A7D` | |
| Sheep / lime wash | `#E8E1D2` | |
| Roof tile | `#A85D4A` | Ryne, Applesham |
| **Revenue blue** | `#2E4A6B` | *Only* the Revenue. Never used elsewhere. |
| **Ichor green** | `#6FBF8F` | Unnatural, luminous. *Only* wight things. |
| **Phlogiston orange** | `#E09B3D` | *Only* Leiden things. |
| Heat | `#C4453A` | Overlays only |

The three magic/faction colours are **reserved**. Nothing in the mundane world may use them. The moment a player sees Ichor green in a building they didn't expect, they should know exactly what it means.

### 15.4 Who makes the art — be realistic

| Asset | Who |
|---|---|
| Terrain, water, roads, dykes, fog, heat overlays | **Fable/Claude Code, procedurally.** Generated vector shapes with the wobble trick. This is where an LLM is genuinely strong: parametric, rule-based, deterministic art. |
| UI, panels, icons, the intel map | **Fable/Claude Code.** Hand-written SVG. Strong here. |
| Combat blobs, carts, boats, sheep | **Fable/Claude Code.** Simple enough to be code-drawn. |
| Buildings (~25 of them), wights, the philosopher, portraits | **Not the LLM.** This is illustrative sprite work and an LLM writing SVG paths will produce something technically valid and visually dead. |

For the buildings and characters: either **(a)** use a CC0 asset pack (Kenney.nl is the standard, free, and the flat-outlined style is close to the brief), **(b)** generate raster sprites with an image model against the palette and outline rules above, then use them as PNGs — do not try to vectorise them, and **(c)** if you want it to look truly authored, commission ~25 building sprites. That is the single highest-leverage art spend on the project.

**Do not block M1 on art.** M1 ships with coloured rectangles.

---

## 16. SOUND DESIGN

**Principle: noise is evidence.** Sound is not decoration in this game — it is a mechanic and an intel channel.

### 16.1 Noise as a leak input
Every building gets a `noise` value. It feeds directly into detection:
```
noiseLeak = building.noise * (1 - acousticCover) * distanceFalloff(nearestPatrolRoute)
heatFromBuilding += noiseLeak * NOISE_COEFF
```
`acousticCover` comes from terrain (a dell, a wood, a dyke bank) and from tech.

| Building | Noise | Consequence |
|---|---|---|
| Cellar hide | 0 | |
| Cutting house | 2 | |
| Fulling mill | 4 | Legitimately noisy — *good cover for other noise* |
| Blunderbuss volley | 30 | One-off spike |
| **Steam-lighter** | **12** | |
| **Great Sluice-Engine** | **40** | Audible from the coast road. Site it inland or lose. |
| **All marsh magic** | **0** | Wights are silent. This is the tree's hidden second advantage. |

A fulling mill next to a steam engine masks it. Acoustic cover is a placement puzzle in its own right.

### 16.2 Sound as the intel channel
The player should **hear the Revenue before seeing them**: dogs barking two fields off, hoofbeats on the high road, a cutter's bell offshore, the creak of a Customs boat. Wight presence is announced by the **boom of a bittern** — a real marsh bird whose call is a low foghorn note. Distant, directional, and it means something is awake.

This is why players will keep the sound on, which is the only way sound design survives contact with players.

### 16.3 Standing is a choir
The parish sings — a smuggler's song, hummed low under the ambient bed. **As Standing falls, voices drop out of the mix.** Mid Standing: a few. Low: one old woman. Zero: silence. The player feels their support draining before any number tells them, and Standing never needs a tooltip.

Implement as stacked vocal stems gated on `standing` thresholds.

### 16.4 Adaptive music — stems gated on Heat
| National Heat | Mix |
|---|---|
| 0–20 | Solo melodeon. Sparse, pastoral. |
| 20–50 | Drone enters underneath. |
| 50–80 | Bodhran. The tune begins to fragment; phrases stop resolving. |
| 80+ | **The music stops.** Sea, shingle, and a distant snare drum. |

Silence after fifteen hours of melodeon is the most frightening sound available to this game. Do not waste it on anything else.

### 16.5 Combat audio
- **No music during battles.** Volley, reload, shouting, the rhythm of attrition.
- Casualty rate is audible: the volleys thin out as a side loses men.
- **The rout has a distinct, unmistakable sound** — a break in the rhythm, boots running on shingle.
- Under **wight-fog**: you hear the enemy but cannot count them. The audio mirrors the hidden-counter mechanic exactly.

### 16.6 Ambient palette
Shingle underfoot (the signature Romney sound — nothing else sounds like it), sheep, wind over flat open ground, sluice gates, gulls, church bells, oars in rowlocks, rain on water. **The sea is always present and is louder at high tide** — so the tide is audible without a UI element.

### 16.7 Production
- **Music: record it live.** Accordion drone beds, melodeon/banjo lead lines, close-miked into Ableton. A hobby project that plays its author's own playing is a better hobby project.
- **Field recordings:** Freesound.org (filter CC0 / CC-BY).
- **UI blips:** jsfxr, or Kenney's CC0 audio packs.
- **Web audio layer:** Howler.js. Stems as separate looping tracks with gain crossfades driven by `standing` and `nationalHeat`. Keep it dumb — no procedural synthesis.
- **Determinism note:** audio is a *render-layer concern*. It reads state; it never writes it. Nothing in `/src/sim` may import an audio module.

---

## 17. THE MARKET — PRICE IS THE SECOND CEILING

Prices are **not constants**. Without a market model the game has only one growth limit (Heat); with one it has two, and they push in different directions.

> **You are big enough to move the price.** Flood Applesham with brandy and Applesham's brandy price collapses.

```
price[market][good] = basePrice * (demand / (stock + inflow * lag)) ^ elasticity
stock[market][good] += inflow - consumption      // per tick
```
- `elasticity` per good: lace 0.4 (luxury, inelastic), tea 0.8, brandy 1.0, wool 1.3 (bulk, very elastic).
- **Prices recover slowly.** Dumping is punished for a long time.
- Each market has finite `demand`, scaling with its size.

### 17.1 The consequence: expansion is forced, not unlocked
Saturating your market is the second wall. The only escape is **new markets** — the City, other ports, a second town — which means longer supply lines, more edges, more exposure, more Heat.

**Growth is therefore self-limiting in two directions at once, and the player is squeezed between them.** This is the game's economic engine. Expansion is never a menu unlock; it is forced on you by your own success.

### 17.2 Scarcity, seizure, and treachery
A **Revenue seizure** — of *anyone's* goods — removes stock and **raises the price**. Therefore:

> **Informing on the Hawksmere Company is an economic instrument.** Crash their supply, raise your margin.

Implement this explicitly. It is the most corrosive loop in the game and it costs almost nothing.

### 17.3 Quality and buyers
Quality tier (Rough / Fair / Gentleman's) multiplies price by 0.6 / 1.0 / 1.8. Selling Rough goods to a gentleman buyer permanently damages that buyer relationship. Gentry buyers are also the **Respectability** win path — poison them and you close an ending.

---

## 18. STORAGE — THE INVERSION THAT KILLS FACTORIO BRAIN

> **In Factorio, a full chest is a comfort. Here, it is evidence.**

```
heatFromStorage = storedIllicitUnits * STORAGE_HEAT_COEFF * (1 - concealmentOfStore) per tick
```

- Storage is **scarce, expensive, and radioactive**.
- Contraband generates Heat **every tick it sits still**.
- **You cannot buffer.** Goods must keep moving.
- A blocked route does not idle your factory — it **starts a fire under it**.

Concealed stores (cellar hide, church tower, sunken tubs) reduce the coefficient but have tiny capacity. **Creeping** — sinking tubs on weighted ropes offshore — is near-zero Heat storage at the cost of latency and a recovery risk. It is the only safe warehouse in the game and it is underwater.

This single rule does more to differentiate the game from Factorio than everything else in this document.

---

## 19. HOUSEKEEPING — WHAT TO CUT AND WHAT TO INVERT

### 19.1 Building wear and tear — **CUT**
A maintenance tax with no decision attached. **Exception:** buildings on wight-covenanted or high-Debt land **rot**. Degradation exists only as a *consequence*, never as an upkeep chore.

### 19.2 Livestock — **KEEP, but it is not farming**
No breeding minigame. No feeding. No pasture management.

> **The flock is your alibi.**

Your fleece output must plausibly account for your cart movements. **The Revenue counts your sheep.** So a murrain in the flock is not an economic setback — it is a **cover crisis**. Suddenly your carts carry more wool than your sheep can grow, and the arithmetic no longer works.

State: `flockSize`, `fleecePerHead`, `declaredFleece`. That is all.

### 19.3 Inventory limits — **KEEP, and make them vicious**
See §18. Small caps, high Heat, no buffering.

---

## 20. UI — THE MAP IS THE TRUTH

**No modal management screens.** Everything is map + side panels + popovers. A management screen would betray the thesis, which is that *the map is the truth and the map is also what the Revenue is assembling.*

### 20.1 The one exception: THE LEDGER
The single screen you switch into — and it is **diegetic**, because bookkeeping *is* the cover mechanic.

- Your declared fleece, your sheep count, your legitimate trade.
- **You cook the books.** The numbers you write are the numbers an officer checks against reality.
- Discrepancy between Ledger and reality = Heat when inspected.

A management screen that is also a lie you are maintaining. **The Revenue keeps a ledger too. Late game, you can steal it.**

### 20.2 Supply flow visibility
Goods on the map look like **carts, not belts**. Flows are an **overlay**, toggled.

**The killer feature, and it must be one keystroke:**
- Overlay A: what you are actually doing.
- Overlay B: what the Revenue thinks you are doing.
- Overlay C: **both, superimposed.**

The gap between A and B is the game. Make looking at it effortless.

---

## 21. TRANSPORT — AND THE DYKES

| Hauler | Capacity | Exposure | Noise | Notes |
|---|---|---|---|---|
| Pack-pony | Low | **Very low** | Low | Goes where carts cannot. Historically *the* smuggler's vehicle. |
| Cart | Medium | Medium | Medium | Roads only. Roads are watched. |
| **Tub-boat (dyke)** | **High** | **Low** | **Very low** | Fixed network. Tide-dependent. **Must be dug.** |
| Lugger | Very high | High | Medium | The open sea, where the cutters are. |
| Steam-lighter | Huge | Medium | **12** | Leiden. Fast, loud, unmistakable. |

### 21.1 DYKE-DIGGING IS THE CENTRAL VERB OF THE MID-GAME

Romney Marsh is a **drainage network**: miles of navigable channel. Digging is slow, capital-intensive, and permanent. It is this game's rail-building — but it does **four things at once**, which is why it is the best mechanic in the design.

**1. Logistics.** High-capacity, low-exposure, near-silent bulk transport on a network *you* control.

**2. Fortification — and this is the good part.** A dyke makes the land navigable by boat and **LESS navigable by everything else**. Water cuts the ground. Riding Officers and Dragoons are **mounted**; a landscape sliced by channels is hell for cavalry. Dykes:
- force attackers onto **bridges and crossings** — chokepoints you choose;
- convert engagements at those chokepoints from **SQUARE law to LINEAR law** (§14.1);
- can be **cut** — collapse a bridge, flood a field, and a raid drowns.

> Your logistics network *is* your fortification network. Every channel you dig to move brandy is a channel a dragoon must ford.

**3. Terrain control.** Dykes drain. Draining creates pasture. Pasture feeds sheep. Sheep are your alibi (§19.2). Drainage therefore *manufactures cover*.

**4. Debt.** Draining the marsh **shrinks the marsh** — and the marsh is what the wights are. Every dyke is `debt += DYKE_DEBT`, permanently. Covenanted land cannot be dug at all.

### 21.2 The dyke is the ideological axis made concrete
Drainage is **improvement**. Improvement is **enclosure**. Enclosure pleases the gentry of Applesham (Respectability path, +Standing with buyers) and enrages the commoners (−Standing with the parish) and the wights.

So a single verb — *dig* — expresses the entire choice the game is about:

- **Dig heavily** → wealth, cover, cavalry-proof terrain, gentry favour → **RESPECTABILITY**, and a marsh that no longer exists.
- **Dig nothing** → covenant, fog, hollow ways, the old water → **THE FREE MARSH**, and no bulk logistics at all.
- **Dig, and then engine it** → **THE ENGINE**, and everyone hates you.

You are not choosing a tech tree. You are choosing what to do with a landscape. **The land is the real protagonist and every ending is something that happens to it.**

---

## 22. WEAPONRY — DELIBERATELY THIN

Six items. **Do not expand this list.** Force is a trap against the primary antagonist, and an arms race would actively mislead the player about which game they are in.

| Item | Tree | Effect |
|---|---|---|
| Dogs | Trade | Early warning. +Intelligence, not +alpha. |
| Bat and cudgel | Trade | Cheap. Non-lethal — **does not kill officers**, which is the point. |
| Blunderbuss | Trade | +alpha. Lethal. Lethality is a liability. |
| Mantrap / spiked hedge | Trade | Static defence. Visible. |
| Galvanic fence / steam-ram | Leiden | High alpha, high Noise, high visibility. |
| Bound Guardian | Marsh | Highest alpha. Accrues Debt every frame it fights. |

**Note the design intent:** the *best* weapon in the game against the Revenue is a bribe, and the second best is a dyke.

---

## 23. DEFERRED — DO NOT BUILD YET
Seasons (winter = long nights = the running season; summer = shearing). Named informers with individual loyalties. Buyer relationship depth. Forward contracts and futures. Multiple parishes. The City as a playable map.
