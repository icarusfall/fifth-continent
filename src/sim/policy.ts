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
  FARM_STORE_CAPACITY,
  FLOCK_CAP,
  LEIDEN_PRICE_MULT,
  PLAUSIBLE_YIELD_MIN,
  RENT_AMOUNT,
  SHEEP_PRICE_BUY,
  WOOL_PRICE_DOMESTIC,
} from './balance';
import { isFlooded } from './time';
import { initialState, tick } from './tick';
import type { Action, Cart, CarterOrder, GameState, Good } from './types';

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

/**
 * hubPolicy: §6.17 lived in miniature — the cutting house as a working hub,
 * on §6.16's designed trajectory (crime's proceeds grow the flock to the
 * pasture cap). Cart-1 owls with a tea backhaul dropped at the cutting house
 * (`backTo` — contraband never enters the wool barn); cart-3 runs the hub's
 * bulked tea to town, an order written before any bulked tea exists
 * (§6.17's products-haulable); the refiner smouches the leaf at dawn. The
 * arithmetic closes: one lugger-hold of tea (8) smouches to 16 — exactly
 * Ryne's daily appetite for the stretched leaf.
 *
 * Cart-2 is the lawful leg as §6.16 means it: an overflow valve. The owl
 * moves what the lugger's nights allow; the grown flock clips more than
 * that, and the surplus either goes to Ryne on the books or silts the barn.
 * The valve hires when the wool backs up and stands down when it drains,
 * so honest sales never cannibalize the gunwale's 4× price.
 */
export function hubPolicy(state: GameState): Action[] {
  return runHub(state, true);
}

/**
 * hubNoAlibiPolicy: the same hub with the lawful leg cut — no fleece ever
 * sold at Ryne once the crime begins. §18's claim, held to in the test:
 * the barn silts with unsold wool, the clip rots on the sheep's backs, the
 * books gape at every audit, and the hub earns *less* than the same crime
 * run behind an honest alibi.
 */
export function hubNoAlibiPolicy(state: GameState): Action[] {
  return runHub(state, false);
}

function runHub(state: GameState, alibi: boolean): Action[] {
  const actions: Action[] = [];
  const [first, second, third] = state.carts;
  if (!first) return actions;
  if (state.fleeceReady > 0) actions.push({ type: 'shear' });

  // The lawful life, until the first rent has been felt.
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

  // The night trade pays for the hub: the house when affordable, then the
  // wheels, then the flock toward the pasture cap (§6.16's loop) — rent
  // always in reserve.
  if (!state.cuttingHouse && state.coin >= CUTTING_HOUSE_COST + RENT_AMOUNT) {
    actions.push({ type: 'placeCuttingHouse', ...BOT_CUTTING_HOUSE_SITE });
  }
  const cartsWanted = alibi ? 3 : 2;
  if (state.cuttingHouse && state.carts.length < cartsWanted && state.coin >= CART_COST + RENT_AMOUNT) {
    actions.push({ type: 'buyCart' });
  } else if (
    state.cuttingHouse &&
    state.flockSize + state.sheepArriving < FLOCK_CAP &&
    state.coin >= SHEEP_PRICE_BUY + RENT_AMOUNT
  ) {
    actions.push({ type: 'buySheep', qty: 1 });
  }

  // Cart-1 owls from the first unlocked night. Once the house stands, the
  // same order grows the back leg (§6.17): fleece over the gunwale, home
  // with tea, the tea dropped where it will be smouched.
  const owl: CarterOrder = state.cuttingHouse
    ? { from: 'farm', to: 'shingle', good: 'fleece', back: 'tea', backTo: 'cutting-house' }
    : { from: 'farm', to: 'shingle', good: 'fleece' };
  if (!first.carter || first.carter.to !== owl.to || first.carter.backTo !== owl.backTo) {
    actions.push({ type: 'hireCarter', cartId: first.id, order: owl });
  }

  if (state.cuttingHouse) {
    // The refiner runs the house: every dawn the backhauled leaf is smouched.
    if (!state.refiner.hired) actions.push({ type: 'hireRefiner' });
    if (!state.refiner.smouch) {
      actions.push({ type: 'setRefinerOrders', cutDepth: 'standard', smouch: true });
    }
    // Cart-2 (alibi only): the lawful leg as an overflow valve — hired when
    // the wool backs up past what the gunwale can move, stood down when the
    // barn drains, so honest sales never undercut the owl's 4× price.
    const teaCart = alibi ? third : second;
    if (alibi && second) {
      // True surplus only: the barn brimming (wool already stuck on the
      // sheep's backs) hires him; a barn back down to one owl-load stands
      // him down. He skims the top and never strips the gunwale's stock.
      const woolBanked = state.stores.farm?.fleece ?? 0;
      if (!second.carter && woolBanked >= FARM_STORE_CAPACITY - CART_CAPACITY / 2) {
        actions.push({
          type: 'hireCarter',
          cartId: second.id,
          order: { from: 'farm', to: 'ryne', good: 'fleece' },
        });
      } else if (
        second.carter?.to === 'ryne' &&
        woolBanked <= CART_CAPACITY &&
        (second.cargo.fleece ?? 0) === 0
      ) {
        actions.push({ type: 'dismissCarter', cartId: second.id });
      }
    }
    // The hub's product to town — bulked tea into the cheap channel.
    if (teaCart && !teaCart.carter) {
      actions.push({
        type: 'hireCarter',
        cartId: teaCart.id,
        order: { from: 'cutting-house', to: 'ryne', good: 'bulked-tea' },
      });
    }
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
