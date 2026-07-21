// The simulation is a pure function: tick(state, actions) -> state.
// No side effects, no Date.now(), no Math.random(). All randomness comes
// from the seeded PRNG carried in state.rngState. (Spec §0 — the single
// most important architectural rule in the project.)

import {
  CART_CAPACITY,
  CART_COST,
  CART_RESALE,
  ROUND_COST,
  RUMOUR_TRUST,
  CARTER_WAGE,
  CUTS,
  DIFFICULTY,
  DIFFICULTY_ORDER,
  DUTCHMAN_SLICE,
  DUTCHMAN_VIG,
  FLOCK_CAP,
  PARISH_VOUCH_COOLDOWN_DAYS,
  PARISH_VOUCH_COST,
  PARISH_VOUCH_STANDING,
  REFINER_WAGE,
  RESEARCH_COST,
  RESEARCH_DAYS,
  SHEARER_WAGE,
  CARTER_DANGER_WAGE,
  CARTER_MARKET_PATIENCE_DAYS,
  DUTCHMAN_TRUST_JENEVER,
  DUTCHMAN_TRUST_TEA,
  HOLLOW_WAY_DEBT,
  MARSH_LANTERN_DEBT,
  SHEEP_PRICE_BUY,
  SHEEP_PRICE_SELL,
  FARM_STORE_CAPACITY,
  CUTTING_HOUSE_STORE_CAPACITY,
  CREW_MUSTER,
  CREW_WAGE,
  CUTTING_HOUSE_COST,
  CUT_SUGAR_COST,
  SMOUCH_COST,
  SMOUCH_YIELD,
  FENCE_PRICE_MULT,
  DAILY_DEMAND,
  FORT_COST,
  GARRISON_BASE,
  GARRISON_PER_TIER,
  MILITIA_MUSTER,
  MILITIA_WAGE,
  STANDING_RECOVERY,
  STANDING_START,
  DUTCHMAN_FLEECE_DEMAND,
  DUTCHMAN_HOLD,
  DUTCHMAN_PRICE,
  FLEECE_PER_HEAD_PER_DAY,
  LEIDEN_PRICE_MULT,
  MAX_CARTS,
  MAX_FORT_TIER,
  MAX_LOG_EVENTS,
  MAX_SUPPRESSIONS,
  RENT_AMOUNT,
  RENT_PERIOD_DAYS,
  RYNE_PRICE,
  SHEARING_HOUR,
  SHEEP_VALUE,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from './balance';
import { FARM_SITE, edgeById, edgesFor, firstHop, isPlaceable, nodeById, otherEnd } from './map';
import {
  CONTRABAND,
  illicitCount,
  accrueDitchHeat,
  accrueMarketTattle,
  accrueRouteHeat,
  accrueStorageHeat,
  coverOf,
  dawnRevenue,
  loseStanding,
  officerTick,
} from './revenue';
import { raidTick, resolveRaid } from './raid';
import { accrueNightMarsh, addDebt, applyPayTribute, applyTrapWight, wightsAtDawn } from './wights';
import {
  applyHouseLeiden,
  applyPublishLetter,
  applyRefuseLeiden,
  applyReleaseLetter,
  applySuppressLetter,
  leidenAtDeparture,
  leidenTierCompleted,
} from './leiden';
import { seedRng } from './rng';
import { clockOf, dayPhaseOf, isFlooded, tideIsRising } from './time';
import type {
  Action,
  Cart,
  CarterOrder,
  CutDepth,
  Difficulty,
  GameState,
  Garrison,
  GarrisonKind,
  Good,
  NodeId,
  Store,
} from './types';

export function initialState(seed: number, difficulty: Difficulty = 'fair'): GameState {
  return {
    seed,
    tick: 0,
    rngState: seedRng(seed),
    difficulty,
    coin: 0,
    farm: { ...FARM_SITE },
    // The tenancy runs from the first morning (spec §6.8).
    rentDueTick: RENT_PERIOD_DAYS * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR,
    rentPending: false,
    rentPaid: 0,
    lost: false,
    dutchmanBook: 0,
    vouches: 0,
    vouchCooldownUntil: 0,
    lastCrisisTick: 0,
    sheepArriving: 0,
    shearer: { hired: false, handShears: 0 },
    refiner: { hired: false, cutDepth: 'standard', smouch: false, handRefines: 0 },
    rumoursHeard: 0,
    lastRoundDay: -1,
    research: { active: null, completed: { trade: 0, marsh: 0, leiden: 0 } },
    flockSize: STARTING_FLOCK,
    // The flock takes the tenancy already in wool (spec §6.7): the very first
    // action is a shear, not a wait for dawn.
    fleeceReady: STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY,
    cuttingHouse: null,
    dutchman: {
      unlocked: false,
      present: false,
      met: false,
      fleeceBought: 0,
      hold: {},
      fleeceAppetite: 0,
    },
    demandRemaining: { ...DAILY_DEMAND },
    heat: { regional: 0, national: 0 },
    revenue: {
      officer: {
        arrived: false,
        location: { kind: 'node', nodeId: 'customs' },
        targetNodeId: null,
        inspectedToday: false,
      },
      suspicion: {},
      gossip: {},
    },
    // The books open honest: the flock gives what the flock gives (§6.10).
    ledger: {
      declaredYield: STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY,
      penTaken: false,
      declaredToDate: 0,
      grownToDate: 0,
      soldLawfully: 0,
      soldToday: 0,
      // The clip the flock arrives with is stock on hand, not new-grown wool.
      openingStock: STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY,
    },
    stores: {
      farm: { fleece: 0 },
      ryne: {},
      shingle: {},
    },
    fortifications: {},
    garrisons: {},
    standing: STANDING_START,
    informer: false,
    contrabandSold: 0,
    goodsSeized: 0,
    lastSeizureNode: null,
    distraintSheep: 0,
    hawksmere: { provoked: false, raidsSurvived: 0, nextRaidTick: 0 },
    raid: null,
    debt: 0,
    boundWights: 0,
    wights: {
      nightUnits: 0,
      nightUnitsByEdge: {},
      sign: null,
      trap: null,
      stone: null,
      lastSignDay: -1,
      hollowWay: null,
    },
    collection: null,
    peopleCollected: 0,
    lastCollected: null,
    // §6.14 (M5c) — nobody has come ashore yet, and the doom clock still forgets.
    leiden: {
      state: 'unmet',
      node: null,
      landingsBought: 0,
      boughtThisVisit: false,
      refusals: 0,
      letterPending: null,
      heldLetters: [],
    },
    nationalHeatFloor: 0,
    carts: [
      {
        id: 'cart-1',
        name: 'The Cart',
        capacity: CART_CAPACITY,
        cargo: {},
        location: { kind: 'node', nodeId: 'farm' },
        carter: null,
      },
    ],
    log: [
      { tick: 0, text: 'Walland Farm. Twelve sheep in wool, one cart, and a price in Ryne.' },
      {
        tick: 0,
        text: `The agent notes your name. Rent is ${rentAmountFor(difficulty)} coin, six days hence.`,
      },
    ],
  };
}

/** Spec §6.15 — the dial scales the rent, rounded to whole coin. */
export function rentAmountFor(difficulty: Difficulty): number {
  return Math.round(RENT_AMOUNT * DIFFICULTY[difficulty].rentMult);
}

export function rentAmount(state: GameState): number {
  return rentAmountFor(state.difficulty);
}

/** Deep-clone via JSON: state is JSON-safe by construction (types.ts). */
function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function addToStore(store: Store, good: keyof Store, qty: number): void {
  store[good] = (store[good] ?? 0) + qty;
}

function cargoCount(cargo: Store): number {
  return Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
}

/**
 * Store walls by node (spec §6.9 / §6.17): the barn and the cutting house have
 * finite room — the cutting house larger, a purpose-built store. Markets and
 * beaches are open ground with no walls.
 */
function storeCapacityOf(nodeId: NodeId): number {
  if (nodeId === 'farm') return FARM_STORE_CAPACITY;
  if (nodeId === 'cutting-house') return CUTTING_HOUSE_STORE_CAPACITY;
  return Number.MAX_SAFE_INTEGER;
}

/** Room left in a node's store (spec §6.17). */
function storeRoom(state: GameState, nodeId: NodeId): number {
  return storeCapacityOf(nodeId) - cargoCount(state.stores[nodeId] ?? {});
}

function logEvent(state: GameState, text: string): void {
  state.log.push({ tick: state.tick, text });
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

function findCart(state: GameState, cartId: string): Cart | undefined {
  return state.carts.find((c) => c.id === cartId);
}

/**
 * §6.11 — a standing order's daily wage: the honest rate for the honest
 * round, danger money when the order names contraband (outbound or back)
 * or touches the shingle. The ordinary carting folk will not run the risk
 * at 3 coin a day. Exported for the picker, the ledger, and the dawn bill.
 */
export function carterWageOf(order: CarterOrder): number {
  const risky =
    CONTRABAND.includes(order.good) ||
    (order.back !== undefined && CONTRABAND.includes(order.back)) ||
    order.from === 'shingle' ||
    order.to === 'shingle' ||
    order.backTo === 'shingle';
  return risky ? CARTER_DANGER_WAGE : CARTER_WAGE;
}

/** A crewed cart answers to its carter, not the player (spec §6.11). */
function underOrders(state: GameState, cart: Cart): boolean {
  if (!cart.carter) return false;
  logEvent(state, `${cart.name} has a carter on the reins. Dismiss him to drive it yourself.`);
  return true;
}

function isDawn(tick: number): boolean {
  const { hour, minute } = clockOf(tick);
  return hour === SHEARING_HOUR && minute === 0;
}

/**
 * Spec §6.15 — sale proceeds pass through the Dutchman's book: while coin is
 * owed him, his man takes DUTCHMAN_SLICE off the top of every sale until the
 * book clears. Returns what actually reaches the purse.
 */
function creditProceeds(state: GameState, proceeds: number): number {
  if (state.dutchmanBook <= 0 || proceeds <= 0) return proceeds;
  const slice = Math.min(state.dutchmanBook, Math.floor(proceeds * DUTCHMAN_SLICE));
  state.dutchmanBook -= slice;
  if (state.dutchmanBook <= 0) {
    logEvent(state, 'The last of the Dutchman’s coin is repaid. The book closes, and he smiles.');
  }
  return proceeds - slice;
}

/**
 * Fleece over the gunwale (§6.9), shared by the player's verb and the
 * carter's shingle order (§6.11): the Dutchman's price, into his per-visit
 * appetite, through his book. Returns units sold; the caller talks.
 */
function dutchmanFleeceSale(state: GameState, cart: Cart): number {
  if (!state.dutchman.present) return 0;
  const held = cart.cargo.fleece ?? 0;
  const qty = Math.min(held, state.dutchman.fleeceAppetite);
  if (qty <= 0) return 0;
  cart.cargo.fleece = held - qty;
  state.dutchman.fleeceAppetite -= qty;
  // §6.9 — coin across the gunwale: he is met, and the wool climbs his trust.
  state.dutchman.met = true;
  state.dutchman.fleeceBought += qty;
  state.coin += creditProceeds(state, qty * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
  return qty;
}

/**
 * The core of a Ryne sale, shared by the player's verb and the hired
 * carter (§6.11): demand cap, coin, the books, and the town's tattle.
 * Returns units sold; the caller does its own talking.
 */
function marketSale(state: GameState, cart: Cart, good: Good): number {
  if (good === 'jenever') return 0; // no legal buyer at any price
  const held = cart.cargo[good] ?? 0;
  const appetite = state.demandRemaining[good] ?? 0;
  // §6.10 — the wool-stapler reads the whole page: lawful fleece sells only
  // against the book's unsold balance. Wool the ledger never grew cannot
  // cross his scales; it moves over the gunwale or not at all.
  const bookAllows = good === 'fleece' ? woolOnTheBooks(state) : Number.MAX_SAFE_INTEGER;
  const qty = Math.min(held, appetite, bookAllows);
  if (qty <= 0) return 0;
  cart.cargo[good] = held - qty;
  state.demandRemaining[good] = appetite - qty;
  state.coin += creditProceeds(state, qty * RYNE_PRICE[good]);
  if (good === 'fleece') {
    state.ledger.soldLawfully += qty; // lawful wool enters the books (§6.10)
    state.ledger.soldToday += qty;
  } else {
    accrueMarketTattle(state, good, qty);
  }
  return qty;
}

/**
 * The cut itself (spec §6.9 / §6.17), shared by the player's verb and the
 * refiner's dawn round: clamps to the tubs on hand, the sugar money, and the
 * house's walls (each tub nets yield − 1 beyond the jenever it consumes).
 * Returns tubs cut; the caller does its own talking.
 */
function doCut(state: GameState, depth: CutDepth, tubsWanted: number): number {
  if (!state.cuttingHouse) return 0;
  const store = state.stores['cutting-house'] ?? {};
  const cut = CUTS[depth];
  const room = storeRoom(state, 'cutting-house');
  const maxByRoom = Math.floor(Math.max(0, room) / (cut.yield - 1));
  const tubs = Math.min(
    tubsWanted,
    store.jenever ?? 0,
    Math.floor(state.coin / CUT_SUGAR_COST),
    maxByRoom,
  );
  if (tubs <= 0) return 0;
  store.jenever = (store.jenever ?? 0) - tubs;
  state.coin -= tubs * CUT_SUGAR_COST;
  addToStore(store, cut.brandy, tubs * cut.yield);
  state.stores['cutting-house'] = store;
  return tubs;
}

/** The smouch itself (spec §6.17), shared the same way. Returns chests smouched. */
function doSmouch(state: GameState, chestsWanted: number): number {
  if (!state.cuttingHouse) return 0;
  const store = state.stores['cutting-house'] ?? {};
  const room = storeRoom(state, 'cutting-house');
  const maxByRoom = Math.floor(Math.max(0, room) / (SMOUCH_YIELD - 1));
  const chests = Math.min(
    chestsWanted,
    store.tea ?? 0,
    Math.floor(state.coin / SMOUCH_COST),
    maxByRoom,
  );
  if (chests <= 0) return 0;
  store.tea = (store.tea ?? 0) - chests;
  state.coin -= chests * SMOUCH_COST;
  addToStore(store, 'bulked-tea', chests * SMOUCH_YIELD);
  state.stores['cutting-house'] = store;
  return chests;
}

/** Spec §6.13 — the garrison's two kinds: muster cost, daily wage, and a name. */
const GARRISON_MUSTER: Record<GarrisonKind, number> = { militia: MILITIA_MUSTER, crew: CREW_MUSTER };
const GARRISON_LABEL: Record<GarrisonKind, string> = { militia: 'militiaman', crew: 'smuggler' };

function isYourBuilding(state: GameState, nodeId: NodeId): boolean {
  return nodeId === 'farm' || (nodeId === 'cutting-house' && state.cuttingHouse !== null);
}

function garrisonCount(g?: Garrison): number {
  return g ? g.militia + g.crew : 0;
}

/** How many men a building can quarter: base plus its fort tier (§6.13). */
export function garrisonCap(state: GameState, nodeId: NodeId): number {
  return GARRISON_BASE + (state.fortifications[nodeId] ?? 0) * GARRISON_PER_TIER;
}

/** §6.10 — the page's unsold balance: wool the book grew (or the officer has
 *  counted) that no scale has yet weighed. The stapler reads the whole page. */
export function woolOnTheBooks(state: GameState): number {
  const l = state.ledger;
  return Math.max(0, l.openingStock + l.declaredToDate - l.soldLawfully);
}

function garrisonWageBill(g: Garrison): number {
  return g.militia * MILITIA_WAGE + g.crew * CREW_WAGE;
}

/** The Trade fortification ladder, for the log (spec §6.12 / §22). Index = tier. */
const FORT_WORKS: readonly ((name: string) => string)[] = [
  () => '',
  (n) => `Dogs and a spiked hedge go up around ${n}.`,
  (n) => `${n} gets bolted doors, and firing steps behind them — for whatever men you post.`,
  (n) => `Gunports are cut into the walls of ${n}.`,
  (n) => `${n} is a fortress now — crenellations, a palisade, the lot.`,
];

// ---- Action application ----
// Invalid actions never throw: they log and do nothing, so a stale or
// mistimed order from the UI (or a replayed log) degrades gracefully and
// identically every time.

function applyAction(state: GameState, action: Action): void {
  switch (action.type) {
    case 'shear': {
      if (state.fleeceReady <= 0) {
        logEvent(state, 'The sheep are shorn bare. Wool grows by dawn.');
        return;
      }
      state.shearer.handShears += 1; // the chore, counted toward his offer (§6.16)
      state.stores.farm = state.stores.farm ?? {};
      // The barn is finite (spec §6.9): wool it cannot take stays on the sheep.
      const room = FARM_STORE_CAPACITY - cargoCount(state.stores.farm);
      const qty = Math.min(state.fleeceReady, room);
      if (qty <= 0) {
        logEvent(state, 'The barn is full to the rafters. The wool stays on the sheep.');
        return;
      }
      state.fleeceReady -= qty;
      addToStore(state.stores.farm, 'fleece', qty);
      logEvent(
        state,
        state.fleeceReady > 0
          ? `Sheared ${qty} fleece; the barn takes no more. The rest stays on the sheep.`
          : `Sheared ${qty} fleece into the farm store.`,
      );
      return;
    }

    case 'loadCart': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node') {
        logEvent(state, `${cart.name} cannot be loaded on the road.`);
        return;
      }
      const store = state.stores[cart.location.nodeId];
      const available = store?.[action.good] ?? 0;
      const room = cart.capacity - cargoCount(cart.cargo);
      const qty = Math.min(action.qty, available, room);
      if (qty <= 0) return;
      store![action.good] = available - qty;
      addToStore(cart.cargo, action.good, qty);
      logEvent(state, `Loaded ${qty} ${action.good} onto ${cart.name}.`);
      return;
    }

    case 'unloadCart': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node') {
        logEvent(state, `${cart.name} cannot be unloaded on the road.`);
        return;
      }
      const held = cart.cargo[action.good] ?? 0;
      const nodeId = cart.location.nodeId;
      // The barn and the cutting house have walls (spec §6.9 / §6.17); markets
      // and beaches are open ground.
      const room = storeRoom(state, nodeId);
      const qty = Math.min(action.qty, held, room);
      if (qty <= 0) {
        if (held > 0 && room <= 0) {
          logEvent(state, 'The barn is full to the rafters. Nothing more fits.');
        }
        return;
      }
      cart.cargo[action.good] = held - qty;
      state.stores[nodeId] = state.stores[nodeId] ?? {};
      addToStore(state.stores[nodeId], action.good, qty);
      logEvent(
        state,
        `Unloaded ${qty} ${action.good} at ${nodeById(nodeId, state.farm, state.cuttingHouse).name}.`,
      );
      return;
    }

    case 'ditchCargo': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      const dumped = cargoCount(cart.cargo);
      if (dumped <= 0) return;
      cart.cargo = {};
      accrueDitchHeat(state, dumped);
      logEvent(
        state,
        `${cart.name} tips ${dumped} goods into a dyke. The marsh keeps its own ledger.`,
      );
      return;
    }

    case 'dispatchCart': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node') {
        logEvent(state, `${cart.name} is already on the road.`);
        return;
      }
      const edge = edgeById(action.edgeId, state.farm, state.cuttingHouse);
      const from = cart.location.nodeId;
      if (edge.a !== from && edge.b !== from) {
        logEvent(state, `${edge.name} does not start here.`);
        return;
      }
      // §6.14 (M5c) — hulls and wheels never share a way.
      if ((edge.id === 'sea-lane') !== (cart.vessel === true)) {
        logEvent(
          state,
          cart.vessel
            ? 'The lighter answers only the sea lane. Steam does not climb mud.'
            : 'No cart swims. The sea lane is the lighter’s alone.',
        );
        return;
      }
      if (edge.condition === 'tideLocked' && isFlooded(state.tick)) {
        logEvent(state, `${edge.name} is under the tide. The cart waits.`);
        return;
      }
      cart.location = {
        kind: 'edge',
        edgeId: edge.id,
        from,
        to: otherEnd(edge, from),
        progress: 0,
      };
      logEvent(state, `${cart.name} sets out on ${edge.name.toLowerCase()}.`);
      return;
    }

    case 'sell': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node') return;
      const node = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
      if (node.kind !== 'market') {
        logEvent(state, `No buyer at ${node.name}.`);
        return;
      }
      if (action.good === 'jenever') {
        logEvent(state, 'No buyer in Ryne will touch overproof jenever. It wants cutting.');
        return;
      }
      const held = cart.cargo[action.good] ?? 0;
      if (held <= 0) return;
      if ((state.demandRemaining[action.good] ?? 0) <= 0) {
        logEvent(state, `Ryne has had its fill of ${action.good} today. Dawn brings appetite.`);
        return;
      }
      if (action.good === 'fleece' && woolOnTheBooks(state) <= 0) {
        // §6.10 — the squeeze: short books starve the page's unsold balance.
        logEvent(
          state,
          'The wool-stapler reads your page against his tally: nothing on the books stands unsold. Selling wool the ledger never grew is a confession.',
        );
        return;
      }
      const qty = marketSale(state, cart, action.good);
      const price = RYNE_PRICE[action.good];
      logEvent(
        state,
        action.good === 'fleece'
          ? `Sold ${qty} fleece at ${node.name} for ${qty * price} coin. The price is insulting.`
          : `Sold ${qty} ${action.good} at ${node.name} for ${qty * price} coin.` +
              (qty < held ? ` The town will take no more today.` : ''),
      );
      return;
    }

    case 'sellToFence': {
      // §6.17 — the back-door buyer: takes surplus contraband whole, uncapped by
      // the day's appetite, at a haircut. The priced way out of a sated market,
      // so a laden cart need not sit in town waiting to be seized (§6.10/§6.11).
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node') return;
      const node = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
      if (node.kind !== 'market') {
        logEvent(state, `No fence at ${node.name}.`);
        return;
      }
      if (!CONTRABAND.includes(action.good) || RYNE_PRICE[action.good] <= 0) {
        logEvent(state, 'The fence deals in contraband, not honest goods.');
        return;
      }
      const held = cart.cargo[action.good] ?? 0;
      if (held <= 0) return;
      const price = Math.round(RYNE_PRICE[action.good] * FENCE_PRICE_MULT);
      cart.cargo[action.good] = 0; // he takes the lot
      const proceeds = held * price;
      state.coin += creditProceeds(state, proceeds);
      accrueMarketTattle(state, action.good, held);
      logEvent(
        state,
        `The fence takes all ${held} ${action.good} for ${proceeds} coin — a fraction of the town price, and no waiting.`,
      );
      return;
    }

    case 'sellToDutchman': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node' || cart.location.nodeId !== 'shingle') return;
      if (!state.dutchman.present) {
        logEvent(state, 'Shingle and sea-wrack. Nobody is buying wool from the water tonight.');
        return;
      }
      const qty = dutchmanFleeceSale(state, cart);
      if (qty <= 0) return;
      logEvent(
        state,
        `${qty} fleece over the gunwale for ${qty * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} coin. Four times the Ryne price, and no questions.`,
      );
      return;
    }

    case 'buyFromDutchman': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node' || cart.location.nodeId !== 'shingle') return;
      if (!state.dutchman.present) return;
      const price = DUTCHMAN_PRICE[action.good];
      const stocked = state.dutchman.hold[action.good] ?? 0;
      if (price === undefined || stocked <= 0) return;
      const room = cart.capacity - cargoCount(cart.cargo);
      const qty = Math.min(action.qty, stocked, room, Math.floor(state.coin / price));
      if (qty <= 0) {
        logEvent(state, 'He does not give credit. Nobody out here gives credit.');
        return;
      }
      state.dutchman.hold[action.good] = stocked - qty;
      state.coin -= qty * price;
      state.dutchman.met = true; // §6.9 — coin across the gunwale, either way
      state.leiden.boughtThisVisit = true; // §6.14 M5c — a tub could hold anything
      addToStore(cart.cargo, action.good, qty);
      logEvent(state, `Bought ${qty} ${action.good} off the lugger for ${qty * price} coin.`);
      return;
    }

    case 'placeCuttingHouse': {
      if (state.cuttingHouse) {
        logEvent(state, 'One cutting house is quite enough to hang for.');
        return;
      }
      if (!isPlaceable(action.x, action.y)) {
        logEvent(state, 'No footing there. The cutting house wants open marsh.');
        return;
      }
      if (state.coin < CUTTING_HOUSE_COST) {
        logEvent(state, `A cutting house costs ${CUTTING_HOUSE_COST} coin, paid up front.`);
        return;
      }
      state.coin -= CUTTING_HOUSE_COST;
      state.cuttingHouse = { x: action.x, y: action.y };
      state.stores['cutting-house'] = {};
      logEvent(
        state,
        'A shed goes up on the marsh, quietly. Water, burnt sugar, and no sign over the door.',
      );
      return;
    }

    case 'cut': {
      if (!state.cuttingHouse) return;
      const store = state.stores['cutting-house'] ?? {};
      const room = storeRoom(state, 'cutting-house');
      const tubs = doCut(state, action.depth, action.tubs);
      if (tubs <= 0) {
        logEvent(
          state,
          (store.jenever ?? 0) <= 0
            ? 'No tubs at the cutting house. The Dutchman sells them.'
            : room <= 0
              ? 'The cutting house store is full; move the brandy on before cutting more.'
              : 'Burnt sugar costs coin, and the till is empty.',
        );
        return;
      }
      state.refiner.handRefines += 1; // the chore, counted toward his offer (§6.17)
      logEvent(
        state,
        `Cut ${tubs} tub${tubs === 1 ? '' : 's'} ${action.depth}: ${tubs * CUTS[action.depth].yield} of ${CUTS[action.depth].brandy} for the town.`,
      );
      return;
    }

    case 'smouch': {
      // §6.17 — the inbound twin of the cut: ash and sloe stretch the bohea to
      // twice the volume at a lower grade, feeding the cheap second market.
      if (!state.cuttingHouse) return;
      const store = state.stores['cutting-house'] ?? {};
      const room = storeRoom(state, 'cutting-house');
      const chests = doSmouch(state, action.chests);
      if (chests <= 0) {
        logEvent(
          state,
          (store.tea ?? 0) <= 0
            ? 'No bohea at the cutting house to smouch.'
            : room <= 0
              ? 'The cutting house store is full; move the leaf on before smouching more.'
              : 'Ash and sloe cost coin, and the till is empty.',
        );
        return;
      }
      state.refiner.handRefines += 1; // the chore, counted toward his offer (§6.17)
      logEvent(
        state,
        `Smouched ${chests} chest${chests === 1 ? '' : 's'}: ${chests * SMOUCH_YIELD} of bulked tea, ash and sloe and all.`,
      );
      return;
    }

    case 'hireRefiner': {
      // Spec §6.17 — the house that runs itself: the shearer's pattern (§6.16),
      // priced dearer because this hand knows what the work is.
      if (!state.cuttingHouse) {
        logEvent(state, 'No cutting house stands. There is nothing for a refiner to run.');
        return;
      }
      if (state.refiner.hired) {
        logEvent(state, 'The refiner already works the house at dawn.');
        return;
      }
      state.refiner.hired = true;
      logEvent(
        state,
        `A quiet man takes the cutting house's dawn work for ${REFINER_WAGE} coin a day. He knows what the work is, and what it is.`,
      );
      return;
    }

    case 'dismissRefiner': {
      if (!state.refiner.hired) return;
      state.refiner.hired = false;
      logEvent(state, 'The refiner is paid off. The cutting and the smouching are your hands again.');
      return;
    }

    case 'setRefinerOrders': {
      // Spec §6.17 — the standing instruction: a cut depth, and a smouch toggle.
      state.refiner.cutDepth = action.cutDepth;
      state.refiner.smouch = action.smouch;
      logEvent(
        state,
        `The refiner's orders: cut ${action.cutDepth}${action.smouch ? ', and smouch the leaf' : ', and leave the leaf alone'}. He holds to them.`,
      );
      return;
    }

    case 'buyCart': {
      // §6.14 (M5c) — the lighter is a hull, not a stall: it never counts
      // against the yard.
      if (state.carts.filter((c) => !c.vessel).length >= MAX_CARTS) {
        logEvent(state, 'The yard holds three carts and no more.');
        return;
      }
      if (state.coin < CART_COST) {
        logEvent(state, `A cart and pony run ${CART_COST} coin, and the till is short.`);
        return;
      }
      state.coin -= CART_COST;
      // The smallest free stall: a sold cart's id and name may be reissued,
      // but never while a cart still answers to them.
      const stall = Array.from({ length: MAX_CARTS }, (_, i) => i + 1).find(
        (n) => !state.carts.some((c) => c.id === `cart-${n}`),
      )!;
      const ordinal = ['The Cart', 'The Second Cart', 'The Third Cart'][stall - 1];
      state.carts.push({
        id: `cart-${stall}`,
        name: ordinal,
        capacity: CART_CAPACITY,
        cargo: {},
        location: { kind: 'node', nodeId: 'farm' },
        carter: null,
      });
      logEvent(state, `${ordinal} stands in the yard, pony and all. ${CART_COST} coin.`);
      return;
    }

    case 'sellCart': {
      // Spec §6.11 — the wheelwright buys back at a small loss: only an empty,
      // carterless cart standing in the farmyard, and never the last one.
      const cart = findCart(state, action.cartId);
      if (!cart) return;
      if (cart.vessel) {
        logEvent(state, 'The wheelwright wants nothing to do with a boiler. The lighter stays.');
        return;
      }
      if (state.carts.filter((c) => !c.vessel).length <= 1) {
        logEvent(state, 'Sell the only cart and the wool walks to Ryne on its own feet. No.');
        return;
      }
      if (cart.carter) {
        logEvent(state, `A man is on the reins of ${cart.name}. Dismiss him first.`);
        return;
      }
      if (cargoCount(cart.cargo) > 0) {
        logEvent(state, `${cart.name} stands laden. The wheelwright buys wood, not cargo.`);
        return;
      }
      if (cart.location.kind !== 'node' || cart.location.nodeId !== 'farm') {
        logEvent(state, 'The wheelwright buys in the farmyard, not wherever a cart happens to stand.');
        return;
      }
      state.carts = state.carts.filter((c) => c.id !== cart.id);
      state.coin += CART_RESALE;
      logEvent(
        state,
        `${cart.name} goes back to the wheelwright, pony and all. ${CART_RESALE} coin — he buys dearer than he forgets, and cheaper than he sells.`,
      );
      return;
    }

    case 'buyRound': {
      // Spec §6.9 (M5a-4) — asking on the quay: coin loosens the next rumour
      // in a fixed chain, once a day. It is you who walks into the alehouse,
      // not a cart — no wagon need stand in Ryne, hired carter or no.
      if (state.dutchman.unlocked || state.rumoursHeard >= RUMOUR_TRUST.length) {
        logEvent(state, 'The quay has nothing left to teach you.');
        return;
      }
      const day = Math.floor(state.tick / TICKS_PER_DAY);
      if (day <= state.lastRoundDay) {
        logEvent(state, 'The alehouse has had your coin once today. Tomorrow is another thirst.');
        return;
      }
      if (state.coin < ROUND_COST) {
        logEvent(state, `A round for the quay is ${ROUND_COST} coin, and the till is short.`);
        return;
      }
      if (state.ledger.soldLawfully < RUMOUR_TRUST[state.rumoursHeard]) {
        logEvent(
          state,
          'Your coin stays on the bar. The quay talks to farmers it knows — sell more wool at Ryne first.',
        );
        return;
      }
      state.coin -= ROUND_COST;
      state.lastRoundDay = day;
      logEvent(state, QUAY_RUMOURS[state.rumoursHeard]);
      state.rumoursHeard += 1;
      if (state.rumoursHeard >= RUMOUR_TRUST.length) {
        // The chain's end is the same unlock the first rent grants unasked
        // (§6.9) — earned early, and announced by its own card.
        state.dutchman.unlocked = true;
      }
      return;
    }

    case 'fortifyBuilding': {
      // Spec §6.12 — climb one rung of the Trade line at one of your buildings.
      const isYours =
        action.nodeId === 'farm' || (action.nodeId === 'cutting-house' && state.cuttingHouse);
      if (!isYours) {
        logEvent(state, 'You can only dig in your own walls.');
        return;
      }
      const tier = state.fortifications[action.nodeId] ?? 0;
      if (tier >= MAX_FORT_TIER) {
        logEvent(state, `${nodeById(action.nodeId, state.farm, state.cuttingHouse).name} is as hard as it gets.`);
        return;
      }
      const cost = FORT_COST[tier + 1];
      if (state.coin < cost) {
        logEvent(state, `The next works cost ${cost} coin, and the till is short.`);
        return;
      }
      state.coin -= cost;
      state.fortifications[action.nodeId] = tier + 1;
      const name = nodeById(action.nodeId, state.farm, state.cuttingHouse).name;
      logEvent(
        state,
        FORT_WORKS[tier + 1](name) + ' The Revenue will not fail to notice.',
      );
      return;
    }

    case 'raiseGarrison': {
      // Spec §6.13 — post one man of a kind at one of your buildings.
      if (!isYourBuilding(state, action.nodeId)) {
        logEvent(state, 'You can only post men in your own walls.');
        return;
      }
      const name = nodeById(action.nodeId, state.farm, state.cuttingHouse).name;
      const g = state.garrisons[action.nodeId] ?? { militia: 0, crew: 0 };
      if (garrisonCount(g) >= garrisonCap(state, action.nodeId)) {
        logEvent(state, `${name} can quarter no more men. Dig in deeper to hold a larger garrison.`);
        return;
      }
      const cost = GARRISON_MUSTER[action.kind];
      if (state.coin < cost) {
        logEvent(state, `A ${GARRISON_LABEL[action.kind]} costs ${cost} coin to raise.`);
        return;
      }
      state.coin -= cost;
      g[action.kind] += 1;
      state.garrisons[action.nodeId] = g;
      logEvent(state, `A ${GARRISON_LABEL[action.kind]} takes the wall at ${name}. ${cost} coin.`);
      return;
    }

    case 'dismissGarrison': {
      const g = state.garrisons[action.nodeId];
      if (!g || g[action.kind] <= 0) return;
      g[action.kind] -= 1;
      const name = nodeById(action.nodeId, state.farm, state.cuttingHouse).name;
      logEvent(state, `A ${GARRISON_LABEL[action.kind]} is stood down from ${name}.`);
      return;
    }

    case 'hireCarter': {
      const cart = findCart(state, action.cartId);
      if (!cart) return;
      const { from, to } = action.order;
      const nodesKnown = ['farm', 'ryne', 'shingle', ...(state.cuttingHouse ? ['cutting-house'] : [])];
      if (from === to || !nodesKnown.includes(from) || !nodesKnown.includes(to)) return;
      // A man already on the reins takes new orders in place — no need to pay
      // him off and hire afresh just to redirect the round (spec §6.11).
      const reorder = !!cart.carter;
      const order: CarterOrder = { ...action.order };
      // §6.17 — the backhaul's drop node: home (`from`) is the default, and a
      // drop at either end of the run means nothing. A bad node degrades to it.
      if (
        order.backTo !== undefined &&
        (order.backTo === from || order.backTo === to || !nodesKnown.includes(order.backTo))
      ) {
        delete order.backTo;
      }
      // §6.11 — the load cap: whole, sane, and under the cart's capacity;
      // anything else means "fill the cart" and is dropped.
      if (order.maxLoad !== undefined) {
        order.maxLoad = Math.round(order.maxLoad);
        if (order.maxLoad <= 0 || order.maxLoad >= cart.capacity) delete order.maxLoad;
      }
      cart.carter = order;
      delete cart.marketPatienceUntil; // a fresh instruction is fresh patience
      const route = `${nodeById(from, state.farm, state.cuttingHouse).name} to ${
        nodeById(to, state.farm, state.cuttingHouse).name
      }${order.maxLoad !== undefined ? `, no more than ${order.maxLoad} a run` : ''}${
        order.back
          ? `, home with ${order.back}${
              order.backTo
                ? ` dropped at ${nodeById(order.backTo, state.farm, state.cuttingHouse).name}`
                : ''
            }`
          : ''
      }`;
      const wage = carterWageOf(order);
      logEvent(
        state,
        reorder
          ? `New orders for ${cart.name}: ${route}, ${wage} coin a day${wage > CARTER_WAGE ? ' — danger money' : ''}. The same man keeps the reins.`
          : `A carter takes ${cart.name}: ${route}, ${wage} coin a day${wage > CARTER_WAGE ? ' — danger money; the honest rate does not cover this work' : ''}. He does not ask what is in the load.`,
      );
      return;
    }

    case 'dismissCarter': {
      const cart = findCart(state, action.cartId);
      if (!cart || !cart.carter) return;
      cart.carter = null;
      delete cart.marketPatienceUntil;
      logEvent(state, `The carter is paid off ${cart.name}. He knew the roads, and he knows things now.`);
      return;
    }

    case 'payRent': {
      payRent(state);
      return;
    }

    case 'takeDutchmanLoan': {
      // Spec §6.15 — he covers the rent shortfall; the book opens at a vig.
      if (!state.rentPending) return;
      if (!state.dutchman.unlocked) {
        logEvent(state, 'Nobody on the water knows your name yet. No one covers a stranger.');
        return;
      }
      if (state.dutchmanBook > 0) {
        logEvent(state, 'The book is already open. He carries one debt per man, and no more.');
        return;
      }
      const shortfall = rentAmount(state) - state.coin;
      if (shortfall <= 0) {
        payRent(state); // nothing to cover: the purse holds it
        return;
      }
      state.coin += shortfall;
      state.dutchmanBook = Math.ceil(shortfall * DUTCHMAN_VIG);
      logEvent(
        state,
        `The Dutchman covers your ${shortfall} coin. His book now says ${state.dutchmanBook}, and his book does not forget.`,
      );
      payRent(state);
      return;
    }

    case 'setDifficulty': {
      // Spec §6.15 — the dial turns one way: down.
      const from = DIFFICULTY_ORDER.indexOf(state.difficulty);
      const to = DIFFICULTY_ORDER.indexOf(action.difficulty);
      if (to < 0 || to >= from) {
        if (to > from) logEvent(state, 'The marsh does not get harder by asking. Only by staying.');
        return;
      }
      state.difficulty = action.difficulty;
      logEvent(state, 'The world eases its grip a little. Nobody will mention it again.');
      return;
    }

    case 'hireShearer': {
      // Spec §6.16 — the last chore, sold. Same pattern as the carter (§6.11).
      if (state.shearer.hired) {
        logEvent(state, 'The shearing lad already comes at dawn.');
        return;
      }
      state.shearer.hired = true;
      logEvent(
        state,
        `A neighbour’s lad will shear at dawn for ${SHEARER_WAGE} coin a day. He is quick, and he does not count.`,
      );
      return;
    }

    case 'dismissShearer': {
      if (!state.shearer.hired) return;
      state.shearer.hired = false;
      logEvent(state, 'The shearing lad is paid off. The dawn clip is yours again.');
      return;
    }

    case 'buySheep': {
      // Spec §6.16 — growth without farming: purchase, capped by the pasture.
      const room = FLOCK_CAP - state.flockSize - state.sheepArriving;
      const qty = Math.min(action.qty, room, Math.floor(state.coin / SHEEP_PRICE_BUY));
      if (qty <= 0) {
        logEvent(
          state,
          room <= 0
            ? 'Walland’s pasture holds what it holds. No grass, no sheep.'
            : `A sheep runs ${SHEEP_PRICE_BUY} coin at Ryne, and the till is short.`,
        );
        return;
      }
      state.coin -= qty * SHEEP_PRICE_BUY;
      state.sheepArriving += qty;
      logEvent(
        state,
        `${qty} sheep bought at Ryne for ${qty * SHEEP_PRICE_BUY} coin. The drover brings them by dawn.`,
      );
      return;
    }

    case 'sellSheep': {
      const qty = Math.min(action.qty, state.flockSize);
      if (qty <= 0) return;
      state.flockSize -= qty;
      // The wool on their backs goes with them; the alibi thins with the flock.
      state.fleeceReady = Math.min(state.fleeceReady, state.flockSize * FLEECE_PER_HEAD_PER_DAY);
      state.ledger.declaredYield = Math.min(state.ledger.declaredYield, state.flockSize);
      state.coin += creditProceeds(state, qty * SHEEP_PRICE_SELL);
      logEvent(
        state,
        `${qty} sheep sold to the drover for ${qty * SHEEP_PRICE_SELL} coin. The agent would have valued them higher.`,
      );
      return;
    }

    case 'startResearch': {
      // Spec §6.14 — one bench, one project. Coin is nominal; the meters are
      // the price. Marsh and Leiden wait on their unlocks (M5b/M5c).
      if (state.research.active) {
        logEvent(state, 'The bench holds one project at a time.');
        return;
      }
      if (action.tree === 'marsh' && state.boundWights < 1) {
        logEvent(state, 'No wight is bound. The marsh does not teach the unbound.');
        return;
      }
      if (action.tree === 'leiden' && state.leiden.state !== 'housed') {
        logEvent(state, 'No philosopher under your roof. His kind arrive by sea, uninvited.');
        return;
      }
      if (action.tree === 'leiden' && state.leiden.letterPending !== null) {
        logEvent(state, 'A letter waits sealed on the bench. He will not work past it.');
        return;
      }
      if (action.tree === 'leiden' && state.leiden.heldLetters.length >= MAX_SUPPRESSIONS) {
        logEvent(state, 'Three letters sit in your strongbox. He has downed tools until one goes out.');
        return;
      }
      const tier = state.research.completed[action.tree];
      const costs = RESEARCH_COST[action.tree];
      if (tier >= costs.length) {
        logEvent(state, 'The trade has taught you all it knows, for now.');
        return;
      }
      const cost = costs[tier];
      if (state.coin < cost) {
        logEvent(state, `The work wants ${cost} coin up front, and the till is short.`);
        return;
      }
      state.coin -= cost;
      state.research.active = {
        tree: action.tree,
        doneTick: state.tick + RESEARCH_DAYS[action.tree][tier] * TICKS_PER_DAY,
      };
      logEvent(
        state,
        `The wheelwright takes ${cost} coin and your cart, and asks no questions about the floor.`,
      );
      return;
    }

    case 'trapWight': {
      applyTrapWight(state);
      return;
    }

    case 'payTribute': {
      applyPayTribute(state);
      return;
    }

    case 'houseLeiden': {
      applyHouseLeiden(state, action.nodeId, coverOf(state, action.nodeId));
      return;
    }

    case 'refuseLeiden': {
      applyRefuseLeiden(state);
      return;
    }

    case 'publishLetter': {
      applyPublishLetter(state);
      return;
    }

    case 'suppressLetter': {
      applySuppressLetter(state);
      return;
    }

    case 'releaseLetter': {
      applyReleaseLetter(state);
      return;
    }

    case 'designateHollowWay': {
      // §6.14 Marsh 3 — one marsh edge that is not there. Named once.
      if (state.research.completed.marsh < 3) {
        logEvent(state, 'The marsh has not yet taught you the way that is not there.');
        return;
      }
      if (state.wights.hollowWay !== null) {
        logEvent(state, 'One hollow way is all the marsh will open. It is chosen.');
        return;
      }
      const edge = edgesFor(state.farm, state.cuttingHouse).find((e) => e.id === action.edgeId);
      if (!edge || !(edge.id === 'marsh-track' || edge.id.startsWith('cut-'))) {
        logEvent(state, 'The hollow way must run through marsh. Roads are the Crown’s.');
        return;
      }
      state.wights.hollowWay = edge.id;
      logEvent(
        state,
        `${edge.name} sinks from the world’s knowing. Carts still cross; nobody watches; every crossing is a favour owed.`,
      );
      return;
    }

    case 'resolveRaid': {
      resolveRaid(state, action.calls);
      return;
    }

    case 'setDeclaredYield': {
      const declared = Math.max(0, Math.min(state.flockSize, Math.round(action.fleecePerDay)));
      state.ledger.declaredYield = declared;
      state.ledger.penTaken = true; // §6.10 — the number is yours now
      logEvent(
        state,
        declared < state.flockSize * FLEECE_PER_HEAD_PER_DAY
          ? `The book now swears the flock gives ${declared} fleece a day. Scrapie, if anyone asks.`
          : `The book admits the flock's full clip: ${declared} fleece a day.`,
      );
      return;
    }
  }
}

