// Spec §20.1 — THE LEDGER: the one screen that is not the map, because
// bookkeeping *is* the cover mechanic. The books and their ± controls live
// here (out of the farm popover, M5a-3), alongside the purse, the rent, the
// Dutchman's book, the day's wage bill, and the parish's regard.

import { useState } from 'react';
import {
  CREW_WAGE,
  MILITIA_WAGE,
  REFINER_WAGE,
  SHEARER_WAGE,
} from '../sim/balance';
import { carterWageOf, rentAmount, woolOnTheBooks } from '../sim/tick';
import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';
import { HEAT_RED, ROOF } from './palette';

/** The day's standing wages: carters (danger money and all), the shearing
 *  lad, the refiner, and every posted man. */
function wageBill(state: GameState): number {
  const carters = state.carts.reduce(
    (sum, c) => sum + (c.carter ? carterWageOf(c.carter) : 0),
    0,
  );
  const shearer = state.shearer.hired ? SHEARER_WAGE : 0;
  const refiner = state.refiner.hired ? REFINER_WAGE : 0;
  const garrisons = Object.values(state.garrisons).reduce(
    (sum, g) => sum + (g ? g.militia * MILITIA_WAGE + g.crew * CREW_WAGE : 0),
    0,
  );
  return carters + shearer + refiner + garrisons;
}

export function LedgerPanel({ state }: { state: GameState }) {
  const enqueue = useGameStore((s) => s.enqueue);
  const [open, setOpen] = useState(false);
  const l = state.ledger;
  const rent = rentAmount(state);
  const wages = wageBill(state);
  const honest = l.declaredYield >= state.flockSize;

  return (
    <div className={open ? 'ledger-panel open' : 'ledger-panel'}>
      <button
        className="ledger-tab"
        title="The book the officer reads — and the one you keep."
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'close ›' : '‹ the ledger'}
      </button>

      {open && (
        <div className="ledger-body">
          <h4>The Ledger</h4>

          <section>
            <h5>the purse</h5>
            <p>
              coin <strong>{state.coin}</strong> · wages {wages}/day
            </p>
            <p>
              rent <strong>{rent}</strong>, due day {clockOf(state.rentDueTick).day} at dawn —{' '}
              {state.coin >= rent ? 'covered' : `short ${rent - state.coin}`}
            </p>
            {state.dutchmanBook > 0 && (
              <p style={{ color: ROOF }}>
                the Dutchman&rsquo;s book: <strong>{state.dutchmanBook}</strong> — half of every
                sale is his until it clears
              </p>
            )}
          </section>

          {state.dutchman.unlocked && (
            <section>
              <h5>the books</h5>
              <p>
                The page swears the flock gives <strong>{l.declaredYield}</strong> fleece a day
                (it gives {state.flockSize}).
              </p>
              <div className="ledger-controls">
                <button
                  disabled={l.declaredYield <= 0}
                  title="Scrapie, if anyone asks — from tomorrow's page. Undeclared wool never existed, and must vanish."
                  onClick={() =>
                    enqueue({ type: 'setDeclaredYield', fleecePerDay: l.declaredYield - 1 })
                  }
                >
                  −
                </button>
                <span>{l.declaredYield}</span>
                <button
                  disabled={l.declaredYield >= state.flockSize}
                  title="The book admits more of the clip from tomorrow's page. Declared wool must show at inspection."
                  onClick={() =>
                    enqueue({ type: 'setDeclaredYield', fleecePerDay: l.declaredYield + 1 })
                  }
                >
                  +
                </button>
              </div>
              <p>
                this page: {Math.round(l.declaredToDate)} declared · {l.soldLawfully} sold at
                Ryne · {l.grownToDate} grown
              </p>
              <p title="The wool-stapler reads the whole page: lawful sales stop when the book holds no admitted wool unsold. The pen writes tomorrow's line, never today's.">
                on the books, unsold: <strong>{woolOnTheBooks(state)}</strong> fleece the stapler
                will take · {l.soldToday} weighed today
              </p>
              <p className="ledger-hint">
                {!l.penTaken
                  ? 'The agent keeps the books square with the flock — until you take up the pen. After that, the number is yours.'
                  : honest
                    ? 'An honest page. Every fleece the lugger swallows will read as a gap.'
                    : 'A shorted page. Declared wool must show; the rest never existed — get it over the gunwale.'}
              </p>
            </section>
          )}

          <section>
            <h5>the parish</h5>
            <p>
              standing <strong style={{ color: state.standing < 30 ? HEAT_RED : undefined }}>
                {Math.round(state.standing)}
              </strong>
              {state.informer ? ' · someone talks — the free hides are closed' : ''}
            </p>
            {state.vouches > 0 && (
              <p className="ledger-hint">
                the neighbours have vouched for the rent {state.vouches === 1 ? 'once' : `${state.vouches} times`}
                {state.tick < state.vouchCooldownUntil ? ' — they will not do it again soon' : ''}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
