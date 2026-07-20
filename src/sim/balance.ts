// All balance numbers live here. Never inline a magic number. (Spec §13)

import type { CutDepth, Difficulty, Good, ResearchTree } from './types';

// ---- Time ----
export const TICKS_PER_HOUR = 6; // one tick = 10 minutes
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY; // 144

// Hour boundaries for time-of-day (spec §6.2: night 0.4, dusk 0.7, day 1.0)
export const DAWN_HOUR = 5; // 05:00–06:59 dusk (half-light)
export const DAY_HOUR = 7; // 07:00–17:59 day
export const DUSK_HOUR = 18; // 18:00–19:59 dusk
export const NIGHT_HOUR = 20; // 20:00–04:59 night

export const TIME_OF_DAY_MOD_NIGHT = 0.4;
export const TIME_OF_DAY_MOD_DUSK = 0.7;
export const TIME_OF_DAY_MOD_DAY = 1.0;

// ---- Tide ----
// A full tide cycle (low → high → low). Deliberately not a divisor of the day,
// so high water walks around the clock and the low road's window keeps moving.
export const TIDE_PERIOD_TICKS = 76; // ~12h40m
// Tide level is a triangle wave in [0, 1]. The low road floods above this.
export const TIDE_FLOOD_THRESHOLD = 0.7;

// ---- The flock (spec §19.2: the flock is your alibi; here it is just wool) ----
export const STARTING_FLOCK = 12;
export const FLEECE_PER_HEAD_PER_DAY = 1; // sheared at dawn, one fleece per sheep
export const SHEARING_HOUR = DAWN_HOUR; // fleece lands in the farm store at dawn

// ---- The cart ----
export const CART_CAPACITY = 8; // fleece per run; 12 sheep/day forces a second run

// ---- The barn (spec §6.9 / §18: storage is scarce — the cap arrives before the Heat) ----
export const FARM_STORE_CAPACITY = 24; // units, all goods together — one lugger-load of wool
// §6.17: the cutting house is a purpose-built store, larger than the barn and
// better hidden (cover 6 > 4). Splitting stock across the two is dispersal, not
// relief — the officer searches one node a dawn, so spread goods lose less.
export const CUTTING_HOUSE_STORE_CAPACITY = 32;

// ---- Roads (spec §6.7: latency = max(1, round(pathTileLength × ticksPerTile))) ----
export const LOW_ROAD_TICKS_PER_TILE = 0.26; // flat and direct, when the sea allows
export const HIGH_ROAD_TICKS_PER_TILE = 0.53; // climbs the upland, minds its manners
export const LOW_ROAD_EXPOSURE = 0.5; // base Heat per unit moved (unused until M3)
export const HIGH_ROAD_EXPOSURE = 1.0; // the Customs House watches it (unused until M3)

// ---- Marsh tracks (spec §6.9: no road, just marsh) ----
export const MARSH_TICKS_PER_TILE = 0.33;
export const MARSH_TRACK_EXPOSURE = 0.7; // recorded, not consumed until M3

// ---- Prices ----
// The domestic price is insulting on purpose (spec §10 rung 2).
export const WOOL_PRICE_DOMESTIC = 2; // coin per fleece at Ryne
export const LEIDEN_PRICE_MULT = 4; // the Dutchman's offer

// ---- The Dutchman (spec §6.9: night, falling tide, no credit) ----
export const DUTCHMAN_FLEECE_DEMAND = 24; // fleece he'll take per visit
/** His hold on arrival — restocked each visit. */
export const DUTCHMAN_HOLD: Partial<Record<Good, number>> = {
  jenever: 12,
  tea: 8,
  lace: 4,
};
/** What he charges, coin per unit. */
export const DUTCHMAN_PRICE: Partial<Record<Good, number>> = {
  jenever: 10,
  tea: 4,
  lace: 15,
};