// ---- Per-tick processes ----

function growWoolAtDawn(state: GameState): void {
  if (!isDawn(state.tick)) return;
  // §6.10 (M5 tutorial pass) — until the pen is taken, the agent keeps the
  // books square with the flock: an honest life needs no bookkeeping. Done
  // before the day's declaration accrues, so the page never drifts.
  if (!state.ledger.penTaken) {
    state.ledger.declaredYield = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
  }
  const grown = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
  state.fleeceReady += grown;
  logEvent(state, `Dawn. The flock carries ${state.fleeceReady} fleece of wool.`);
  // Ryne wakes hungry (spec §6.9): yesterday's saturation is forgiven —
  // and the wool-stapler turns to a fresh page of his own (§6.10).
  state.demandRemaining = { ...DAILY_DEMAND };
  state.ledger.soldToday = 0;
  // The books accrue (§6.10): what grew, and what the page admits grew.
  state.ledger.grownToDate += grown;
  state.ledger.declaredToDate += Math.min(state.ledger.declaredYield, grown);
}

/** Spec §6.16 — bought sheep come up the drove road overnight and join at dawn. */
function sheepArriveAtDawn(state: GameState): void {
  if (!isDawn(state.tick) || state.sheepArriving <= 0) return;
  state.flockSize += state.sheepArriving;
  logEvent(state, `The drover delivers ${state.sheepArriving} sheep. The flock stands at ${state.flockSize}.`);
  state.sheepArriving = 0;
}

