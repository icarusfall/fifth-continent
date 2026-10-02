// DESTINATION TAGS (spec §20.4, D2): select a cart, and every place it could
// go wears a tag — up to two routes, each with its roads, its hours, and its
// worst risk named. Click a route to send; shift-click to add the place to a
// round. The map's own loop pins each tag beside its place every frame.

import { reachableNodesFor } from '../sim/tick';
import { nodeById } from '../sim/map';
import type { Cart, GameState, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';
import { addDraftStop, sendByRoute } from './command';
import { useDeskUi } from './deskUi';
import { hoursOf, originOf, routeRisk, routesBetween, waysFor, type Route } from './routes';

const TONE_LABEL: Record<string, string> = {
  quiet: 'quiet',
  seen: 'seen',
  watched: 'watched',
  water: 'on the water',
};

function roadsOf(route: Route): string {
  const names: string[] = [];
  for (const l of route.legs) {
    const n = l.edge.name.replace(/^The /, 'the ');
    if (names[names.length - 1] !== n) names.push(n);
  }
  return names.join(', then ');
}

/** The places a tag can name: those the world shows, minus the cart's own. */
function destinations(state: GameState, cart: Cart, from: NodeId): NodeId[] {
  const reach = new Set(reachableNodesFor(state, cart, from));
  const places: NodeId[] = ['farm', 'ryne'];
  if (state.dutchman.unlocked) places.push('shingle');
  if (state.cuttingHouse) places.push('cutting-house');
  return places.filter((p) => p !== from && reach.has(p));
}

export function Tags() {
  const state = useGameStore((s) => s.state);
  const selection = useDeskUi((s) => s.selection);
  const draft = useDeskUi((s) => s.draft);
  const setHoverRoute = useDeskUi((s) => s.setHoverRoute);
  const pushSlip = useDeskUi((s) => s.pushSlip);

  if (selection?.kind !== 'cart') return null;
  const cart = state.carts.find((c) => c.id === selection.id);
  if (!cart || waysFor(state, cart).length === 0) return null;
  const drafting = draft?.cartId === cart.id;
  const from = drafting ? draft.stops[draft.stops.length - 1] : originOf(cart);
  const crewed = !!cart.carter;
  const name = (n: NodeId) => nodeById(n, state.farm, state.cuttingHouse).name;

  const choose = (e: React.MouseEvent, to: NodeId, route: Route) => {
    e.stopPropagation();
    setHoverRoute(null);
    if (e.shiftKey || drafting || crewed) {
      const refused = addDraftStop(cart, to);
      if (refused) pushSlip({ id: `max-stops-${Date.now()}`, title: 'The round is full', body: refused });
      return;
    }
    sendByRoute(cart, route);
  };

  return (
    <div className="tags" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {destinations(state, cart, from).map((to) => {
        const routes = routesBetween(state, cart, from, to);
        if (routes.length === 0) return null;
        return (
          <div key={to} className="tag" data-anchor={to}>
            <div className="tag-to">
              {drafting || crewed ? '+ ' : ''}
              {name(to)}
            </div>
            {routes.map((r, i) => {
              const risk = routeRisk(state, r);
              return (
                <button
                  key={i}
                  className={`tag-opt ${risk.tone}`}
                  onMouseEnter={() => setHoverRoute({ cartId: cart.id, route: r })}
                  onMouseLeave={() => setHoverRoute(null)}
                  onClick={(e) => choose(e, to, r)}
                  title={
                    crewed
                      ? 'A hand holds the reins: this adds the place to a new round for him.'
                      : 'Click to send. Shift-click to add it to a round.'
                  }
                >
                  <i className="dot" aria-label={TONE_LABEL[risk.tone]} />
                  <span className="by">by {roadsOf(r)}</span>
                  <span className="hrs">{hoursOf(r.ticks)}</span>
                  <span className="risk">{risk.words.join(' · ')}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      {crewed && !drafting && (
        <div className="tag-hint">A {cart.vessel === 'dyke' ? 'dyke-pilot' : cart.vessel === 'sea' ? 'lighterman' : 'carter'} holds the reins — a click on a tag starts him a new round.</div>
      )}
    </div>
  );
}
