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
Regional heat spilling over a threshold **promotes** into national heat. National heat never resets. This is the doom clock. *(From M5, national decay is floored by `nationalHeatFloor` — Publication, §6.14.)*

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
start            the flock takes the tenancy already carrying one clip
                  (fleeceReady = flockSize at tick 0; openingStock matches, so
                  the books do not read it as new wool) — the very first action
                  is a shear, not a wait for the first dawn (§10: no dead opening)
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

### 6.9 M2 — the crime (the Dutchman, the shingle, running, cutting)

The crime arrives before the law. The Revenue is M3: in M2 smuggling *works*;
in M3 it starts to *cost*. Route exposure and storage heat are recorded, not
consumed — same as the `exposure` numbers the roads have carried since M1.

**The shingle.** One new node on the beach, north-east across the open marsh,
and one new edge to reach it:
```
SHINGLE_SITE       fixed, on the shingle north-east of the farm
marshTrackLatency  = max(1, round(pathTileLength × MARSH_TICKS_PER_TILE))
                   MARSH_TICKS_PER_TILE = 0.33   // no road, just marsh
```

**The Dutchman.**
```
unlocked    once the first rent has been collected (§6.8) — the grind must be
            felt before the way out opens, and dawn on day six is late enough
            to hurt but early enough not to bore
present(t)  = unlocked && night(t) && tideFalling(t)
```
Because the tide period is deliberately not a divisor of the day (§6.7 M1),
the night∩falling-tide window walks around the clock: some nights it is long,
some nights it never opens. The existing tide gauge already forecasts it — a
run to the shingle is a timed bet, like everything else on this marsh.

Per visit, his lugger's hold:
```
buys   fleece, up to DUTCHMAN_FLEECE_DEMAND = 24 per visit,
       at WOOL_PRICE_DOMESTIC × LEIDEN_PRICE_MULT = 8 coin
sells  jenever  12 tubs   @ JENEVER_COST = 10
       bohea tea 8 chests @ TEA_COST     = 4
       lace      4 parcels @ LACE_COST   = 15
       (the hold restocks each visit)
```
No credit. He pays coin on the spot; the wool going out funds the tubs coming
back, and the same cart carries both legs. Bidirectionality is discovered as
margin, not presented as a feature (§10 rung 4).

**The cutting house** — the first player-sited building; the placement
machinery held back in §6.7 finally earns its keep. Per §10 (the tutorial is
the story), the option to raise it is offered **only once the player holds
overproof jenever they cannot legally sell** — the building is caused by the
problem it solves, never offered ahead of it. Its purpose is explained where
the button lives: cut the unsellable spirit with water and burnt sugar and it
becomes brandy the town will buy.
```
placement  any open-marsh tile (isPlaceable); costs CUTTING_HOUSE_COST = 60 coin
tracks     placing it generates plain marsh tracks (MARSH_TICKS_PER_TILE) to
           the farm, the shingle, and Ryne — latency by distance, so siting
           the triangle IS the decision
cut        1 tub jenever + CUT_SUGAR_COST = 2 coin (water and burnt sugar) →
           depth of cut   yield per tub   tier
           gentle         2               Gentleman's
           standard       3               Fair
           deep           4               Rough
```
The depth of the cut is the player's hand on the till: volume against tier —
and, come M3+, against the buyers' patience (§17.3's Standing damage is
deferred along with Standing itself).

**Domestic prices — fixed, capped, dumb on purpose.** §17's moving prices
wait for their milestone. An M2 market is a fixed price and a daily appetite:
```
sellPrice[good]        fleece 2 · brandy round(BRANDY_BASE_PRICE × tierMult)
                       · tea 7 · lace 24        (BRANDY_BASE_PRICE = 6)
tierMult               Rough 0.6 / Fair 1.0 / Gentleman's 1.8   (§17.3)
demandRemaining        resets at dawn to DAILY_DEMAND[ryne][good]:
                       fleece 24 · brandy Rough 10 / Fair 6 / Gentleman's 2
                       · tea 8 · lace 2
overproof jenever has no legal buyer — it cannot be sold at Ryne at all
```
When the appetite is spent, the town is done buying until dawn. This is the
first, crude taste of §17's second ceiling — saturation as a wall — without a
single moving price.

**The barn, and the ditch.** §18's storage inversion arrives early, blunt and
heatless: the farm store is finite, a cart is not a warehouse, and the last
resort is to feed the marsh.
```
FARM_STORE_CAPACITY = 24   units, all goods together — exactly one
                           lugger-load of wool, two dawns of the flock
shear      moves min(fleeceReady, roomInBarn) into the store; wool the barn
           cannot take stays on the sheep and loses nothing
unload     legal at any node with a store; at the farm, capped by roomInBarn
ditch      a cart may tip its whole cargo into a dyke wherever it stands —
           goods destroyed, no coin back. (M3: the Revenue drags dykes;
           recorded, not consumed, like all M2 exposure.)
```
The cap is the argument, pre-Heat: tubs in the barn crowd the wool out, so
contraband must keep moving even before sitting still costs anything. The
ditch exists so a full cart is never a soft-lock — only a loss the player
chose over a worse one.

**What M2 does not do** (each deferred with the system that gives it meaning):
no Heat consumed (M3); no Standing, so quality only prices goods (buyer damage
comes with buyers who remember); no smouching — tea sells as-is, bulking
enters with the market model; no fulling/packing — the Dutchman takes raw
fleece, outbound refining enters with §17.