/**
 * Spec §6.16 — the hired shearer: wage at dawn with the wool, then the clip
 * goes into the barn as far as the walls allow. Unpaid, he walks the same
 * morning, like the carter (§6.11), and shearing is the player's chore again.
 */
function shearerAtDawn(state: GameState): void {
  if (!isDawn(state.tick) || !state.shearer.hired) return;
  if (state.coin < SHEARER_WAGE) {
    state.shearer.hired = false;
    logEvent(state, 'No wage, no shearer: the lad walks off, and the wool stays on the sheep.');
    return;
  }
  state.coin -= SHEARER_WAGE;
  if (state.fleeceReady <= 0) return;
  state.stores.farm = state.stores.farm ?? {};
  const room = FARM_STORE_CAPACITY - cargoCount(state.stores.farm);
  const qty = Math.min(state.fleeceReady, room);
  if (qty <= 0) {
    logEvent(state, 'The lad finds the barn full to the rafters. The wool stays on the sheep.');
    return;
  }
  state.fleeceReady -= qty;
  addToStore(state.stores.farm, 'fleece', qty);
  logEvent(state, `The lad shears ${qty} fleece into the barn before breakfast.`);
}

/**
 * Spec §6.17 — the refiner: wage at dawn with the wool, then the whole house
 * worked to the standing instruction — all jenever cut at his depth, all tea
 * smouched if told to. Dumb as the shearer: he refines what is there and does
 * nothing else. Unpaid, he walks the same morning.
 */
