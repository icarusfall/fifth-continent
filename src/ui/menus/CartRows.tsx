// The carts (stage 2): manual load/road verbs, every cart’s row at a node,

// the round picker (§6.19), and the on-the-road cart menu. Moved verbatim.



import { GOOD_LABEL, spanOf, storeSummary } from '../format';
import { CARTER_DANGER_WAGE, CARTER_MAX_STOPS, CARTER_UNLOCK_FLEECE, CARTER_WAGE, CART_CAPACITY, CART_RESALE, DUTCHMAN_PRICE, DUTCHMAN_TRUST_JENEVER, DUTCHMAN_TRUST_TEA, FARM_STORE_CAPACITY, FENCE_PRICE_MULT, LEIDEN_PRICE_MULT, RYNE_PRICE, TUB_TIDE_MIN, WOOL_PRICE_DOMESTIC } from '../../sim/balance';
import { dykeWaterways } from '../../sim/dykes';
import { edgesFor, nodeById } from '../../sim/map';
import { CONTRABAND } from '../../sim/revenue';
import { carterWageOf, reachableNodesFor } from '../../sim/tick';
import { isFlooded, ticksUntilTideTurn, tideLevel } from '../../sim/time';
import type { Action, Cart, CarterStop, EdgeId, GameState, Good, NodeId } from '../../sim/types';
import { CloseCtx, GOOD_WHISPER, backOptionsFor, cargoCount, cartWhereabouts, coatNote, lanternNote, orderLabel, shingleRoutesOpen, undirectedCartsAt, useEnqueue, useSendCart } from './shared';
import { useContext, useState } from 'react';
import type { ReactNode } from 'react';
/**
 * §20 — a present cart's cargo business at the node it stands on: loading and
 * unloading, selling in Ryne, trading with the Dutchman, cutting-house work.
 * Rendered per cart in its own row, so every cart is directed on its own terms
 * (not just the first one the old single-cart menu happened to pick).
 */
