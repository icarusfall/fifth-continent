// Spec §6.10 — the Revenue. Heat in two pools, suspicion by node, and one
// deterministic Riding Officer. Everything here is a pure function of
// GameState: no dice, no clocks. Outplaying him is timetabling, not luck.

import {
  BOOK_AUDIT_OFFSET_DAYS,
  BOOK_AUDIT_PERIOD_DAYS,
  CELLAR_COVER_PER_TIER,
  COVER_CAPACITY,
  DIFFICULTY,
  DITCH_HEAT,
  MARSH_LANTERN_EXPOSURE_MULT,
  TIME_OF_DAY_MOD_NIGHT,
  FALSE_BOTTOM_COVER,
  FALSE_BOTTOM_EXPOSURE_MULT,
  FORT_VISIBILITY,
  FORT_VISIBILITY_HEAT,
  GALVANIC_VISIBILITY,
  INFORMER_COVER,
  LIGHTER_EXPOSURE_MULT,
  MARKET_TATTLE,
  MARSH_VEIL_DIV,
  MAX_CELLAR_TIER,
  MAX_FORT_TIER,
  MAX_LOG_EVENTS,
  NATIONAL_HEAT_CAP,
  NATIONAL_HEAT_DECAY,
  NATIONAL_HEAT_QUIET_DECAY,
  QUIET_SEASON_DAYS,
  OFFICER_ARRIVAL_HEAT,
  PATROL_THRESHOLD,
  PAUPER_FLOOR,
  PLAUSIBLE_YIELD_MIN,
  RYNE_PRICE,
  PROMOTION_RATE,
  PROMOTION_THRESHOLD,
  REGIONAL_HEAT_DECAY,
  SEARCH_RELIEF,
  SEARCH_HEAT_RELIEF,
  SEIZURE_HEAT,
  STORAGE_HEAT_COEFF,
  SUSPICION_DECAY,
  SUSPICION_SHARE,
  TICKS_PER_DAY,
  WOOL_GAP_COEFF,
} from './balance';
import { firstHop, horseLatency, nodeById, officerEdgesFor, otherEnd } from './map';
import { timeOfDayMod } from './time';
import type { Cart, GameEvent, GameState, Good, MapEdge, NodeId, Store } from './types';

// ---- Contraband ----
// Fleece is lawful in itself: wool's crime is the export (§2), and the
// Revenue catches that in the books, not on the marsh.
export const CONTRABAND: readonly Good[] = [
  'jenever',
  'tea',
  'bulked-tea',
  'lace',
  'brandy-rough',
  'brandy-fair',
  'brandy-gent',
];

export function illicitCount(store: Store): number {
  return CONTRABAND.reduce((sum, g) => sum + (store[g] ?? 0), 0);
}

/** What the officer writes in his book — the goods' names as the log and the
 *  UI both speak them. Lives sim-side so seizures can name what they take
 *  (§6.10, M5c playtest: "seizes 6 goods" reads as nothing at all). */
export const GOOD_LABEL: Record<Good, string> = {
  fleece: 'fleece',
  jenever: 'tubs of jenever',
  tea: 'bohea tea',
  'bulked-tea': 'bulked tea',
  lace: 'lace',
  'brandy-rough': 'rough brandy',
  'brandy-fair': 'fair brandy',
  'brandy-gent': "gentleman's brandy",
};

