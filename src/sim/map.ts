// The Gault — hand-authored, not generated (spec §12 M1).
// 40×30 tile grid. The terrain is visual truth; the logistics graph below is
// mechanical truth. Roads are edges, not tiles.
//
// Legend: c clay upland · . marsh · p pasture · f farmstead · d dyke
//         t town (Ryne) · s shingle · ~ sea

import {
  LOW_ROAD_LATENCY,
  HIGH_ROAD_LATENCY,
  LOW_ROAD_EXPOSURE,
  HIGH_ROAD_EXPOSURE,
  CART_CAPACITY,
} from './balance';
import type { MapNode, MapEdge, NodeId, EdgeId } from './types';

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
  '.....ppppppppp...................s~~~~~~',                     // row 10
  '.....ppfffpppp...................s~~~~~~',                     // row 11
  '.....ppfffpppp...................s~~~~~~',                     // row 12
  '.....ppppppppp...................s~~~~~~',                     // row 13
  '.....ppppppppp...................s~~~~~~',                     // row 14
  '.....ppppppppp..................s~~~~~~~',                     // row 15
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

export const NODES: readonly MapNode[] = [
  { id: 'farm', kind: 'farm', name: 'Walland Farm', x: 8, y: 11 },
  { id: 'ryne', kind: 'market', name: 'Ryne', x: 28, y: 22 },
  { id: 'customs', kind: 'customs', name: 'The Customs House', x: 26, y: 19 },
];

export const EDGES: readonly MapEdge[] = [
  {
    id: 'low-road',
    name: 'The Low Road',
    a: 'farm',
    b: 'ryne',
    capacity: CART_CAPACITY,
    latency: LOW_ROAD_LATENCY,
    exposure: LOW_ROAD_EXPOSURE,
    condition: 'tideLocked',
    path: [
      { x: 8, y: 11 },
      { x: 8, y: 17 },
      { x: 13, y: 22 },
      { x: 20, y: 25 },
      { x: 26, y: 25 },
      { x: 28, y: 23 },
      { x: 28, y: 22 },
    ],
  },
  {
    id: 'high-road',
    name: 'The High Road',
    a: 'farm',
    b: 'ryne',
    capacity: CART_CAPACITY,
    latency: HIGH_ROAD_LATENCY,
    exposure: HIGH_ROAD_EXPOSURE,
    condition: 'open',
    path: [
      { x: 8, y: 11 },
      { x: 8, y: 8 },
      { x: 14, y: 5 },
      { x: 22, y: 5 },
      { x: 26, y: 8 },
      { x: 26, y: 19 }, // past the Customs House door
      { x: 27, y: 20 },
      { x: 28, y: 22 },
    ],
  },
];

export function nodeById(id: NodeId): MapNode {
  const n = NODES.find((n) => n.id === id);
  if (!n) throw new Error(`Unknown node: ${id}`);
  return n;
}

export function edgeById(id: EdgeId): MapEdge {
  const e = EDGES.find((e) => e.id === id);
  if (!e) throw new Error(`Unknown edge: ${id}`);
  return e;
}

/** The far end of an edge, seen from `from`. */
export function otherEnd(edge: MapEdge, from: NodeId): NodeId {
  if (edge.a === from) return edge.b;
  if (edge.b === from) return edge.a;
  throw new Error(`Node ${from} is not an endpoint of ${edge.id}`);
}