export function cargoButtons(
  nodeId: NodeId,
  state: GameState,
  cart: Cart,
  enqueue: (a: Action) => void,
): ReactNode[] {
  const btns: ReactNode[] = [];
  const held = cargoCount(cart.cargo);
  const cargoEntries = Object.entries(cart.cargo) as Array<[Good, number]>;
  switch (nodeId) {
    case 'farm': {
      const barn = state.stores.farm ?? {};
      const barnRoom = FARM_STORE_CAPACITY - cargoCount(barn);
      if (held < CART_CAPACITY) {
        for (const [good, n] of Object.entries(barn) as Array<[Good, number]>) {
          if (n <= 0) continue;
          btns.push(
            <button
              key={`load-${good}`}
              onClick={() => enqueue({ type: 'loadCart', cartId: cart.id, good, qty: CART_CAPACITY })}
            >
              Load {cart.name.toLowerCase()} with {GOOD_LABEL[good]}
            </button>,
          );
        }
      }
      for (const [good, n] of cargoEntries) {
        if (n <= 0) continue;
        const can = Math.min(n, barnRoom);
        btns.push(
          <button
            key={`unload-${good}`}
            disabled={can <= 0}
            title={can <= 0 ? 'The barn is full to the rafters.' : undefined}
            onClick={() => enqueue({ type: 'unloadCart', cartId: cart.id, good, qty: 99 })}
          >
            {can > 0
              ? `Unload ${can} ${GOOD_LABEL[good]} into the barn`
              : `${GOOD_LABEL[good]} · the barn is full`}
          </button>,
        );
      }
      break;
    }
    case 'ryne': {
      for (const [good, n] of cargoEntries) {
        if (n <= 0 || good === 'jenever') continue;
        const appetite = state.demandRemaining[good] ?? 0;
        const q = Math.min(n, appetite);
        btns.push(
          <button
            key={`sell-${good}`}
            disabled={q <= 0}
            title={q <= 0 ? 'The town has had its fill today. Dawn brings appetite.' : undefined}
            onClick={() => enqueue({ type: 'sell', cartId: cart.id, good })}
          >
            {q > 0
              ? `Sell ${q} ${GOOD_LABEL[good]} · ${q * RYNE_PRICE[good]} coin` +
                (q < n ? ' · all the town will take' : '')
              : `${GOOD_LABEL[good]} · Ryne is sated until dawn`}
          </button>,
        );
        // §6.17 — the fence: dump the whole load at a haircut, uncapped, so a
        // laden cart need not sit in town waiting for the officer.
        if (CONTRABAND.includes(good) && RYNE_PRICE[good] > 0) {
          const fencePrice = Math.round(RYNE_PRICE[good] * FENCE_PRICE_MULT);
          btns.push(
            <button
              key={`fence-${good}`}
              title="The fence takes the whole load at once — no waiting, no appetite to fill — but pays a fraction of the stall price."
              onClick={() => enqueue({ type: 'sellToFence', cartId: cart.id, good })}
            >
              Fence {n} {GOOD_LABEL[good]} · {n * fencePrice} coin
            </button>,
          );
        }
      }
      break;
    }
    case 'shingle': {
      const d = state.dutchman;
      if (!d.present) break;
      const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
      const fleeceSale = Math.min(cart.cargo.fleece ?? 0, d.fleeceAppetite);
      if (fleeceSale > 0) {
        btns.push(
          <button
            key="sell-dutchman"
            onClick={() => enqueue({ type: 'sellToDutchman', cartId: cart.id })}
          >
            Sell {fleeceSale} fleece · {fleeceSale * beachPrice} coin
          </button>,
        );
      }
      const room = cart.capacity - held;
      for (const good of ['jenever', 'tea', 'lace'] as Good[]) {
        const stock = d.hold[good] ?? 0;
        if (stock <= 0) continue;
        const price = DUTCHMAN_PRICE[good]!;
        const can = Math.min(stock, room, Math.floor(state.coin / price));
        btns.push(
          <button
            key={`buy-${good}`}
            disabled={can <= 0}
            title={
              can <= 0
                ? 'No room in the cart, or no coin. He does not give credit.'
                : GOOD_WHISPER[good]
            }
            onClick={() => enqueue({ type: 'buyFromDutchman', cartId: cart.id, good, qty: 99 })}
          >
            {can > 0
              ? `Buy ${can} ${GOOD_LABEL[good]} · ${can * price} coin`
              : `${GOOD_LABEL[good]} · ${price} coin each`}{' '}
            · {stock} aboard
          </button>,
        );
      }
      break;
    }
    case 'cutting-house': {
      const store = state.stores['cutting-house'] ?? {};
      if ((cart.cargo.jenever ?? 0) > 0) {
        btns.push(
          <button
            key="unload-jenever"
            onClick={() => enqueue({ type: 'unloadCart', cartId: cart.id, good: 'jenever', qty: 99 })}
          >
            Unload {cart.cargo.jenever} tubs into the house
          </button>,
        );
      }
      for (const good of ['brandy-gent', 'brandy-fair', 'brandy-rough'] as Good[]) {
        if ((store[good] ?? 0) <= 0) continue;
        btns.push(
          <button
            key={`load-${good}`}
            onClick={() => enqueue({ type: 'loadCart', cartId: cart.id, good, qty: 99 })}
          >
            Load {GOOD_LABEL[good]} ({store[good]})
          </button>,
        );
      }
      break;
    }
  }
  return btns;
}


/**
 * §20 — where a present cart can be sent from the node it stands on, with the
 * same tide and blue-coat notes the old node menus carried. One row per cart.
 */
