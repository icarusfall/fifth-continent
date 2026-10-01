// The Shingle (stage 2). Moved verbatim.



import { CUTTING_HOUSE_COST, LEIDEN_PRICE_MULT, WOOL_PRICE_DOMESTIC } from '../../sim/balance';
import type { GameState } from '../../sim/types';
import { useGameStore } from '../../state/store';
import { CartsAtNode } from './CartRows';
export function ShingleMenu({ state, onPlace }: { state: GameState; onPlace: () => void }) {
  const d = state.dutchman;
  const waiting = useGameStore((s) => s.waitingForLugger);
  const setWaiting = useGameStore((s) => s.setWaitingForLugger);
  const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
  // The cutting house is offered when overproof jenever stands on the beach with
  // no legal buyer — any cart here holding tubs, whichever one it is.
  const jeneverBeached = state.carts.some(
    (c) =>
      c.location.kind === 'node' &&
      c.location.nodeId === 'shingle' &&
      (c.cargo.jenever ?? 0) > 0,
  );

  return (
    <>
      <h4>The Shingle</h4>
      {!d.present ? (
        <>
          <p className="flavour">
            Shingle and grey water. They say a lugger stands off here some nights — after dark, on
            a falling tide, while the Customs House is counting other things.
          </p>
          <div className="menu-buttons">
            {/* §6.9 (playtest) — no foot-tapping: run the hours until he shows,
                a card interrupts, or dawn calls the vigil off. */}
            <button
              title={
                waiting
                  ? 'The hours are running. Any speed button also calls it off.'
                  : 'The clock runs fast until the lugger stands off — or dawn, if he never comes. Nothing is skipped: cards still interrupt.'
              }
              onClick={() => setWaiting(!waiting)}
            >
              {waiting ? 'Waiting on the water… · call it off' : 'Wait for the lugger · let the hours run'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="flavour">
            The Dutchman. {beachPrice} coin the fleece, and he&rsquo;ll take {d.fleeceAppetite}{' '}
            more tonight. Coin on the nail; no credit, no names, no questions in either direction.
            {!d.met
              ? ' He came to meet you, and he will wait the night out.'
              : ' Gone when the tide turns — he minds it better than you do.'}
          </p>
        </>
      )}
      {jeneverBeached && !state.cuttingHouse && (
        <>
          <p className="flavour">The tubs want cutting before any buyer in Ryne dares look at them.</p>
          <div className="menu-buttons">
            <button
              disabled={state.coin < CUTTING_HOUSE_COST}
              onClick={onPlace}
            >
              Raise a cutting house · {CUTTING_HOUSE_COST} coin
            </button>
          </div>
        </>
      )}

      <CartsAtNode state={state} nodeId="shingle" />
    </>
  );
}
