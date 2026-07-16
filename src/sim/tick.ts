// The simulation is a pure function: tick(state, actions) -> state.
// No side effects, no Date.now(), no Math.random(). All randomness comes
// from the seeded PRNG carried in state.rngState. (Spec §0 — the single
// most important architectural rule in the project.)

import {
  CART_CAPACITY,
  CART_COST,
  CARTER_WAGE,
  CUTS,
  FARM_STORE_CAPACITY,
  CREW_MUSTER,
  CREW_WAGE,
  CUTTING_HOUSE_COST,
  CUT_SUGAR_COST,
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
  accrueDitchHeat,
  accrueMarketTattle,
  accrueRouteHeat,
  accrueStorageHeat,
  dawnRevenue,
  officerTick,
} from './revenue';
import { seedRng } from './rng';
import { clockOf, dayPhaseOf, isFlooded, tideIsRising } from './time';
import type {
  Action,
  Cart,
  GameState,
  Garrison,
  GarrisonKind,
  Good,
  NodeId,
  Store,
} from './types';

export function initialState(seed: number): GameState {
  return {
    seed,
    tick: 0,
    rngState: seedRng(seed),
    coin: 0,
    farm: { ...FARM_SITE },
    // The tenancy runs from the first morning (spec §6.8).
    rentDueTick: RENT_PERIOD_DAYS * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR,
    rentPending: false,
    rentPaid: 0,
    lost: false,
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
      { tick: 0, text: `The agent notes your name. Rent is ${RENT_AMOUNT} coin, six days hence.` },
    ],
  };
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
  state.coin += qty * RYNE_PRICE[good];
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

/**
 * Spec §6.13 / §11 — the parish's regard falls when your people die. At zero
 * the country people give you up: a permanent informer, and the free hides of
 * the marsh close (§6.13 / revenue.ts coverOf). Survivable, not a loss.
 */
export function loseStanding(state: GameState, amount: number): void {
  if (amount <= 0) return;
  state.standing = Math.max(0, state.standing - amount);
  if (state.standing <= 0 && !state.informer) {
    state.informer = true;
    logEvent(
      state,
      'Someone talks. The country people close their doors — the free hides of the marsh are gone.',
    );
  }
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
      // Only the barn has walls (spec §6.9); other stores stay open ground for now.
      const room =
        nodeId === 'farm'
          ? FARM_STORE_CAPACITY - cargoCount(state.stores[nodeId] ?? {})
          : Number.MAX_SAFE_INTEGER;
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

    case 'sellToDutchman': {
      const cart = findCart(state, action.cartId);
      if (!cart || underOrders(state, cart)) return;
      if (cart.location.kind !== 'node' || cart.location.nodeId !== 'shingle') return;
      if (!state.dutchman.present) {
        logEvent(state, 'Shingle and sea-wrack. Nobody is buying wool from the water tonight.');
        return;
      }
      const held = cart.cargo.fleece ?? 0;
      const qty = Math.min(held, state.dutchman.fleeceAppetite);
      if (qty <= 0) return;
      const price = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
      cart.cargo.fleece = held - qty;
      state.dutchman.fleeceAppetite -= qty;
      state.coin += qty * price;
      logEvent(
        state,
        `${qty} fleece over the gunwale for ${qty * price} coin. Four times the Ryne price, and no questions.`,
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
      const tubs = Math.min(
        action.tubs,
        store.jenever ?? 0,
        Math.floor(state.coin / CUT_SUGAR_COST),
      );
      if (tubs <= 0) {
        logEvent(
          state,
          (store.jenever ?? 0) <= 0
            ? 'No tubs at the cutting house. The Dutchman sells them.'
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
      const ordinal = ['The Cart', 'The Second Cart', 'The Third Cart'][state.carts.length];
      state.carts.push({
        id: `cart-${state.carts.length + 1}`,
        name: ordinal,
        capacity: CART_CAPACITY,
        cargo: {},
        location: { kind: 'node', nodeId: 'farm' },
        carter: null,
      });
      logEvent(state, `${ordinal} stands in the yard, pony and all. ${CART_COST} coin.`);
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
      if (cart.carter) {
        logEvent(state, `${cart.name} already has a man on the reins.`);
        return;
      }
      const { from, to } = action.order;
      const nodesKnown = ['farm', 'ryne', 'shingle', ...(state.cuttingHouse ? ['cutting-house'] : [])];
      if (from === to || !nodesKnown.includes(from) || !nodesKnown.includes(to)) return;
      cart.carter = { ...action.order };
      logEvent(
        state,
        `A carter takes ${cart.name}: ${nodeById(from, state.farm, state.cuttingHouse).name} to ${
          nodeById(to, state.farm, state.cuttingHouse).name
        }, ${CARTER_WAGE} coin a day. He does not ask what is in the load.`,
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

function runCarters(state: GameState): void {
  for (const cart of state.carts) {
    const order = cart.carter;
    if (!order || cart.location.kind !== 'node') continue;
    const at = cart.location.nodeId;

    if (at === order.from) {
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
        const roomHere =
          at === 'farm'
            ? FARM_STORE_CAPACITY - cargoCount(state.stores[at] ?? {})
            : Number.MAX_SAFE_INTEGER;
        const qty = Math.min(held, Math.max(0, roomHere));
        if (qty > 0) {
          cart.cargo[order.good] = held - qty;
          state.stores[at] = state.stores[at] ?? {};
          addToStore(state.stores[at], order.good, qty);
        }
      }
      // What cannot be sold or unloaded rides home with him.
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
    logEvent(state, `Rent day. The agent is at the door, and he wants his ${RENT_AMOUNT} coin.`);
  }
}

/** Spec §6.8 — settle the pending rent: pay what the purse holds, distrain the rest. */
function payRent(state: GameState): void {
  if (!state.rentPending) return;

  const paid = Math.min(state.coin, RENT_AMOUNT);
  state.coin -= paid;
  state.rentPaid += paid;
  const shortfall = RENT_AMOUNT - paid;

  if (shortfall <= 0) {
    logEvent(state, `Rent paid: ${RENT_AMOUNT} coin. The agent tips his hat exactly one inch.`);
  } else {
    const seized = Math.min(state.flockSize, Math.ceil(shortfall / SHEEP_VALUE));
    state.flockSize -= seized;
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

  return next;
}