function refinerAtDawn(state: GameState): void {
  if (!isDawn(state.tick) || !state.refiner.hired) return;
  if (state.coin < REFINER_WAGE) {
    state.refiner.hired = false;
    logEvent(state, 'No wage, no refiner: the man walks off, and the house stands idle.');
    return;
  }
  state.coin -= REFINER_WAGE;
  const tubs = doCut(state, state.refiner.cutDepth, Number.MAX_SAFE_INTEGER);
  const chests = state.refiner.smouch ? doSmouch(state, Number.MAX_SAFE_INTEGER) : 0;
  if (tubs > 0 && chests > 0) {
    logEvent(
      state,
      `The refiner cuts ${tubs} tub${tubs === 1 ? '' : 's'} ${state.refiner.cutDepth} and smouches ${chests} chest${chests === 1 ? '' : 's'} before breakfast.`,
    );
  } else if (tubs > 0) {
    logEvent(
      state,
      `The refiner cuts ${tubs} tub${tubs === 1 ? '' : 's'} ${state.refiner.cutDepth} before breakfast.`,
    );
  } else if (chests > 0) {
    logEvent(
      state,
      `The refiner smouches ${chests} chest${chests === 1 ? '' : 's'} before breakfast.`,
    );
  }
}

/** Spec §6.14 — the bench: a project completes the tick its time is served. */
function researchProgress(state: GameState): void {
  const active = state.research.active;
  if (!active || state.tick < active.doneTick) return;
  state.research.completed[active.tree] += 1;
  state.research.active = null;
  if (active.tree === 'trade' && state.research.completed.trade === 1) {
    logEvent(
      state,
      'The carts come back with hollow floors. Four tubs ride under the boards now, and the road reads quieter.',
    );
  } else if (active.tree === 'marsh') {
    const marshDone = [
      'The stone teaches the lantern-word. Night carts over the marsh read a tenth as loud — and every run owes the marsh one.',
      'The stone teaches the fog. In a fight, one Call and the raiders swing at shapes — eight owed, each time.',
      'The stone teaches the way that is not there. Choose the track at the stone; nobody will ever watch it, and it is never free.',
    ];
    logEvent(state, marshDone[state.research.completed.marsh - 1] ?? 'The stone falls silent.');
  } else if (active.tree === 'leiden') {
    leidenTierCompleted(state); // §6.14 M5c — the work, the letter, the lighter
  } else {
    logEvent(state, 'The bench clears: the work is done.');
  }
}

