// The round being written (spec §20.4, D2): shift-click places on the map and
// they gather here — each stop with what he picks up there (defaulted from
// where the round goes next, and the player's to change), the wool read
// aloud, the wage, and the one button that makes it his standing order.

import { useEffect } from 'react';
import { carterWageOf } from '../sim/tick';
import { nodeById } from '../sim/map';
import type { Good } from '../sim/types';
import { woolMismatches } from '../sim/wool';
import { GOOD_LABEL } from '../shared/format';
import { useGameStore } from '../state/store';
import { draftBlocked, draftStops, hireDraft } from './command';
import { useDeskUi } from './deskUi';
import { defaultTake, takeOptions } from './routes';
import { handOf } from './sheets/cart';

export function RoundDraft() {
  const state = useGameStore((s) => s.state);
  const draft = useDeskUi((s) => s.draft);
  const setDraft = useDeskUi((s) => s.setDraft);

  // Enter hires, Esc puts the pen down.
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        hireDraft();
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setDraft(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [draft, setDraft]);

  if (!draft) return null;
  const cart = state.carts.find((c) => c.id === draft.cartId);
  if (!cart) return null;
  const stops = draftStops(state, draft);
  const blocked = draftBlocked(state, cart, stops);
  const mismatches = woolMismatches(stops);
  const wage = carterWageOf({ stops });
  const name = (n: string) => nodeById(n, state.farm, state.cuttingHouse).name;
  const hand = handOf(cart);

  return (
    <section className="round-draft" aria-label="The round being written">
      <div className="kicker">a round for {cart.name.toLowerCase()}</div>
      <ol>
        {draft.stops.map((at, i) => {
          if (i === draft.stops.length - 1 && i > 0 && at === draft.stops[0]) return null;
          const options = takeOptions(state, at);
          const auto = defaultTake(state, draft.stops.map((n) => ({ at: n })), i);
          const value = draft.takes[i] ?? auto ?? 'none';
          return (
            <li key={i}>
              <span className="stop-name">{name(at)}</span>
              {options.length > 0 ? (
                <select
                  aria-label={`What he picks up at ${name(at)}`}
                  value={value}
                  onChange={(e) =>
                    setDraft({ ...draft, takes: { ...draft.takes, [i]: e.target.value as Good | 'none' } })
                  }
                >
                  <option value="none">{at === 'shingle' ? 'buys nothing' : 'picks up nothing'}</option>
                  {options.map((g) => (
                    <option key={g} value={g}>
                      {at === 'shingle' ? 'buys ' : 'takes '}
                      {GOOD_LABEL[g]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="stop-verb">{at === 'ryne' ? 'sells' : at === 'shingle' ? 'deals over the gunwale' : 'unloads'}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="round-loop">…and back to {name(draft.stops[0])}, and round again.</p>
      {mismatches.map((m) => (
        <p key={m} className="fact warn">
          {m}
        </p>
      ))}
      {blocked && <p className="verb-reason">{blocked}</p>}
      <div className="round-acts">
        <button className="primary" disabled={!!blocked} onClick={() => hireDraft()}>
          {cart.carter ? `Give him this round` : `Hire a ${hand} for this round`} · {wage} coin a day
          <kbd>Enter</kbd>
        </button>
        <button className="secondary" onClick={() => setDraft(null)}>
          Put the pen down <kbd>Esc</kbd>
        </button>
      </div>
      <p className="fact quiet">Click more places on the map to add stops — up to four.</p>
    </section>
  );
}