/** "4 bohea tea, 2 lace" — the itemised line every seizure speaks. */
export function goodsSummary(taken: Store): string {
  const parts = (Object.entries(taken) as Array<[Good, number]>)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${GOOD_LABEL[g]}`);
  return parts.join(', ');
}

/**
 * §6.15 — condemnable worth: coin plus contraband at Ryne prices, everywhere
 * it sits. Overproof jenever prices at 0 (no legal buyer — the Board would
 * pour it in a ditch); lawful assets never make you worth pouncing on, so
 * the go-straight recovery path stays under the candle at any flock size.
 */
export function worthOf(state: GameState): number {
  let goods = 0;
  for (const nodeId of Object.keys(state.stores)) {
    for (const g of CONTRABAND) goods += (state.stores[nodeId][g] ?? 0) * RYNE_PRICE[g];
  }
  for (const cart of state.carts) {
    for (const g of CONTRABAND) goods += (cart.cargo[g] ?? 0) * RYNE_PRICE[g];
  }
  return state.coin + goods;
}

/** §6.15 — the Floor: nobody spends ink or men on a pauper. */
export function underTheCandle(state: GameState): boolean {
  return worthOf(state) < PAUPER_FLOOR;
}

/** Contraband held anywhere — every store and every cart. Zero means the
 *  player has genuinely gone straight, not merely stashed the tubs elsewhere. */
export function illicitAnywhere(state: GameState): number {
  let n = 0;
  for (const k of Object.keys(state.stores)) n += illicitCount(state.stores[k]);
  for (const c of state.carts) n += illicitCount(c.cargo);
  return n;
}

/**
 * What a building can hide in plain sight (§18, §6.1). With an informer set
 * (Standing hit zero, §6.13), the marsh's free hides close: cover drops to
 * INFORMER_COVER and every tub is visible to a search — but a cellar the
 * parish never saw dug stays yours (§6.12 M5½ playtest: the scar stays
 * severe; the recovery the player *built* survives it, per §6.15's Floor).
 */
export function coverOf(state: GameState, nodeId: NodeId): number {
  const base = state.informer ? INFORMER_COVER : (COVER_CAPACITY[nodeId] ?? 0);
  const cellar =
    Math.min(state.cellars[nodeId] ?? 0, MAX_CELLAR_TIER) * CELLAR_COVER_PER_TIER;
  // §6.14 (M5½ playtest) — the philosopher takes the loft, not the hides:
  // housing him no longer touches cover. His prices are the letters, the
  // floor, and the wights' list.
  return Math.max(0, base + cellar);
}

// ---- Heat plumbing ----

/** Every heat event lands regional; most also stain the nearest node (§6.6).
 *  §6.15: the dial scales heat *gained* here, at the one funnel — never decay. */
export function addHeat(state: GameState, amount: number, stainNode?: NodeId): void {
  amount *= DIFFICULTY[state.difficulty].heatMult;
  if (amount <= 0) return;
  state.heat.regional += amount;
  if (stainNode) {
    state.revenue.suspicion[stainNode] =
      (state.revenue.suspicion[stainNode] ?? 0) + amount * SUSPICION_SHARE;
  }
}

/** Spec §6.14 — trade tier 1: every cart rides on a hollow floor. */
export function hasFalseBottom(state: GameState): boolean {
  return state.research.completed.trade >= 1;
}

/** Route heat for one tick of laden movement (§6.2, weather and tech = 1, 0). */
export function accrueRouteHeat(state: GameState, cart: Cart, edge: MapEdge): void {
  const illicit = illicitCount(cart.cargo);
  if (illicit <= 0 || cart.location.kind !== 'edge') return;
  // §6.14 Marsh 3 — the hollow way is not there: no exposure, no stain.
  if (state.wights.hollowWay === edge.id) return;
  // §6.14: a false-bottomed cart reads quieter on the road (tech mult of §6.2).
  const techMult = hasFalseBottom(state) ? FALSE_BOTTOM_EXPOSURE_MULT : 1;
  // §6.14 Marsh 1 — lantern haulers: night moves over marsh read a tenth
  // as loud. Passive once learned; the Debt is charged on arrival (tick.ts).
  const lanternMult =
    state.research.completed.marsh >= 1 &&
    (edge.id === 'marsh-track' || edge.id.startsWith('cut-')) &&
    timeOfDayMod(state.tick) === TIME_OF_DAY_MOD_NIGHT
      ? MARSH_LANTERN_EXPOSURE_MULT
      : 1;
  // §6.14 (M5c) — the lighter's engine is audible over water: laden runs
  // read the louder, day or night.
  // §6.18 — only the STEAM hull is loud; the tub is quiet as weed, and its
  // waterway's own exposure (0.1) already prices the ride.
  const lighterMult = cart.vessel === 'sea' ? LIGHTER_EXPOSURE_MULT : 1;
  const amount =
    ((illicit * edge.exposure) / edge.latency) *
    timeOfDayMod(state.tick) *
    techMult *
    lanternMult *
    lighterMult;
  // The stain falls on whichever end of the road the cart is nearer.
  const nearer =
    cart.location.progress * 2 < edge.latency ? cart.location.from : cart.location.to;
  addHeat(state, amount, nearer);
}

/**
 * Fortification visibility of a building before concealment (spec §6.4):
 * the sum of its tiers' visibility contributions, plus the galvanic fence.
 * Tier 0 (or an un-listed node) is invisible. The Reed-Veil's Debt is
 * charged against this raw figure — the marsh knows what it is hiding.
 */
export function fortVisibilityRaw(state: GameState, nodeId: NodeId): number {
  const tier = Math.min(state.fortifications[nodeId] ?? 0, MAX_FORT_TIER);
  let v = 0;
  for (let t = 1; t <= tier; t++) v += FORT_VISIBILITY[t];
  // §6.14 (M5c) — the galvanic fence reads from the coast road: Leiden's
  // apparatus is enormous and visibly weird (§6.4).
  if (
    state.leiden.state === 'housed' &&
    state.leiden.node === nodeId &&
    state.research.completed.leiden >= 1
  ) {
    v += GALVANIC_VISIBILITY;
  }
  return v;
}

/** §6.4's promise kept (§6.14 Marsh 4, M5c playtest): while the Reed-Veil
 *  stands, the whole sum — the galvanic apparatus included — reads divided.
 *  Every consumer (dawn tell, over-cover leak, the yard meter) follows this
 *  one number; the raiders' arithmetic never does (§14 reads fort tiers). */
export function fortVisibility(state: GameState, nodeId: NodeId): number {
  const raw = fortVisibilityRaw(state, nodeId);
  return state.wights.veil && state.research.completed.marsh >= 4 ? raw / MARSH_VEIL_DIV : raw;
}

/** Storage heat, per tick (§18): stores hide up to their cover; carts hide nothing. */
export function accrueStorageHeat(state: GameState): void {
  for (const nodeId of Object.keys(state.stores)) {
    const over = illicitCount(state.stores[nodeId]) - coverOf(state, nodeId);
    // §6.1/§6.12: what a hard building cannot hide, it leaks the louder.
    if (over > 0) addHeat(state, over * STORAGE_HEAT_COEFF * (1 + fortVisibility(state, nodeId)), nodeId);
  }
  for (const cart of state.carts) {
    if (cart.location.kind !== 'node') continue; // moving carts pay route heat instead
    const illicit = illicitCount(cart.cargo);
    if (illicit > 0) addHeat(state, illicit * STORAGE_HEAT_COEFF, cart.location.nodeId);
  }
}

/** The town drinks happily and talks constantly (§6.10); and every contraband
 *  sale widens your footprint on the Company's market (§6.13). */
export function accrueMarketTattle(state: GameState, good: Good, qty: number): void {
  if (!CONTRABAND.includes(good)) return;
  addHeat(state, qty * MARKET_TATTLE, 'ryne');
  state.contrabandSold += qty;
  // §6.18 (M5½d) — the quiet season's clock is reset by the *sale*, not the
  // landing: what London notices is goods reaching a market. Tubs on a beach
  // are the parish's business (and the barn's heat, §18).
  state.lastContrabandTick = state.tick;
}

/** Tubs carry no name: regional heat only, no stain (§6.10). */
export function accrueDitchHeat(state: GameState, units: number): void {
  state.heat.regional += units * DITCH_HEAT * DIFFICULTY[state.difficulty].heatMult;
}

// ---- Dawn bookkeeping ----

function logEvent(state: GameState, text: string): void {
  // Mirrors tick.ts's ring buffer; kept local so revenue.ts stays standalone.
  state.log.push({ tick: state.tick, text } satisfies GameEvent);
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

/** Decay, promotion, gossip, arrival, and the day's patrol plan. Dawn only. */
export function dawnRevenue(state: GameState): void {
  // Decay first: yesterday cools before today is planned (§6.3). Publication
  // (§6.14, M5c) floors the national side: London can never entirely forget
  // a parish the societies keep reading about.
  state.heat.regional *= REGIONAL_HEAT_DECAY;
  // §6.18 (M5½d) — the quiet season: London's attention is the one meter the
  // player could not spend down, which made the Dragoon rung a door with no
  // way back. Sell nothing for QUIET_SEASON_DAYS and it cools at the quiet
  // rate — bought with the trade you are not doing, never with coin.
  const quiet = state.tick - state.lastContrabandTick >= QUIET_SEASON_DAYS * TICKS_PER_DAY;
  const before = state.heat.national;
  state.heat.national = Math.max(
    state.heat.national * (quiet ? NATIONAL_HEAT_QUIET_DECAY : NATIONAL_HEAT_DECAY),
    state.nationalHeatFloor,
  );
  // Announced the dawn it begins, once, so it is read and not inferred (§10).
  // `before` guards the floor case: no line when there is nothing left to cool.
  if (quiet && before > state.nationalHeatFloor && !state.quietSeason) {
    state.quietSeason = true;
    logEvent(
      state,
      'Nothing of yours has reached a market in four days. The talk in London turns to other counties — and the barn sits full while it does.',
    );
  } else if (!quiet && state.quietSeason) {
    state.quietSeason = false;
  }
  for (const k of Object.keys(state.revenue.suspicion)) {
    state.revenue.suspicion[k] *= SUSPICION_DECAY;
  }

  // Promotion: the parish's noise spills toward London (§6.3).
  const spill = Math.max(0, state.heat.regional - PROMOTION_THRESHOLD) * PROMOTION_RATE;
  state.heat.regional -= spill;
  state.heat.national += spill;
  // §6.18 (M5½d) — and there it stops. The cap goes on AFTER the spill so
  // nothing routes around it: every road into the national meter (sales,
  // storage, the works' tell, the parish's noise) ends here. Ordinary play,
  // however greedy, never summons soldiers — that must be an act the game
  // names, not a number quietly filling (designer's call, 2026-08).
  state.heat.national = Math.min(state.heat.national, NATIONAL_HEAT_CAP);

  // A hard building is a tell even when nothing moves through it (§6.12): each
  // dawn its works stand off fresh suspicion of their own. Before the gossip
  // snapshot and the officer's plan, so it shows in both.
  accrueFortHeat(state);

  // The parish talks over breakfast: the player reads yesterday's mind.
  state.revenue.gossip = { ...state.revenue.suspicion };

  const officer = state.revenue.officer;
  if (!officer.arrived) {
    if (state.heat.regional >= OFFICER_ARRIVAL_HEAT) {
      officer.arrived = true;
      officer.location = { kind: 'node', nodeId: 'customs' };
      logEvent(
        state,
        'A Riding Officer takes rooms above the Customs House. He has a list of questions.',
      );
    }
    return;
  }

  // The day's plan: the sorest stain if any is sore enough, else his beat —
  // except on an audit dawn (§6.10): the dawn after each rent day the farm is
  // his target regardless, so the books are read even when the hub keeps the
  // barn spotless. The Board's calendar bends for no stain.
  officer.inspectedToday = false;
  officer.targetNodeId = isAuditDawn(state.tick) ? 'farm' : patrolTarget(state);
}

/** §6.10 — the audit cadence: day % period == offset, and never day 1. */
export function isAuditDawn(tick: number): boolean {
  const day = Math.floor(tick / TICKS_PER_DAY);
  return day > BOOK_AUDIT_OFFSET_DAYS && day % BOOK_AUDIT_PERIOD_DAYS === BOOK_AUDIT_OFFSET_DAYS;
}

/**
 * Spec §6.13 / §11 — the parish's regard falls when your people die. At zero
 * the country people give you up: a permanent informer, and the free hides of
 * the marsh close (coverOf). Survivable, not a loss.
 */
export function loseStanding(state: GameState, amount: number): void {
  if (amount <= 0) return;
  state.standing = Math.max(0, state.standing - amount);
  if (state.standing <= 0 && !state.informer) {
    state.informer = true;
    logEvent(
      state,
      'Someone talks. The country people close their doors — the free hides of the marsh are gone.',
    );
  }
}

/** Your own roofs — the only buildings that can carry works or the fence. */
export function playerBuildings(state: GameState): NodeId[] {
  return state.cuttingHouse !== null ? ['farm', 'cutting-house'] : ['farm'];
}

/** The dawn tell of visible works (§6.12): each hard building stains itself.
 *  Walked over the player's buildings, not the fortification record — the
 *  galvanic fence makes a building loud without a single spade of earthwork
 *  (M5c playtest fix: an unfortified workshop previously paid no dawn tell). */
export function accrueFortHeat(state: GameState): void {
  for (const nodeId of playerBuildings(state)) {
    const vis = fortVisibility(state, nodeId);
    if (vis > 0) addHeat(state, vis * FORT_VISIBILITY_HEAT, nodeId);
  }
}

/**
 * §20.2 (M5c playtest) — the standing charge: heat the coming dawn will bring
 * with no further crime committed, per day. The dawn tell of the works plus a
 * day of over-cover leak. Pure of the tick so the HUD can read the charge
 * aloud; `/(1 − REGIONAL_HEAT_DECAY)` gives where the parish settles.
 */
export function standingDawnHeat(state: GameState): number {
  const mult = DIFFICULTY[state.difficulty].heatMult;
  let perDay = 0;
  for (const nodeId of playerBuildings(state)) {
    perDay += fortVisibility(state, nodeId) * FORT_VISIBILITY_HEAT;
  }
  for (const nodeId of Object.keys(state.stores)) {
    const over = illicitCount(state.stores[nodeId]) - coverOf(state, nodeId);
    if (over > 0) {
      perDay += over * STORAGE_HEAT_COEFF * (1 + fortVisibility(state, nodeId)) * TICKS_PER_DAY;
    }
  }
  return perDay * mult;
}

/** Highest-suspicion node at or over the threshold; otherwise the Ryne beat. */
export function patrolTarget(state: GameState): NodeId {
  let best: NodeId | null = null;
  let bestValue = 0;
  // Fixed iteration order for determinism: the map's node order.
  for (const nodeId of ['farm', 'ryne', 'shingle', 'cutting-house']) {
    if (nodeId === 'cutting-house' && !state.cuttingHouse) continue;
    const v = state.revenue.suspicion[nodeId] ?? 0;
    if (v > bestValue) {
      best = nodeId;
      bestValue = v;
    }
  }
  return best !== null && bestValue >= PATROL_THRESHOLD ? best : 'ryne';
}

// ---- The officer's day ----

/** Seize contraband from a store, up to `limit` units. Returns units taken. */
function seizeFrom(store: Store, limit: number, taken?: Store): number {
  let count = 0;
  for (const g of CONTRABAND) {
    if (count >= limit) break;
    const here = store[g] ?? 0;
    const take = Math.min(here, limit - count);
    if (take > 0) {
      store[g] = here - take;
      count += take;
      if (taken) taken[g] = (taken[g] ?? 0) + take;
    }
  }
  return count;
}

/** Search a node: what the cover cannot hide is seized (§6.10). */
function searchNode(state: GameState, nodeId: NodeId): void {
  const store = state.stores[nodeId] ?? {};
  const cartsHere = state.carts.filter(
    (c) => c.location.kind === 'node' && c.location.nodeId === nodeId,
  );
  const inStore = illicitCount(store);
  const aboard = cartsHere.reduce((sum, c) => sum + illicitCount(c.cargo), 0);
  const cover = coverOf(state, nodeId);
  // The building's clutter hides its own stock; a cart in the yard hides nothing.
  const found = Math.max(0, inStore - cover) + aboard;
  const name = nodeById(nodeId, state.farm, state.cuttingHouse).name;

  if (found <= 0) {
    // A clean search always eases the node's own suspicion. But the parish's
    // regional Heat only falls when you have genuinely gone straight — nothing
    // illicit anywhere (§6.10). A smuggler whose tubs are merely on the road
    // earns no forgiveness; lie low and clear the lot, and the meter drops
    // faster than dawn decay alone.
    state.revenue.suspicion[nodeId] = (state.revenue.suspicion[nodeId] ?? 0) * SEARCH_RELIEF;
    const wentStraight = illicitAnywhere(state) <= 0;
    if (wentStraight) state.heat.regional *= SEARCH_HEAT_RELIEF;
    logEvent(
      state,
      wentStraight
        ? `The officer turns over ${name} and finds honest clutter. The parish's suspicion of you eases.`
        : `The officer turns over ${name} and finds honest clutter. The trail cools.`,
    );
    return;
  }

  // §6.15 — under the candle: he counts, he notes, he does not condemn. No
  // seizure, no heat, no card — the Board does not send men for a pauper.
  if (underTheCandle(state)) {
    logEvent(
      state,
      `The officer turns over ${name}, counts what he finds, and puts the notebook away. The Board does not spend ink on a pauper's tubs.`,
    );
    return;
  }

  const taken: Store = {};
  let remaining = found - seizeFrom(store, Math.max(0, inStore - cover), taken);
  let offCarts = 0;
  for (const cart of cartsHere) {
    if (remaining <= 0) break;
    const fromThisCart = seizeFrom(cart.cargo, remaining, taken);
    remaining -= fromThisCart;
    offCarts += fromThisCart;
  }
  state.goodsSeized += found;
  state.lastSeizureNode = nodeId;
  addHeat(state, found * SEIZURE_HEAT); // no extra stain: the stain was earned already
  // §6.10 (M5c playtest) — the seizure names its goods, and a standing cart
  // learns the hard rule: the false bottom fools the road, never the yard.
  logEvent(
    state,
    `The officer searches ${name} and seizes ${found} goods for the Crown: ${goodsSummary(taken)}.` +
      (offCarts > 0 && hasFalseBottom(state)
        ? ' A cart standing still is searched at leisure — the hollow floor hides nothing in the yard.'
        : ''),
  );
}