/** Spec §6.11 — wages at dawn, with the wool: the honest rate or danger
 *  money, by the order. Unpaid men walk the same morning. */
function payCartersAtDawn(state: GameState): void {
  if (!isDawn(state.tick)) return;
  for (const cart of state.carts) {
    if (!cart.carter) continue;
    const wage = carterWageOf(cart.carter);
    if (state.coin >= wage) {
      state.coin -= wage;
    } else {
      cart.carter = null;
      delete cart.marketPatienceUntil;
      logEvent(
        state,
        `No wage, no carter: the man walks off ${cart.name} and leaves it standing.`,
      );
    }
  }
}

/**
 * Spec §6.13 — the garrison draws its wage at dawn, with the carter's. A wall
 * that cannot be paid loses men to desertion, the cheapest (militia) first,
 * until the remaining bill can be met.
 */
function payGarrisonsAtDawn(state: GameState): void {
  if (!isDawn(state.tick)) return;
  for (const nodeId of Object.keys(state.garrisons)) {
    const g = state.garrisons[nodeId];
    if (!g) continue;
    let bill = garrisonWageBill(g);
    while (bill > state.coin && garrisonCount(g) > 0) {
      if (g.militia > 0) g.militia -= 1;
      else g.crew -= 1;
      logEvent(
        state,
        `No wage at ${nodeById(nodeId, state.farm, state.cuttingHouse).name}: a man walks off the wall.`,
      );
      bill = garrisonWageBill(g);
    }
    state.coin -= bill;
  }
}