// ---- The cutting house (spec §6.9) ----
export const CUTTING_HOUSE_COST = 60; // coin, sited on open marsh
export const CUT_SUGAR_COST = 2; // coin per tub — water and burnt sugar
// §6.17 — smouching: the inbound twin of the cut. Ash & sloe leaves stretch the
// bohea to twice the volume at a lower grade, opening the cheap second market.
export const SMOUCH_COST = 1; // coin per chest of tea — ash, sloe leaves, dye
export const SMOUCH_YIELD = 2; // chests of bulked-tea per chest of raw
/** Depth of cut: volume against tier. The player's hand on the till. */
export const CUTS: Record<CutDepth, { yield: number; brandy: Good }> = {
  gentle: { yield: 2, brandy: 'brandy-gent' },
  standard: { yield: 3, brandy: 'brandy-fair' },
  deep: { yield: 4, brandy: 'brandy-rough' },
};

// ---- The refiner (spec §6.17): one hired hand runs the whole house at dawn ----
// Dearer than the shearer's 1: this hand knows what the work is, and what it is.
export const REFINER_WAGE = 2; // coin per day, due at dawn with the wool
/** Acts of processing by hand (cuts and smouches together) before his offer
 *  appears — the §6.11 pattern: automation is sold once the chore is felt. */
export const REFINER_UNLOCK = 6;

// ---- The Ryne market: fixed prices, daily appetite (spec §6.9) ----
// §17's moving prices wait for their milestone. Jenever price 0 = no legal buyer.
// §6.17 — the fence: a back-door buyer at Ryne, uncapped by the daily appetite,
// who takes surplus contraband off your hands at a haircut. The priced way out
// of a sated market, so a laden cart need not sit in town waiting to be seized.
export const FENCE_PRICE_MULT = 0.6;
export const BRANDY_BASE_PRICE = 6;
export const QUALITY_MULT = { rough: 0.6, fair: 1.0, gent: 1.8 } as const; // §17.3
export const RYNE_PRICE: Record<Good, number> = {
  fleece: WOOL_PRICE_DOMESTIC,
  jenever: 0,
  tea: 7,
  'bulked-tea': 4, // §6.17: the undiscerning buyer pays less for the stretched leaf
  lace: 24,
  'brandy-rough': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.rough),
  'brandy-fair': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.fair),
  'brandy-gent': Math.round(BRANDY_BASE_PRICE * QUALITY_MULT.gent),
};
/** Units Ryne will buy per day, reset at dawn. Saturation as a wall. §6.16:
 *  fleece demand sits just over the starting clip — a grown flock's surplus
 *  wool moves only over the gunwale (owling), never through the ledger. */
export const DAILY_DEMAND: Record<Good, number> = {
  fleece: 16,
  jenever: 0,
  tea: 8,
  'bulked-tea': 16, // §6.17: a fatter, cheaper channel than the fine leaf's 8
  lace: 2,
  'brandy-rough': 10,
  'brandy-fair': 6,
  'brandy-gent': 2,
};

// ---- M3: Heat, two pools (spec §6.10) ----
export const REGIONAL_HEAT_DECAY = 0.97; // × at dawn — the parish forgets, slowly
export const NATIONAL_HEAT_DECAY = 0.995; // × at dawn — London barely forgets
export const PROMOTION_THRESHOLD = 100; // regional above this spills upward at dawn
export const PROMOTION_RATE = 0.1; // share of the excess that promotes
export const SUSPICION_SHARE = 0.5; // every heat event stains its nearest node by this
export const SUSPICION_DECAY = 0.99; // × at dawn — he keeps notes
export const STORAGE_HEAT_COEFF = 0.01; // per illicit unit over cover, per tick (§18)
export const MARKET_TATTLE = 0.5; // heat per contraband unit sold at Ryne
export const DITCH_HEAT = 0.2; // heat per unit tipped into a dyke — tubs carry no name
/** What a site can hide in plain sight (stock, not throughput — §6.1 leak is M4). */
export const COVER_CAPACITY: Partial<Record<string, number>> = {
  farm: 4, // wool-trade clutter
  'cutting-house': 6,
};

// ---- M3: the Riding Officer (spec §6.10) ----
export const OFFICER_ARRIVAL_HEAT = 30; // first dawn regional at or above this, he comes
/** §20.2 — the London gauge's display ceiling (the doom dial reads full here).
 *  A display scale only, until M6 names the ending's true threshold. */