The arithmetic, against §6.8's squeeze: 12 fleece a day is 24 coin at Ryne or
96 at the shingle. A full cart of 8 tubs costs 80 + 16 sugar and cuts standard
into 24 Fair brandy = 144 coin — but Ryne's Fair appetite is 6 a day, so one
batch is four days of selling, or a spread of cuts across tiers. Rent holds at
20 a day. One good night on the shingle out-earns a lawful week; that is the
whole argument, and the player does the moral bookkeeping themselves.

### 6.10 M3 — the Revenue (Heat, suspicion, the Riding Officer, the books)

In M2 the crime works; in M3 it costs. Everything recorded since M1 — edge
exposure, time-of-day, tubs sitting still, the ditch — is finally consumed.
No new goods, no new buildings, no dice: M3 adds one man, two numbers, and a
page of arithmetic he checks against your life. Revenue blue (`#2E4A6B`)
enters the palette at last: he wears the coat.

**Contraband.** Jenever, tea, lace and every brandy tier are contraband
wherever they stand. Fleece is lawful in itself — wool's crime is the export
(§2), the gunwale is the crime scene, and the Revenue catches it not on the
marsh but in the books (below).

**Heat — two pools (§6.3, consumed at last).**
```
heat.regional   the parish noticing; decays ×0.97 at dawn
heat.national   London noticing; decays ×0.995 at dawn — the doom clock
promotion       at dawn, spill = max(0, regional - PROMOTION_THRESHOLD) × PROMOTION_RATE
                regional -= spill; national += spill
                PROMOTION_THRESHOLD = 100, PROMOTION_RATE = 0.10
```
Loss stays out of reach in M3 — national Heat buys escalation in M4+, not
dragoons tomorrow. It accrues so that the doom clock is already ticking when
the player first learns to read it.

**Heat sources.** Each source adds to `heat.regional`; each also stains the
nearest node: `suspicion[node] += amount × SUSPICION_SHARE (0.5)` (§6.6 with
`officerCompetence = 1`, bribes not yet in the world).
```
route     per tick a cart moves with contraband aboard (§6.2):
          (illicitAboard × edge.exposure / edge.latency) × timeOfDayMod(t)
          — weatherMod and concealmentTech wait for their systems (= 1, 0)
storage   per tick contraband sits in a store or on a standing cart (§18):
          max(0, illicitStored - coverCapacity[site]) × STORAGE_HEAT_COEFF (0.01)
          coverCapacity: farm 4 (wool-trade clutter), cutting house 6,
          everywhere else 0, carts 0 (the false bottom is a tree tier)
market    selling contraband at Ryne: units × MARKET_TATTLE (0.5)
          — the town drinks happily and talks constantly
ditch     tipped cargo: units × DITCH_HEAT (0.2), regional only, no node
          stain — the Revenue drags dykes, but tubs carry no name
```
Night discipline, low-exposure tracks, a clean barn and a quick market are
the M3 countermeasures. They are behaviour, not purchases: the tree tiers
that buy Heat down arrive in M5.

**The Riding Officer.** One man, on a government horse, permanent from the
first dawn where `heat.regional ≥ OFFICER_ARRIVAL_HEAT (30)`. He lodges at
the Customs House and he is entirely deterministic — outplaying him is
timetabling, not luck (§7: countermeasures against an inference, never a
dice roll).
```
at dawn    target = argmax suspicion[node], if the max ≥ PATROL_THRESHOLD (4);
           otherwise his beat: Customs House → Ryne → back
riding     HORSE_TICKS_PER_TILE: road 0.18, marsh 0.45 — the marsh fights
           horses; the shingle is a long, sour ride
stop       if he and a cart share an edge on the same tick, the cart is
           stopped and searched: contraband aboard is seized (cover 0)
search     at his target node: found = max(0, illicitStored - coverCapacity);
           seized, plus heat.regional += found × SEIZURE_HEAT (1.5);
           a clean search instead cools the trail:
           suspicion[node] ×= SEARCH_RELIEF (0.5)
           one inspection a day, then home to the Customs House
decay      suspicion[node] ×= 0.99 at dawn — he keeps notes
```
Seizure takes the goods and nothing else: no arrest, no fine, no combat.
There is deliberately no verb for violence against him — that verb arrives
with M4 and §7 prices it as catastrophe. The ditch (§6.9) becomes the panic
button it was built to be: see the blue coat on your road, tip the lot.

**The books (§19.2, §20.1 — the flock gets its job).** The farm popover
grows a ledger page. The player keeps one standing number:
```
declaredYield   fleece per day the books admit the flock gives, 0..flockSize,
                changed at will; accrues declaredToDate at each dawn
grownToDate     what the flock actually grew (accrued at dawn)
soldLawfully    fleece sold at Ryne, accrued at sale
```
Undeclared wool does not exist and may vanish over any gunwale it likes.
Declared wool must be accounted for. When the officer inspects the farm he
counts sheep and reads the page:
```
accounted = soldLawfully + fleece on hand (barn + carts + sheep's backs)
gap       = |declaredToDate - accounted|
          + max(0, grownToDate × PLAUSIBLE_YIELD_MIN - declaredToDate)
            PLAUSIBLE_YIELD_MIN = 0.5 — he knows what a Romney ewe gives;
            swear to less than half and he prices the lie himself
heat.regional += gap × WOOL_GAP_COEFF (1.0); the page is then initialled —
each gap is paid for once, and the ledger reconciles to reality
```
The squeeze: honest books mean every fleece must show — the Dutchman becomes
expensive. Short books free the surplus wool but cap lawful Ryne sales at the
declared figure, and the floor keeps half the clip on the record. Cooking
the books is one number, and it is a real decision every rent period.