/** Spec §6.13 — the parish's memory of a dead neighbour fades, slowly. */
function recoverStandingAtDawn(state: GameState): void {
  if (!isDawn(state.tick)) return;
  if (state.standing < STANDING_START) {
    state.standing = Math.min(STANDING_START, state.standing + STANDING_RECOVERY);
  }
}

/** Spec §6.9 (M5a-4) — the quay's rumour chain, fixed and three long:
 *  the price, the crime, the hour. Index = rumours already heard. */
export const QUAY_RUMOURS: readonly string[] = [
  'The round goes down and a wool-buyer talks: across the water they pay four times the Ryne price for fleece. He says it the way a man names a woman he cannot afford.',
  'A second round, an older man, quieter: wool leaves this coast at night, from open beaches, by the ton. Owling, they call it — the oldest crime on this marsh, and the best paid.',
  'The landlord himself brings the third round. A Dutch lugger stands off the shingle north-east of Walland — after dark, on a falling tide, showing no lights. He has told you nothing, and you have heard nothing.',
];

// ---- The hired carter (spec §6.11) ----
// Tide-smart and coat-blind: he takes the faster road that is open at
// departure, and he will drive contraband straight past the Customs House
// if that is the order he was given.

function carterDispatch(state: GameState, cart: Cart, target: NodeId): void {
  if (cart.location.kind !== 'node' || cart.location.nodeId === target) return;
  const from = cart.location.nodeId;
  const hop = firstHop(from, target, edgesFor(state.farm, state.cuttingHouse), (e) => {
    // §6.14 (M5c) — hulls and wheels never share a way: the lighter answers
    // only the sea lane, and no cart swims.
    if ((e.id === 'sea-lane') !== (cart.vessel === true)) return Infinity;
    return e.condition === 'tideLocked' && isFlooded(state.tick) ? Infinity : e.latency;
  });
  if (!hop) return; // no open road: he waits for the tide like anyone
  cart.location = { kind: 'edge', edgeId: hop.id, from, to: otherEnd(hop, from), progress: 0 };
}