export const LONDON_GAUGE_CEILING = 100;
export const PATROL_THRESHOLD = 4; // max suspicion below this, he rides his beat
export const SEIZURE_HEAT = 1.5; // regional heat per unit seized
export const SEARCH_RELIEF = 0.5; // × suspicion at a node searched clean
export const SEARCH_HEAT_RELIEF = 0.8; // × regional heat when a search finds you clean — going straight pays
export const HORSE_TICKS_PER_TILE_ROAD = 0.18; // faster than any cart
export const HORSE_TICKS_PER_TILE_MARSH = 0.45; // the marsh fights horses

// ---- M3: the books (spec §6.10 / §19.2) ----
export const PLAUSIBLE_YIELD_MIN = 0.5; // he knows what a Romney ewe gives
export const WOOL_GAP_COEFF = 1.0; // regional heat per fleece adrift at inspection
// §6.10 (M5, §6.17 Beat 3) — the audit cadence: the dawn after each rent day
// the farm is the officer's target regardless of stains, so the books are
// read even when the hub keeps the barn spotless. Without it a crime run
// entirely off-farm never has its wool ledger opened.
export const BOOK_AUDIT_PERIOD_DAYS = 6;
export const BOOK_AUDIT_OFFSET_DAYS = 1;

// ---- M3: wheels (spec §6.11) ----
export const CART_COST = 50; // coin, cart and pony, bought at the farm
export const CART_RESALE = 40; // the wheelwright buys back at a small loss (§6.11)
export const MAX_CARTS = 3; // the yard holds three
export const CARTER_WAGE = 3; // coin per carter, due at dawn with the wool
/**
 * Lawful fleece sold by hand before a carter may be hired (spec §6.11 / §10):
 * automation is offered only once the manual round is a felt chore — about two
 * cart-loads hauled and sold. (A lawful life makes no Heat, so no officer comes
 * to reset the tally before this; see revenue.ts.)
 */
export const CARTER_UNLOCK_FLEECE = 2 * CART_CAPACITY;
/**
 * §6.11 / §6.17 — a carter who cannot sell his whole load waits at the market
 * for the appetite to refresh, exposed (a laden cart in town has no cover and
 * is seized whole if the officer inspects there), up to this many days — then
 * carries the remainder home to cover rather than bleed Heat forever.
 */
export const CARTER_MARKET_PATIENCE_DAYS = 2;

// ---- M5a-4: asking on the quay (spec §6.9) ----
export const ROUND_COST = 2; // coin, a round for the alehouse, once a day
/** Lawful fleece sold at Ryne before the quay loosens rumour n — about one
 *  cart-load per rumour. Length = the chain; the last rumour unlocks the
 *  Dutchman early (the first rent remains the unasked floor). */
export const RUMOUR_TRUST: readonly number[] = [8, 16, 24];

// ---- Rent (spec §6.8: the first squeeze) ----
export const RENT_AMOUNT = 120; // coin, per period
export const RENT_PERIOD_DAYS = 6; // first due at dawn, this many days after placement
export const SHEEP_VALUE = 10; // the agent's valuation under distraint

// ---- M4c-2: the Hawksmere raid (spec §6.13) ----
// A rival smuggling company, provoked by your market footprint, that raids to
// take your goods. Numbers are opening bids for the distribution test (§13).
/** Cumulative contraband units sold at Ryne before the Company takes notice. */
export const HAWKSMERE_PROVOKE = 60;
/** Days from provocation to the first muster. */
export const HAWKSMERE_FIRST_RAID_DELAY_DAYS = 4;
/** Days between one raid resolving and the next mustering. */
export const RAID_INTERVAL_DAYS = 6;
/** Days of warning between a muster gathering and the blow falling. */
export const RAID_MUSTER_LEAD_DAYS = 2;
/** The first raid is a gentle introduction: this many men, seizing only a share. */
export const HAWKSMERE_FIRST_RAID = 6;
export const FIRST_RAID_SEIZE_FRAC = 1 / 3;
/** Every raid after the first: base, plus growth per raid survived, plus footprint. */
export const HAWKSMERE_BASE = 12;
export const HAWKSMERE_GROWTH = 4;
export const HAWKSMERE_SCALE = 40; // +1 raider per this many contraband units sold

