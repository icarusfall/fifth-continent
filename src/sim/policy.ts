// Scripted players for headless runs. Used by the 200-game distribution
// tests (spec §13) and the `npm run headless` demo. These are bots, not AIs —
// they exist so that balance can be smoke-tested without a browser.
//
// greedyCarterPolicy: the lawful life. Shear at dawn, cart wool to Ryne,
// take the low road when the tide allows, come home. (M1)
//
// smugglerPolicy: the Dutchman's argument, taken. Lawful until the first
// rent unlocks the lugger, then wool goes over the gunwale at night, tubs
// come back, a cutting house goes up, and Ryne drinks "brandy". (M2)

import {
  CART_CAPACITY,
  CART_COST,
  CUTTING_HOUSE_COST,
  DUTCHMAN_PRICE,
  LEIDEN_PRICE_MULT,
  PLAUSIBLE_YIELD_MIN,
  RENT_AMOUNT,
  WOOL_PRICE_DOMESTIC,
} from './balance';
import { isFlooded } from './time';
import { initialState, tick } from './tick';
import type { Action, Cart, GameState, Good } from './types';

export function greedyCarterPolicy(state: GameState): Action[] {
  const actions: Action[] = [];

  const cart = state.carts[0];
  if (!cart || cart.location.kind !== 'node') return actions;

  if (cart.location.nodeId === 'farm') {
    if (state.fleeceReady > 0) {
      actions.push({ type: 'shear' });
    }
    const fleeceHeld = cart.cargo.fleece ?? 0;
    const fleeceAtFarm = (state.stores.farm?.fleece ?? 0) + state.fleeceReady;
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

// Where the smuggler bot raises its cutting house: open marsh, mid-triangle.
export const BOT_CUTTING_HOUSE_SITE = { x: 24, y: 12 };

// Bot heuristics, not balance: buy tubs a little ahead of the town's thirst,
// never so far ahead that coin drowns in inventory the demand cap won't clear.
const BOT_TUBS_PER_VISIT = 2;
const BOT_BRANDY_STOCK_CAP = 18; // three days of Fair appetite

const SELLABLE: Good[] = ['brandy-gent', 'brandy-fair', 'brandy-rough', 'tea', 'lace'];

function roadHome(state: GameState): Action {
  return {
    type: 'dispatchCart',
    cartId: state.carts[0].id,
    edgeId: isFlooded(state.tick) ? 'high-road' : 'low-road',
  };
}

function cargoOf(cart: Cart, good: Good): number {
  return cart.cargo[good] ?? 0;
}

export function smugglerPolicy(state: GameState): Action[] {
  // The lawful life, until the first rent has been felt.
  if (!state.dutchman.unlocked) return greedyCarterPolicy(state);

  const actions: Action[] = [];
  const cart = state.carts[0];
  if (!cart || cart.location.kind !== 'node') return actions;
  const at = cart.location.nodeId;

  if (at === 'farm') {
    if (state.fleeceReady > 0) actions.push({ type: 'shear' });
    // Short the books to the plausible floor: the surplus clip stops existing
    // on paper the day the lugger starts buying it (§6.10).
    const floor = Math.floor(state.flockSize * PLAUSIBLE_YIELD_MIN);
    if (state.ledger.declaredYield > floor) {
      actions.push({ type: 'setDeclaredYield', fleecePerDay: floor });
    }
    // Raise the cutting house once there is coin beyond the rent reserve.
    if (!state.cuttingHouse && state.coin >= CUTTING_HOUSE_COST + RENT_AMOUNT) {
      actions.push({ type: 'placeCuttingHouse', ...BOT_CUTTING_HOUSE_SITE });
    }
    if (cargoOf(cart, 'jenever') > 0 && state.cuttingHouse) {
      actions.push({ type: 'dispatchCart', cartId: cart.id, edgeId: 'cut-farm-track' });
      return actions;
    }
    if (state.dutchman.present) {
      // Load up and run for the shingle while the lugger stands off.
      actions.push({ type: 'loadCart', cartId: cart.id, good: 'fleece', qty: CART_CAPACITY });
      actions.push({ type: 'dispatchCart', cartId: cart.id, edgeId: 'marsh-track' });
      return actions;
    }
    // Unsold town goods ride back in when the town is hungry again.
    if (SELLABLE.some((g) => cargoOf(cart, g) > 0 && (state.demandRemaining[g] ?? 0) > 0)) {
      actions.push(roadHome(state));
      return actions;
    }
    // Keep the lawful trade visible: declared wool must go somewhere the
    // officer can see it, and the barn must not silt up (§6.9, §6.10).
    if (
      (state.stores.farm?.fleece ?? 0) >= CART_CAPACITY &&
      (state.demandRemaining.fleece ?? 0) > 0
    ) {
      actions.push({ type: 'loadCart', cartId: cart.id, good: 'fleece', qty: CART_CAPACITY });
      actions.push(roadHome(state));
    }
    return actions;
  }

  if (at === 'shingle') {
    if (state.dutchman.present) {
      const fleeceSale =
        Math.min(cargoOf(cart, 'fleece'), state.dutchman.fleeceAppetite) *
        (WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
      if (fleeceSale > 0) {
        actions.push({ type: 'sellToDutchman', cartId: cart.id });
      }
      // Tubs with whatever the night leaves over the rent reserve — but only
      // once there is a cutting house to take them (a tub with nowhere to go
      // wedges the cart), and never past the brandy the town can drink.
      const tubsAffordable = Math.floor(
        Math.max(0, state.coin + fleeceSale - RENT_AMOUNT) / DUTCHMAN_PRICE.jenever!,
      );
      const brandyBanked =
        (state.stores['cutting-house']?.['brandy-fair'] ?? 0) + cargoOf(cart, 'brandy-fair');
      const tubs = Math.min(tubsAffordable, BOT_TUBS_PER_VISIT);
      if (state.cuttingHouse && tubs > 0 && brandyBanked < BOT_BRANDY_STOCK_CAP) {
        actions.push({ type: 'buyFromDutchman', cartId: cart.id, good: 'jenever', qty: tubs });
      }
    }
    actions.push({
      type: 'dispatchCart',
      cartId: cart.id,
      edgeId: state.cuttingHouse ? 'cut-shingle-track' : 'marsh-track',
    });
    return actions;
  }

  if (at === 'cutting-house') {
    // One tick of industry: tubs off, cut standard, brandy on, off to town.
    if (cargoOf(cart, 'jenever') > 0) {
      actions.push({ type: 'unloadCart', cartId: cart.id, good: 'jenever', qty: 99 });
    }
    actions.push({ type: 'cut', depth: 'standard', tubs: 99 });
    actions.push({ type: 'loadCart', cartId: cart.id, good: 'brandy-fair', qty: 99 });
    const willCarry =
      cargoOf(cart, 'brandy-fair') > 0 || (state.stores['cutting-house']?.jenever ?? 0) > 0 ||
      cargoOf(cart, 'jenever') > 0;
    actions.push({
      type: 'dispatchCart',
      cartId: cart.id,
      edgeId: willCarry ? 'cut-ryne-track' : 'cut-farm-track',
    });
    return actions;
  }

  if (at === 'ryne') {
    for (const good of SELLABLE) {
      if (cargoOf(cart, good) > 0) actions.push({ type: 'sell', cartId: cart.id, good });
    }
    if (cargoOf(cart, 'fleece') > 0) {
      actions.push({ type: 'sell', cartId: cart.id, good: 'fleece' });
    }
    actions.push(roadHome(state));
    return actions;
  }

  return actions;
}

/**
 * delegatorPolicy: §6.11 lived in miniature. The owner shears and keeps no
 * secrets; a hired carter runs the wool to Ryne on a standing order. If the
 * man walks off over wages, another is hired — the bot tests the machinery,
 * not the labour market.
 */
export function delegatorPolicy(state: GameState): Action[] {
  const actions: Action[] = [];
  const cart = state.carts[0];
  if (!cart) return actions;
  if (!cart.carter) {
    actions.push({
      type: 'hireCarter',
      cartId: cart.id,
      order: { from: 'farm', to: 'ryne', good: 'fleece' },
    });
  }
  if (state.fleeceReady > 0) actions.push({ type: 'shear' });
  return actions;
}

/**
 * relayPolicy: the backhaul lived in miniature (§6.11, M5a-4). Lawful
 * delegation until the first rent unlocks the lugger; then the standing
 * order flips to the shingle with a tea backhaul. While the yard holds one
 * cart, its man alternates jobs — owl, then flush the tea to Ryne when a
 * cart-load has banked. Once crime's proceeds clear the rent reserve a
 * second cart is bought and hired onto the tea run, and the first stays on
 * the beach for good: the relay meets at the barn, exactly as designed.
 */
export function relayPolicy(state: GameState): Action[] {
  const actions: Action[] = [];
  const [first, second, third] = state.carts;
  if (!first) return actions;
  if (state.fleeceReady > 0) actions.push({ type: 'shear' });

  if (!state.dutchman.unlocked) {
    if (!first.carter) {
      actions.push({
        type: 'hireCarter',
        cartId: first.id,
        order: { from: 'farm', to: 'ryne', good: 'fleece' },
      });
    }
    return actions;
  }

  // The owling begins: the books drop to the plausible floor (§6.10).
  const floor = Math.floor(state.flockSize * PLAUSIBLE_YIELD_MIN);
  if (state.ledger.declaredYield > floor) {
    actions.push({ type: 'setDeclaredYield', fleecePerDay: floor });
  }

  // Crime's proceeds buy the wheels, always keeping the rent in reserve.
  if (state.carts.length < 3 && state.coin >= CART_COST + RENT_AMOUNT) {
    actions.push({ type: 'buyCart' });
  }
  // Cart-2: the lawful alibi — the surplus clip to Ryne keeps the barn
  // draining and the books fed (without it the tea can never land: the
  // 4-fleece/day surplus silts the barn shut).
  if (second && !second.carter) {
    actions.push({
      type: 'hireCarter',
      cartId: second.id,
      order: { from: 'farm', to: 'ryne', good: 'fleece' },
    });
  }
  // Cart-3: the tea run, once the yard is full.
  if (third && !third.carter) {
    actions.push({
      type: 'hireCarter',
      cartId: third.id,
      order: { from: 'farm', to: 'ryne', good: 'tea' },
    });
  }

  // Cart-1's job: owl with a tea backhaul — flushing its own tea to Ryne
  // whenever a cart-load has gathered (banked or still aboard) and no
  // dedicated tea cart exists yet.
  const teaBanked = (state.stores.farm?.tea ?? 0) + (first.cargo.tea ?? 0);
  const wantFlush = !third && teaBanked >= CART_CAPACITY;
  const onFlush = first.carter?.to === 'ryne' && first.carter.good === 'tea';
  const onOwl = first.carter?.to === 'shingle';
  if (wantFlush ? !onFlush : !onOwl) {
    if (first.carter) actions.push({ type: 'dismissCarter', cartId: first.id });
    actions.push({
      type: 'hireCarter',
      cartId: first.id,
      order: wantFlush
        ? { from: 'farm', to: 'ryne', good: 'tea' }
        : { from: 'farm', to: 'shingle', good: 'fleece', back: 'tea' },
    });
  }
  return actions;
}

/** Run one policy-driven game for `ticks` ticks. */
export function runPolicyGame(
  seed: number,
  ticks: number,
  policy: (state: GameState) => Action[] = greedyCarterPolicy,
): GameState {
  let state = initialState(seed);
  for (let t = 0; t < ticks; t++) {
    const actions = policy(state);
    // The bots always meet the agent at the door (§6.8): the event card that
    // makes a human pause is a UI thing; headless, rent is paid the moment due.
    if (state.rentPending) actions.unshift({ type: 'payRent' });
    // And they see a raid through the moment it lands (§6.13) — no player Calls.
    if (state.raid?.pendingBattle) actions.unshift({ type: 'resolveRaid' });
    state = tick(state, actions);
  }
  return state;
}
