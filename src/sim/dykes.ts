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
  DYKE_EXPOSURE,
  DYKE_LANDING_REACH,
  DYKE_MOAT_REACH,
  MOAT_MIN_TILES,
  DYKE_PARISH_STANDING,
  DYKE_PASTURE_HEAD,
  DYKE_TICKS_PER_TILE,
  FLOCK_CAP,
  MAX_LOG_EVENTS,
  TICKS_PER_DAY,
  TUB_BOAT_CAPACITY,
} from './balance';
import { DYKE_SEGMENTS, dykeById, dykeTiles, pathTileLength } from './map';
import type { DykeSegment } from './map';
import { loseStanding } from './revenue';
import { addDebt } from './wights';
import type { GameEvent, GameState, MapEdge, NodeId } from './types';

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
    `${segment.name} runs with water. The gentry approve; the parish mutters; the marsh is smaller than it was, and it knows. Grazing for ${DYKE_PASTURE_HEAD} more head has drained dry — the pasture now holds ${flockCapOf(state)}.`,
  );
}

/** Segments still worth offering in a menu: not dug, not the one in hand. */
export function undugSegments(state: GameState): DykeSegment[] {
  return DYKE_SEGMENTS.filter(
    (d) => !state.dykesDug.includes(d.id) && state.digging?.id !== d.id,
  );
}

// ---- M5½b: the waterways (spec §6.18) ----
// Chains of dug segments whose endpoints touch (within a tile) link the
// landings — the farm, the shingle, Ryne's back waters, and the cutting
// house when it stands within reach of a channel. One edge per landing
// pair; junctions are never nodes (a two-chain journey is two orders).

type Pt = { x: number; y: number };

function near(a: Pt, b: Pt, reach: number): boolean {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= reach;
}

function landingsFor(state: GameState): Array<{ id: NodeId; at: Pt }> {
  const spots: Array<{ id: NodeId; at: Pt }> = [
    { id: 'farm', at: state.farm },
    { id: 'shingle', at: { x: 34, y: 8 } },
    { id: 'ryne', at: { x: 28, y: 22 } },
  ];
  if (state.cuttingHouse) spots.push({ id: 'cutting-house', at: state.cuttingHouse });
  return spots;
}

/** The dug network's ends of a segment, both ways round. */
function segmentEnds(seg: DykeSegment): [Pt, Pt] {
  return [seg.path[0], seg.path[seg.path.length - 1]];
}

/**
 * §6.18 — the waterways: for each pair of landings joined by a chain of dug
 * segments, one MapEdge whose path is the stitched chain. Dijkstra over the
 * dug segments by tile length; shortest chain wins the pair.
 */
export function dykeWaterways(state: GameState): MapEdge[] {
  const dug = DYKE_SEGMENTS.filter((d) => state.dykesDug.includes(d.id));
  if (dug.length === 0) return [];
  const landings = landingsFor(state);
  const edges: MapEdge[] = [];

  for (let i = 0; i < landings.length; i++) {
    for (let j = i + 1; j < landings.length; j++) {
      const chain = shortestChain(dug, landings[i].at, landings[j].at);
      if (!chain) continue;
      const path = stitchChain(chain, landings[i].at);
      const tiles = pathTileLength(path);
      const label: Record<string, string> = {
        farm: 'Walland',
        shingle: 'Shingle',
        ryne: 'Ryne',
        'cutting-house': 'Cutting',
      };
      edges.push({
        id: `waterway-${landings[i].id}-${landings[j].id}`,
        name: `The ${label[landings[i].id]}–${label[landings[j].id]} Water`,
        a: landings[i].id,
        b: landings[j].id,
        capacity: TUB_BOAT_CAPACITY,
        latency: Math.max(1, Math.round(tiles * DYKE_TICKS_PER_TILE)),
        exposure: DYKE_EXPOSURE,
        condition: 'tideLocked', // §6.18 — the tub minds the tide (see moveCarts)
        path,
      });
    }
  }
  return edges;
}

/** Dijkstra over segments: entry = within landing reach of `from`, exit =
 *  within reach of `to`; two segments connect where endpoints touch. */