/** Every fleece not yet weighed, wherever it sits — barn, boards, or backs. */
function fleeceOnHand(state: GameState): number {
  return (
    (state.stores.farm?.fleece ?? 0) +
    state.carts.reduce((sum, c) => sum + (c.cargo.fleece ?? 0), 0) +
    state.fleeceReady
  );
}

/**
 * §6.10 (M5c playtest) — the gap checkBooks would price at this instant,
 * computed pure so the ledger page can read the charge aloud BEFORE the
 * audit does: a shorted page with lawful sales is pure self-harm, and the
 * game must say so while the pen can still fix it.
 */
export function auditGapNow(state: GameState): number {
  const l = state.ledger;
  const accounted = l.soldLawfully + Math.max(0, fleeceOnHand(state) - l.openingStock);
  return (
    Math.abs(l.declaredToDate - accounted) +
    Math.max(0, l.grownToDate * PLAUSIBLE_YIELD_MIN - l.declaredToDate)
  );
}

/** The farm inspection reads the books as well (§6.10 / §19.2). */
function checkBooks(state: GameState): void {
  const l = state.ledger;
  const gap = auditGapNow(state);

  if (gap > 0 && underTheCandle(state)) {
    // §6.15 — read, adrift, and closed uncharged: nothing worth the ink.
    logEvent(
      state,
      `He counts the sheep, reads the book, and the arithmetic is ${
        Math.round(gap * 10) / 10
      } fleece adrift. He closes it. There is nothing here worth the Board's ink.`,
    );
  } else if (gap > 0) {
    addHeat(state, gap * WOOL_GAP_COEFF, 'farm');
    logEvent(
      state,
      `He counts the sheep twice and reads the book three times. The arithmetic is ${
        Math.round(gap * 10) / 10
      } fleece adrift.`,
    );
  } else {
    logEvent(state, 'He reads the book against the flock. It balances. He looks almost sorry.');
  }

  // The page is initialled: each gap is paid for once (§6.10).
  l.declaredToDate = 0;
  l.grownToDate = 0;
  l.soldLawfully = 0;
  l.openingStock = fleeceOnHand(state);
}

