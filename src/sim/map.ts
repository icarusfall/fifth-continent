// The Gault — hand-authored, not generated (spec §12 M1).
// 40×30 tile grid. The terrain is visual truth; the logistics graph below is
// mechanical truth. Roads are edges, not tiles.
//
// The farm sits at FARM_SITE (spec §6.7: given, not chosen). Both roads are
// generated from the farm site to Ryne along fixed, hand-authored waypoint
// chains, with latency derived from path length; the cutting house (spec
// §6.9) is the one player-sited node, and its tracks are generated the
// same way from wherever the player raised it.
//
// Legend: c clay upland · . marsh · d dyke · t town (Ryne) · s shingle · ~ sea

import {
  CART_CAPACITY,
  HIGH_ROAD_EXPOSURE,
  HIGH_ROAD_TICKS_PER_TILE,
  HORSE_TICKS_PER_TILE_MARSH,
  HORSE_TICKS_PER_TILE_ROAD,
  LOW_ROAD_EXPOSURE,
  LOW_ROAD_TICKS_PER_TILE,
  MARSH_TICKS_PER_TILE,
  MARSH_TRACK_EXPOSURE,
} from './balance';
import type { MapEdge, MapNode, NodeId, EdgeId } from './types';

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;

// prettier-ignore
export const TERRAIN: readonly string[] = [
  'cccccccccccccccccccccccccccccccccccs~~~~',                     // row 0
  'cccccccccccccccccccccccccccccccccccs~~~~',                     // row 1
  'cccccccccccccccccccccccccccccccccccs~~~~',                     // row 2
  'cccccccccccccccccccc...............s~~~~',                     // row 3
  'cccccccccccc.......................s~~~~',                     // row 4
  '..................................s~~~~~',                     // row 5
  '..................................s~~~~~',                     // row 6
  '..................................s~~~~~',                     // row 7
  '..................................s~~~~~',                     // row 8
  '..................................s~~~~~',                     // row 9
  '.................................s~~~~~~',                     // row 10
  '.................................s~~~~~~',                     // row 11
  '.................................s~~~~~~',                     // row 12
  '.................................s~~~~~~',                     // row 13
  '.................................s~~~~~~',                     // row 14
  '................................s~~~~~~~',                     // row 15
  '................................s~~~~~~~',                     // row 16
  '..ddddddddddddddddd.............s~~~~~~~',                     // row 17
  '................................s~~~~~~~',                     // row 18
  '.........................cccccccs~~~~~~~',                     // row 19
  '.........................cctttts~~~~~~~~',                     // row 20
  '.........................cctttts~~~~~~~~',                     // row 21
  '.........................cctttts~~~~~~~~',                     // row 22
  '.........................cctttts~~~~~~~~',                     // row 23
  '.........................ccccccs~~~~~~~~',                     // row 24
  '.........................cccccs~~~~~~~~~',                     // row 25
  '.........................cccc.s~~~~~~~~~',                     // row 26
  '..............................s~~~~~~~~~',                     // row 27
  '..............................s~~~~~~~~~',                     // row 28
  '..............................s~~~~~~~~~',                     // row 29
];

export function terrainAt(x: number, y: number): string {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return '~';
  return TERRAIN[y][x];
}

/** Buildable ground is open marsh. (M2+ buildings will site through this.) */
export function isPlaceable(x: number, y: number): boolean {
  return terrainAt(x, y) === '.';
}

export interface FarmSite {
  x: number;
  y: number;
}

/** Spec §6.7: the tenancy at Walland is where the game begins. */
export const FARM_SITE: FarmSite = { x: 8, y: 11 };

/** A player-sited building, once placed. Same shape as FarmSite on purpose. */
export type BuildingSite = FarmSite | null | undefined;

// ---- Fixed nodes ----

export const RYNE: MapNode = { id: 'ryne', kind: 'market', name: 'Ryne', x: 28, y: 22 };
export const CUSTOMS: MapNode = {
  id: 'customs',
  kind: 'customs',
  name: 'The Customs House',
  x: 26,
  y: 19,
};
/** Spec §6.9: where the Dutchman stands off, north-east across the marsh. */
export const SHINGLE: MapNode = { id: 'shingle', kind: 'beach', name: 'The Shingle', x: 34, y: 8 };