**What the player sees (§20.2, first cut).** `gossip` = suspicion snapshotted
at each dawn — the parish talks over breakfast, so the player reads
yesterday's Revenue mind, not today's. One toggle paints the gossip stains on
the map; the full A/B/C overlay set waits until there are flows worth
superimposing. The officer himself is always visible — one horse in open
country; it is his mind that is fogged, not his body. The HUD gains the two
Heat gauges. Dispatch buttons carry the warning a marshman's eyes would:
when the officer is on an edge or standing at its far node, the button says
so — *"the blue coat is on the high road."* Hired carters (§6.11) do not
read buttons and do not heed the coat; the warning is for the hand on the
tiller, and that difference is the point.

**What M3 does not do** (each deferred with the system that gives it
meaning): no bribes — the Bought Officer is a tree tier (M5); no `watched`
set, informers or decoy runs (M4/M5); no escalation past one man — the Water
Guard and worse are bought by national Heat in M4+; no §6.1 throughput leak
or fortificationVisibility — those enter with fortifications in M4 (M3 cover
is capacity against *stock*, §18); no weather; no arrest, fine or combat.

Arithmetic, against §6.9: a full night run is 8 × 0.7 × 0.4 ≈ 2.2 route
Heat; a day's brandy trade at Ryne tattles ~5–6 more; a barn holding 8 tubs
overnight leaks ~2.5. A working smuggler runs ~8–10 Heat a day against 3%
decay, meets the officer around day 9–11, and lives thereafter by keeping
the stains moving. The lawful carter generates exactly none of it — the
officer never comes, which is its own quiet verdict on the lawful life.
Numbers are opening bids for the distribution tests to beat into shape.

### 6.11 M3 — more wheels: bought carts and the hired carter

§5 promised haulers *assigned* to edges; here the promise is kept. The wool
round — shear, load, road, sell, home — is by now a felt chore, and per §10
the mechanic arrives only once the player has the problem it solves: the
option to hire a carter appears only after **two cart-loads of fleece have
been sold by hand** (`CARTER_UNLOCK_FLEECE`), or once crime has begun (the
Dutchman unlocked, by which point the round has been run many times). Before
that it is not offered — automation ahead of the chore only overwhelms. The
deeper move: automation frees the player's hands for crime. You automate the
alibi and run the tubs yourself — and the moment carts move without you is
the moment the officer starts stopping carts (§6.10).
```
buyCart      CART_COST = 50 coin, at the farm; the new cart is named and
             starts in the yard. MAX_CARTS = 3 — the yard holds three.
hireCarter   a carter takes a cart and a standing order:
             order = { from: node, to: node, good }
             CARTER_WAGE = 3 coin per day, due at dawn with the wool
at `from`    load `good` to capacity from the store; if the store is empty
             he waits (a carter shuttles loads, not air)
roads        between nodes joined by two edges he takes the faster one that
             is open at departure — he knows the tide like everyone born here
at `to`      market → sell into remaining demand; otherwise unload into the
             store (respecting its walls, §6.9); what cannot be sold or
             unloaded rides home with him
wages        unpaid at dawn → he walks off the same morning; the cart stands
             where he left it, order cleared
dismiss      at will, no severance; the order clears
```
The carter is deliberately dumb about everything but the tide: he does not
watch for the blue coat, he does not wait for night, and he will drive a
cartload of contraband straight past the Customs House if that is the order
he was given. Standing orders full of brandy are legal-to-write and stupid-
to-keep — the player discovers this the way §10 demands: by losing a load.
Night-only orders, pack-ponies and the rest of §21's stable are deferred to
their milestones; the hired mouth that can be *turned* joins the informer
system in M4/M5 — the payroll is where informers will start.

Arithmetic: a carter on farm→Ryne moves the whole clip (12/day ≤ his two
runs × 8) for 3 coin against ~24 coin of wool — automation of the lawful
trade roughly pays for itself and buys the player's attention back. A second
cart (50) plus wages eats most of a rent period's lawful margin: expansion
is bought with crime's proceeds, which is the game's whole loop in
miniature.

### 6.12 M4 — fortification & the visibility trade-off

The spec's oldest promise (§9): *a fortified building is a visible building.*
M3 left §6.1's leak term and `fortificationVisibility` switched off on purpose
(the M3 note in §6.10 says so). M4 turns them on. Fortification is the first
half of Force and it stands on its own, before a single raider appears: you
harden a building up a ladder of coin, and every rung you climb the Revenue
sees you the better. Nothing else in the game asks the player to *choose to be
seen* — this is that choice.

**The Trade fortification line (§8, §22).** Fortification is a per-building
tier, `fortTier: 0..4`, climbed one rung at a time at the building itself. The
ladder is mundane — bought with coin, not researched — and is the only fort
line available until the trees open (M5). Each rung is a visible change to the
silhouette (the art is the tell, below).

```
tier 0  Bare              the building as M1–M3 drew it
tier 1  Dogs & hedge      FORT_COST[1]=40   +intelligence, not +alpha (see below)
tier 2  Bolted doors &    FORT_COST[2]=80   the first men who shoot back
        blunderbuss men
tier 3  Gunported barn    FORT_COST[3]=160
tier 4  The Fortified     FORT_COST[4]=320  a blockhouse in a smock
        Farm
```

