// Core sim types. Everything here must be plain JSON-serialisable data —
// no Maps, Sets, Dates, or class instances — so that GameState round-trips
// through JSON byte-identically (persistence and the replay test rely on it).

import type { RngState } from './rng';

export type NodeId = string;
export type EdgeId = string;
export type CartId = string;

export type Good = 'fleece'; // M2 adds cloth, woolpacks, jenever, tea, lace…

export type Store = Partial<Record<Good, number>>;

// ---- The map (static — lives in map.ts, never in GameState) ----

export type NodeKind = 'farm' | 'market' | 'customs' | 'waypoint';

export interface MapNode {
  id: NodeId;
  kind: NodeKind;
  name: string;
  /** Tile coordinates (x right, y down) on the terrain grid. */
  x: number;
  y: number;
}

export type EdgeCondition = 'open' | 'tideLocked'; // M2+: nightOnly, moonLocked

export interface MapEdge {
  id: EdgeId;
  name: string;
  a: NodeId;
  b: NodeId;
  /** Goods per run a hauler can move — informational in M1 (cart has own cap). */
  capacity: number;
  /** Ticks to traverse. */
  latency: number;
  /** Base Heat per unit moved. Recorded now, consumed from M3. */
  exposure: number;
  condition: EdgeCondition;
  /** Waypoints in tile coords for rendering and cart interpolation. */
  path: Array<{ x: number; y: number }>;
}

// ---- Dynamic state ----

export type CartLocation =
  | { kind: 'node'; nodeId: NodeId }
  | {
      kind: 'edge';
      edgeId: EdgeId;
      from: NodeId;
      to: NodeId;
      /** Ticks of progress made along the edge, 0..latency. */
      progress: number;
    };

export interface Cart {
  id: CartId;
  name: string;
  capacity: number;
  cargo: Store;
  location: CartLocation;
}

export interface GameEvent {
  tick: number;
  text: string;
}

export interface GameState {
  seed: number;
  tick: number;
  rngState: RngState;
  coin: number;
  /** The farm's fixed site (spec §6.7: the tenancy at Walland). */
  farm: { x: number; y: number };
  /** Tick at which the next rent falls due. */
  rentDueTick: number;
  /** Cumulative coin paid in rent — the ledger will want it later. */
  rentPaid: number;
  /** The tenancy is forfeit: the sim freezes, the game is over. */
  lost: boolean;
  flockSize: number;
  /** Wool on the sheep's backs, grown at dawn, collected by the shear action. */
  fleeceReady: number;
  /** Goods sitting at nodes (farm store, quay, …). */
  stores: Record<NodeId, Store>;
  carts: Cart[];
  /** Ring buffer of recent events, oldest first. Part of state: deterministic. */
  log: GameEvent[];
}

// ---- Actions ----

export type Action =
  | { type: 'shear' }
  | { type: 'loadCart'; cartId: CartId; good: Good; qty: number }
  | { type: 'unloadCart'; cartId: CartId; good: Good; qty: number }
  | { type: 'dispatchCart'; cartId: CartId; edgeId: EdgeId }
  | { type: 'sell'; cartId: CartId; good: Good };

/** Actions to apply at a given tick, for replay: actionLog[tick] = Action[]. */
export type ActionLog = Record<number, Action[]>;