export function nodesFor(farm: FarmSite, cuttingHouse?: BuildingSite): MapNode[] {
  const nodes: MapNode[] = [
    { id: 'farm', kind: 'farm', name: 'Walland Farm', x: farm.x, y: farm.y },
    RYNE,
    CUSTOMS,
    SHINGLE,
  ];
  if (cuttingHouse) {
    nodes.push({
      id: 'cutting-house',
      kind: 'works',
      name: 'The Cutting House',
      x: cuttingHouse.x,
      y: cuttingHouse.y,
    });
  }
  return nodes;
}

// ---- Roads ----
// Hand-authored waypoint chains from the open marsh to Ryne. The generated
// edge is [farm, ...chain]; only the first leg varies with placement.

const LOW_ROAD_WAYPOINTS = [
  { x: 8, y: 17 },
  { x: 13, y: 22 },
  { x: 20, y: 25 },
  { x: 26, y: 25 },
  { x: 28, y: 23 },
  { x: 28, y: 22 },
];

const HIGH_ROAD_WAYPOINTS = [
  { x: 8, y: 8 },
  { x: 14, y: 5 },
  { x: 22, y: 5 },
  { x: 26, y: 8 },
  { x: 26, y: 19 }, // past the Customs House door
  { x: 27, y: 20 },
  { x: 28, y: 22 },
];

// Farm to the shingle, straight across the open marsh. No road: just marsh.
const MARSH_TRACK_WAYPOINTS = [
  { x: 16, y: 10 },
  { x: 25, y: 9 },
  { x: SHINGLE.x, y: SHINGLE.y },
];

export function pathTileLength(path: Array<{ x: number; y: number }>): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/** Spec §6.7: roadLatency = max(1, round(pathTileLength × ticksPerTile)). */
export function roadLatency(path: Array<{ x: number; y: number }>, ticksPerTile: number): number {
  return Math.max(1, Math.round(pathTileLength(path) * ticksPerTile));
}

/** A plain marsh track between a sited building and a fixed point (spec §6.9). */
function marshTrack(
  id: EdgeId,
  name: string,
  a: NodeId,
  b: NodeId,
  from: { x: number; y: number },
  to: { x: number; y: number },
): MapEdge {
  const path = [
    { x: from.x, y: from.y },
    { x: to.x, y: to.y },
  ];
  return {
    id,
    name,
    a,
    b,
    capacity: CART_CAPACITY,
    latency: roadLatency(path, MARSH_TICKS_PER_TILE),
    exposure: MARSH_TRACK_EXPOSURE,
    condition: 'open',
    path,
  };
}

export function edgesFor(farm: FarmSite, cuttingHouse?: BuildingSite): MapEdge[] {
  const lowPath = [{ x: farm.x, y: farm.y }, ...LOW_ROAD_WAYPOINTS];
  const highPath = [{ x: farm.x, y: farm.y }, ...HIGH_ROAD_WAYPOINTS];
  const marshPath = [{ x: farm.x, y: farm.y }, ...MARSH_TRACK_WAYPOINTS];
  const edges: MapEdge[] = [
    {
      id: 'low-road',
      name: 'The Low Road',
      a: 'farm',
      b: 'ryne',
      capacity: CART_CAPACITY,
      latency: roadLatency(lowPath, LOW_ROAD_TICKS_PER_TILE),
      exposure: LOW_ROAD_EXPOSURE,
      condition: 'tideLocked',
      path: lowPath,
    },
    {
      id: 'high-road',
      name: 'The High Road',
      a: 'farm',
      b: 'ryne',
      capacity: CART_CAPACITY,
      latency: roadLatency(highPath, HIGH_ROAD_TICKS_PER_TILE),
      exposure: HIGH_ROAD_EXPOSURE,
      condition: 'open',
      path: highPath,
    },
    {
      id: 'marsh-track',
      name: 'The Marsh Track',
      a: 'farm',
      b: 'shingle',
      capacity: CART_CAPACITY,
      latency: roadLatency(marshPath, MARSH_TICKS_PER_TILE),
      exposure: MARSH_TRACK_EXPOSURE,
      condition: 'open',
      path: marshPath,
    },
  ];
  if (cuttingHouse) {
    // Siting the triangle IS the decision (spec §6.9): each leg's latency
    // falls straight out of where the player put the building.
    edges.push(
      marshTrack('cut-farm-track', 'The Yard Track', 'cutting-house', 'farm', cuttingHouse, farm),
      marshTrack(
        'cut-shingle-track',
        'The Shingle Track',
        'cutting-house',
        'shingle',
        cuttingHouse,
        SHINGLE,
      ),
      marshTrack('cut-ryne-track', 'The Town Track', 'cutting-house', 'ryne', cuttingHouse, RYNE),
    );
  }
  return edges;
}