// The Crown escalates on the *other* meter (§6.13): national Heat. The raider
// who comes is the worst your doom clock has earned — and Dragoons do not rout.
export const WATER_GUARD_HEAT = 40;
export const DRAGOON_HEAT = 80;
export const WATER_GUARD_BASE = 14;
export const DRAGOON_BASE = 20;

// ---- M4c: the garrison & Standing (spec §6.13) ----
// Men posted at a building against the raid to come. Muster is up-front, wages
// fall at dawn with the carter's (§6.11); a building that cannot pay loses men.
export const MILITIA_MUSTER = 15; // coin to raise one marsh militiaman
export const MILITIA_WAGE = 1; // coin/day
export const CREW_MUSTER = 40; // coin to raise one smuggler
export const CREW_WAGE = 3; // coin/day
/** A building holds this many, plus more per fort tier (fort = capacity too). */
export const GARRISON_BASE = 4;
export const GARRISON_PER_TIER = 2; // bare holds 4, a fortress 12

// Standing — the parish's regard (spec §6.13 / §11). Falls when your people
// die (STANDING_LOSS_PER_FRIENDLY_DEAD, in the combat block above), drifts back
// in peace. At zero the parish gives you up — survivable, not a loss.
export const STANDING_START = 100;
export const STANDING_RECOVERY = 0.5; // per day, up to the start
/** With an informer set (Standing hit zero), the free hides close to this. */
export const INFORMER_COVER = 0;

// ---- M4b: fortification & the visibility trade-off (spec §6.12) ----
// A per-building tier ladder (the Trade line, §22). Bought with coin, no
// upkeep. Each rung hardens the building (+alpha in a raid, §14.2) and, the
// trap, makes it louder to the Revenue — the silhouette is the tell.
export const MAX_FORT_TIER = 4;
/** Coin to climb *to* each tier (index = tier). Roughly doubles per rung. */
export const FORT_COST: readonly number[] = [0, 40, 80, 160, 320];
/**
 * Each tier's contribution to a building's visibility (§6.4). Climbs faster
 * than the +0.05/tier alpha: hardness and hiddenness pull apart on purpose.
 * Index = tier; tier 0 is invisible, tier 1 (dogs & hedge) is nearly so.
 */
export const FORT_VISIBILITY: readonly number[] = [0, 0.1, 0.3, 0.6, 1.0];
/**
 * Regional heat a hard building stands off each dawn, per unit of visibility.
 * Tuned against the 0.97 regional decay so dogs are all but silent, mid-tiers
 * add real load, and a full fortress (visibility 2.0) draws the officer's
 * arrival on its own inside a fortnight — its steady state (~86) sits just
 * under the promotion threshold, so bare walls alone do not start the doom
 * clock. An opening bid for the distribution test to beat into shape (§6.12).
 */
export const FORT_VISIBILITY_HEAT = 1.3;
// (The dogs-give-intelligence-not-alpha rule of §22 bites in raids, so it lives
//  with the combat wiring in M4c, not here — M4b's fort alpha stays latent.)

// ---- M4: combat — deterministic attrition (spec §14) ----
// The battle is a sub-tick loop that runs the attrition for real; the render
// plays back the frame log. No dice here — combat is a pure function of the
// setup and the player's Calls. Numbers are opening bids; §14 says tune here.

/** Integration step for the Lanchester equations (§14.1). Tuned 0.05 → 0.01
 *  (M5 hub polish, playtest): typical raids now resolve in §14's intended
 *  30–50 frames instead of 3–7, so the watched battle has a story to tell. */
export const COMBAT_DT = 0.01;
/** Safety cap on sub-ticks; a real battle ends in rout or annihilation first. */
export const COMBAT_MAX_FRAMES = 600;
/** Both sides start whole-hearted. */
export const COMBAT_START_MORALE = 100;
/**
 * Linear law divides losses by how many you can bring to bear against a
 * reference cohort (§14.1): outnumbered on prepared ground hurts *far* less,
 * and a crowd that cannot deploy takes *more*. This is the marsh's whole payoff.
 */