/** One tick of the officer's ride: move, stop carts he passes, inspect. */
export function officerTick(state: GameState): void {
  const officer = state.revenue.officer;
  if (!officer.arrived) return;

  const edges = officerEdgesFor(state.farm, state.cuttingHouse);

  if (officer.location.kind === 'edge') {
    const edgeId = officer.location.edgeId;
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) {
      // The cutting house appeared or vanished under him mid-ride: stand down.
      officer.location = { kind: 'node', nodeId: officer.location.from };
      return;
    }
    officer.location.progress += 1;
    stopCartsOnEdge(state, edge);
    if (officer.location.progress >= horseLatency(edge)) {
      officer.location = { kind: 'node', nodeId: officer.location.to };
    }
    return;
  }

  const at = officer.location.nodeId;

  if (officer.targetNodeId === at && !officer.inspectedToday && at !== 'customs') {
    searchNode(state, at);
    if (at === 'farm') checkBooks(state);
    officer.inspectedToday = true;
    officer.targetNodeId = 'customs'; // one inspection a day, then home
    return;
  }

  const target = officer.targetNodeId ?? 'customs';
  if (at === target) return; // home, or nothing left to do: he waits

  const hop = firstHop(at, target, edges, horseLatency);
  if (!hop) return;
  officer.location = {
    kind: 'edge',
    edgeId: hop.id,
    from: at,
    to: otherEnd(hop, at),
    progress: 0,
  };
}

