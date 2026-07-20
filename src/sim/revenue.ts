// Spec §6.10 — the Revenue. Heat in two pools, suspicion by node, and one
// deterministic Riding Officer. Everything here is a pure function of
// GameState: no dice, no clocks. Outplaying him is timetabling, not luck.

import {
  BOOK_AUDIT_OFFSET_DAYS,
  BOOK_AUDIT_PERIOD_DAYS,
  COVER_CAPACITY,
  DIFFICULTY,
  DITCH_HEAT,
  MARSH_LANTERN_EXPOSURE_MULT,
  TIME_OF_DAY_MOD_NIGHT,
  FALSE_BOTTOM_COVER,
  FALSE_BOTTOM_EXPOSURE_MULT,
  FORT_VISIBILITY,
  FORT_VISIBILITY_HEAT,
  INFORMER_COVER,
  MARKET_TATTLE,
  MAX_FORT_TIER,
  MAX_LOG_EVENTS,
  NATIONAL_HEAT_DECAY,
  OFFICER_ARRIVAL_HEAT,
  PATROL_THRESHOLD,
  PLAUSIBLE_YIELD_MIN,
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
 * INFORMER_COVER and every tub is visible to a search.
 */
export function coverOf(state: GameState, nodeId: NodeId): number {
  return state.informer ? INFORMER_COVER : (COVER_CAPACITY[nodeId] ?? 0);
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
  const amount =
    ((illicit * edge.exposure) / edge.latency) * timeOfDayMod(state.tick) * techMult * lanternMult;
  // The stain falls on whichever end of the road the cart is nearer.
  const nearer =
    cart.location.progress * 2 < edge.latency ? cart.location.from : cart.location.to;
  addHeat(state, amount, nearer);
}

/**
 * Fortification visibility of a building (spec §6.4/§6.12): the sum of its
 * tiers' visibility contributions. Concealment tech would divide this (§6.4,
 * M5); until then a hard building is exactly as loud as its works. Tier 0 (or
 * an un-listed node) is invisible.
 */
export function fortVisibility(state: GameState, nodeId: NodeId): number {
  const tier = Math.min(state.fortifications[nodeId] ?? 0, MAX_FORT_TIER);
  let v = 0;
  for (let t = 1; t <= tier; t++) v += FORT_VISIBILITY[t];
  return v;
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
  // Decay first: yesterday cools before today is planned (§6.3).
  state.heat.regional *= REGIONAL_HEAT_DECAY;
  state.heat.national *= NATIONAL_HEAT_DECAY;
  for (const k of Object.keys(state.revenue.suspicion)) {
    state.revenue.suspicion[k] *= SUSPICION_DECAY;
  }

  // Promotion: the parish's noise spills toward London (§6.3).
  const spill = Math.max(0, state.heat.regional - PROMOTION_THRESHOLD) * PROMOTION_RATE;
  state.heat.regional -= spill;
  state.heat.national += spill;

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

/** The dawn tell of visible works (§6.12): each hard building stains itself. */
export function accrueFortHeat(state: GameState): void {
  for (const nodeId of Object.keys(state.fortifications)) {
    const vis = fortVisibility(state, nodeId);
    if (vis > 0) addHeat(state, vis * FORT_VISIBILITY_HEAT, nodeId);
  }
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
function seizeFrom(store: Store, limit: number): number {
  let taken = 0;
  for (const g of CONTRABAND) {
    if (taken >= limit) break;
    const here = store[g] ?? 0;
    const take = Math.min(here, limit - taken);
    if (take > 0) {
      store[g] = here - take;
      taken += take;
    }
  }
  return taken;
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

  let remaining = found - seizeFrom(store, Math.max(0, inStore - cover));
  for (const cart of cartsHere) {
    if (remaining <= 0) break;
    remaining -= seizeFrom(cart.cargo, remaining);
  }
  state.goodsSeized += found;
  state.lastSeizureNode = nodeId;
  addHeat(state, found * SEIZURE_HEAT); // no extra stain: the stain was earned already
  logEvent(state, `The officer searches ${name} and seizes ${found} goods for the Crown.`);
}

/** The farm inspection reads the books as well (§6.10 / §19.2). */
function checkBooks(state: GameState): void {
  const l = state.ledger;
  const onHand =
    (state.stores.farm?.fleece ?? 0) +
    state.carts.reduce((sum, c) => sum + (c.cargo.fleece ?? 0), 0) +
    state.fleeceReady;
  const accounted = l.soldLawfully + Math.max(0, onHand - l.openingStock);
  const gap =
    Math.abs(l.declaredToDate - accounted) +
    Math.max(0, l.grownToDate * PLAUSIBLE_YIELD_MIN - l.declaredToDate);

  if (gap > 0) {
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
  l.openingStock = onHand;
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
    const found = Math.max(0, illicitCount(cart.cargo) - hidden);
    if (found <= 0) continue; // honest wool is waved on, silently
    seizeFrom(cart.cargo, found);
    state.goodsSeized += found;
    state.lastSeizureNode = cart.location.to;
    addHeat(state, found * SEIZURE_HEAT, cart.location.to);
    logEvent(
      state,
      `The officer stops ${cart.name} on ${edge.name.toLowerCase()} and seizes ${found} goods.`,
    );
  }
}