export const COMBAT_LINEAR_REF = 20;

/** Base kill rate per man, per enemy, per dt (spec §14.2). */
export const FACTION_ALPHA = {
  'marsh-militia': 0.1, // fowling pieces; they have families
  'smuggler-crew': 0.18, // armed, willing, experienced
  'riding-officer': 0.15,
  hawksmere: 0.3, // hard men, well armed
  'water-guard': 0.35, // professionals
  dragoons: 0.55,
  wights: 0.4, // ignore fortification; halved by iron & salt (M5)
} as const;

/** Morale floor below which a force routs (spec §14.3). Two rows are the threat. */
export const FACTION_BREAKPOINT = {
  'riding-officer': 65, // one volley and they are gone
  'marsh-militia': 55, // they have farms to go back to
  hawksmere: 35, // they will take real losses first
  'smuggler-crew': 30,
  'water-guard': 25, // professionals
  dragoons: 0, // they do not rout
  wights: 0, // not alive; cannot be frightened
} as const;

/** Alpha added to the *defender* per tier of ground works (spec §14.2). */
export const FORT_ALPHA_PER_TIER = 0.05;
/** Leiden fence / ram and the marsh's Guardian — additive alpha (spec §14.2). */
export const GALVANIC_FENCE_ALPHA = 0.12;
export const STEAM_RAM_ALPHA = 0.2;
export const BOUND_GUARDIAN_ALPHA = 0.35;

// Morale erosion (spec §14.3): morale -= casualtyRate × coeff + (leaderDown ? 25 : 0).
export const MORALE_CASUALTY_COEFF = 6;
export const LEADER_DOWN_MORALE = 25;
/** A side's leader falls once it has lost this fraction of its starting strength. */
export const LEADER_DOWN_THRESHOLD = 0.5;
/** Below this many men a side is spent — annihilated (headcount is fractional). */
export const COMBAT_MIN_STRENGTH = 0.5;
/**
 * §14.3 — the rout's toll: a side that *breaks* loses this fraction of its
 * remaining men as it leaves the field — broken men are cut down running.
 * A retreat sounded before morale collapses pays no toll; that is what the
 * Call buys. (Without this, fine integration lets every morale-rout escape
 * whole, and §14.6's economy goes silent.)
 */
export const ROUT_TOLL = 0.2;

// The three Calls (spec §14.4).
/** Fire the Engine: a one-shot spike added to the player's alpha for the rest. */
export const ENGINE_SPIKE_ALPHA = 0.4;
/** …and the Sluice-Cannon is seen for counties — national Heat, once. */
export const ENGINE_FIRE_HEAT = 20;
/** Pay Them Off: coin to end it, scaled to how badly you are losing (§14.4). */
export const PAYOFF_BASE = 20;
export const PAYOFF_PER_ENEMY_HEAD = 5;
/** Coin only silences the venal; the button is greyed against the rest (§14.4). */
export const PAY_OFFABLE: readonly string[] = ['hawksmere', 'riding-officer'];

// Consequences — combat feeds the economy (spec §14.6).
export const STANDING_LOSS_PER_FRIENDLY_DEAD = 3;
export const NATIONAL_HEAT_PER_REVENUE_DEAD = 40; // one dead officer > a year of running
export const NATIONAL_HEAT_PER_DRAGOON_DEAD = 15; // they expect casualties; you exist
/** Rescaled 2 → 0.4 with COMBAT_DT (0.05 → 0.01): the Guardian's price is
 *  per unit of *fought time*, not per integration step. */
export const DEBT_PER_GUARDIAN_FRAME = 0.4;
/** The Revenue's own men, for the heat tally (§14.6). */
export const REVENUE_FACTIONS: readonly string[] = ['riding-officer', 'water-guard'];