/** Carts sharing his road are stopped and searched: cart cover is 0 (§6.10) —
 *  unless the floor is hollow (§6.14): the road-stop misses what rides under
 *  the boards. A cart searched at leisure in a yard still shows everything. */
function stopCartsOnEdge(state: GameState, edge: MapEdge): void {
  // §6.14 Marsh 3 — the hollow way never enters the Revenue's knowing: a
  // cart on it shares no road with anyone, whatever the map says.
  if (state.wights.hollowWay === edge.id) return;
  const hidden = hasFalseBottom(state) ? FALSE_BOTTOM_COVER : 0;
  for (const cart of state.carts) {
    if (cart.location.kind !== 'edge' || cart.location.edgeId !== edge.id) continue;
    const aboard = illicitCount(cart.cargo);
    const found = Math.max(0, aboard - hidden);
    if (found <= 0) continue; // honest wool is waved on, silently
    // §6.15 — under the candle: counted, noted, waved on.
    if (underTheCandle(state)) {
      logEvent(
        state,
        `The officer stops ${cart.name} on ${edge.name.toLowerCase()}, counts the tubs, and waves it on — not worth the candle.`,
      );
      continue;
    }
    const taken: Store = {};
    seizeFrom(cart.cargo, found, taken);
    state.goodsSeized += found;
    state.lastSeizureNode = cart.location.to;
    addHeat(state, found * SEIZURE_HEAT, cart.location.to);
    // §6.10 (M5c playtest) — name the goods; and when the hollow floor held
    // its four, say that too, so the tier is seen working (like the lanterns).
    const kept = Math.min(hidden, aboard);
    logEvent(
      state,
      `The officer stops ${cart.name} on ${edge.name.toLowerCase()} and seizes ${found} goods: ${goodsSummary(taken)}.` +
        (kept > 0 ? ` The hollow floor keeps its ${kept}.` : ''),
    );
  }
}
