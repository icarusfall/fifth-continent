// Core sim types. Everything here must be plain JSON-serialisable data —
// no Maps, Sets, Dates, or class instances — so that GameState round-trips
// through JSON byte-identically (persistence and the replay test rely on it).

import type { Faction, ScheduledCall } from './combat';
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
  | 'bulked-tea'
  | 'lace'
  | 'brandy-rough'
  | 'brandy-fair'
  | 'brandy-gent';

/** Depth of the cut (spec §6.9): volume against tier. */
export type CutDepth = 'gentle' | 'standard' | 'deep';

/**
 * Spec §6.15 — how hard the world leans. Scales what is done *to* you (rent,
 * heat gained, raid muster), never what your own economy yields. Chosen at
 * new game; may be lowered mid-run (a logged action), never raised.
 */
export type Difficulty = 'gentle' | 'fair' | 'hard';

/** Spec §8 / §6.14 — the three trees. */
export type ResearchTree = 'trade' | 'marsh' | 'leiden';

/** Spec §6.14 — one bench, one project at a time. */
export interface Research {
  /** The active project: which tree, and the tick its tier completes. */
  active: { tree: ResearchTree; doneTick: number } | null;
  /** Tiers completed per tree (0 = nothing learned). */
  completed: Record<ResearchTree, number>;
}

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

/** A hired carter's standing order (spec §6.11): shuttle `good` from → to.
 *  `back` (M5a-4) is the optional return leg: loaded at `to` from the store,
 *  or bought over the gunwale with the till's coin. `backTo` (M5, §6.17) is
 *  where that backhaul is dropped — delivered on the way home, from → to →
 *  backTo → from — so one cart runs a whole owling loop and contraband need
 *  never enter the wool barn. Default: `from`. */
export interface CarterOrder {
  from: NodeId;
  to: NodeId;
  good: Good;
  back?: Good;
  backTo?: NodeId;
}

export interface Cart {
  id: CartId;
  name: string;
  capacity: number;
  cargo: Store;
  location: CartLocation;
  /** Non-null = a hired man drives this cart on a standing order (§6.11). */
  carter: CarterOrder | null;
  /**
   * §6.11 / §6.17 — set while the carter waits at a sated market for the
   * appetite to refresh: the tick his patience runs out and he turns for
   * home with the remainder. Absent when he is not waiting.
   */
  marketPatienceUntil?: number;
}

/** A building's posted men (spec §6.13): the two kinds of the §14.2 pair. */
export interface Garrison {
  militia: number;
  crew: number;
}

export type GarrisonKind = 'militia' | 'crew';

/** A force riding for one of your buildings (spec §6.13). */
export interface Raid {
  faction: Faction;
  /** Headcount of the attacking force. */
  size: number;
  /** The building it means to take. */
  target: NodeId;
  /** Tick the blow falls (the muster gathers `RAID_MUSTER_LEAD_DAYS` before). */
  battleTick: number;
  /** It has arrived and the battle awaits the player's answer (§14.4 Calls). */
  pendingBattle: boolean;
}

/** Spec §6.13 — the Hawksmere Company's standing intent against you. */
export interface Hawksmere {
  /** Your market footprint has drawn them; raids now come on a cadence. */
  provoked: boolean;
  /** Raids weathered — each grows the next. */
  raidsSurvived: number;
  /** Tick the next blow is scheduled to fall. */
  nextRaidTick: number;
}

export interface GameEvent {
  tick: number;
  text: string;
}