Cost roughly doubles per rung: the top of the ladder is a fortune, and — the
trap — the *loudest* thing you can build. Fort is bought outright (no upkeep);
the men who hold it are separate and come with the garrison (§6.13).

**The alpha is latent until §6.13.** Each tier adds `+0.05` to the building's
defender alpha in a raid (§14.2) — dead weight until there is a raid and a
garrison to spend it. Tier 1 is the exception the weaponry table demands
(§22): **dogs give intelligence, not alpha** — a fortified-with-dogs building
sees a muster coming (advance warning of a raid, §6.13), where higher tiers
win the fight. Buying tier 1 for its warning and never climbing higher is a
legitimate, cheap, *quiet* choice — and quiet is the point.

**The visibility trade-off — this is the live half in M4b.** Two things now
consume `fortificationVisibility`, per §6.1 and §6.4:

```
fortVisibility   = Σ(tier ≤ fortTier) VISIBILITY[tier] / concealment[building]
                   VISIBILITY = { 1: 0.1, 2: 0.3, 3: 0.6, 4: 1.0 }  // superlinear
                   concealment = 1 until marsh tech divides it (§6.4, M5)

// §6.1 realised on M3's cover model, not a new subsystem: the over-cover
// storage heat the game already accrues each tick (§18, STORAGE_HEAT_COEFF)
// now leaks *more* from a hard building than a soft one. (§6.1's abstract
// "load over cover" is that same over-cover stock here — M3 chose stock as
// the cover model and M4 keeps it; no throughput accounting is introduced.)
overCoverHeat    = max(0, stock − cover) × STORAGE_HEAT_COEFF × (1 + fortVisibility)

// …and a hard building is a tell even when nothing moves through it: each
// dawn it stains its own node, the way gunports draw the eye.
fortHeat         = fortVisibility × FORT_VISIBILITY_HEAT   // regional + node stain, per dawn
```

`VISIBILITY` climbs faster than the `+0.05` alpha: the fourth rung roughly
doubles the third's defence but sextuples its first rung's visibility. Hardness
and hiddenness pull apart on purpose. The intended play is spatial (§9): harden
the building you will *fight* for, hide the building you *store* in, and route
goods between — you cannot be both in one place, and the numbers are tuned so
that trying bankrupts you in Heat.

**Arithmetic (opening bid, for the distribution test to beat into shape).** A
tier-3 cutting house running a day's brandy leaks its over-cover throughput at
`1 + 0.7 ≈ 1.7×` the bare rate, and stands off `~0.7 × FORT_VISIBILITY_HEAT`
of fresh suspicion every dawn on top — enough that the officer, who rides to
the sorest stain (§6.10), now rides to your fort by choice. Fortifying pulls
the Revenue toward you. That is not a bug; it is the whole trade, and M4c is
where you make him regret the visit.

**Art — the silhouette is the tell (§15.3).** The five tiers are five
escalating silhouettes, flat-filled and ink-outlined: bare barn → spiked-hedge
ring + a dog → bolted door with two figures at the wall → gunported walls with
dark slits → crenellated blockhouse behind a palisade. A small Heat-red meter
under the building rises with `fortVisibility`, so the trade is legible at a
glance in the Yard view. Reserved palette is untouched (house rule 7): fort
uses ink, clay, and roof-tile, darkening as it hardens.

### 6.13 M4c — the raid: standing garrison, Hawksmere, and resolution

Force is the second half of M4 and the milestone's namesake. M4b made a
building *hard*; M4c gives it something to be hard *against*. The loop: your
success draws raiders, they muster off-map and ride to one of your buildings,
and the fight resolves through the deterministic engine already built (§14) —
you defend with the men you posted and the works you dug. Numbers below are
opening bids for the distribution test (§13) to beat into shape.

**The engine exists; M4c is the wiring.** `simulateBattle(setup)` (§14) is done
and tested. M4c raises the two sides, moves the raider on the map, hands the
`CombatLog` to the renderer, and applies the §14.6 consequences to the world.
No new combat maths.

#### The garrison (your defenders)

Men are *posted at a building* and drawn from two kinds, the §14.2 pair:

```
marsh militia   α 0.10, breakpoint 55   MILITIA_MUSTER 15 coin, MILITIA_WAGE 1/day
smuggler crew   α 0.18, breakpoint 30   CREW_MUSTER   40 coin, CREW_WAGE   3/day
raise           a verb at the building; men appear in its garrison next tick
wages           at dawn, with the carter's (§6.11); a building that cannot pay
                its garrison loses men to desertion (cheapest first)
cap             GARRISON_BASE 4 + fortTier × GARRISON_PER_TIER 2  → a bare
                building holds 4, a fortress 12. Fortification now does *three*
                things: alpha, capacity, and visibility (§6.12).
```

