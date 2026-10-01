// Spec §20.1 — THE LEDGER: the one screen that is not the map, because
// bookkeeping *is* the cover mechanic. The books and their ± controls live
// here (out of the farm popover, M5a-3), alongside the purse, the rent, the
// Dutchman's book, the day's wage bill, and the parish's regard.

import {
  CREW_WAGE,
  FLEECE_PER_HEAD_PER_DAY,
  MILITIA_WAGE,
  REFINER_WAGE,
  SHEARER_WAGE,
  TICKS_PER_DAY,
} from '../sim/balance';
import { forecastDay } from '../sim/forecast';
import { auditGapNow, CONTRABAND, darkOnHand } from '../sim/revenue';
import { whiteShare } from '../sim/wool';
import { carterWageOf, rentAmount } from '../sim/tick';
import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';
import { useUiStore } from '../state/ui';
import { DARK_WOOL, HEAT_RED, ROOF, WHITE_WOOL } from '../shared/palette';

/** §6.10 M5½f — the wool's colour, named in its colour. */
function WoolChip({ kind }: { kind: 'white' | 'dark' }) {
  return (
    <span className={`wool-chip ${kind}`} style={{ background: kind === 'white' ? WHITE_WOOL : DARK_WOOL }}>
      {kind}
    </span>
  );
}

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
  const clip = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
  const white = whiteShare(l.books, clip);
  const darkHere = darkOnHand(state);
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
              {/* §6.10 M5½f — the dial became a switch, and the lie a colour:
                  each side reads its trade aloud where it is set. */}
              <div className="books-switch" role="group" aria-label="How the books are kept">
                <button
                  className={l.books === 'square' ? 'on' : undefined}
                  aria-pressed={l.books === 'square'}
                  onClick={() => enqueue({ type: 'setBooks', books: 'square' })}
                >
                  Square
                </button>
                <button
                  className={l.books === 'short' ? 'on' : undefined}
                  aria-pressed={l.books === 'short'}
                  onClick={() => enqueue({ type: 'setBooks', books: 'short' })}
                >
                  Short
                </button>
              </div>
              <p>
                {l.books === 'square' ? (
                  <>
                    <strong>Square:</strong> every fleece grows <WoolChip kind="white" /> — Ryne
                    buys all {clip} a day. Any fleece the lugger takes shows at the audit.
                  </>
                ) : (
                  <>
                    <strong>Short:</strong> {clip - white} a day grow <WoolChip kind="dark" />,
                    free for the lugger. Ryne buys only the {white} <WoolChip kind="white" />.
                  </>
                )}
              </p>
              <p className="ledger-hint">
                {l.books === 'square'
                  ? 'Switch to Short and, from the next dawn, half of every clip grows dark.'
                  : 'Send the dark to the shingle and the white to town, and the arithmetic keeps itself.'}
              </p>
              {darkHere > 0 && (
                <p style={{ color: HEAT_RED }}>
                  {darkHere} dark fleece at the farm. If the officer comes, he counts them and writes them
                  onto the page: Heat once, and they turn white.
                </p>
              )}
              <p>
                this page: {Math.round(l.declaredToDate)} declared · {l.soldLawfully} sold at
                Ryne · {l.grownToDate} grown · {l.soldToday} weighed today
              </p>
              {/* §6.10 (M5c playtest) — the charge, read aloud BEFORE the audit. */}
              {auditGapNow(state) > 0.5 && (
                <p style={{ color: HEAT_RED }}>
                  If he read this page now: ~<strong>{Math.round(auditGapNow(state))}</strong> fleece
                  adrift — the audit prices every one of them in Heat.
                </p>
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
