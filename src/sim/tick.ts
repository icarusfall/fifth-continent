// The simulation is a pure function: tick(state, actions) -> state.
// No side effects, no Date.now(), no Math.random(). All randomness comes
// from the seeded PRNG carried in state.rngState. (Spec §0 — the single
// most important architectural rule in the project.)

import {
  CART_CAPACITY,
  FLEECE_PER_HEAD_PER_DAY,
  MAX_LOG_EVENTS,
  RENT_AMOUNT,
  RENT_PERIOD_DAYS,
  SHEARING_HOUR,
  SHEEP_VALUE,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from './balance';
import { FARM_SITE, edgeById, nodeById, otherEnd } from './map';
import { seedRng } from './rng';
import { clockOf, isFlooded } from './time';
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
    stores: {
      farm: { fleece: 0 },
      ryne: {},
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
      logEvent(state, `Unloaded ${qty} ${action.good} at ${nodeById(nodeId, state.farm).name}.`);
      return;
    }

    case 'dispatchCart': {
      const cart = findCart(state, action.cartId);
      if (!cart) return;
      if (cart.location.kind !== 'node') {
        logEvent(state, `${cart.name} is already on the road.`);
        return;
      }
      const edge = edgeById(action.edgeId, state.farm);
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
      const node = nodeById(cart.location.nodeId, state.farm);
      if (node.kind !== 'market') {
        logEvent(state, `No buyer at ${node.name}.`);
        return;
      }
      const qty = cart.cargo[action.good] ?? 0;
      if (qty <= 0) return;
      const price = WOOL_PRICE_DOMESTIC;
      cart.cargo[action.good] = 0;
      state.coin += qty * price;
      logEvent(
        state,
        `Sold ${qty} ${action.good} at ${node.name} for ${qty * price} coin. The price is insulting.`,
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
  }
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
}

function moveCarts(state: GameState): void {
  for (const cart of state.carts) {
    if (cart.location.kind !== 'edge') continue;
    const edge = edgeById(cart.location.edgeId, state.farm);

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
      logEvent(state, `${cart.name} arrives at ${nodeById(arrived, state.farm).name}.`);
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
  moveCarts(next);

  return next;
}
