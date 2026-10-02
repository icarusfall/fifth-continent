// Why a hired hand stands still (spec §20.4, D5 prep). A carter waiting at the
// round's first pick-up with nothing to pick up looks, from the stable, exactly
// like a broken order — the playtest rule is that a mechanic which stops must
// say why it stopped. Pure: read off the state, tested in Node.

import type { Cart, GameState } from '../sim/types';
import { GOOD_LABEL } from '../shared/format';

export function idleReason(state: GameState, cart: Cart): string | null {
  const order = cart.carter;
  if (!order || cart.location.kind !== 'node') return null;
  const here = cart.location.nodeId;
  const wool = (cart.cargo.fleece ?? 0) + (cart.cargo['dark-fleece'] ?? 0);
  if (here === 'shingle' && wool > 0 && !state.dutchman.present) return 'waits on the lugger';
  if (cart.marketPatienceUntil !== undefined) return 'waits on the town’s appetite, in plain view';
  const stop = order.stops[cart.stop ?? 0];
  if (!stop || stop.at !== here || stop.take === undefined) return null;
  if (here === 'shingle') {
    return state.dutchman.present ? null : `waits on the lugger for ${GOOD_LABEL[stop.take]}`;
  }
  const have = state.stores[here]?.[stop.take] ?? 0;
  if (have > 0) return null;
  const isWool = stop.take === 'fleece' || stop.take === 'dark-fleece';
  const onBacks = stop.take === 'fleece' ? state.fleeceReady : state.darkReady;
  if (isWool && here === 'farm' && onBacks > 0 && !state.shearer.hired) {
    return `waits on ${GOOD_LABEL[stop.take]} — the flock wants shearing`;
  }
  if (stop.take === 'dark-fleece' && state.ledger.books === 'square' && state.darkReady === 0) {
    return 'waits on dark fleece — the books are square, so none grows';
  }
  return `waits on ${GOOD_LABEL[stop.take]}`;
}
