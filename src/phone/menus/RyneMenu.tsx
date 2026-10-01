// Ryne (stage 2). Moved verbatim.



import { GOOD_LABEL } from '../../shared/format';
import { DAILY_DEMAND, LEIDEN_PRICE_MULT, ROUND_COST, RUMOUR_TRUST, TICKS_PER_DAY, WOOL_PRICE_DOMESTIC } from '../../sim/balance';
import { CONTRABAND, illicitAnywhere } from '../../sim/revenue';
import type { GameState, Good } from '../../sim/types';
import { CartsAtNode } from './CartRows';
import { heldAnywhere, useEnqueue } from './shared';
export function RyneMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  // §6.9 (M5a-4) — asking on the quay: why the round button is greyed, if it is.
  const quayHint = !state.dutchman.unlocked
    ? Math.floor(state.tick / TICKS_PER_DAY) <= state.lastRoundDay
      ? 'The alehouse has had your coin once today. Tomorrow is another thirst.'
      : state.coin < ROUND_COST
        ? `A round for the quay is ${ROUND_COST} coin, and the till is short.`
        : state.ledger.soldLawfully < RUMOUR_TRUST[state.rumoursHeard]
          ? 'The quay talks to farmers it knows. Sell more wool at Ryne first.'
          : null
    : null;

  return (
    <>
      <h4>Ryne</h4>
      <p className="flavour">
        Wool fetches {WOOL_PRICE_DOMESTIC} coin the fleece here, and every buyer on the quay knows
        it cannot lawfully leave the country.
      </p>
      {/* §10 — no contraband is named before the player holds any: the
          appetite board grows a channel the day its good first exists. */}
      <p className="flavour">
        The town will still take today —{' '}
        {(Object.keys(DAILY_DEMAND) as Good[])
          .filter(
            (g) =>
              DAILY_DEMAND[g] > 0 &&
              // A contraband channel is named only while its good is actually
              // in your hands somewhere — no spoilers, nothing stale (§10).
              (!CONTRABAND.includes(g) || heldAnywhere(state, g) > 0),
          )
          .map((g) => `${GOOD_LABEL[g]} ${state.demandRemaining[g] ?? 0}/${DAILY_DEMAND[g]}`)
          .join(' · ')}
        .{' '}
        {state.contrabandSold > 0 || illicitAnywhere(state) > 0
          ? 'Sell past the day’s appetite and the rest waits exposed — unless a fence takes it.'
          : 'Sell past the day’s appetite and the rest waits for dawn.'}
      </p>
      {!state.dutchman.unlocked && (
        <p className="flavour">
          Across the water they pay {WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} the fleece. Not that
          anyone would know about that.
        </p>
      )}
      {!state.dutchman.unlocked && (
        <div className="menu-buttons">
          <button
            disabled={quayHint !== null}
            title={
              quayHint ??
              'Coin loosens tongues. Somebody on this quay knows where the wool really goes.'
            }
            onClick={() => enqueue({ type: 'buyRound' })}
          >
            Stand a round in the alehouse · {ROUND_COST} coin
          </button>
        </div>
      )}
      <CartsAtNode state={state} nodeId="ryne" />
    </>
  );
}
