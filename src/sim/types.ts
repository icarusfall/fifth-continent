// Core sim types. Everything here must be plain JSON-serialisable data —
// no Maps, Sets, Dates, or class instances — so that GameState round-trips
// through JSON byte-identically (persistence and the replay test rely on it).

import type { RngState } from './rng';

export type NodeId = string;
export type EdgeId = string;
export type CartId = string;

// Brandy tiers are distinct goods: quality is what a thing sells as (§17.3),
// and a plain string key keeps Store JSON-flat. Cloth and woolpacks arrive
// with the market model (§17); overproof jenever has no legal buyer at all.
export type Good =
  | 'fleece'
  | 'jenever'
  | 'tea'
  | 'lace'
  | 'brandy-rough'
  | 'brandy-fair'
  | 'brandy-gent';

/** Depth of the cut (spec §6.9): volume against tier. */
export type CutDepth = 'gentle' | 'standard' | 'deep';

export type Store = Partial<Record<Good, number>>;

// ---- The map (static — lives in map.ts, never in GameState) ----

export type NodeKind = 'farm' | 'market' | 'customs' | 'beach' | 'works' | 'waypoint';

export interface MapNode {
  id: NodeId;
  kind: NodeKind;
  name: string;
  /** Tile coordinates (x right, y down) on the terrain grid. */
  x: number;
  y: number;
}

export type EdgeCondition = 'open' | 'tideLocked'; // M3+: nightOnly, moonLocked

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

/** A hired carter's standing order (spec §6.11): shuttle `good` from → to. */
export interface CarterOrder {
  from: NodeId;
  to: NodeId;
  good: Good;
}

export interface Cart {
  id: CartId;
  name: string;
  capacity: number;
  cargo: Store;
  location: CartLocation;
  /** Non-null = a hired man drives this cart on a standing order (§6.11). */
  carter: CarterOrder | null;
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
  /** The cutting house site, once raised on the marsh (spec §6.9). */
  cuttingHouse: { x: number; y: number } | null;
  /**
   * The Dutchman (spec §6.9). Unlocked once the first rent is collected;
   * present at the shingle on night ∩ falling tide. Hold and appetite are
   * per-visit, restocked on arrival.
   */
  dutchman: {
    unlocked: boolean;
    present: boolean;
    hold: Store;
    fleeceAppetite: number;
  };
  /** Ryne's remaining appetite today, per good — reset at dawn (spec §6.9). */
  demandRemaining: Store;
  /** Spec §6.10: the parish noticing, and London noticing. */
  heat: { regional: number; national: number };
  /** Spec §6.10 / §7: the Revenue's mind, and the officer who acts on it. */
  revenue: {
    officer: {
      /** Permanent from the first dawn regional heat crosses the threshold. */
      arrived: boolean;
      location: CartLocation;
      /** Today's destination: an inspection target, or home to the Customs House. */
      targetNodeId: NodeId | null;
      inspectedToday: boolean;
    };
    /** Where they think goods move — grows from stains, decays at dawn. */
    suspicion: Record<NodeId, number>;
    /** The player's fogged copy: suspicion as of last dawn. The parish talks. */
    gossip: Record<NodeId, number>;
  };
  /** Spec §6.10 / §19.2 — the books, one page per inspection. */
  ledger: {
    /** Fleece per day the books admit the flock gives. Set at will. */
    declaredYield: number;
    declaredToDate: number;
    grownToDate: number;
    /** Fleece sold at Ryne since the page opened. */
    soldLawfully: number;
    /** Fleece on hand when the page opened — carried stock is not new wool. */
    openingStock: number;
  };
  /** Goods sitting at nodes (farm store, quay, …). */
  stores: Record<NodeId, Store>;
  /**
   * Spec §6.12 — how hard each of your buildings is dug in, `fortTier 0..4`.
   * Absent = tier 0. Only your own buildings (farm, cutting house) appear.
   * A hard building leaks more Heat and stands off suspicion of its own —
   * the works are visible, by design (§9).
   */
  fortifications: Partial<Record<NodeId, number>>;
  carts: Cart[];
  /** Ring buffer of recent events, oldest first. Part of state: deterministic. */
  log: GameEvent[];
}

// ---- Actions ----

export type Action =
  | { type: 'shear' }
  | { type: 'loadCart'; cartId: CartId; good: Good; qty: number }
  | { type: 'unloadCart'; cartId: CartId; good: Good; qty: number }
  | { type: 'ditchCargo'; cartId: CartId }
  | { type: 'dispatchCart'; cartId: CartId; edgeId: EdgeId }
  | { type: 'sell'; cartId: CartId; good: Good }
  | { type: 'sellToDutchman'; cartId: CartId }
  | { type: 'buyFromDutchman'; cartId: CartId; good: Good; qty: number }
  | { type: 'placeCuttingHouse'; x: number; y: number }
  | { type: 'cut'; depth: CutDepth; tubs: number }
  | { type: 'buyCart' }
  | { type: 'fortifyBuilding'; nodeId: NodeId }
  | { type: 'hireCarter'; cartId: CartId; order: CarterOrder }
  | { type: 'dismissCarter'; cartId: CartId }
  | { type: 'setDeclaredYield'; fleecePerDay: number };

/** Actions to apply at a given tick, for replay: actionLog[tick] = Action[]. */
export type ActionLog = Record<number, Action[]>;