/**
 * Spec §6.11 (M5a-4) — the back leg: before turning for home the carter
 * loads the order's `back` good, from the node's store or over the gunwale
 * at the Dutchman's prices with the coin in the till. His hold, the cart's
 * room, and the purse are the caps; no credit.
 */
function carterBackload(state: GameState, cart: Cart, order: CarterOrder): void {
  const back = order.back;
  if (!back || cart.location.kind !== 'node') return;
  const at = cart.location.nodeId;
  const room = cart.capacity - cargoCount(cart.cargo);
  if (room <= 0) return;
  if (at === 'shingle') {
    if (!state.dutchman.present) return; // no lugger, no market — he turns home
    const price = DUTCHMAN_PRICE[back];
    const stocked = state.dutchman.hold[back] ?? 0;
    if (price === undefined || stocked <= 0) return;
    const qty = Math.min(stocked, room, Math.floor(state.coin / price));
    if (qty <= 0) return;
    state.dutchman.hold[back] = stocked - qty;
    state.coin -= qty * price;
    state.leiden.boughtThisVisit = true; // §6.14 M5c — any hand at the gunwale
    addToStore(cart.cargo, back, qty);
    logEvent(
      state,
      `The carter takes ${qty} ${back} off the lugger for ${qty * price} coin of the till's money, and asks nothing.`,
    );
    return;
  }
  const store = state.stores[at];
  const available = store?.[back] ?? 0;
  const qty = Math.min(available, room);
  if (qty <= 0) return;
  store![back] = available - qty;
  addToStore(cart.cargo, back, qty);
}

/**
 * Spec §6.11 (M5a-4) — home again: everything aboard that is not the
 * outbound good is unloaded into the store, respecting its walls. What
 * cannot fit stays aboard and eats the cart's room.
 */
function carterUnloadForeign(state: GameState, cart: Cart, outbound: Good, at: NodeId): void {
  for (const [good, held] of Object.entries(cart.cargo) as Array<[Good, number]>) {
    if (good === outbound || held <= 0) continue;
    const roomHere = storeRoom(state, at);
    const qty = Math.min(held, Math.max(0, roomHere));
    if (qty <= 0) continue;
    cart.cargo[good] = held - qty;
    state.stores[at] = state.stores[at] ?? {};
    addToStore(state.stores[at], good, qty);
    logEvent(
      state,
      `The carter unloads ${qty} ${good} at ${nodeById(at, state.farm, state.cuttingHouse).name}.`,
    );
  }
}

function runCarters(state: GameState): void {
  for (const cart of state.carts) {
    const order = cart.carter;
    if (!order || cart.location.kind !== 'node') continue;
    const at = cart.location.nodeId;

    if (at === order.from) {
      // The back leg lands first (§6.11, M5a-4): everything aboard that is
      // not the outbound good goes into the store, respecting its walls.
      carterUnloadForeign(state, cart, order.good, at);
      const store = state.stores[at];
      const available = store?.[order.good] ?? 0;
      const room = cart.capacity - cargoCount(cart.cargo);
      // §6.11 — the load cap (M5b playtest): the order may take at most
      // maxLoad of the good per run, counting what already rides aboard.
      const capLeft =
        order.maxLoad !== undefined
          ? Math.max(0, order.maxLoad - (cart.cargo[order.good] ?? 0))
          : Number.MAX_SAFE_INTEGER;
      const qty = Math.min(available, room, capLeft);
      if (qty > 0) {
        store![order.good] = available - qty;
        addToStore(cart.cargo, order.good, qty);
      }
      // A carter shuttles loads, not air: nothing aboard, he waits.
      if ((cart.cargo[order.good] ?? 0) > 0) carterDispatch(state, cart, order.to);
      continue;
    }

    if (at === order.to && (cart.cargo[order.good] ?? 0) > 0) {
      // The shingle order (§6.11, M5a-3): fleece goes over the gunwale when
      // the lugger stands off; otherwise he waits on the beach with the load.
      // He minds the tide and the lugger, and nothing else.
      if (at === 'shingle' && order.good === 'fleece') {
        const sold = dutchmanFleeceSale(state, cart);
        if (sold > 0) {
          logEvent(
            state,
            `The carter passes ${sold} fleece over the gunwale for ${sold * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} coin, and does not look at the boat.`,
          );
        }
        if ((cart.cargo.fleece ?? 0) > 0) continue; // waiting on the lugger
      } else {
        const node = nodeById(at, state.farm, state.cuttingHouse);
        if (node.kind === 'market') {
          const sold = marketSale(state, cart, order.good);
          if (sold > 0) {
            logEvent(
              state,
              `The carter sells ${sold} ${order.good} at ${node.name} for ${sold * RYNE_PRICE[order.good]} coin.`,
            );
          }
          // §6.11 / §6.17 — the sated market: what the town would not take he
          // no longer sloshes home. He waits for the appetite to refresh —
          // exposed, a laden cart in town has no cover — until his patience
          // runs out, then carries the remainder home to cover.
          if ((cart.cargo[order.good] ?? 0) > 0) {
            if (cart.marketPatienceUntil === undefined) {
              cart.marketPatienceUntil =
                state.tick + CARTER_MARKET_PATIENCE_DAYS * TICKS_PER_DAY;
              // §6.10: wool can also be stopped by the book, not the town —
              // the stapler's tally ran out before Ryne's appetite did.
              const bookCapped =
                order.good === 'fleece' && (state.demandRemaining.fleece ?? 0) > 0;
              logEvent(
                state,
                bookCapped
                  ? `The wool-stapler will take no more against your book today. The carter waits on tomorrow's page.`
                  : `${node.name} has had its fill of ${order.good}. The carter waits on the appetite, laden and in plain view.`,
              );
            }
            if (state.tick < cart.marketPatienceUntil) continue; // waiting, exposed
            delete cart.marketPatienceUntil;
            logEvent(
              state,
              `The carter's patience runs out at ${node.name}: he turns for home with the remainder.`,
            );
          } else {
            delete cart.marketPatienceUntil;
          }
        } else {
          // Unload into the store, respecting the barn's walls (§6.9).
          const held = cart.cargo[order.good] ?? 0;
          const roomHere = storeRoom(state, at);
          const qty = Math.min(held, Math.max(0, roomHere));
          if (qty > 0) {
            cart.cargo[order.good] = held - qty;
            state.stores[at] = state.stores[at] ?? {};
            addToStore(state.stores[at], order.good, qty);
          }
        }
      }
      // The back leg (§6.11, M5a-4), then home — by way of the drop node when
      // one is named and the backhaul is aboard (§6.17). What cannot be sold
      // or unloaded rides with him either way.
      carterBackload(state, cart, order);
      carterDispatch(state, cart, carterHomeward(cart, order));
      continue;
    }

    // §6.17 — the drop node: the backhaul lands here on the way home, as far
    // as the walls allow. What cannot fit stays aboard and rides on to `from`.
    if (
      order.backTo !== undefined &&
      at === order.backTo &&
      order.back !== undefined &&
      (cart.cargo[order.back] ?? 0) > 0
    ) {
      const held = cart.cargo[order.back] ?? 0;
      const qty = Math.min(held, Math.max(0, storeRoom(state, at)));
      if (qty > 0) {
        cart.cargo[order.back] = held - qty;
        state.stores[at] = state.stores[at] ?? {};
        addToStore(state.stores[at], order.back, qty);
        logEvent(
          state,
          `The carter drops ${qty} ${order.back} at ${nodeById(at, state.farm, state.cuttingHouse).name} on his way home.`,
        );
      }
      // Deliveries still first: a leftover backhaul dropped in passing must
      // not turn an outbound cart for home.
      carterDispatch(state, cart, (cart.cargo[order.good] ?? 0) > 0 ? order.to : order.from);
      continue;
    }

    // Anywhere else: head for the work — deliveries first, then the drop
    // node if the backhaul is aboard (§6.17), then home.
    carterDispatch(
      state,
      cart,
      (cart.cargo[order.good] ?? 0) > 0 ? order.to : carterHomeward(cart, order),
    );
  }
}