export function nodeById(id: NodeId, farm: FarmSite, cuttingHouse?: BuildingSite): MapNode {
  const n = nodesFor(farm, cuttingHouse).find((n) => n.id === id);
  if (!n) throw new Error(`Unknown node: ${id}`);
  return n;
}

export function edgeById(id: EdgeId, farm: FarmSite, cuttingHouse?: BuildingSite): MapEdge {
  const e = edgesFor(farm, cuttingHouse).find((e) => e.id === id);
  if (!e) throw new Error(`Unknown edge: ${id}`);
  return e;
}

/** The far end of an edge, seen from `from`. */
export function otherEnd(edge: MapEdge, from: NodeId): NodeId {
  if (edge.a === from) return edge.b;
  if (edge.b === from) return edge.a;
  throw new Error(`Node ${from} is not an endpoint of ${edge.id}`);
}

// ---- The officer's map (spec §6.10) ----
// The Customs House sits beside the high road but off the cart graph: the
// officer alone rides the short lane between his lodgings and Ryne. He does
// not use the low road — the blue coat belongs on the high road, and he
// knows the tide as well as anyone born here.

const CUSTOMS_LANE_PATH = [
  { x: CUSTOMS.x, y: CUSTOMS.y },
  { x: 27, y: 20 },
  { x: RYNE.x, y: RYNE.y },
];

export const CUSTOMS_LANE: MapEdge = {
  id: 'customs-lane',
  name: 'The Customs Lane',
  a: 'customs',
  b: 'ryne',
  capacity: 0, // no hauler carries goods here; the lane is his alone
  latency: 1, // cart latency is meaningless; horse latency rules below
  exposure: 0,
  condition: 'open',
  path: CUSTOMS_LANE_PATH,
};

/** Roads take a horse at road pace; everything else is marsh under hoof. */
export function horseLatency(edge: MapEdge): number {
  const rate =
    edge.id === 'high-road' || edge.id === 'low-road' || edge.id === 'customs-lane'
      ? HORSE_TICKS_PER_TILE_ROAD
      : HORSE_TICKS_PER_TILE_MARSH;
  return Math.max(1, Math.round(pathTileLength(edge.path) * rate));
}

/** The edges the officer will ride: everything but the low road, plus his lane. */
export function officerEdgesFor(farm: FarmSite, cuttingHouse?: BuildingSite): MapEdge[] {
  return [...edgesFor(farm, cuttingHouse).filter((e) => e.id !== 'low-road'), CUSTOMS_LANE];
}

/**
 * Dijkstra over a small edge set: the first edge to take from `from` on the
 * cheapest path to `to`, or null if unreachable. `cost` prices an edge;
 * return Infinity to bar it (a flooded low road, say).
 */
export function firstHop(
  from: NodeId,
  to: NodeId,
  edges: MapEdge[],
  cost: (edge: MapEdge) => number,
): MapEdge | null {
  if (from === to) return null;
  const dist: Record<NodeId, number> = { [from]: 0 };
  const first: Record<NodeId, MapEdge> = {};
  const done: Record<NodeId, boolean> = {};
  for (;;) {
    let u: NodeId | null = null;
    for (const k of Object.keys(dist)) {
      if (!done[k] && (u === null || dist[k] < dist[u])) u = k;
    }
    if (u === null) return null;
    if (u === to) return first[to] ?? null;
    done[u] = true;
    for (const e of edges) {
      if (e.a !== u && e.b !== u) continue;
      const c = cost(e);
      if (!Number.isFinite(c)) continue;
      const v = otherEnd(e, u);
      const d = dist[u] + c;
      if (dist[v] === undefined || d < dist[v]) {
        dist[v] = d;
        first[v] = u === from ? e : first[u];
      }
    }
  }
}