function shortestChain(dug: DykeSegment[], from: Pt, to: Pt): DykeSegment[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, DykeSegment[]>();
  const queue: Array<{ seg: DykeSegment; d: number; chain: DykeSegment[] }> = [];

  for (const seg of dug) {
    const [a, b] = segmentEnds(seg);
    if (near(a, from, DYKE_LANDING_REACH) || near(b, from, DYKE_LANDING_REACH)) {
      queue.push({ seg, d: dykeTiles(seg), chain: [seg] });
    }
  }

  let best: { chain: DykeSegment[]; d: number } | null = null;
  while (queue.length > 0) {
    queue.sort((x, y) => x.d - y.d);
    const { seg, d, chain } = queue.shift()!;
    if ((dist.get(seg.id) ?? Infinity) <= d) continue;
    dist.set(seg.id, d);
    prev.set(seg.id, chain);
    const [a, b] = segmentEnds(seg);
    if (near(a, to, DYKE_LANDING_REACH) || near(b, to, DYKE_LANDING_REACH)) {
      if (!best || d < best.d) best = { chain, d };
      continue;
    }
    for (const nxt of dug) {
      if (chain.includes(nxt)) continue;
      const [na, nb] = segmentEnds(nxt);
      const touches = [a, b].some((e) => near(e, na, 1) || near(e, nb, 1));
      if (touches) queue.push({ seg: nxt, d: d + dykeTiles(nxt), chain: [...chain, nxt] });
    }
  }
  return best?.chain ?? null;
}

// ---- M5½b playtest: the survey sells a route, not a ditch (spec §6.18) ----
// The post priced the cut in coin, days, Debt, parish and pasture, and never
// said what it JOINS — the one thing a player digs channels for. These are
// pure reads over hypothetical dug-sets: no dice, no clocks, no mutation.

/** A pair of landings a chain of water joins, and the water's name. */
export interface WaterwayPair {
  a: NodeId;
  b: NodeId;
  name: string;
}

/** The landing pairs standing in a given dug-set, keyed `a|b`. */
function pairsWith(state: GameState, dug: string[]): Map<string, WaterwayPair> {
  const probe: GameState = { ...state, dykesDug: dug };
  const out = new Map<string, WaterwayPair>();
  for (const edge of dykeWaterways(probe)) {
    out.set(`${edge.a}|${edge.b}`, { a: edge.a, b: edge.b, name: edge.name });
  }
  return out;
}

/** Pairs in `after` that were not in `before` — what a cut would open. */
function newPairs(
  before: Map<string, WaterwayPair>,
  after: Map<string, WaterwayPair>,
): WaterwayPair[] {
  const out: WaterwayPair[] = [];
  for (const [key, pair] of after) if (!before.has(key)) out.push(pair);
  return out;
}

/**
 * §6.18 (M5½b playtest) — what this cut would open, said before its price.
 * `opens` is the landings joined once it runs that are not joined today.
 * When it opens nothing alone, one step of lookahead names the partner that
 * would (the survey is eight segments; the search is free) — so a channel
 * that is only pasture can say so, and a channel that is half a road can
 * point at its other half.
 */
export function dykePreview(
  state: GameState,
  id: string,
): { opens: WaterwayPair[]; nextStep: { id: string; name: string; opens: WaterwayPair[] } | null } {
  if (state.dykesDug.includes(id)) return { opens: [], nextStep: null };
  const today = pairsWith(state, state.dykesDug);
  const opens = newPairs(today, pairsWith(state, [...state.dykesDug, id]));
  if (opens.length > 0) return { opens, nextStep: null };

  for (const other of DYKE_SEGMENTS) {
    if (other.id === id || state.dykesDug.includes(other.id)) continue;
    // The baseline is the PARTNER dug alone, not today: a dead end must never
    // take credit for water its neighbour would open without it.
    const alone = pairsWith(state, [...state.dykesDug, other.id]);
    const both = newPairs(alone, pairsWith(state, [...state.dykesDug, id, other.id]));
    if (both.length > 0) {
      return { opens, nextStep: { id: other.id, name: other.name, opens: both } };
    }
  }
  return { opens, nextStep: null };
}

/**
 * §6.18 (M5½e) — the building this cut would moat that is not moated today,
 * or null. The same hypothetical-dug-set probe as the route preview: pure,
 * no dice, no mutation. The survey uses it to tell a cut that DOES something
 * from a dyke to nowhere.
 */
