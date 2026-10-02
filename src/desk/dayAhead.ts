// THE DAY AHEAD (spec §20.4, D3): the next 24 hours as marks on a line, every
// one computed from the sim's own pure functions — the strip can never promise
// what the tick will not do. Pure: tested in Node.

import { SHEARING_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from '../sim/balance';
import { dykeWaterways } from '../sim/dykes';
import { edgesFor, horseLatency, nodeById, officerEdgesFor } from '../sim/map';
import { isAuditDawn } from '../sim/revenue';
import { luggerStandsOff } from '../sim/tick';
import { dayPhaseOf, isFlooded, tideLevel } from '../sim/time';
import type { GameState, NodeId } from '../sim/types';
import type { Journey } from './deskUi';
import type { Route } from './routes';

export const WINDOW = TICKS_PER_DAY;

export interface Span {
  from: number; // ticks from now
  to: number;
}

export interface Mark {
  at: number; // ticks from now
  kind: 'arrival' | 'officer' | 'audit' | 'rent' | 'raid' | 'high-water';
  label: string;
  /** A cart's number, for its badge. */
  num?: number;
}

export interface DayAhead {
  now: number;
  night: Span[];
  dusk: Span[];
  drowned: Span[];
  lugger: Span[];
  tide: number[]; // one sample per tick across the window, 0..1
  marks: Mark[];
  /** Days to the rent when it lies beyond the window, else null. */
  rentBeyond: number | null;
}

/** Contiguous runs of ticks where `pred` holds, relative to `now`. */
function spans(now: number, pred: (tick: number) => boolean): Span[] {
  const out: Span[] = [];
  let open: number | null = null;
  for (let t = 0; t <= WINDOW; t++) {
    const on = t < WINDOW && pred(now + t);
    if (on && open === null) open = t;
    if (!on && open !== null) {
      out.push({ from: open, to: t });
      open = null;
    }
  }
  return out;
}

export function dayAhead(state: GameState, journeys: Record<string, Journey> = {}): DayAhead {
  const now = state.tick;
  const marks: Mark[] = [];
  const place = (id: NodeId) => nodeById(id, state.farm, state.cuttingHouse).name;

  const tide: number[] = [];
  for (let t = 0; t <= WINDOW; t++) tide.push(tideLevel(now + t));
  for (let t = 1; t < WINDOW; t++) {
    if (tide[t] >= tide[t - 1] && tide[t] > tide[t + 1]) marks.push({ at: t, kind: 'high-water', label: 'High water' });
  }

  // The officer: his next audit dawn, and his arrival where he rides.
  for (let t = 0; t < WINDOW; t++) {
    const tick = now + t;
    if (tick % TICKS_PER_DAY === SHEARING_HOUR * TICKS_PER_HOUR && isAuditDawn(tick) && state.revenue.officer.arrived) {
      marks.push({ at: t, kind: 'audit', label: 'The officer reads the books at the farm' });
    }
  }
  const o = state.revenue.officer;
  if (o.arrived && o.location.kind === 'edge') {
    const loc = o.location;
    const edge = officerEdgesFor(state.farm, state.cuttingHouse).find((e) => e.id === loc.edgeId);
    if (edge) {
      const left = Math.max(0, horseLatency(edge) - loc.progress);
      if (left < WINDOW) marks.push({ at: left, kind: 'officer', label: `The officer reaches ${place(loc.to)}` });
    }
  }

  // The carts: each travelling cart's arrival, and a journey's last stop.
  const ways = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)];
  state.carts.forEach((cart, i) => {
    if (cart.location.kind !== 'edge') return;
    const loc = cart.location;
    const edge = ways.find((e) => e.id === loc.edgeId);
    if (!edge) return;
    let left = Math.max(0, edge.latency - loc.progress);
    const j = journeys[cart.id];
    if (j) {
      for (let k = j.next; k < j.route.legs.length; k++) left += j.route.legs[k].edge.latency;
      if (left < WINDOW) marks.push({ at: left, kind: 'arrival', label: `${cart.name} reaches ${place(j.to)} (about)`, num: i + 1 });
    } else if (left < WINDOW) {
      marks.push({ at: left, kind: 'arrival', label: `${cart.name} reaches ${place(loc.to)} (about)`, num: i + 1 });
    }
  });

  // The rent, and the raid.
  const toRent = state.rentDueTick - now;
  let rentBeyond: number | null = null;
  if (toRent >= 0 && toRent < WINDOW) marks.push({ at: toRent, kind: 'rent', label: 'The agent at the door for the rent' });
  else if (toRent >= WINDOW) rentBeyond = Math.ceil(toRent / TICKS_PER_DAY);
  if (state.raid && state.raid.battleTick - now >= 0 && state.raid.battleTick - now < WINDOW) {
    marks.push({ at: state.raid.battleTick - now, kind: 'raid', label: `The blow falls at ${place(state.raid.target)}` });
  }

  return {
    now,
    night: spans(now, (t) => dayPhaseOf(t) === 'night'),
    dusk: spans(now, (t) => dayPhaseOf(t) === 'dusk'),
    drowned: spans(now, (t) => isFlooded(t)),
    lugger: spans(now, (t) => luggerStandsOff(state, t)),
    tide,
    marks: marks.sort((a, b) => a.at - b.at),
    rentBeyond,
  };
}

/** Ticks before a cart is free to start a new route: the rest of its current
 *  leg if it is on the road (its route is reckoned from where it is bound). */
export function ticksToOrigin(state: GameState, cartId: string): number {
  const cart = state.carts.find((c) => c.id === cartId);
  if (!cart || cart.location.kind !== 'edge') return 0;
  const loc = cart.location;
  const edge = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)].find((e) => e.id === loc.edgeId);
  return edge ? Math.max(0, edge.latency - loc.progress) : 0;
}

export interface TripLeg {
  from: number;
  to: number;
  name: string;
  /** Ticks from now at which this leg would meet high water, if it can drown. */
  drownsAt: number | null;
}

/**
 * A route laid on the strip as if sent now: leg by leg, each starting when the
 * last ends — and a leg on a tide-locked road that would be under water while
 * the cart rides it is marked where it drowns (the sim halts a cart there).
 */
export function tripOf(state: GameState, route: Route, startIn = 0): TripLeg[] {
  const out: TripLeg[] = [];
  let at = startIn;
  for (const leg of route.legs) {
    let drownsAt: number | null = null;
    if (leg.edge.condition === 'tideLocked') {
      for (let t = at; t < at + leg.edge.latency; t++) {
        if (isFlooded(state.tick + t)) {
          drownsAt = t;
          break;
        }
      }
    }
    out.push({ from: at, to: at + leg.edge.latency, name: leg.edge.name, drownsAt });
    at += leg.edge.latency;
  }
  return out;
}
