// Cart command's arithmetic (spec §20.4, D2): which ways a hull may use, the
// routes between two places with their hours and their risk named, and the
// pick-up a round's stop defaults to. Pure functions of the state — no React,
// no store — so they are tested in Node with the sim's own fixtures.

import { CONTRABAND } from '../sim/revenue';
import { dykeWaterways } from '../sim/dykes';
import { edgesFor, otherEnd } from '../sim/map';
import { TICKS_PER_HOUR, TUB_TIDE_MIN } from '../sim/balance';
import { isFlooded, tideLevel } from '../sim/time';
import type { Cart, CarterStop, GameState, Good, MapEdge, NodeId } from '../sim/types';
import { backOptionsFor, coatOn } from '../shared/words';

/** The ways this hull may ride, as the sim's dispatch allows them (§6.14/§6.18). */
export function waysFor(state: GameState, cart: Cart): MapEdge[] {
  const all = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)];
  return all.filter((e) => {
    if (e.id === 'sea-lane') return cart.vessel === 'sea';
    if (e.id.startsWith('waterway-')) return cart.vessel === 'dyke';
    if (cart.vessel !== undefined) return false;
    // §10 — the marsh track is no road until the coast has spoken.
    if (e.id === 'marsh-track') return state.dutchman.unlocked;
    return true;
  });
}

export interface Leg {
  edge: MapEdge;
  from: NodeId;
  to: NodeId;
}

export interface Route {
  legs: Leg[];
  /** Tide-blind ticks, as the ribbons and the forecast count them. */
  ticks: number;
}

/** Every simple path from → to over the hull's ways, cheapest first. */
export function routesBetween(state: GameState, cart: Cart, from: NodeId, to: NodeId, max = 2): Route[] {
  if (from === to) return [];
  const ways = waysFor(state, cart);
  const out: Route[] = [];
  const walk = (at: NodeId, seen: Set<NodeId>, legs: Leg[], ticks: number) => {
    if (at === to) {
      out.push({ legs: [...legs], ticks });
      return;
    }
    for (const e of ways) {
      if (e.a !== at && e.b !== at) continue;
      const next = otherEnd(e, at);
      if (seen.has(next)) continue;
      seen.add(next);
      legs.push({ edge: e, from: at, to: next });
      walk(next, seen, legs, ticks + e.latency);
      legs.pop();
      seen.delete(next);
    }
  };
  walk(from, new Set([from]), [], 0);
  out.sort((p, q) => p.ticks - q.ticks || p.legs.length - q.legs.length);
  const pick = out.slice(0, max);
  // If every route offered can drown, the dry one earns the last place: the
  // high road is slow, but the tide never has it (the phone's "slow and sure").
  const drowns = (r: Route) => r.legs.some((l) => l.edge.condition === 'tideLocked');
  if (max > 1 && pick.length === max && pick.every(drowns)) {
    const dry = out.find((r) => !drowns(r));
    if (dry) pick[max - 1] = dry;
  }
  return pick;
}

export function hoursOf(ticks: number): string {
  const h = ticks / TICKS_PER_HOUR;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : `${Math.round(h * 2) / 2}h`;
}

export type RiskTone = 'quiet' | 'seen' | 'watched' | 'water';

export interface Risk {
  tone: RiskTone;
  /** The risks this route runs, in words, worst first. */
  words: string[];
}

/** Exposure bands for the words: the Customs House's road is 1.0 (§6.10). */
const WATCHED = 0.9;
const SEEN = 0.6;

