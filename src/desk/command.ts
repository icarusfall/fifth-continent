// Cart command (spec §20.4, D2): send, draft, hire — and the two hooks that
// keep a journey moving and let the world lean in. Every order reaches the sim
// as an ordinary Action through the store's queue, exactly as a click would:
// the replay log never knows the desk exists.

import { useEffect } from 'react';
import { CARTER_MAX_STOPS, CARTER_UNLOCK_FLEECE } from '../sim/balance';
import type { Cart, CarterStop, GameState, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';
import { useDeskUi, type Draft } from './deskUi';
import { defaultTake, legOpen, originOf, type Route } from './routes';

/** Send a cart along a route: the first leg now (if it is open), the rest as
 *  it arrives. A cart already on the road takes the route after it arrives. */
export function sendByRoute(cart: Cart, route: Route): void {
  const game = useGameStore.getState();
  const ui = useDeskUi.getState();
  const state = game.state;
  let next = 0;
  if (cart.location.kind === 'node' && legOpen(state, route.legs[0])) {
    game.enqueue({ type: 'dispatchCart', cartId: cart.id, edgeId: route.legs[0].edge.id });
    next = 1;
  }
  const to = route.legs[route.legs.length - 1].to;
  ui.setJourney(cart.id, next >= route.legs.length ? null : { to, route, next, issuedTick: state.tick });
}

/** Shift-click: the place joins the round being written for this cart. */
export function addDraftStop(cart: Cart, at: NodeId): string | null {
  const ui = useDeskUi.getState();
  const d: Draft =
    ui.draft && ui.draft.cartId === cart.id ? ui.draft : { cartId: cart.id, stops: [originOf(cart)], takes: {} };
  if (d.stops[d.stops.length - 1] === at) return null;
  if (d.stops.length >= CARTER_MAX_STOPS) return 'Four calls is as long a sentence as a man will hold in his head.';
  ui.setDraft({ ...d, stops: [...d.stops, at] });
  return null;
}

/** The draft's stops as the sim will take them: each with its pick-up said. */
export function draftStops(state: GameState, d: Draft): CarterStop[] {
  // A round is a loop: a last stop that repeats the first collapses (§6.19).
  const nodes = d.stops.length > 1 && d.stops[d.stops.length - 1] === d.stops[0] ? d.stops.slice(0, -1) : d.stops;
  const at = nodes.map((n) => ({ at: n }));
  return nodes.map((n, i) => {
    const o = d.takes[i];
    const take = o === 'none' ? undefined : (o ?? defaultTake(state, at, i));
    return take === undefined ? { at: n } : { at: n, take };
  });
}

/** Why this draft cannot be hired now, or null. */
export function draftBlocked(state: GameState, cart: Cart, stops: CarterStop[]): string | null {
  if (!cart.carter && !(state.dutchman.unlocked || state.ledger.soldLawfully >= CARTER_UNLOCK_FLEECE)) {
    return 'No carter will take wages from a stranger. Sell two cart-loads at Ryne by hand first.';
  }
  if (stops.length < 2) return 'A round is a journey: name at least two places.';
  if (!stops.some((s) => s.take !== undefined)) return 'He picks nothing up anywhere — a round that moves nothing.';
  return null;
}

/** Enter: the round becomes his standing order (a hire, or a re-order). */
export function hireDraft(): boolean {
  const game = useGameStore.getState();
  const ui = useDeskUi.getState();
  const d = ui.draft;
  if (!d) return false;
  const cart = game.state.carts.find((c) => c.id === d.cartId);
  if (!cart) return false;
  const stops = draftStops(game.state, d);
  if (draftBlocked(game.state, cart, stops)) return false;
  game.enqueue({ type: 'hireCarter', cartId: cart.id, order: { stops } });
  ui.setDraft(null);
  ui.setJourney(cart.id, null);
  return true;
}

/**
 * Drive the journeys: when a cart stands at the start of its next leg, issue
 * that leg — once per tick, never into a drowned road (it waits on the tide,
 * as a careful hand would, rather than having the sim refuse it every tick).
 */
export function useJourneys(): void {
  useEffect(
    () =>
      useGameStore.subscribe((store, prev) => {
        if (store.state === prev.state) return;
        const state = store.state;
        const ui = useDeskUi.getState();
        for (const [cartId, j] of Object.entries(ui.journeys)) {
          const cart = state.carts.find((c) => c.id === cartId);
          if (!cart || cart.carter) {
            ui.setJourney(cartId, null);
            continue;
          }
          if (cart.location.kind !== 'node') continue;
          const here = cart.location.nodeId;
          if (here === j.to || j.next >= j.route.legs.length) {
            ui.setJourney(cartId, null);
            continue;
          }
          const leg = j.route.legs[j.next];
          if (leg.from !== here) {
            ui.setJourney(cartId, null); // he was sent elsewhere by hand
            continue;
          }
          if (state.tick <= j.issuedTick || !legOpen(state, leg)) continue;
          store.enqueue({ type: 'dispatchCart', cartId, edgeId: leg.edge.id });
          ui.setJourney(cartId, { ...j, next: j.next + 1, issuedTick: state.tick });
        }
      }),
    [],
  );
}

/**
 * THE WORLD LEANS IN (§20.4): while the pointer rests on a moving cart, the
 * clock drops to the amble, and returns to the player's own pace when it
 * leaves — unless the player changed the pace meanwhile. UI-only.
 */
export function useLeaning(): void {
  useEffect(() => {
    let saved: number | null = null;
    return useDeskUi.subscribe((ui, prev) => {
      if (ui.leaning === prev.leaning) return;
      const game = useGameStore.getState();
      if (ui.leaning) {
        if (game.paused || game.waitingForLugger || game.ticksPerSecond <= 1) return;
        saved = game.ticksPerSecond;
        game.setSpeed(1);
      } else if (saved !== null) {
        if (game.ticksPerSecond === 1) game.setSpeed(saved);
        saved = null;
      }
    });
  }, []);
}