export interface GameState {
  seed: number;
  tick: number;
  rngState: RngState;
  /** Spec §6.15 — the dial. Scales the world's hand, never the player's yields. */
  difficulty: Difficulty;
  coin: number;
  /** The farm's fixed site (spec §6.7: the tenancy at Walland). */
  farm: { x: number; y: number };
  /** Tick at which the next rent falls due. */
  rentDueTick: number;
  /**
   * Spec §6.8 — rent has fallen due and awaits the player's hand (§6.13 event
   * card): the agent is at the door and the sim marks it, but the coin does not
   * move until a `payRent` action. The UI pauses and surfaces it; the headless
   * bots pay at once.
   */
  rentPending: boolean;
  /** Cumulative coin paid in rent — the ledger will want it later. */
  rentPaid: number;
  /** The tenancy is forfeit: the sim freezes, the game is over. */
  lost: boolean;
  /**
   * Spec §6.15 — the Dutchman's book: coin owed him for a covered rent, with
   * the vig already added. Repaid as a top-slice of every later sale.
   */
  dutchmanBook: number;
  /** Spec §6.15 — the parish vouched (count, for the card) and when it may again. */
  vouches: number;
  vouchCooldownUntil: number;
  /** Spec §6.15 — crisis spacing: tick of the last existential event landed. */
  lastCrisisTick: number;
  flockSize: number;
  /** Spec §6.16 — sheep bought at Ryne, on the drove road home; they join at dawn. */
  sheepArriving: number;
  /** Spec §6.16 — the hired shearer, and the hand-shears that earn his offer. */
  shearer: { hired: boolean; handShears: number };
  /**
   * Spec §6.17 — the refiner: one hired hand who works the whole cutting
   * house at dawn. He cuts all jenever at the standing depth, smouches all
   * tea if told to, and does nothing else. `handRefines` counts the player's
   * own cuts and smouches toward his offer (the §6.11 pattern).
   */
  refiner: { hired: boolean; cutDepth: CutDepth; smouch: boolean; handRefines: number };
  /** Spec §6.9 (M5a-4) — rumours heard on the quay, 0..RUMOUR_TRUST.length. */
  rumoursHeard: number;
  /** Day index of the last round stood in the alehouse (−1 = never). */
  lastRoundDay: number;
  /** Spec §6.14 — the research bench. */
  research: Research;
  /** Wool on the sheep's backs, grown at dawn, collected by the shear action. */
  fleeceReady: number;
  /** The cutting house site, once raised on the marsh (spec §6.9). */
  cuttingHouse: { x: number; y: number } | null;
  /**
   * The Dutchman (spec §6.9). Unlocked once the first rent is collected;
   * present at the shingle on night ∩ falling tide — but until first `met`
   * (coin across the gunwale, either direction) he stands off all night:
   * the first invitation cannot be missed. Hold and appetite are per-visit,
   * restocked on arrival; the hold opens one good at a time as
   * `fleeceBought` (cumulative wool he has taken) climbs the trust ladder.
   */
  dutchman: {
    unlocked: boolean;
    present: boolean;
    met: boolean;
    fleeceBought: number;
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
    /**
     * §6.10 (M5 tutorial pass) — false until the player first sets the
     * declared yield by hand. Until then the agent keeps honest books:
     * declaredYield follows the flock each dawn, so an honest life needs
     * no bookkeeping at all. Cooking the books is the act that takes the
     * pen — after it, the number is yours and never auto-moves again.
     */
    penTaken: boolean;
    declaredToDate: number;
    grownToDate: number;
    /** Fleece sold at Ryne since the page opened. */
    soldLawfully: number;
    /**
     * Fleece sold at Ryne since dawn — the wool-stapler's own tally. Lawful
     * sales are capped at declaredYield per day (§6.10): wool the ledger
     * never grew cannot cross his scales. Reset with the town's appetite.
     */
    soldToday: number;
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
  /**
   * Spec §6.13 — men posted at each building against the raid. Absent = none.
   * The cap is a function of the building's fortTier (fort = capacity too).
   */
  garrisons: Partial<Record<NodeId, Garrison>>;
  /** Spec §6.13 / §11 — the parish's regard for you; falls when your people die. */
  standing: number;
  /** Spec §6.13 — the parish gave you up once (Standing hit zero). Permanent. */
  informer: boolean;
  /** Spec §6.13 — cumulative contraband sold at Ryne; your market footprint. */
  contrabandSold: number;
  /**
   * Spec §6.10 / §6.8 — running tallies the event cards watch: goods the
   * officer has seized (and where the last blow fell), and sheep the agent's
   * men have driven off in distraint. Cumulative, so a watcher reads the
   * delta; raid plunder is not counted here (the raid has its own cards).
   */
  goodsSeized: number;
  lastSeizureNode: NodeId | null;
  distraintSheep: number;
  /** Spec §6.13 — the Hawksmere Company's intent, and the raid it has in the field. */
  hawksmere: Hawksmere;
  raid: Raid | null;
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
  | { type: 'smouch'; chests: number }
  | { type: 'sellToFence'; cartId: CartId; good: Good }
  | { type: 'buyCart' }
  | { type: 'sellCart'; cartId: CartId }
  | { type: 'buyRound' }
  | { type: 'fortifyBuilding'; nodeId: NodeId }
  | { type: 'raiseGarrison'; nodeId: NodeId; kind: GarrisonKind }
  | { type: 'dismissGarrison'; nodeId: NodeId; kind: GarrisonKind }
  | { type: 'hireCarter'; cartId: CartId; order: CarterOrder }
  | { type: 'dismissCarter'; cartId: CartId }
  | { type: 'setDeclaredYield'; fleecePerDay: number }
  | { type: 'payRent' }
  | { type: 'takeDutchmanLoan' }
  | { type: 'setDifficulty'; difficulty: Difficulty }
  | { type: 'hireShearer' }
  | { type: 'dismissShearer' }
  | { type: 'hireRefiner' }
  | { type: 'dismissRefiner' }
  | { type: 'setRefinerOrders'; cutDepth: CutDepth; smouch: boolean }
  | { type: 'buySheep'; qty: number }
  | { type: 'sellSheep'; qty: number }
  | { type: 'startResearch'; tree: ResearchTree }
  | { type: 'resolveRaid'; calls?: ScheduledCall[] };

/** Actions to apply at a given tick, for replay: actionLog[tick] = Action[]. */
export type ActionLog = Record<number, Action[]>;