/** Where a carter turning for home actually heads (§6.17): the backhaul's
 *  drop node while the backhaul is aboard, `from` otherwise. */
function carterHomeward(cart: Cart, order: CarterOrder): NodeId {
  return order.backTo !== undefined &&
    order.back !== undefined &&
    (cart.cargo[order.back] ?? 0) > 0
    ? order.backTo
    : order.from;
}

/**
 * Spec §6.9 — the Dutchman stands off the shingle on night ∩ falling tide,
 * once the first rent has been felt. Until first met he ignores the tide
 * and waits the whole night out — the first invitation cannot be missed
 * (the drive is 1.5h; some nights' windows are shorter). His hold and
 * appetite restock on the rising edge of his presence, the hold opened one
 * good at a time by the trust his wool has bought (the ladder).
 */
function dutchmanHoldFor(state: GameState): Store {
  const hold: Store = { lace: DUTCHMAN_HOLD.lace };
  if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_TEA) hold.tea = DUTCHMAN_HOLD.tea;
  if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_JENEVER) {
    hold.jenever = DUTCHMAN_HOLD.jenever;
  }
  return hold;
}

function dutchmanTide(state: GameState): void {
  const here =
    state.dutchman.unlocked &&
    dayPhaseOf(state.tick) === 'night' &&
    (state.dutchman.met ? !tideIsRising(state.tick) : true);
  if (here && !state.dutchman.present) {
    state.dutchman.hold = dutchmanHoldFor(state);
    state.dutchman.fleeceAppetite = DUTCHMAN_FLEECE_DEMAND;
    logEvent(
      state,
      state.dutchman.met
        ? 'A lugger stands off the shingle. No lights, no flag, a falling tide.'
        : 'A lugger stands off the shingle, and waits. He has come to meet you, and he will wait the night.',
    );
  } else if (!here && state.dutchman.present) {
    logEvent(
      state,
      state.dutchman.met ? 'The lugger slips out with the tide.' : 'At first light the lugger slips away, unmet.',
    );
    leidenAtDeparture(state); // §6.14 M5c — was there a man in one of those tubs?
  }
  state.dutchman.present = here;
}

/**
 * Spec §6.8 / §6.13 — the agent arrives at the due dawn and knocks. The coin
 * does not move here: rent is marked *pending* and waits for the player's hand
 * (the `payRent` action, surfaced by the event card). The bots pay at once.
 */
function markRentDue(state: GameState): void {
  if (state.tick >= state.rentDueTick && !state.rentPending) {
    state.rentPending = true;
    logEvent(state, `Rent day. The agent is at the door, and he wants his ${rentAmount(state)} coin.`);
  }
}

/** Spec §6.8 — settle the pending rent: pay what the purse holds, distrain the rest. */
function payRent(state: GameState): void {
  if (!state.rentPending) return;

  const due = rentAmount(state); // §6.15: the dial scales the rent
  const paid = Math.min(state.coin, due);
  state.coin -= paid;
  state.rentPaid += paid;
  const shortfall = due - paid;

  if (shortfall <= 0) {
    logEvent(state, `Rent paid: ${due} coin. The agent tips his hat exactly one inch.`);
  } else {
    const seized = Math.min(state.flockSize, Math.ceil(shortfall / SHEEP_VALUE));
    // Spec §6.15 — the parish vouches: a distraint that would end the tenancy
    // is covered by the neighbours instead, if they still think well of you.
    // Kindness is insurance, spendable once a fortnight, priced in Standing.
    if (
      seized >= state.flockSize &&
      state.standing >= PARISH_VOUCH_STANDING &&
      state.tick >= state.vouchCooldownUntil
    ) {
      loseStanding(state, PARISH_VOUCH_COST);
      state.vouches += 1;
      state.vouchCooldownUntil = state.tick + PARISH_VOUCH_COOLDOWN_DAYS * TICKS_PER_DAY;
      state.lastCrisisTick = state.tick; // an existential event, weathered (§6.15)
      logEvent(
        state,
        'The parish makes up the rent before the agent reaches the fold. A debt no book records — but the marsh keeps accounts.',
      );
    } else {
      state.flockSize -= seized;
      state.distraintSheep += seized;
      state.lastCrisisTick = state.tick;
      logEvent(
        state,
        `Short by ${shortfall} coin. The agent's men drive off ${seized} sheep. Distraint, he calls it.`,
      );
      if (state.flockSize <= 0) {
        state.lost = true;
        state.rentPending = false;
        logEvent(state, 'The tenancy is forfeit. The Gault keeps no one who cannot pay.');
        return;
      }
    }
  }
  state.rentPending = false;
  state.rentDueTick += RENT_PERIOD_DAYS * TICKS_PER_DAY;

  // Spec §6.9: the first rent unlocks the Dutchman. The grind must be felt
  // before the way out opens — he makes his argument to the freshly squeezed.
  state.dutchman.unlocked = true;
}

function moveCarts(state: GameState): void {
  for (const cart of state.carts) {
    if (cart.location.kind !== 'edge') continue;
    const edge = edgeById(cart.location.edgeId, state.farm, state.cuttingHouse);

    // The low road floods at high tide. A cart caught on it halts —
    // it does not drown, it waits, and the player learns about tides.
    if (edge.condition === 'tideLocked' && isFlooded(state.tick)) {
      if (cart.location.progress > 0) {
        // Log only on the first halted tick to avoid spam.
        const last = state.log[state.log.length - 1];
        if (!last || last.text !== `${edge.name} floods. ${cart.name} waits on high ground.`) {
          logEvent(state, `${edge.name} floods. ${cart.name} waits on high ground.`);
        }
      }
      continue;
    }

    cart.location.progress += 1;
    accrueRouteHeat(state, cart, edge); // §6.2, consumed at last
    accrueNightMarsh(state, cart, edge); // §6.14 — the marsh notices, too
    if (cart.location.progress >= edge.latency) {
      // §6.14 — marsh power is priced per use, charged as the run completes.
      // The hollow way charges EVERY crossing, laden or empty — the way
      // itself is the favour, whatever you carry. The lanterns charge each
      // illicit night run they quieten.
      if (state.wights.hollowWay === edge.id) {
        addDebt(state, HOLLOW_WAY_DEBT);
      } else if (
        illicitCount(cart.cargo) > 0 &&
        state.research.completed.marsh >= 1 &&
        (edge.id === 'marsh-track' || edge.id.startsWith('cut-')) &&
        dayPhaseOf(state.tick) === 'night'
      ) {
        addDebt(state, MARSH_LANTERN_DEBT);
      }
      const arrived = cart.location.to;
      cart.location = { kind: 'node', nodeId: arrived };
      logEvent(
        state,
        `${cart.name} arrives at ${nodeById(arrived, state.farm, state.cuttingHouse).name}.`,
      );
    }
  }
}

// ---- The tick ----

export function tick(state: GameState, actions: Action[]): GameState {
  // The tenancy is forfeit: the world stops. Only a new game moves it.
  if (state.lost) return clone(state);

  const next = clone(state);

  for (const action of actions) applyAction(next, action);

  next.tick += 1;
  growWoolAtDawn(next);
  sheepArriveAtDawn(next); // after the clip: they arrive shorn of the morning
  shearerAtDawn(next);
  refinerAtDawn(next);
  researchProgress(next);
  payCartersAtDawn(next);
  payGarrisonsAtDawn(next);
  recoverStandingAtDawn(next);
  markRentDue(next);
  if (isDawn(next.tick)) dawnRevenue(next);
  if (isDawn(next.tick)) wightsAtDawn(next);
  dutchmanTide(next);
  runCarters(next);
  moveCarts(next);
  accrueStorageHeat(next);
  officerTick(next);
  raidTick(next);

  return next;
}
