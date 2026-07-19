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
  RESEARCH_COST,
  RESEARCH_DAYS,
  SHEARER_WAGE,
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
  accrueDitchHeat,
  accrueMarketTattle,
  accrueRouteHeat,
  accrueStorageHeat,
  dawnRevenue,
  loseStanding,
  officerTick,
} from './revenue';
import { raidTick, resolveRaid } from './raid';
import { seedRng } from './rng';
import { clockOf, dayPhaseOf, isFlooded, tideIsRising } from './time';
import type {
  Action,
  Cart,
  CarterOrder,
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
    rumoursHeard: 0,
    lastRoundDay: -1,
    research: { active: null, completed: { trade: 0, marsh: 0, leiden: 0 } },
    flockSize: STARTING_FLOCK,
    // The flock takes the tenancy already in wool (spec §6.7): the very first
    // action is a shear, not a wait for dawn.
    fleeceReady: STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY,
    cuttingHouse: null,
    dutchman: { unlocked: false, present: false, hold: {}, fleeceAppetite: 0 },
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
      declaredToDate: 0,
      grownToDate: 0,
      soldLawfully: 0,
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
    hawksmere: { provoked: false, raidsSurvived: 0, nextRaidTick: 0 },
    raid: null,
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
  const qty = Math.min(held, appetite);
  if (qty <= 0) return 0;
  cart.cargo[good] = held - qty;
  state.demandRemaining[good] = appetite - qty;
  state.coin += creditProceeds(state, qty * RYNE_PRICE[good]);
  if (good === 'fleece') {
    state.ledger.soldLawfully += qty; // lawful wool enters the books (§6.10)
  } else {
    accrueMarketTattle(state, good, qty);
  }
  return qty;
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

function garrisonWageBill(g: Garrison): number {
  return g.militia * MILITIA_WAGE + g.crew * CREW_WAGE;
}

/** The Trade fortification ladder, for the log (spec §6.12 / §22). Index = tier. */
const FORT_WORKS: readonly ((name: string) => string)[] = [
  () => '',
  (n) => `Dogs and a spiked hedge go up around ${n}.`,
  (n) => `${n} gets bolted doors, and men who will point a blunderbuss.`,
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
      const cut = CUTS[action.depth];
      // Cutting grows the store (a tub in, yield out): it must fit the walls
      // (§6.17). Each tub nets (yield − 1) beyond the jenever it consumes.
      const room = storeRoom(state, 'cutting-house');
      const maxByRoom = Math.floor(Math.max(0, room) / (cut.yield - 1));
      const tubs = Math.min(
        action.tubs,
        store.jenever ?? 0,
        Math.floor(state.coin / CUT_SUGAR_COST),
        maxByRoom,
      );
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
      store.jenever = (store.jenever ?? 0) - tubs;
      state.coin -= tubs * CUT_SUGAR_COST;
      addToStore(store, cut.brandy, tubs * cut.yield);
      state.stores['cutting-house'] = store;
      logEvent(
        state,
        `Cut ${tubs} tub${tubs === 1 ? '' : 's'} ${action.depth}: ${tubs * cut.yield} of ${cut.brandy} for the town.`,
      );
      return;
    }

    case 'smouch': {
      // §6.17 — the inbound twin of the cut: ash and sloe stretch the bohea to
      // twice the volume at a lower grade, feeding the cheap second market.
      if (!state.cuttingHouse) return;
      const store = state.stores['cutting-house'] ?? {};
      const room = storeRoom(state, 'cutting-house');
      const maxByRoom = Math.floor(Math.max(0, room) / (SMOUCH_YIELD - 1));
      const chests = Math.min(
        action.chests,
        store.tea ?? 0,
        Math.floor(state.coin / SMOUCH_COST),
        maxByRoom,
      );
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
      store.tea = (store.tea ?? 0) - chests;
      state.coin -= chests * SMOUCH_COST;
      addToStore(store, 'bulked-tea', chests * SMOUCH_YIELD);
      state.stores['cutting-house'] = store;
      logEvent(
        state,
        `Smouched ${chests} chest${chests === 1 ? '' : 's'}: ${chests * SMOUCH_YIELD} of bulked tea, ash and sloe and all.`,
      );
      return;
    }

    case 'buyCart': {
      if (state.carts.length >= MAX_CARTS) {
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
      if (state.carts.length <= 1) {
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
      cart.carter = { ...action.order };
      const route = `${nodeById(from, state.farm, state.cuttingHouse).name} to ${
        nodeById(to, state.farm, state.cuttingHouse).name
      }${action.order.back ? `, home with ${action.order.back}` : ''}`;
      logEvent(
        state,
        reorder
          ? `New orders for ${cart.name}: ${route}. The same man keeps the reins.`
          : `A carter takes ${cart.name}: ${route}, ${CARTER_WAGE} coin a day. He does not ask what is in the load.`,
      );
      return;
    }

    case 'dismissCarter': {
      const cart = findCart(state, action.cartId);
      if (!cart || !cart.carter) return;
      cart.carter = null;
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
      if (action.tree === 'marsh') {
        logEvent(state, 'No wight is bound. The marsh does not teach the unbound.');
        return;
      }
      if (action.tree === 'leiden') {
        logEvent(state, 'No philosopher under your roof. His kind arrive by sea, uninvited.');
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

    case 'resolveRaid': {
      resolveRaid(state, action.calls);
      return;
    }

    case 'setDeclaredYield': {
      const declared = Math.max(0, Math.min(state.flockSize, Math.round(action.fleecePerDay)));
      state.ledger.declaredYield = declared;
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
  const grown = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
  state.fleeceReady += grown;
  logEvent(state, `Dawn. The flock carries ${state.fleeceReady} fleece of wool.`);
  // Ryne wakes hungry (spec §6.9): yesterday's saturation is forgiven.
  state.demandRemaining = { ...DAILY_DEMAND };
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
  } else {
    logEvent(state, 'The bench clears: the work is done.');
  }
}

/** Spec §6.11 — wages at dawn, with the wool. Unpaid men walk the same morning. */
function payCartersAtDawn(state: GameState): void {
  if (!isDawn(state.tick)) return;
  for (const cart of state.carts) {
    if (!cart.carter) continue;
    if (state.coin >= CARTER_WAGE) {
      state.coin -= CARTER_WAGE;
    } else {
      cart.carter = null;
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
  const hop = firstHop(from, target, edgesFor(state.farm, state.cuttingHouse), (e) =>
    e.condition === 'tideLocked' && isFlooded(state.tick) ? Infinity : e.latency,
  );
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
      const qty = Math.min(available, room);
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
      // The back leg (§6.11, M5a-4), then home. What cannot be sold or
      // unloaded rides with him either way.
      carterBackload(state, cart, order);
      carterDispatch(state, cart, order.from);
      continue;
    }

    // Anywhere else: head for the work — deliveries first.
    carterDispatch(state, cart, (cart.cargo[order.good] ?? 0) > 0 ? order.to : order.from);
  }
}

/**
 * Spec §6.9 — the Dutchman stands off the shingle on night ∩ falling tide,
 * once the first rent has been felt. His hold and appetite restock on the
 * rising edge of his presence: each visit is its own market.
 */
function dutchmanTide(state: GameState): void {
  const here =
    state.dutchman.unlocked &&
    dayPhaseOf(state.tick) === 'night' &&
    !tideIsRising(state.tick);
  if (here && !state.dutchman.present) {
    state.dutchman.hold = { ...DUTCHMAN_HOLD };
    state.dutchman.fleeceAppetite = DUTCHMAN_FLEECE_DEMAND;
    logEvent(state, 'A lugger stands off the shingle. No lights, no flag, a falling tide.');
  } else if (!here && state.dutchman.present) {
    logEvent(state, 'The lugger slips out with the tide.');
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
    if (cart.location.progress >= edge.latency) {
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
  researchProgress(next);
  payCartersAtDawn(next);
  payGarrisonsAtDawn(next);
  recoverStandingAtDawn(next);
  markRentDue(next);
  if (isDawn(next.tick)) dawnRevenue(next);
  dutchmanTide(next);
  runCarters(next);
  moveCarts(next);
  accrueStorageHeat(next);
  officerTick(next);
  raidTick(next);

  return next;
}