export function cutWouldMoat(state: GameState, id: string): NodeId | null {
  if (state.dykesDug.includes(id)) return null;
  const probe: GameState = { ...state, dykesDug: [...state.dykesDug, id] };
  const owned: NodeId[] = state.cuttingHouse ? ['cutting-house', 'farm'] : ['farm'];
  for (const node of owned) {
    if (!moatedAt(state, node) && moatedAt(probe, node)) return node;
  }
  return null;
}

/**
 * §6.18 (M5½e) — should this post breathe on the map? True when digging this
 * one segment, today, opens a waterway or moats a building you own.
 */
export function cutInvites(state: GameState, id: string): boolean {
  if (state.dykesDug.includes(id)) return false;
  return dykePreview(state, id).opens.length > 0 || cutWouldMoat(state, id) !== null;
}

// ---- M5½c: the water fights back (spec §6.18 / §14.1) ----
// No topology, no ring — a raid is narrowed by water at the foot of the
// walls, which is what a drained level looks like. (A rule keyed to which
// ROADS the channels cut was designed and rejected: the cutting house is
// player-sited, so its tracks are straight lines from an arbitrary tile and
// no authored segment can be guaranteed to cross them.)

/** Where a node stands on the tile grid — the farm and the house move. */
function siteOf(state: GameState, node: NodeId): Pt | null {
  if (node === 'farm') return state.farm;
  if (node === 'cutting-house') return state.cuttingHouse ?? null;
  return null; // Ryne, the shingle and the Customs House are nobody's to hold
}

/** §6.18 — dug channel tiles within DYKE_MOAT_REACH of a building. */
export function moatTilesAt(state: GameState, node: NodeId): number {
  const at = siteOf(state, node);
  if (!at) return 0;
  let tiles = 0;
  for (const seg of DYKE_SEGMENTS) {
    if (!state.dykesDug.includes(seg.id)) continue;
    for (const p of walkPath(seg.path)) {
      if (near(p, at, DYKE_MOAT_REACH)) tiles++;
    }
  }
  return tiles;
}

/** §6.18 — is there water enough at the foot to narrow the approach? */
export function moatedAt(state: GameState, node: NodeId): boolean {
  return moatTilesAt(state, node) >= MOAT_MIN_TILES;
}

/**
 * §6.18 (M5½c) — the bank they cut: the dug segment with most of itself at
 * this building's foot, and so the one the water takes back when the
 * crossing goes. Null when nothing is near enough to break.
 */
export function nearestDugSegment(state: GameState, node: NodeId): DykeSegment | null {
  const at = siteOf(state, node);
  if (!at) return null;
  let best: { seg: DykeSegment; tiles: number } | null = null;
  for (const seg of DYKE_SEGMENTS) {
    if (!state.dykesDug.includes(seg.id)) continue;
    let tiles = 0;
    for (const p of walkPath(seg.path)) if (near(p, at, DYKE_MOAT_REACH)) tiles++;
    if (tiles > 0 && (!best || tiles > best.tiles)) best = { seg, tiles };
  }
  return best?.seg ?? null;
}

/** Every whole tile a segment's polyline passes through, ends included. */
function walkPath(path: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      out.push({
        x: Math.round(a.x + ((b.x - a.x) * s) / steps),
        y: Math.round(a.y + ((b.y - a.y) * s) / steps),
      });
    }
  }
  return out;
}

/** Orient and concatenate a chain's paths so the polyline flows from the
 *  `from` landing's end to the far end, tolerating one-tile junction gaps. */
function stitchChain(chain: DykeSegment[], from: Pt): Pt[] {
  const out: Pt[] = [];
  let cursor = from;
  for (const seg of chain) {
    const p = [...seg.path];
    const [a, b] = segmentEnds(seg);
    const distA = Math.hypot(a.x - cursor.x, a.y - cursor.y);
    const distB = Math.hypot(b.x - cursor.x, b.y - cursor.y);
    const oriented = distA <= distB ? p : p.reverse();
    for (const pt of oriented) {
      const last = out[out.length - 1];
      if (!last || last.x !== pt.x || last.y !== pt.y) out.push(pt);
    }
    cursor = out[out.length - 1];
  }
  return out;
}
