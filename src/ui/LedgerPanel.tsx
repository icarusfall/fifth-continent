// Spec §20.1 — THE LEDGER: the one screen that is not the map, because
// bookkeeping *is* the cover mechanic. The books and their ± controls live
// here (out of the farm popover, M5a-3), alongside the purse, the rent, the
// Dutchman's book, the day's wage bill, and the parish's regard.

import {
  CREW_WAGE,
  MILITIA_WAGE,
  REFINER_WAGE,
  SHEARER_WAGE,
  TICKS_PER_DAY,
} from '../sim/balance';
import { forecastDay } from '../sim/forecast';
import { auditGapNow, CONTRABAND } from '../sim/revenue';
import { carterWageOf, rentAmount, woolOnTheBooks } from '../sim/tick';
import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';
import { useUiStore } from '../state/ui';
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
  const soundTheAlarm = useGameStore((s) => s.soundTheAlarm);
  // Open state lives in the UI store: the spine tab (desktop) and the bottom
  // bar's ledger button (phone) drive the same panel.
  const open = useUiStore((s) => s.ledgerOpen);
  const setOpen = useUiStore((s) => s.setLedgerOpen);
  const l = state.ledger;
  const rent = rentAmount(state);
  const wages = wageBill(state);
  const honest = l.declaredYield >= state.flockSize;
  const forecast = forecastDay(state);
  // §20.1 — urgent when the purse is short inside two days of the due.
  const rentUrgent =
    state.coin < rent && state.rentDueTick - state.tick < 2 * TICKS_PER_DAY;
  const anyLadenCart = state.carts.some((c) =>
    CONTRABAND.some((g) => (c.cargo[g] ?? 0) > 0),
  );

  return (
    <div className={open ? 'ledger-panel open' : 'ledger-panel'}>
      <button
        className="ledger-tab"
        title="The book the officer reads — and the one you keep."
        onClick={() => setOpen(!open)}
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
            <p style={rentUrgent ? { color: HEAT_RED, fontWeight: 'bold' } : undefined}>
              rent <strong>{rent}</strong>, due day {clockOf(state.rentDueTick).day} at dawn —{' '}
              {state.coin >= rent ? 'covered' : `short ${rent - state.coin}`}
              {rentUrgent ? ' — and the agent is nearly at the door' : ''}
            </p>
            {/* §20.1 (M5½ playtest) — the day ahead: the book's guess at what
                the standing orders take in, against the wages. Never prices
                the player's own hands, and says so. */}
            <p
              title="What the standing orders should take in over the next day — trips priced off each route, capped by the town's appetite and the lugger's. A guess: it prices the orders, never your own hands."
              style={{
                color: forecast.takings >= forecast.wages ? undefined : HEAT_RED,
              }}
            >
              the day ahead (the book&rsquo;s guess): takings ~
              <strong>{forecast.takings}</strong> · wages {forecast.wages} · net{' '}
              {forecast.takings - forecast.wages >= 0 ? '+' : ''}
              {forecast.takings - forecast.wages}
            </p>
            {(rentUrgent || anyLadenCart) && (
              <div className="menu-buttons">
                <button
                  title="Every cart holding contraband turns for Ryne with the fence taking the remainder; carts already in town fence their load at once. Raise cash first; apologise to the routes later."
                  onClick={soundTheAlarm}
                >
                  Sound the alarm — every laden cart to the fence
                </button>
              </div>
            )}
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
              {/* §6.10 (M5c playtest) — the charge, read aloud BEFORE the
                  audit: a shorted page with lawful sales is pure self-harm,
                  and the game says so while the pen can still fix it. */}
              {l.penTaken && auditGapNow(state) > 0.5 && (
                <p style={{ color: HEAT_RED }}>
                  If the stapler read this page now: ~
                  <strong>{Math.round(auditGapNow(state))}</strong> fleece adrift — the audit
                  will price every one of them in Heat. A shorted page only pays when the
                  surplus goes over the gunwale.
                </p>
              )}
              {l.penTaken && (
                <div className="menu-buttons">
                  <button
                    title="The agent resumes keeping the book square with the flock. An honest page needs no bookkeeping — and prices no gap."
                    onClick={() => enqueue({ type: 'returnPen' })}
                  >
                    Hand the pen back — let the agent keep it square
                  </button>
                </div>
              )}
            </section>
          )}

          {(state.nationalHeatFloor > 0 || state.leiden.heldLetters.length > 0) && (
            <section>
              <h5>the societies</h5>
              {state.nationalHeatFloor > 0 && (
                <>
                  <p>
                    London&rsquo;s memory of this parish never falls below{' '}
                    <strong>{Math.round(state.nationalHeatFloor)}</strong> now. Print is for ever.
                  </p>
                  {/* §6.14 (M5½ playtest) — say what the floor IS: the national
                      meter is the one the Crown musters off. */}
                  <p className="ledger-hint">
                    The parish cools by morning; London does not, and never now below this. It is
                    the meter the Crown reads when it decides who rides.
                  </p>
                </>
              )}
              {state.leiden.heldLetters.length > 0 && (
                <p className="ledger-hint">
                  {state.leiden.heldLetters.length} letter
                  {state.leiden.heldLetters.length === 1 ? '' : 's'} held in the strongbox — he
                  minds, and the parish minds with him.
                </p>
              )}
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