export function roadButtons(
  nodeId: NodeId,
  state: GameState,
  cart: Cart,
  send: (cartId: string, edgeId: EdgeId) => void,
  flooded: boolean,
): ReactNode[] {
  const btns: ReactNode[] = [];
  const name = cart.name.toLowerCase();
  const held = cargoCount(cart.cargo);
  const tideSpan = spanOf(ticksUntilTideTurn(state.tick));
  // §6.14 (M5c) — the lighter answers only the sea lane: its buttons are its
  // own, and no cart is ever offered the water.
  if (cart.vessel === 'sea') {
    if (nodeId === 'shingle') {
      btns.push(
        <button
          key="sea"
          title="Steam minds neither tide nor night. Every ear on the coast minds the steam."
          onClick={() => send(cart.id, 'sea-lane')}
        >
          Steam for Ryne&rsquo;s quay · the sea lane
        </button>,
      );
    } else if (nodeId === 'ryne') {
      btns.push(
        <button
          key="sea"
          title="Steam minds neither tide nor night. Every ear on the coast minds the steam."
          onClick={() => send(cart.id, 'sea-lane')}
        >
          Steam for the shingle · the sea lane
        </button>,
      );
    }
    return btns;
  }
  // §6.18 (M5½b) — the tub-boat answers the waterways from this landing.
  if (cart.vessel === 'dyke') {
    for (const w of dykeWaterways(state)) {
      if (w.a !== nodeId && w.b !== nodeId) continue;
      const farEnd = w.a === nodeId ? w.b : w.a;
      const lowWater = tideLevel(state.tick) < TUB_TIDE_MIN;
      btns.push(
        <button
          key={w.id}
          disabled={lowWater}
          title={
            lowWater
              ? 'The channel wants more tide under the keel. It will come.'
              : 'Quiet as weed, and nobody counts what moves under the banks.'
          }
          onClick={() => send(cart.id, w.id)}
        >
          Pole {name} down {w.name.toLowerCase()} — to{' '}
          {nodeById(farEnd, state.farm, state.cuttingHouse).name}
          {lowWater ? ' · waits on the tide' : ''}
        </button>,
      );
    }
    return btns;
  }
  switch (nodeId) {
    case 'farm': {
      if (held > 0) {
        // Playtest (first morning): the default sits on top, and it names
        // where it goes. The high road is slow but never drowns — the send
        // least likely to strand a beginner; the tide's gamble sits second.
        btns.push(
          <button
            key="high"
            title="Slow, dry, and past the Customs House. The tide never has it."
            onClick={() => send(cart.id, 'high-road')}
          >
            Send {name} to Ryne · the high road, slow and sure
            {coatNote(state, 'high-road', 'farm')}
          </button>,
          <button
            key="low"
            disabled={flooded}
            title={
              flooded
                ? `Under the tide. Clears in ${tideSpan}.`
                : `Short and flat. Floods in ${tideSpan}.`
            }
            onClick={() => send(cart.id, 'low-road')}
          >
            Send {name} to Ryne · the low road,{' '}
            {flooded ? `drowned — clears in ${tideSpan}` : `fast — floods in ${tideSpan}`}
          </button>,
        );
      }
      if (state.dutchman.unlocked) {
        btns.push(
          <button
            key="marsh"
            title="Across the open marsh to the sea. Nobody counts what crosses it."
            onClick={() => send(cart.id, 'marsh-track')}
          >
            Send {name} over the marsh to the shingle{coatNote(state, 'marsh-track', 'farm')}
            {lanternNote(state, 'marsh-track')}
          </button>,
        );
      }
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-farm-track')}>
            Send {name} to the cutting house{coatNote(state, 'cut-farm-track', 'farm')}
            {lanternNote(state, 'cut-farm-track')}
          </button>,
        );
      }
      break;
    }
    case 'ryne': {
      btns.push(
        <button key="high" onClick={() => send(cart.id, 'high-road')}>
          Home to the farm · the high road, slow and sure
          {coatNote(state, 'high-road', 'ryne')}
        </button>,
        <button
          key="low"
          disabled={flooded}
          title={flooded ? 'Under the tide. It will fall.' : undefined}
          onClick={() => send(cart.id, 'low-road')}
        >
          Home to the farm · the low road, {flooded ? 'drowned' : 'fast'}
        </button>,
      );
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-ryne-track')}>
            Out to the cutting house{coatNote(state, 'cut-ryne-track', 'ryne')}
            {lanternNote(state, 'cut-ryne-track')}
          </button>,
        );
      }
      break;
    }
    case 'shingle': {
      btns.push(
        <button key="marsh" onClick={() => send(cart.id, 'marsh-track')}>
          Home over the marsh{coatNote(state, 'marsh-track', 'shingle')}
          {lanternNote(state, 'marsh-track')}
        </button>,
      );
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-shingle-track')}>
            To the cutting house{coatNote(state, 'cut-shingle-track', 'shingle')}
            {lanternNote(state, 'cut-shingle-track')}
          </button>,
        );
      }
      break;
    }
    case 'cutting-house': {
      btns.push(
        <button key="ryne" onClick={() => send(cart.id, 'cut-ryne-track')}>
          Send to Ryne{coatNote(state, 'cut-ryne-track', 'cutting-house')}
          {lanternNote(state, 'cut-ryne-track')}
        </button>,
        <button key="farm" onClick={() => send(cart.id, 'cut-farm-track')}>
          Send home to the farm{coatNote(state, 'cut-farm-track', 'cutting-house')}
          {lanternNote(state, 'cut-farm-track')}
        </button>,
        <button key="shingle" onClick={() => send(cart.id, 'cut-shingle-track')}>
          Send to the shingle{coatNote(state, 'cut-shingle-track', 'cutting-house')}
          {lanternNote(state, 'cut-shingle-track')}
        </button>,
      );
      break;
    }
  }
  return btns;
}


