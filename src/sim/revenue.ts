// Spec §6.10 — the Revenue. Heat in two pools, suspicion by node, and one
// deterministic Riding Officer. Everything here is a pure function of
// GameState: no dice, no clocks. Outplaying him is timetabling, not luck.

import {
  COVER_CAPACITY,
  DITCH_HEAT,
  MARKET_TATTLE,
  MAX_LOG_EVENTS,
  NATIONAL_HEAT_DECAY,
  OFFICER_ARRIVAL_HEAT,
  PATROL_THRESHOLD,
  PLAUSIBLE_YIELD_MIN,
  PROMOTION_RATE,
  PROMOTION_THRESHOLD,
  REGIONAL_HEAT_DECAY,
  SEARCH_RELIEF,
  SEIZURE_HEAT,
  STORAGE_HEAT_COEFF,
  SUSPICION_DECAY,
  SUSPICION_SHARE,
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
  'lace',
  'brandy-rough',
  'brandy-fair',
  'brandy-gent',
];

export function illicitCount(store: Store): number {
  return CONTRABAND.reduce((sum, g) => sum + (store[g] ?? 0), 0);
}

// ---- Heat plumbing ----

/** Every heat event lands regional; most also stain the nearest node (§6.6). */
export function addHeat(state: GameState, amount: number, stainNode?: NodeId): void {
  if (amount <= 0) return;
  state.heat.regional += amount;
  if (stainNode) {
    state.revenue.suspicion[stainNode] =
      (state.revenue.suspicion[stainNode] ?? 0) + amount * SUSPICION_SHARE;
  }
}

/** Route heat for one tick of laden movement (§6.2, weather and tech = 1, 0). */
export function accrueRouteHeat(state: GameState, cart: Cart, edge: MapEdge): void {
  const illicit = illicitCount(cart.cargo);
  if (illicit <= 0 || cart.location.kind !== 'edge') return;
  const amount = ((illicit * edge.exposure) / edge.latency) * timeOfDayMod(state.tick);
  // The stain falls on whichever end of the road the cart is nearer.
  const nearer =
    cart.location.progress * 2 < edge.latency ? cart.location.from : cart.location.to;
  addHeat(state, amount, nearer);
}

/** Storage heat, per tick (§18): stores hide up to their cover; carts hide nothing. */
export function accrueStorageHeat(state: GameState): void {
  for (const nodeId of Object.keys(state.stores)) {
    const over = illicitCount(state.stores[nodeId]) - (COVER_CAPACITY[nodeId] ?? 0);
    if (over > 0) addHeat(state, over * STORAGE_HEAT_COEFF, nodeId);
  }
  for (const cart of state.carts) {
    if (cart.location.kind !== 'node') continue; // moving carts pay route heat instead
    const illicit = illicitCount(cart.cargo);
    if (illicit > 0) addHeat(state, illicit * STORAGE_HEAT_COEFF, cart.location.nodeId);
  }
}

/** The town drinks happily and talks constantly (§6.10). */
export function accrueMarketTattle(state: GameState, good: Good, qty: number): void {
  if (!CONTRABAND.includes(good)) return;
  addHeat(state, qty * MARKET_TATTLE, 'ryne');
}

/** Tubs carry no name: regional heat only, no stain (§6.10). */
export function accrueDitchHeat(state: GameState, units: number): void {
  state.heat.regional += units * DITCH_HEAT;
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

  // The day's plan: the sorest stain if any is sore enough, else his beat.
  officer.inspectedToday = false;
  officer.targetNodeId = patrolTarget(state);
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
  const cover = COVER_CAPACITY[nodeId] ?? 0;
  // The building's clutter hides its own stock; a cart in the yard hides nothing.
  const found = Math.max(0, inStore - cover) + aboard;
  const name = nodeById(nodeId, state.farm, state.cuttingHouse).name;

  if (found <= 0) {
    state.revenue.suspicion[nodeId] = (state.revenue.suspicion[nodeId] ?? 0) * SEARCH_RELIEF;
    logEvent(state, `The officer turns over ${name} and finds honest clutter. The trail cools.`);
    return;
  }

  let remaining = found - seizeFrom(store, Math.max(0, inStore - cover));
  for (const cart of cartsHere) {
    if (remaining <= 0) break;
    remaining -= seizeFrom(cart.cargo, remaining);
  }
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

/** Carts sharing his road are stopped and searched: cart cover is 0 (§6.10). */
function stopCartsOnEdge(state: GameState, edge: MapEdge): void {
  for (const cart of state.carts) {
    if (cart.location.kind !== 'edge' || cart.location.edgeId !== edge.id) continue;
    const found = illicitCount(cart.cargo);
    if (found <= 0) continue; // honest wool is waved on, silently
    seizeFrom(cart.cargo, found);
    addHeat(state, found * SEIZURE_HEAT, cart.location.to);
    logEvent(
      state,
      `The officer stops ${cart.name} on ${edge.name.toLowerCase()} and seizes ${found} goods.`,
    );
  }
}
