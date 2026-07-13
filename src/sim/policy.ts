// A trivial scripted player for headless runs: load the cart at the farm,
// take the low road when the tide allows (else the high road), sell at Ryne,
// come home. Used by the 200-game distribution test (spec §13) and the
// `npm run headless` demo. This is a bot, not an AI — it exists so that
// balance can be smoke-tested without a browser.

import { CART_CAPACITY } from './balance';
import { isFlooded } from './time';
import { initialState, tick } from './tick';
import type { Action, GameState } from './types';

export function greedyCarterPolicy(state: GameState): Action[] {
  const cart = state.carts[0];
  const actions: Action[] = [];

  if (cart.location.kind !== 'node') return actions;

  if (cart.location.nodeId === 'farm') {
    const fleeceHeld = cart.cargo.fleece ?? 0;
    const fleeceAtFarm = state.stores.farm?.fleece ?? 0;
    if (fleeceHeld < CART_CAPACITY && fleeceAtFarm > 0) {
      actions.push({
        type: 'loadCart',
        cartId: cart.id,
        good: 'fleece',
        qty: CART_CAPACITY - fleeceHeld,
      });
    }
    if (fleeceHeld > 0 || fleeceAtFarm > 0) {
      actions.push({
        type: 'dispatchCart',
        cartId: cart.id,
        edgeId: isFlooded(state.tick) ? 'high-road' : 'low-road',
      });
    }
    return actions;
  }

  if (cart.location.nodeId === 'ryne') {
    if ((cart.cargo.fleece ?? 0) > 0) {
      actions.push({ type: 'sell', cartId: cart.id, good: 'fleece' });
    }
    actions.push({
      type: 'dispatchCart',
      cartId: cart.id,
      edgeId: isFlooded(state.tick) ? 'high-road' : 'low-road',
    });
    return actions;
  }

  return actions;
}

/** Run one policy-driven game for `ticks` ticks. */
export function runPolicyGame(seed: number, ticks: number): GameState {
  let state = initialState(seed);
  for (let t = 0; t < ticks; t++) {
    state = tick(state, greedyCarterPolicy(state));
  }
  return state;
}
