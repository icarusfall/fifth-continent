// Spec §6.18 / §21.1 (M5½a) — the survey and the spade. Digging is slow,
// capital-intensive, and permanent: coin up front, one crew so one dig at a
// time (the bench pattern, its own slot), and on completion the §21.2 axis
// lands whole — Debt to the marsh, Standing to the parish, pasture to the
// flock, and a line of water on the map for ever. The logistics (M5½b) and
// the fighting (M5½c) come later; the spade's own consequences are a
// complete loop.
//
// Pure functions of GameState, like wights.ts: no dice, no clocks.

import {
  DYKE_COST_PER_TILE,
  DYKE_DAYS_PER_TILE,
  DYKE_DEBT,
  DYKE_PARISH_STANDING,
  DYKE_PASTURE_HEAD,
  FLOCK_CAP,
  MAX_LOG_EVENTS,
  TICKS_PER_DAY,
} from './balance';
import { DYKE_SEGMENTS, dykeById, dykeTiles } from './map';
import type { DykeSegment } from './map';
import { loseStanding } from './revenue';
import { addDebt } from './wights';
import type { GameEvent, GameState } from './types';

function logEvent(state: GameState, text: string): void {
  state.log.push({ tick: state.tick, text } satisfies GameEvent);
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

/** Coin a segment wants, up front: tiles × the diggers' rate. */
export function dykeCost(segment: DykeSegment): number {
  return dykeTiles(segment) * DYKE_COST_PER_TILE;
}

/** Crew-days a segment takes, rounded up — slow is the point. */
export function dykeDays(segment: DykeSegment): number {
  return Math.max(1, Math.ceil(dykeTiles(segment) * DYKE_DAYS_PER_TILE));
}

/** §6.16 / §6.18 — drainage manufactures pasture: the flock cap with the
 *  dug segments' grazing counted. Every consumer of FLOCK_CAP reads this. */
export function flockCapOf(state: GameState): number {
  return FLOCK_CAP + state.dykesDug.length * DYKE_PASTURE_HEAD;
}

/** §6.18 — the stone's ground refuses the spade while the stone stands:
 *  any segment passing within one tile of the wight-stone. */
export function stoneRefuses(state: GameState, segment: DykeSegment): boolean {
  const stone = state.wights.stone;
  if (!stone) return false;
  return segment.path.some(
    (p) => Math.abs(p.x - stone.x) <= 1 && Math.abs(p.y - stone.y) <= 1,
  );
}

/** §6.18 — the dig verb: coin paid, the crew walks out, done days later. */
export function applyDigDyke(state: GameState, id: string): void {
  const segment = dykeById(id);
  if (!segment) {
    logEvent(state, 'No such line is on the survey.');
    return;
  }
  if (state.dykesDug.includes(id)) {
    logEvent(state, `${segment.name} already runs with water. A dyke is never dug twice.`);
    return;
  }
  if (state.digging !== null) {
    const busy = dykeById(state.digging.id);
    logEvent(
      state,
      `The crew is up to their knees in ${busy?.name ?? 'a channel'}. One dig at a time.`,
    );
    return;
  }
  if (stoneRefuses(state, segment)) {
    logEvent(
      state,
      `The men will not put a spade in the ground by the stone. The line stands unsurveyed while it does.`,
    );
    return;
  }
  const cost = dykeCost(segment);
  if (state.coin < cost) {
    logEvent(state, `The diggers want ${cost} coin up front, and the till is short.`);
    return;
  }
  state.coin -= cost;
  state.digging = { id, doneTick: state.tick + dykeDays(segment) * TICKS_PER_DAY };
  logEvent(
    state,
    `${cost} coin to the diggers, and ${segment.name} begins: ${dykeDays(segment)} days of mud and Kentish oaths.`,
  );
}

/** The dig completes the tick its time is served (the bench pattern, §6.14):
 *  the water runs, and §21.2's whole axis lands at once. */
export function digProgress(state: GameState): void {
  const digging = state.digging;
  if (!digging || state.tick < digging.doneTick) return;
  const segment = dykeById(digging.id);
  state.digging = null;
  if (!segment || state.dykesDug.includes(digging.id)) return;
  state.dykesDug.push(digging.id);
  addDebt(state, DYKE_DEBT); // the marsh is smaller, permanently (§6.14)
  loseStanding(state, DYKE_PARISH_STANDING); // enclosure enrages the commoners
  logEvent(
    state,
    `${segment.name} runs with water. The gentry approve; the parish mutters; the marsh is smaller than it was, and it knows. Grazing for ${DYKE_PASTURE_HEAD} more head has drained dry.`,
  );
}

/** Segments still worth offering in a menu: not dug, not the one in hand. */
export function undugSegments(state: GameState): DykeSegment[] {
  return DYKE_SEGMENTS.filter(
    (d) => !state.dykesDug.includes(d.id) && state.digging?.id !== d.id,
  );
}