export function CartsAtNode({
  state,
  nodeId,
  stable = false }: {
  state: GameState;
  nodeId: NodeId;
  /** The farm is the yard: list every cart, wherever its wheels are. */
  stable?: boolean;
}) {
  const enqueue = useEnqueue();
  const send = useSendCart(state, nodeId);
  const close = useContext(CloseCtx);
  const flooded = isFlooded(state.tick);
  // The order picker walks a sentence (§6.11): origin → good → destination →
  // back leg → its drop node (§6.17). `from` is the node the order loads at —
  // the menu's node for a fresh hire (switchable: the origin pick), or the
  // carter's existing base when re-ordering a man already on the reins.
  const [hiring, setHiring] = useState<{
    cartId: string;
    /** The stops answered so far. */
    stops: CarterStop[];
    /** A stop chosen but not yet answered ("and what does he pick up there?"). */
    where?: NodeId;
    /** The stop whose load cap is being asked about (§6.11's wool-split lever). */
    capFor?: number;
  } | null>(null);
  const carts = stable
    ? state.carts
    : state.carts.filter((c) => c.location.kind === 'node' && c.location.nodeId === nodeId);
  if (carts.length === 0) return null;

  const hire = (cartId: string, stops: CarterStop[]) => {
    enqueue({ type: 'hireCarter', cartId, order: { stops } });
    setHiring(null);
    // A directed cart is dealt with: if that was the last undirected one, the
    // visit is over (§20). Re-orders never empty the yard (the cart was
    // already crewed), so they leave the menu open.
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };

  /** Add the stop just answered. The first load asks its cap (the wool-split
   *  lever, §6.11); later stops take what they can and go on. */
  const addStop = (at: NodeId, take: Good | undefined, fenceRest?: boolean) => {
    if (!hiring) return;
    const stop: CarterStop = { at };
    if (take !== undefined) stop.take = take;
    if (fenceRest) stop.fenceRest = true;
    const stops = [...hiring.stops, stop];
    const firstLoad = take !== undefined && !hiring.stops.some((x) => x.take !== undefined);
    setHiring({
      cartId: hiring.cartId,
      stops,
      ...(firstLoad ? { capFor: stops.length - 1 } : {}) });
  };

  const setCap = (max: number | undefined) => {
    if (!hiring || hiring.capFor === undefined) return;
    const at = hiring.capFor;
    setHiring({
      cartId: hiring.cartId,
      stops: hiring.stops.map((s, i) => (i === at && max !== undefined ? { ...s, max } : s)) });
  };

  // §6.11 / §10 — a carter is offered only once the manual round is a felt
  // chore: two cart-loads sold by hand, or crime already begun (by which point
  // you have hauled plenty). Before that, automation would only overwhelm.
  const carterAvailable =
    state.dutchman.unlocked || (state.ledger.soldLawfully >= CARTER_UNLOCK_FLEECE);

  // A standing order loads from a node: what it can haul, and where to. The
  // shingle is named only once the Dutchman is (§6.11) — no menu speaks of
  // the trade before the coast has.
  /**
   * §6.19 — the KNOWLEDGE gate, which replaces the old stock gate. A stop may
   * name any good the player knows of, whether or not one sits in the store
   * today: an order is a sentence about the future, and the second cart of a
   * relay has to be writable before the first has run. What gates a good is
   * the ladder the game already climbs (§10 — no menu names a good before the
   * coast or the still has), never a barn's contents this instant.
   */
  const knownGoods = (): Good[] => {
    const goods: Good[] = ['fleece'];
    if (state.dutchman.met) goods.push('lace');
    if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_TEA) goods.push('tea');
    if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_JENEVER) goods.push('jenever');
    if (state.cuttingHouse) {
      goods.push('bulked-tea', 'brandy-rough', 'brandy-fair', 'brandy-gent');
    }
    return goods;
  };
  /** What he can pick up at a stop: off the lugger at the shingle, out of the
   *  store anywhere that keeps one. A market sells; it does not supply. */
  const takeOptionsAt = (at: NodeId): Good[] =>
    at === 'shingle' ? backOptionsFor(state, 'shingle') : at === 'ryne' ? [] : knownGoods();
  // §6.18 (M5½b playtest) — a hull answers only its own element. The picker
  // asks the sim which nodes this cart could ever reach and greys the rest
  // with the reason: a tub ordered to a landlocked node used to take the
  // order, refuse the dispatch, and idle. (The lighter had this bug too.)
  const adriftFor = (cart: Cart, from: NodeId, to: NodeId): string | null => {
    if (!cart.vessel) return null;
    if (reachableNodesFor(state, cart, from).includes(to)) return null;
    return cart.vessel === 'sea'
      ? 'No sea lane runs there. Steam does not climb mud.'
      : 'No water of yours runs there yet. Dig the channels that join these two, and the tub will go.';
  };
  /**
   * §6.19 — where the round may call next: never the stop it already stands
   * on, never past CARTER_MAX_STOPS, and the shingle only once the coast has
   * spoken (§6.11's gate, §10). Unreachable-for-this-hull nodes come back with
   * their reason rather than vanishing.
   */
  const nextNodesFor = (
    cart: Cart,
    stops: CarterStop[],
  ): Array<{ node: NodeId; adrift: string | null }> => {
    if (stops.length >= CARTER_MAX_STOPS) return [];
    const last = stops.length > 0 ? stops[stops.length - 1].at : null;
    const here = cart.location.kind === 'node' ? cart.location.nodeId : 'farm';
    return (['farm', 'ryne', 'shingle', 'cutting-house'] as NodeId[])
      .filter(
        (n) =>
          n !== last &&
          (n !== 'cutting-house' || state.cuttingHouse) &&
          (n !== 'shingle' || shingleRoutesOpen(state) || state.dutchman.unlocked),
      )
      .map((node) => ({ node, adrift: adriftFor(cart, last ?? here, node) }));
  };
  /** §6.19's refusals, asked before the button is offered rather than after:
   *  two stops at least, and something picked up somewhere. */
  const roundIsSayable = (stops: CarterStop[]): boolean =>
    stops.length >= 2 && stops.some((s) => s.take !== undefined);

  return (
    <>
      {carts.map((cart) => {
        const laden = cargoCount(cart.cargo) > 0;
        const present = cart.location.kind === 'node' && cart.location.nodeId === nodeId;
        // A cart at this node with no carter is the player's to drive: it gets
        // its own load/sell/send controls, in its own row. Mid-hire, the picker
        // takes the row over (§6.11), so the manual buttons stand aside.
        const choosing = hiring?.cartId === cart.id;
        const drivable = present && !cart.carter && !choosing;
        return (
          <div key={cart.id}>
            <p className="flavour">
              <strong>{cart.name}</strong>: {storeSummary(cart.cargo, 'empty')}
              {!present ? ` · ${cartWhereabouts(state, cart)}` : ''}
              {cart.carter
                ? ` · standing order: ${orderLabel(state, cart.carter)}, and round again — ${carterWageOf(
                    cart.carter,
                  )} coin a day${
                    carterWageOf(cart.carter) > CARTER_WAGE ? ' (danger money)' : ''
                  }. ` +
                  (cart.carter.stops.some((s) => s.at === 'shingle')
                    ? 'He deals over the gunwale when the lugger stands off, and waits when it does not.'
                    : 'He minds the tide and nothing else.')
                : ` · no ${handOf(cart)} — yours to drive`}
            </p>
            <div className="menu-buttons">
              {/* Playtest (first morning): the top button is the DEFAULT —
                  the FORWARD verb. At a store (the farm, the house) a laden
                  cart's next act is the road, never "unload it all back
                  again"; at the market or the gunwale it is the sale, never
                  "home to the farm". An empty cart loads first anywhere. */}
              {drivable &&
                laden &&
                (nodeId === 'farm' || nodeId === 'cutting-house') &&
                roadButtons(nodeId, state, cart, send, flooded)}
              {drivable && cargoButtons(nodeId, state, cart, enqueue)}
              {drivable &&
                !(laden && (nodeId === 'farm' || nodeId === 'cutting-house')) &&
                roadButtons(nodeId, state, cart, send, flooded)}
              {hiring?.cartId === cart.id ? (
                hiring.capFor !== undefined ? (
                  // §6.11 (M5b playtest) — the load cap: how much of the shared
                  // store each round may take. The wool-split lever.
                  <>
                    <button onClick={() => setCap(undefined)}>…as much as he can carry</button>
                    <button
                      title="Half the cart, so the barn keeps enough for the other round."
                      onClick={() => setCap(cart.capacity / 2)}
                    >
                      …no more than {cart.capacity / 2} a run
                    </button>
                    <button
                      title="A token load — the alibi, not the trade."
                      onClick={() => setCap(cart.capacity / 4)}
                    >
                      …no more than {cart.capacity / 4} a run
                    </button>
                    {/* Playtest 2026-08: the old picker offered a way out on
                        its first step only, so a mis-click had to be clicked
                        through to the end. Every step can be left. */}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                ) : hiring.where !== undefined ? (
                  // What he picks up at the stop just named. §6.19 — the goods
                  // offered are the ones the PLAYER KNOWS, not the ones that
                  // happen to be in the store this instant: an order is a
                  // sentence about the future, and the second cart of a relay
                  // must be writable before the first has run.
                  <>
                    {takeOptionsAt(hiring.where).map((good) => {
                      const inStore = (state.stores[hiring.where!]?.[good] ?? 0) > 0;
                      const beach = hiring.where === 'shingle';
                      return (
                        <button
                          key={good}
                          title={
                            beach
                              ? `${GOOD_WHISPER[good] ?? ''} He buys with the coin in the till, to the cart’s room. No credit, and no keeping back the rent.`
                              : inStore
                                ? GOOD_WHISPER[good]
                                : 'None there today — he loads what he finds, and lies waiting when he finds none.'
                          }
                          onClick={() => addStop(hiring.where!, good)}
                        >
                          {beach ? 'Take' : 'Load'} {GOOD_LABEL[good]} at{' '}
                          {nodeById(hiring.where!, state.farm, state.cuttingHouse).name}
                          {!beach && !inStore ? ' · none there today' : ''}
                        </button>
                      );
                    })}
                    <button
                      title="He calls, unloads what he is carrying, and goes on. This is how a load is delivered somewhere that is not the end of the round."
                      onClick={() => addStop(hiring.where!, undefined)}
                    >
                      …just call at {nodeById(hiring.where, state.farm, state.cuttingHouse).name} and
                      unload
                    </button>
                    {hiring.where === 'ryne' && (
                      <button
                        title={`The whole remainder, round the back, at the haircut — the ${handOf(cart)} looks away, then goes on.`}
                        onClick={() => addStop('ryne', undefined, true)}
                      >
                        …sell at Ryne, and the fence takes the remainder
                      </button>
                    )}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                ) : (
                  // Where next? The round is a loop, so the last stop is
                  // followed by the first — "and home again" is not a stop.
                  <>
                    {nextNodesFor(cart, hiring.stops).map(({ node, adrift }) => (
                      <button
                        key={node}
                        disabled={!!adrift}
                        title={adrift ?? undefined}
                        onClick={() => setHiring({ ...hiring, where: node })}
                      >
                        {hiring.stops.length === 0 ? 'Start the round at' : '…then on to'}{' '}
                        {nodeById(node, state.farm, state.cuttingHouse).name}
                        {node === 'shingle' ? ' · danger money' : ''}
                        {adrift ? ' · no way there for this hull' : ''}
                      </button>
                    ))}
                    {roundIsSayable(hiring.stops) && (
                      <button
                        title="The round closes: from the last stop he goes back to the first, and round again."
                        onClick={() => hire(cart.id, hiring.stops)}
                      >
                        …and that is the round — {orderLabel(state, { stops: hiring.stops })} ·{' '}
                        {carterWageOf({ stops: hiring.stops })} coin a day
                      </button>
                    )}
                    {hiring.stops.length >= CARTER_MAX_STOPS && (
                      <p className="flavour">
                        Four calls is as long a sentence as a man will hold in his head.
                      </p>
                    )}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                )
              ) : cart.carter ? (
                <>
                  {/* §6.17 (M5½ playtest) — the fence over the carter's
                      shoulder: a crewed cart stuck on the appetite can be
                      emptied by hand at the market, and the man simply turns
                      for home. */}
                  {present &&
                    nodeId === 'ryne' &&
                    CONTRABAND.filter(
                      (g) => (cart.cargo[g] ?? 0) > 0 && RYNE_PRICE[g] > 0,
                    ).map((g) => {
                      const n = cart.cargo[g] ?? 0;
                      const fencePrice = Math.round(RYNE_PRICE[g] * FENCE_PRICE_MULT);
                      return (
                        <button
                          key={`fence-${g}`}
                          title={`The whole remainder, round the back, at once — the ${handOf(cart)} looks away, then turns for home.`}
                          onClick={() => enqueue({ type: 'sellToFence', cartId: cart.id, good: g })}
                        >
                          Fence the remaining {n} {GOOD_LABEL[g]} · {n * fencePrice} coin
                        </button>
                      );
                    })}
                  <button
                    title="The same man keeps the reins; the round is written afresh."
                    onClick={() => setHiring({ cartId: cart.id, stops: [] })}
                  >
                    Change standing order
                  </button>
                  <button
                    title={
                      present
                        ? undefined
                        : 'Word reaches him on the road: the order ends where he stands.'
                    }
                    onClick={() => enqueue({ type: 'dismissCarter', cartId: cart.id })}
                  >
                    Dismiss the {handOf(cart)}
                  </button>
                </>
              ) : !present ? null : carterAvailable ? (
                <>
                  {/* §6.19 — one door into the picker, and the round is
                      written a stop at a time from there. The old menu offered
                      a button per good in the barn, which is where the stock
                      gate leaked into the UI in the first place. */}
                  <button
                    title="Where he calls, and what he picks up at each — any loop among the known places, up to four calls."
                    onClick={() => setHiring({ cartId: cart.id, stops: [] })}
                  >
                    Hire a {handOf(cart)}, and write him a round · {CARTER_WAGE} coin a day
                    {shingleRoutesOpen(state) || state.dutchman.unlocked
                      ? `, ${CARTER_DANGER_WAGE} if it touches the coast`
                      : ''}
                  </button>
                </>
              ) : null}
              {laden && drivable && (
                <button onClick={() => enqueue({ type: 'ditchCargo', cartId: cart.id })}>
                  Tip {cart.name.toLowerCase()}&rsquo;s load into a dyke · nothing comes back
                </button>
              )}
              {/* §6.11 — the wheelwright buys back: empty, carterless, in the
                  yard, never the last. The undo for a cart bought in optimism. */}
              {stable && drivable && !laden && state.carts.length > 1 && (
                <button
                  title="He buys cheaper than he sells. Nobody out here forgets a price."
                  onClick={() => enqueue({ type: 'sellCart', cartId: cart.id })}
                >
                  Sell {cart.name.toLowerCase()} back · {CART_RESALE} coin
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}


/** §6.19 (M5½e playtest) — the hand on the reins, named for the hull: a
 *  carter on the road, a dyke-pilot on the dug water, a lighterman at sea.
 *  One hire flow, three trades — "hire a carter" on a tub-boat reads wrong. */
function handOf(cart: Cart): string {
  return cart.vessel === 'dyke' ? 'dyke-pilot' : cart.vessel === 'sea' ? 'lighterman' : 'carter';
}

export function CartMenu({
  state,
  flooded,
  cartId }: {
  state: GameState;
  flooded: boolean;
  cartId: string;
}) {
  const enqueue = useEnqueue();
  const cart = state.carts.find((c) => c.id === cartId);
  if (!cart) return null;
  const cargo = storeSummary(cart.cargo, 'Empty');
  const laden = cargoCount(cart.cargo) > 0;

  // A cart popover only opens on the road (spec §20) — but the road ends,
  // and a stale selection lands here: point at the place and step aside.
  if (cart.location.kind === 'node') {
    const here = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
    return (
      <>
        <h4>{cart.name}</h4>
        <p className="flavour">
          Standing at {here.name}. {cargo} aboard. Its business is the place&rsquo;s business —
          click {here.name}.
        </p>
      </>
    );
  }

  // §6.18 — the world's ways include the dug waterways (the tub rides them).
  const edge = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)].find(
    (e) => e.id === (cart.location as { edgeId: string }).edgeId,
  );
  const pct = edge ? Math.round((cart.location.progress / edge.latency) * 100) : 0;
  const halted = edge?.condition === 'tideLocked' && flooded;
  return (
    <>
      <h4>{cart.name}</h4>
      <p className="flavour">
        {cargo} aboard. {edge?.name}, {pct}% along.
        {halted ? ' The tide has the road — waiting on high ground.' : ''}
      </p>
      {cart.carter && (
        <>
          <p className="flavour">
            A {handOf(cart)} holds the reins: {orderLabel(state, cart.carter)}, and round again —{' '}
            {carterWageOf(cart.carter)} coin a day. He minds the tide and nothing else — not even
            the blue coat.
          </p>
          <div className="menu-buttons">
            <button onClick={() => enqueue({ type: 'dismissCarter', cartId: cart.id })}>
              Dismiss the {handOf(cart)}
            </button>
          </div>
        </>
      )}
      {laden && !cart.carter && (
        <div className="menu-buttons">
          <button onClick={() => enqueue({ type: 'ditchCargo', cartId: cart.id })}>
            Tip the lot into a dyke · nothing comes back
          </button>
        </div>
      )}
    </>
  );
}