// ---- M5a: difficulty & mercy (spec §6.15) ----
// The dial scales what the world does to you — never what your own economy
// yields — so every player learns the same arithmetic. heatMult scales heat
// *gained*, never decay; raidMult scales the muster; crisisSpacingDays keeps
// existential events from stacking (later ones queue, they do not vanish).
export interface DifficultyDials {
  rentMult: number;
  heatMult: number;
  raidMult: number;
  debtMult: number; // Debt arrives in M5b; the dial is ready for it
  crisisSpacingDays: number;
}
export const DIFFICULTY: Record<Difficulty, DifficultyDials> = {
  gentle: { rentMult: 0.75, heatMult: 0.8, raidMult: 0.7, debtMult: 0.75, crisisSpacingDays: 6 },
  fair: { rentMult: 1.0, heatMult: 1.0, raidMult: 1.0, debtMult: 1.0, crisisSpacingDays: 4 },
  hard: { rentMult: 1.25, heatMult: 1.2, raidMult: 1.3, debtMult: 1.0, crisisSpacingDays: 0 },
};
/** Lower-only ordering (§6.15): a player may step left, never right. */
export const DIFFICULTY_ORDER: readonly Difficulty[] = ['gentle', 'fair', 'hard'];

// Mercy — diegetic, visible, priced; active at every difficulty (§6.15).
/** The Dutchman covers a rent shortfall at this vig; one loan at a time. */
export const DUTCHMAN_VIG = 1.25;
/** …and takes this slice off the top of every later sale until the book clears. */
export const DUTCHMAN_SLICE = 0.5;
/** The parish covers a forfeit-grade distraint if it still thinks well of you. */
export const PARISH_VOUCH_STANDING = 30;
export const PARISH_VOUCH_COST = 10; // Standing, spent
export const PARISH_VOUCH_COOLDOWN_DAYS = 12;

// ---- M5a: the shearer & the flock market (spec §6.16) ----
// The designed identity, asserted in a test: flock × price − carter − shearer
// = rent/day exactly. The fully hired farm pays the rent to the coin.
export const SHEARER_WAGE = 1; // coin/day, due at dawn with the wool
/** Hand-shears before the chore is felt and his offer appears (§6.11 pattern). */
export const SHEARER_UNLOCK_SHEARS = 6;
export const SHEEP_PRICE_BUY = 15; // coin, at Ryne; home by the next dawn
export const SHEEP_PRICE_SELL = 8; // the market pays cash and pays worse than the agent values
export const FLOCK_CAP = 24; // Walland's pasture holds what it holds (dykes raise it, M5½)
/** §6.16 — the one-time card naming the flock-vs-carter fork, raised the first
 *  dawn on or after this day: before the first rent, as the carter comes into view. */
export const FLOCK_SPOTLIGHT_DAY = 4;

// ---- M5a: the research bench (spec §6.14) ----
// Coin is nominal everywhere in research — the real price is always a meter
// (Debt, the Heat floor, Standing). Trade costs only coin: safe, and weak.
export const RESEARCH_COST: Record<ResearchTree, readonly number[]> = {
  trade: [40],
  marsh: [30, 70, 140],
  leiden: [50, 110, 220],
};
export const RESEARCH_DAYS: Record<ResearchTree, readonly number[]> = {
  trade: [2],
  marsh: [2, 3, 4],
  leiden: [3, 4, 5],
};
/** Trade tier 1 — the false-bottom cart: route exposure eased, and a hollow
 *  floor the road-stop cannot see into (§6.14). Yard searches still see all:
 *  a stopped cart is searched at leisure. */
export const FALSE_BOTTOM_EXPOSURE_MULT = 0.6;
export const FALSE_BOTTOM_COVER = 4;

// ---- Bookkeeping ----
export const MAX_LOG_EVENTS = 50; // event log ring buffer, part of state
/** §10 (M5 hub polish, playtest) — offer-type milestone cards keep this much
 *  daylight between them, so the day-6 unlock pile reads as a week of
 *  discoveries instead of an avalanche. World-event cards (the officer
 *  arriving, the lugger offshore) are never delayed. */
export const MILESTONE_CARD_SPACING_DAYS = 1;