`garrisons: Partial<Record<NodeId, { militia: number; crew: number }>>` joins
GameState (save bump). Militia are cheap and break early ("they have families");
crew hold. The building's works add to the defender's alpha in the fight —
`fortAlpha = max(0, fortTier − 1) × 0.05` (tier-1 dogs give **intelligence,
not alpha**, §22; refine §14.2's flat "+0.05/tier" to honour the carve-out).

#### Standing — introduced here, minimal (spec §11)

Combat already prices friendly dead in Standing (§14.6); M4c gives Standing a
home. A single number, the parish's regard for you:

```
standing        starts STANDING_START 100, floored at 0
falls           friendlyDead × STANDING_LOSS_PER_FRIENDLY_DEAD 3, per battle
recovers        + STANDING_RECOVERY 0.5 / day, capped at start (the parish's
                memory of a dead neighbour fades — slowly)
at zero         "someone talks" (§11) — but *not* the end (design call): a
                permanent `informer` is set and the marsh's free hides close
                (building cover falls to INFORMER_COVER, an opening bid of 0 —
                every tub now visible to a search). Standing recovers with peace;
                the informer does not. Severe, survivable, and meant to be lived
                through — into a harder, more exposed game.
```

Standing's fuller economy — conspicuous spend (§6.5), gentry buyers, buying the
informer *off* — is **deferred**; in M4c it moves one way under fire and drifts
back in peace, and its floor is the informer scar. It is the cost that makes
"every dead neighbour a family that now hates you" (§14.3) a number, not a line
of flavour: a player can *win* every fight and still bleed the parish white.

#### Two raiders, two meters (the orthogonal threats of §9)

Raids come from two sources, and keeping their triggers separate keeps the
threats legible:

```
HAWKSMERE (rival) — wants your market. Provoked by your FOOTPRINT:
  contrabandSold (cumulative illicit units sold at Ryne) ≥ HAWKSMERE_PROVOKE 60
  Once provoked, they raid on a cadence; each raid you survive grows the next.

THE CROWN (state force) — wants you gone. Summoned by national HEAT (§6.3, the
  doom clock):
    national ≥ WATER_GUARD_HEAT 40  → the Preventive Water Guard rides (α 0.35, bp 25)
    national ≥ DRAGOON_HEAT     80  → Dragoons (α 0.55, bp 0 — they do not rout)
  The raider's faction is the worst its national Heat has earned. This is §11's
  spiral made real: kill the Crown's men and national Heat leaps (§14.6,
  revenueDead × 40), summoning worse — Force against the state is a trap that
  pays in Dragoons.
```

The Revenue's officer (§6.10) still only searches; he never storms. Force is for
the two who bring it.

#### The raid — muster, ride, resolve

```
target      the building holding the most contraband (illicitCount), tie-break
            to the cutting house, then the farm — they take what they can carry
size        HAWKSMERE_BASE 12 + raidsSurvived × HAWKSMERE_GROWTH 4
            + floor(contrabandSold / HAWKSMERE_SCALE 40); Crown raids read their
            base off the faction (WATER_GUARD_BASE, DRAGOON_BASE)
first raid  a deliberate gentle introduction (design call): HAWKSMERE_FIRST_RAID
            6, well under the base, announced with FIRST_RAID_LEAD +2 extra days
            of warning, and on a loss it seizes only FIRST_RAID_SEIZE_FRAC ⅓ of
            the building's stock, not all of it. Even a token garrison holds it;
            losing it teaches the whole system cheaply. Every raid after uses the
            full size and takes everything.
muster      announced RAID_MUSTER_LEAD 2 days before it arrives — the window to
            raise men or sound the retreat. Dogs (fortTier ≥ 1) add
            DOGS_WARNING_LEAD 1 day: the tier-1 intelligence payoff (§22).
ride        a raid entity with a graph location (node | edge+progress), moving
            each tick toward the target by the officer's own machinery
            (revenue.ts firstHop/horseLatency) — deterministic, not a random walk
            (§14/§15 sim-render line). No dykes yet (§21 is mid-game), so the
            law is SQUARE: numbers dominate, and the pre-battle readout says so.
cadence     next raid at RAID_INTERVAL 6 days after the last resolves
```

**Resolution.** When the raid reaches the target node the sim *marks* a pending
battle; the store pauses (§6.13 pause-event, house rule 1 keeps the pause out of
`/src/sim`). The player queues up to three Calls (§14.4), then `simulateBattle`
runs a defender-side setup — garrison as `strength`, `fortAlpha` as tech alpha,
square law — and the renderer plays the `CombatLog` back. Then §14.6 lands:

```
win (attacker routs/annihilated)   the goods are safe; friendly dead cost Standing
lose (defender routs/annihilated)  the raider seizes the target's contraband
                                   (all of it — they came for it; the gentle
                                   first raid takes only its ⅓); Standing hit
Sound Retreat                      goods seized, but your people live: far less
                                   Standing lost than dying on the pile
no garrison at all                 an unopposed raid — they simply take it (the
                                   first one still only its fraction): how the
                                   player learns, cheaply, to post men (§10)
```

#### What joins GameState (save bump)

`standing`, `garrisons`, `contrabandSold`, and a `raid`/`hawksmere` record
(provoked, raidsSurvived, next-raid tick, the active raider's faction/size/
location/target/pending-battle flag) — all JSON-plain. The three Calls are
actions queued into `simulateBattle`, so replay stays byte-identical.

#### Build order (stop at each, as ever)

- **M4c-1 — garrison & Standing.** Raise/dismiss/wage militia and crew, the
  cap off fortTier, Standing and its loss. Sim + 200-game test. *(No raider
  yet: this is the defensive apparatus standing ready.)*
- **M4c-2 — the Hawksmere raid.** Provocation, muster, the ride, resolution
  through `simulateBattle`, consequences, the pause. Sim + test.
- **M4c-3 — the Crown escalation + render.** Water Guard and Dragoons off
  national Heat; the raid drawn on the map, the `CombatLog` played back, the
  three-Call UI, and the pause card.

#### Decisions taken (2026-07-16 design pass)

1. **Two meters, orthogonal.** Hawksmere is provoked by your market footprint
   (`contrabandSold`, §9's "wants your buyers"); the Crown's force is summoned by
   national Heat. Two threats, managed separately — not one doom clock.
2. **Standing at zero is survivable, not a loss.** It sets the permanent
   informer and closes the marsh's free hides (above), and the game goes on,
   harder. (This softens §11's "someone talks → loss": in M4c it is a scar, not
   an ending. A harder Standing-death may return with the fuller economy.)
3. **The first raid eases the player in** — small, well-telegraphed, and cheap
   to lose (above). The stakes climb from there, not on the first contact.

These are opening-bid numbers; the §13 distribution test is what beats them into
shape once M4c-2 can field a raid.

---

### 6.14 M5 — the trees: research, Debt, Publication, and the two unlocks

§8 names the trees; this section prices them. The governing decision: **coin is
nominal everywhere in research — the real price is always a meter.** Trade costs
only coin, which is why it is safe and weak. Marsh power is cheap to learn and
accrues Debt every time it is *used*. Leiden's power is cheap to learn and
raises the national Heat floor every time a tier *completes*. A player who
reads the coin costs has read nothing.

#### Research — one bench, one project at a time

```
one active project; coin paid up front, done RESEARCH_DAYS later at dawn
trade    researched at the farm         — costs coin, only coin
marsh    researched at the wight-stone  — needs ≥1 bound wight
leiden   researched at the workshop     — needs Leiden housed

RESEARCH_COST   trade [40]       marsh [30, 70, 140]     leiden [50, 110, 220]
RESEARCH_DAYS   trade [2]        marsh [2, 3, 4]         leiden [3, 4, 5]
```

There is **no tree-pick gate**. Exclusivity is economic — coin, cover
capacity, and meter-headroom are scarce — until M6's alliances close doors for
real. M4's fortTiers and hides are retroactively the trade tree's
fortification and concealment lines; the research UI groups them so the three
trees read as three columns from the first time the panel opens.

#### The wight — coerced, and the player goes looking

The marsh notices being used. After NIGHT_MARSH_UNITS = 40 unit-tiles of goods
have crossed marsh at night, a **wight-sign** appears on the deep-marsh tile
nearest the most-used night crossing (event card). Trapping it is a deliberate
verb:

```
trap = WIGHT_TRAP_IRON 20 coin (iron & salt) + bait sheep staked overnight
       bait rises with each binding: 1, 2, 3… sheep — the flock pays
at dawn the wight is bound (deterministic — no roll)
each binding: +1 boundWights, the sheep are gone
signs recur every SIGN_RECURRENCE 8 days while marsh powers see use
```

#### Debt — the account that never closes

```
debt never decays                          // its whole identity against Heat
accrues   per USE of marsh powers (tier table below); later +DYKE_DEBT 15 (§21.1)
bindings  = boundWights × BINDING_CAPACITY 60
tribute   at the wight-stone: 1 sheep forgives TRIBUTE_RELIEF 12 debt
          sheep only — they do not take coin, and never will
breach    debt > bindings at dawn → collection card + COLLECTION_GRACE_DAYS 3:
          tribute down, bind another wight, or at the third dawn they collect —
          one person, taken (carter, garrison man, Leiden himself), permanent,
          forgiving PERSON_DEBT 40. Repeats while the breach stands.
          nobody left to take → they take you (loss)
```

Collection is **not a combat and never fires a battle** — §9: force is useless
against the wights. No muster, no Calls; the person is simply gone at dawn.
The flock is now triple-loaded — alibi (§19.2), bait, and appeasement — which
is the point: the moral reserve currency of the marsh has legs and a bell.

#### Leiden — courted, and you did not choose him

On the LEIDEN_ARRIVAL_RUN = 6th successful landing, one tub holds a
philosopher (event card — he is cargo, uninsured, and wet). **Housing him**
needs a building with ≥ LEIDEN_COVER = 4 spare cover capacity; he occupies it
permanently and it becomes the workshop. Turn him away and he is rowed back
out; the offer recurs once (run 10), then never. He is a person in the
collection sense: the wights will happily take him.

#### Publication — the floor that rises

```
each completed leiden tier: nationalHeatFloor += PUBLICATION_HEAT [6, 10, 16]
nationalHeat = max(nationalHeat × NATIONAL_HEAT_DECAY, nationalHeatFloor)
                                            // §6.3 gains a floor; decay
                                            // can never take you below it
suppress a letter  costs SUPPRESS_STANDING 15 (he is well liked)
                   the tier then adds no floor
after MAX_SUPPRESSIONS 3 he refuses the bench until a letter goes out
                   (research blocked, not lost)
```

What suppression eventually costs *him* (§8.3) is M6's business.

#### The tiers M5 ships (capstones wait for the endings)

| Tier | Effect | The price |
|---|---|---|
| Trade: False-bottom cart | cart exposure ×0.6, +4 cover on the move | coin only |
| Marsh 1: Marsh-lantern haulers | night moves exposure ×0.1 | +1 Debt per run |
| Marsh 2: Wight-fog | a raid Call: raider alpha ×0.5 that battle | +8 Debt per invocation |
| Marsh 3: Hollow Way | one marsh edge never enters `knownEdges`, exposure 0 | +1 Debt per traversal |
| Leiden 1: Galvanic fence | garrison alpha ×1.5 at that building | fortificationVisibility +8, Noise + |
| Leiden 2: Steam-lighter | water hauler, capacity 16, runs all hours | loud: exposure ×1.3 |
| Leiden 3: Aetheric Telegraph | the intel panel defogs — the true `RevenueModel`, live | the largest floor rise |

The **Bound Guardian** and the **Great Sluice-Engine** are ending machinery —
M6. Ichor green `#6FBF8F` and Phlogiston orange `#E09B3D` leave §13's reserve
with their owners.

#### What joins GameState (save bump)

`difficulty` (§6.15), a research record (active project, completed tiers),
`debt`, `boundWights`, wight-signs, a Leiden record (state, workshop node,
suppressions), `nationalHeatFloor`, and §6.15's `dutchmanBook` and vouch
cooldown — all JSON-plain.

#### Build order (stop at each, as ever)

- **M5a — the bench and the soft hand.** Research framework (trade tier as
  proof), difficulty dial + mercy (§6.15) retrofit over rent/heat/raids, the
  shearer and the flock market (§6.16). Sim + 200-game distribution test.
- **M5b — the wight.** Sign, trap, the three marsh tiers, Debt, tribute,
  collection. Sim + test.
- **M5c — Leiden.** Arrival, the workshop, Publication and the floor, the
  three tiers, the telegraph UI.

### 6.15 M5 — difficulty & mercy (a squeeze, not a wall)

Design intent, stated plainly: **this game must be playable by someone who has
never played an RTS.** Two layers, both deterministic, neither hidden.

**The dial** scales what the world does to you — never what your own economy
yields. Prices, yields, and capacities are identical at every difficulty, so
every player learns the same arithmetic; only the adversaries lean harder or
softer.

```
difficulty ∈ { gentle, fair, hard }   chosen at new game, in GameState;
                                      may be LOWERED mid-run (a logged action,
                                      so replays hold) — never raised

          rentMult   heatMult   raidMult   debtMult   crisisSpacingDays
gentle    0.75       0.8        0.7        0.75       6
fair      1.0        1.0        1.0        1.0        4
hard      1.25       1.2        1.3        1.0        0
```

`heatMult` scales heat *gained*, never decay. `raidMult` scales Hawksmere's
muster. **Crisis spacing:** at most one existential event (raid arrival,
collection, forfeit distraint) may fire per window — later ones queue, they
do not vanish.

**Mercy** is active at every difficulty, diegetic, visible, and priced —
never rubber-banding:

1. **The Dutchman's book.** At a rent dawn with coin short and the Dutchman
   known: event card — he covers the shortfall. `dutchmanBook += shortfall ×
   DUTCHMAN_VIG 1.25`, repaid as a DUTCHMAN_SLICE 0.5 top-slice of every later
   sale until clear; one loan outstanding at a time. Refusable — refusal is
   distraint as before. *(The Dope Wars loan shark, wearing clogs.)*
2. **The parish vouches.** If distraint would end the tenancy (flock to zero)
   and standing ≥ PARISH_VOUCH_STANDING 30: the parish covers the shortfall,
   standing −PARISH_VOUCH_COST 10, once per PARISH_VOUCH_COOLDOWN 12 days.
   Kindness to the parish is insurance, spendable once.
3. **No single-dawn deaths.** Every loss in §11 must pass through a carded,
   dated warning first (officer arrival, collection countdown, forfeit
   warning). A player who ignores three cards may lose; a player who misread
   one number must not.

#### Decisions taken (2026-07-17 design pass)

1. **Coin is nominal in research; the meters are the price** (Debt, the Heat
   floor, Standing).
2. **Collection is not combat** and never fires a battle.
3. **Debt is payable only in sheep and people** — never coin.
4. **Mercy is diegetic and priced**, never hidden; the dial scales
   adversaries, never the player's yields.
5. **Difficulty can be lowered mid-game, never raised.**
6. **Dykes are not M5.** §21.1 lands as its own stop (M5½) between the trees
   and the alliances — Debt must exist first, and the dig verb deserves its
   own review.

Opening bids, all of them; the distribution test beats them into shape.

### 6.16 M5a — the shearer and the flock market (the automated alibi)

The design promise: **the lawful bottom of the game can be fully automated,
Satisfactory-style** — sheep grow wool, the shearer clips it, the carter sells
it, the rent gets paid, and the player's hands never touch a fleece. But
automation buys *freedom, not wealth*: the hired farm is an alibi machine, not
an income machine. §19.2's law stands untouched — no breeding, no feeding, no
pasture management. The flock changes size only by purchase, sale, distraint,
bait, and tribute: sheep are a stock you trade, not creatures you husband.

#### The shearer — the last chore, sold

Same pattern as the carter (§6.11): the mechanic arrives only once the chore
is felt.

```
unlock        offered after SHEARER_UNLOCK_SHEARS 6 dawns sheared by hand,
              or as soon as a carter is hired (wheels without hands makes
              the remaining chore obvious)
hire          SHEARER_WAGE 1 coin per day, due at dawn with the wool
behaviour     at dawn he shears: farmStore.fleece += fleeceReady (respecting
              the store's walls; what will not fit stays on the sheep).
              That is all he does — dumb as the carter, §6.11
wages unpaid  he walks off the same morning; shearing is a player verb again
payroll       another hired mouth — he joins the informer pool with the
              carter when that system lands (§6.11)
```

**The designed identity — check it in a test:** 12 sheep × 2 coin of fleece
= 24/day gross; carter 3 + shearer 1 = 4/day wages; rent is 120/6 = 20/day.
`24 − 4 = 20`. **The fully hired farm pays the rent to the coin, and not one
coin more.** Automated lawful play is a treadmill, exactly poised — the wage
bill converts the wool margin into attention, and attention is spent on
crime. (On `gentle`, rentMult 0.75 makes the same farm run +30/period in the
black: the difficulty dial turns the treadmill into a floor for beginners,
§6.15.)

#### The flock market — growth without farming

```
buy    SHEEP_PRICE_BUY 15 coin at Ryne; bought sheep join the flock at the
       next dawn (driven home overnight — no escort chore)
sell   SHEEP_PRICE_SELL 8 coin at Ryne (the agent's distraint valuation is
       10, §6.8 — the market pays cash and pays worse)
cap    FLOCK_CAP 24: Walland's pasture holds what it holds. Drained land
       raises it (M5½, §21.1 — drainage manufactures pasture, pasture
       manufactures alibi)
```

**And the ceiling that keeps wool honest:** `DAILY_DEMAND.fleece` drops
24 → 16. Ryne wants little more than Walland clips — the marsh has more
sheep than England has coats. A full flock of 24 clips 24 fleece a day
against a town that buys 16: the surplus moves only over the gunwale, at the
Dutchman's 4× — which is **owling**, the original crime of this coast. Growing
the flock therefore never grows lawful income past the rent line; it grows
the alibi (§19.2), the tribute buffer (§6.14), the trap bait — and the night
trade. The Satisfactory loop feeds the crime, not the ledger.

One consequence, accepted with eyes open: Ryne sells sheep and the wights
take sheep, so Debt is coin-payable at one remove (15 coin → 12 debt, plus
the drive home). Appeasement having a market price softens Debt in exactly
the direction §6.15 wants; the wights still take no coin, and never will.

#### What joins GameState

`shearer` (hired flag + unlock progress) and the flock-market actions;
`FLOCK_CAP`, prices, and the demand change live in `balance.ts`. Builds in
**M5a** with the bench and the soft hand (§6.14 build order).

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

**M2 — The Crime.** Dutchman, the beach, inbound goods, cutting house, quality tiers, bidirectional routing (§6.9). Fixed prices and daily demand caps — §17's market model comes later.
**M3 — The Revenue.** `RevenueModel`, suspicion inference, the fogged player-facing intel map, cover & leak, first Riding Officer (§6.10). Bought carts and the hired carter on standing orders (§6.11) — automation arrives with the man who stops carts.
**M4 — Force.** Hawksmere, raid resolution, fortification tiers, the visibility trade-off.
**M5 — The Trees.** Ichor and Phlogiston, Debt, Publication, the two unlock events (§6.14). Difficulty dial & mercy (§6.15) and the shearer + flock market (§6.16) land first, in M5a. Sub-stops M5a/M5b/M5c.
**M5½ — The Dykes.** §21.1's dig verb: channel logistics, chokepoints, drainage cover, dyke Debt. Its own design pass and stop.
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

**The sim/render boundary — house rule 1, made explicit (settled M4 design pass).**
The sim owns only *outcome-bearing* position and the abstract combat counts. A
unit is at a node or a fraction along an edge, exactly like the officer
(§6.10), and moves there deterministically by pathfinding — never by a random
walk. Combat is the `CombatLog`'s frame counts and events, never per-man
coordinates. **Everything finer than that is render, and render may take
liberties.** The milling of individual men — defenders loitering by the walls,
a raiding party's Brownian shuffle inside its patch of ground (bounded to the
terrain, e.g. penned to a dyke crossing, §21), combat blobs jostling during
playback — is owned by the layer above (§15.1). It may use its own randomness,
seeded per entity id so it does not shimmer (§15.3), and it is **never**
stored in GameState. The test that decides where a thing belongs: *a tweak to
how men wander must never be able to break a saved replay.* If it could, it is
in the wrong layer.

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
- **Layer 1 (dynamic):** buildings, carts, boats, people, combat blobs. Redrawn every frame. This layer owns all figure-level motion — the ambient bounded-wander of men around a node or battle (§14) — and may use its own randomness; none of it touches GameState.
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
Also: drag-to-pan (middle mouse or space+drag), edge-scroll, and trackpad pinch (`ctrlKey` on the wheel event). On touch, one finger pans and a two-finger pinch drives the same midpoint-anchored zoom — the game must stay playable on a phone, with the header and event log yielding the screen to the map below 640px.

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

*(M5a adds purchase, sale, and a pasture cap — §6.16 — which is trade, not
husbandry: the three prohibitions above stand.)*

### 19.3 Inventory limits — **KEEP, and make them vicious**
See §18. Small caps, high Heat, no buffering.

---

## 20. UI — THE MAP IS THE TRUTH

**No modal management screens.** Everything is map + side panels + popovers. A management screen would betray the thesis, which is that *the map is the truth and the map is also what the Revenue is assembling.*

**Click the place, not the pixel.** Anything standing at a node answers from
the node's popover: a cart in the farmyard is part of the farm's menu (its
cargo, its carter, its dyke), never a separate sprite to hunt for. Only a
cart on the road — where there is no place to click — answers for itself.

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