/** What a route risks, named — the spec's "worst risk named". */
export function routeRisk(state: GameState, route: Route): Risk {
  const words: string[] = [];
  let worst = 0;
  let drowns = false;
  let coat = false;
  for (const { edge, from } of route.legs) {
    worst = Math.max(worst, edge.exposure);
    if (edge.condition === 'tideLocked') drowns = true;
    if (coatOn(state, edge.id, from)) coat = true;
  }
  if (coat) words.push('the blue coat rides it now');
  if (worst >= WATCHED) words.push('watched — the Customs House counts every load');
  else if (worst >= SEEN) words.push('open marsh — some eyes');
  if (drowns) words.push(isFlooded(state.tick) ? 'drowned now — waits on the tide' : 'drowns at high water');
  const water = route.legs.every((l) => l.edge.id.startsWith('waterway-'));
  if (water) words.push(tideLevel(state.tick) < TUB_TIDE_MIN ? 'the channel wants more tide' : 'quiet as weed');
  if (words.length === 0) words.push('a quiet road');
  const tone: RiskTone = coat || worst >= WATCHED ? 'watched' : water ? 'water' : worst >= SEEN || drowns ? 'seen' : 'quiet';
  return { tone, words };
}

/** Can this leg be ridden this tick? (The sim refuses otherwise, and says so.) */
export function legOpen(state: GameState, leg: Leg): boolean {
  if (leg.edge.condition === 'tideLocked' && isFlooded(state.tick)) return false;
  if (leg.edge.id.startsWith('waterway-') && tideLevel(state.tick) < TUB_TIDE_MIN) return false;
  return true;
}

/** Where the cart's next choice starts from: where it stands, or where it is bound. */
export function originOf(cart: Cart): NodeId {
  return cart.location.kind === 'node' ? cart.location.nodeId : cart.location.to;
}

/**
 * §6.19 on the desk — what a stop picks up if the player says nothing. A store
 * loads the goods the round can SELL further on: wool by the colour its next
 * dealing stop wants (§6.10 M5½f — dark to the lugger, white to the town), the
 * house's most plentiful product to market. The beach and the town default to
 * nothing: a purchase off the lugger spends the till, and is the player's to say.
 */
export function defaultTake(state: GameState, stops: ReadonlyArray<{ at: NodeId }>, i: number): Good | undefined {
  const at = stops[i].at;
  if (at === 'ryne' || at === 'shingle') return undefined;
  let next: NodeId | null = null;
  for (let step = 1; step < stops.length; step++) {
    const there = stops[(i + step) % stops.length].at;
    if (there === 'ryne' || there === 'shingle') {
      next = there;
      break;
    }
  }
  if (at === 'farm') {
    if (next === 'shingle') return state.ledger.books === 'short' || (state.stores.farm?.['dark-fleece'] ?? 0) > 0 ? 'dark-fleece' : 'fleece';
    return 'fleece';
  }
  if (at === 'cutting-house') {
    const store = state.stores['cutting-house'] ?? {};
    const products: Good[] = ['bulked-tea', 'brandy-fair', 'brandy-rough', 'brandy-gent', 'tea', 'lace'];
    let best: Good | undefined;
    for (const g of products) if ((store[g] ?? 0) > (best ? store[best] ?? 0 : 0)) best = g;
    if (best) return best;
    return state.refiner.smouch ? 'bulked-tea' : 'brandy-fair';
  }
  return undefined;
}

/** What a stop COULD pick up, for the round's picker: §6.19's knowledge gate. */
export function takeOptions(state: GameState, at: NodeId): Good[] {
  if (at === 'ryne') return [];
  if (at === 'shingle') return state.dutchman.met ? backOptionsFor(state, 'shingle') : [];
  // A store offers what it is FOR (§6.19's knowledge gate), plus whatever
  // actually sits in it today — the barn is for wool, the house for its
  // products; a backhaul dropped in either is named while it is there.
  const goods: Good[] =
    at === 'farm'
      ? ['fleece', ...(state.dutchman.unlocked || state.ledger.books === 'short' ? (['dark-fleece'] as Good[]) : [])]
      : ['bulked-tea', 'brandy-fair', 'brandy-rough', 'brandy-gent', 'tea'];
  for (const [g, n] of Object.entries(state.stores[at] ?? {}) as Array<[Good, number]>) if (n > 0) goods.push(g);
  return [...new Set(goods)];
}

/** Does this round carry anything the town calls contraband? (Danger money.) */
export function roundCarriesContraband(stops: CarterStop[]): boolean {
  return stops.some((s) => s.take !== undefined && CONTRABAND.includes(s.take));
}
