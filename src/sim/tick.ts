// The simulation is a pure function: tick(state, actions) -> state.
// No side effects, no Date.now(), no Math.random(). All randomness comes
// from the seeded PRNG carried in state.rngState. (Spec §0 — the single
// most important architectural rule in the project.)

import {
  CART_CAPACITY,
  CUTS,
  CUTTING_HOUSE_COST,
  CUT_SUGAR_COST,
  DAILY_DEMAND,
  DUTCHMAN_FLEECE_DEMAND,
  DUTCHMAN_HOLD,
  DUTCHMAN_PRICE,
  FLEECE_PER_HEAD_PER_DAY,
  LEIDEN_PRICE_MULT,
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
import { FARM_SITE, edgeById, isPlaceable, nodeById, otherEnd } from './map';
import { seedRng } from './rng';
import { clockOf, dayPhaseOf, isFlooded, tideIsRising } from './time';
import type { Action, Cart, GameState, Store } from './types';

export function initialState(seed: number): GameState {
  return {
    seed,
    tick: 0,
    rngState: seedRng(seed),
    coin: 0,
    farm: { ...FARM_SITE },
    // The tenancy runs from the first morning (spec §6.8).
    rentDueTick: RENT_PERIOD_DAYS * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR,
    rentPaid: 0,
    lost: false,
    flockSize: STARTING_FLOCK,
    fleeceReady: 0,
    cuttingHouse: null,
    dutchman: { unlocked: false, present: false, hold: {}, fleeceAppetite: 0 },
    demandRemaining: { ...DAILY_DEMAND },
    stores: {
      farm: { fleece: 0 },
      ryne: {},
      shingle: {},
    },
    carts: [
      {
        id: 'cart-1',
        name: 'The Cart',
        capacity: CART_CAPACITY,
        cargo: {},
        location: { kind: 'node', nodeId: 'farm' },
      },
    ],
    log: [
      { tick: 0, text: 'Walland Farm. Twelve sheep, one cart, and a price in Ryne.' },
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
      const qty = state.fleeceReady;
      state.fleeceReady = 0;
      state.stores.farm = state.stores.farm ?? {};
      addToStore(state.stores.farm, 'fleece', qty);
      logEvent(state, `Sheared ${qty} fleece into the farm store.`);
      return;
    }

    case 'loadCart': {
      const cart = findCart(state, action.cartId);
      if (!cart) return;
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
      if (!cart) return;
      if (cart.location.kind !== 'node') {
        logEvent(state, `${cart.name} cannot be unloaded on the road.`);
        return;
      }
      const held = cart.cargo[action.good] ?? 0;
      const qty = Math.min(action.qty, held);
      if (qty <= 0) return;
      cart.cargo[action.good] = held - qty;
      const nodeId = cart.location.nodeId;
      state.stores[nodeId] = state.stores[nodeId] ?? {};
      addToStore(state.stores[nodeId], action.good, qty);
      logEvent(
        state,
        `Unloaded ${qty} ${action.good} at ${nodeById(nodeId, state.farm, state.cuttingHouse).name}.`,
      );
      return;
    }

    case 'dispatchCart': {
      const cart = findCart(state, action.cartId);
      if (!cart) return;
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
      if (!cart) return;
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
      const appetite = state.demandRemaining[action.good] ?? 0;
      if (appetite <= 0) {
        logEvent(state, `Ryne has had its fill of ${action.good} today. Dawn brings appetite.`);
        return;
      }
      const qty = Math.min(held, appetite);
      const price = RYNE_PRICE[action.good];
      cart.cargo[action.good] = held - qty;
      state.demandRemaining[action.good] = appetite - qty;
      state.coin += qty * price;
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
      if (!cart) return;
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
      if (!cart) return;
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
  }
}

// ---- Per-tick processes ----

function growWoolAtDawn(state: GameState): void {
  const { hour, minute } = clockOf(state.tick);
  if (hour === SHEARING_HOUR && minute === 0) {
    const grown = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
    state.fleeceReady += grown;
    logEvent(state, `Dawn. The flock carries ${state.fleeceReady} fleece of wool.`);
    // Ryne wakes hungry (spec §6.9): yesterday's saturation is forgiven.
    state.demandRemaining = { ...DAILY_DEMAND };
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

/** Spec §6.8 — the agent calls at dawn. Pays what it can; distrains the rest. */
function collectRent(state: GameState): void {
  if (state.tick !== state.rentDueTick) return;

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
      logEvent(state, 'The tenancy is forfeit. The Gault keeps no one who cannot pay.');
      return;
    }
  }
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
  collectRent(next);
  dutchmanTide(next);
  moveCarts(next);

  return next;
}
