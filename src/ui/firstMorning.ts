// The first morning (§10 — the tutorial is the story). A brand-new tenancy
// gives no orders and opens no popups: it POINTS. Until the first coin rings,
// the ticker carries one sentence naming the next thing the marsh expects,
// and tapping it eases the camera there. The thread is derived from the
// world every frame — it advances however the player actually plays, and it
// vanishes for good the moment the first sale lands. Pure UI: no GameState,
// no save, and a returning game never sees it.

import type { GameState } from '../sim/types';

/** Where a hint points: a place the map knows, or a cart on the road. */
export type HintTarget = 'farm' | 'ryne' | `cart:${string}`;

export interface FirstMorningHint {
  text: string;
  sel: HintTarget;
}

/** A tenancy with nothing earned and nothing moved — the glow's condition. */
export function isFreshGame(state: GameState): boolean {
  const cart = state.carts[0];
  return (
    state.coin === 0 &&
    state.rentPaid === 0 &&
    (state.stores.farm?.fleece ?? 0) === 0 &&
    (cart?.cargo.fleece ?? 0) === 0 &&
    cart?.location.kind === 'node'
  );
}

/**
 * The thread: one pointing sentence, or null once the world has taught the
 * round. Every phase is read off the state, so shearing from the menu,
 * loading by hand, or ignoring the thread entirely all advance it.
 */
export function firstMorningHint(state: GameState): FirstMorningHint | null {
  // The thread runs only before the first sale of the first round: no coin,
  // no rent paid, nothing ever sold. Any progressed game fails this gate.
  if (state.coin > 0 || state.rentPaid > 0 || state.ledger.soldLawfully > 0) return null;
  if (state.lost) return null;
  const cart = state.carts[0];
  if (!cart) return null;
  const aboard = cart.cargo.fleece ?? 0;
  const inBarn = state.stores.farm?.fleece ?? 0;

  if (cart.location.kind === 'edge') {
    return aboard > 0
      ? { text: 'The cart is on the road for Ryne. The tide minds its own hours.', sel: `cart:${cart.id}` }
      : { text: 'The cart rolls home, empty and honest.', sel: `cart:${cart.id}` };
  }

  const at = cart.location.nodeId;
  if (at === 'ryne' && aboard > 0) {
    return { text: 'The stalls are open. Sell the clip.', sel: 'ryne' };
  }
  if (at === 'farm' && aboard > 0) {
    return { text: 'Ryne pays coin for wool. Send the cart.', sel: 'farm' };
  }
  if (at === 'farm' && inBarn > 0) {
    return { text: 'The clip is in the barn. The cart in the yard will carry it.', sel: 'farm' };
  }
  if (state.fleeceReady > 0) {
    return {
      text: `${state.flockSize} sheep stand heavy with wool. Begin at Walland Farm.`,
      sel: 'farm',
    };
  }
  return null;
}
