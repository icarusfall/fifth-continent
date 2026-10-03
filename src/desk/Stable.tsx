// THE STABLE (spec §20.4): every cart, wherever its wheels are — where it is,
// what it carries (white and dark wool in their colours), and whose hand is
// on the reins. A cart is a moving target on the map; here it holds still
// (the playtest rule: anything that moves needs a control that does not).

import { useGameStore } from '../state/store';
import { cargoCount, cartWhereabouts, orderLabel } from '../shared/words';
import { GOOD_LABEL } from '../shared/format';
import type { Cart, GameState, Good, NodeId } from '../sim/types';
import { woolMismatches } from '../sim/wool';
import { useDeskUi } from './deskUi';
import { handOf } from './sheets/cart';
import { idleReason, tideHold, tideHoldWords } from './idle';
import { spanOf } from '../shared/format';

function Cargo({ cart }: { cart: Cart }) {
  const goods = (Object.entries(cart.cargo) as Array<[Good, number]>).filter(([, n]) => n > 0);
  if (goods.length === 0) return <span className="cargo empty">empty</span>;
  return (
    <span className="cargo">
      {goods.map(([g, n]) => (
        <span key={g} className={`chip ${g === 'fleece' ? 'white' : g === 'dark-fleece' ? 'dark' : 'goods'}`}>
          {n} {GOOD_LABEL[g]}
        </span>
      ))}
    </span>
  );
}

function placesOf(state: GameState): Array<{ id: NodeId; label: string }> {
  const out: Array<{ id: NodeId; label: string }> = [
    { id: 'farm', label: 'Walland Farm' },
    { id: 'ryne', label: 'Ryne' },
  ];
  if (state.dutchman.unlocked) out.push({ id: 'shingle', label: 'The Shingle' });
  if (state.cuttingHouse) out.push({ id: 'cutting-house', label: 'The Cutting House' });
  return out;
}

export function Stable() {
  const state = useGameStore((s) => s.state);
  const selection = useDeskUi((s) => s.selection);
  const select = useDeskUi((s) => s.select);

  const men: string[] = [];
  const hands = state.carts.filter((c) => c.carter).length;
  if (hands > 0) men.push(`${hands} on the reins`);
  if (state.shearer.hired) men.push('the shearing lad');
  if (state.refiner.hired) men.push('a refiner');
  const posted = Object.values(state.garrisons).reduce((n, g) => n + (g ? g.militia + g.crew : 0), 0);
  if (posted > 0) men.push(`${posted} posted`);

  return (
    <aside className="panel stable" aria-label="The stable">
      <h3 className="panel-title">the stable</h3>
      <div className="stable-rows">
        {state.carts.map((cart, i) => {
          const on = selection?.kind === 'cart' && selection.id === cart.id;
          const mismatch = cart.carter ? woolMismatches(cart.carter.stops) : [];
          return (
            <button
              key={cart.id}
              className={on ? 'stable-row on' : 'stable-row'}
              onClick={() => select({ kind: 'cart', id: cart.id }, true)}
            >
              <span className="num">{i + 1}</span>
              <span className="who">
                <span className="name">{cart.name}</span>
                <span className="where">{cartWhereabouts(state, cart)}</span>
                <Cargo cart={cart} />
                <span className="hand">
                  {cart.carter
                    ? `${handOf(cart)}: ${orderLabel(state, cart.carter)}`
                    : `yours to drive · ${cargoCount(cart.cargo)}/${cart.capacity}`}
                </span>
                {idleReason(state, cart) && <span className="idle">{idleReason(state, cart)}</span>}
                {(() => {
                  const h = tideHold(state, cart);
                  return h && <span className="idle tide">≈ {tideHoldWords(h, spanOf(h.clears))}</span>;
                })()}
                {mismatch.map((m) => (
                  <span key={m} className="warn">
                    {m}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {men.length > 0 && <p className="stable-men">Men: {men.join(' · ')}</p>}
      <h3 className="panel-title">places</h3>
      <div className="place-links">
        {placesOf(state).map((p) => (
          <button
            key={p.id}
            className={selection?.kind === 'place' && selection.id === p.id ? 'on' : undefined}
            onClick={() => select({ kind: 'place', id: p.id }, true)}
          >
            {p.label}
          </button>
        ))}
        <button
          className={selection?.kind === 'ledger' ? 'on' : undefined}
          onClick={() => select({ kind: 'ledger' })}
        >
          The Ledger
        </button>
      </div>
    </aside>
  );
}
