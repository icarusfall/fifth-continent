// Walland Farm (stage 2): the flock rows and the farm menu. Moved verbatim.



import { storeSummary } from '../format';
import { CART_COST, CUTTING_HOUSE_COST, FARM_STORE_CAPACITY, MAX_CARTS, MAX_TUB_BOATS, RESEARCH_COST, RESEARCH_DAYS, SHEARER_UNLOCK_SHEARS, SHEARER_WAGE, SHEEP_PRICE_BUY, SHEEP_PRICE_SELL, TICKS_PER_DAY, TUB_BOAT_COST } from '../../sim/balance';
import { flockCapOf, waterwayTouches } from '../../sim/dykes';
import { illicitAnywhere } from '../../sim/revenue';
import type { GameState } from '../../sim/types';
import { CartsAtNode } from './CartRows';
import { BenchNote, Group, StoreFill, cargoCount, useEnqueue } from './shared';
import { CellarRow, FortifyRow, GarrisonRow, WorkshopRow } from './works';
/**
 * Spec §6.16 — the shearing lad: offered once the chore is felt (six hand
 * shears, or a carter already on the reins). The last chore, sold.
 */
export function ShearerRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const offered =
    state.shearer.hired ||
    state.shearer.handShears >= SHEARER_UNLOCK_SHEARS ||
    state.carts.some((c) => c.carter !== null);
  if (!offered) return null;
  return (
    <div className="menu-buttons">
      {state.shearer.hired ? (
        <button
          title="The dawn clip becomes your chore again."
          onClick={() => enqueue({ type: 'dismissShearer' })}
        >
          Dismiss the shearing lad
        </button>
      ) : (
        <button
          title="He shears the flock into the barn at dawn, and he does not count."
          onClick={() => enqueue({ type: 'hireShearer' })}
        >
          Hire the shearing lad · {SHEARER_WAGE} coin a day
        </button>
      )}
    </div>
  );
}


/** Spec §6.16 — the flock market: purchase and sale, never husbandry. */
export function FlockMarketRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const room = flockCapOf(state) - state.flockSize - state.sheepArriving;
  return (
    <>
      <p className="flavour">
        The pasture holds {flockCapOf(state)}
        {state.dykesDug.length > 0 ? ' (the drained land grazes more)' : ''}. More sheep, more
        wool, more alibi — and Ryne buys only so much honest fleece.
      </p>
      <div className="menu-buttons">
        <button
          disabled={room <= 0 || state.coin < SHEEP_PRICE_BUY}
          title={
            room <= 0
              ? 'No grass, no sheep. Walland holds what it holds.'
              : state.coin < SHEEP_PRICE_BUY
                ? `${SHEEP_PRICE_BUY} coin, and the till is short.`
                : 'The drover brings them up the drove road by dawn.'
          }
          onClick={() => enqueue({ type: 'buySheep', qty: 1 })}
        >
          Buy a sheep · {SHEEP_PRICE_BUY} coin
        </button>
        <button
          disabled={state.flockSize <= 1}
          title="The market pays cash, and pays worse than the agent values them."
          onClick={() => enqueue({ type: 'sellSheep', qty: 1 })}
        >
          Sell a sheep · {SHEEP_PRICE_SELL} coin
        </button>
      </div>
    </>
  );
}


/** Spec §6.14 — the bench: one project at a time; trade tier 1 in M5a.
 *  Offered once contraband has touched your hands (§10, playtest): hollow
 *  floors mean nothing to a farmer who has nothing to hide. */
export function BenchRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const r = state.research;
  if (
    !r.active &&
    r.completed.trade < 1 &&
    !(state.dutchman.unlocked && (state.contrabandSold > 0 || illicitAnywhere(state) > 0))
  ) {
    return null;
  }
  if (r.completed.trade >= 1) {
    return (
      <p className="flavour">
        The carts ride on hollow floors — the road reads quieter, and the road-stops miss what
        is under the boards.
      </p>
    );
  }
  if (r.active) {
    // §6.14 (M5½e) — the wheelwright's line belongs to the wheelwright's
    // project; any other tree's work reads out by name from the one bench.
    if (r.active.tree !== 'trade') return <BenchNote state={state} />;
    const days = Math.max(1, Math.ceil((r.active.doneTick - state.tick) / TICKS_PER_DAY));
    return (
      <p className="flavour">
        The wheelwright has the carts in his yard. Done in about {days} day{days === 1 ? '' : 's'}.
      </p>
    );
  }
  return (
    <div className="menu-buttons">
      <button
        disabled={state.coin < RESEARCH_COST.trade[0]}
        title={
          state.coin < RESEARCH_COST.trade[0]
            ? `${RESEARCH_COST.trade[0]} coin up front, and the till is short.`
            : 'Hollow floors under every cart: quieter roads, and road-stops miss four tubs.'
        }
        onClick={() => enqueue({ type: 'startResearch', tree: 'trade' })}
      >
        Fit false bottoms · {RESEARCH_COST.trade[0]} coin · {RESEARCH_DAYS.trade[0]} days
      </button>
    </div>
  );
}

export function FarmMenu({
  state,
  onPlace }: {
  state: GameState;
  onPlace: () => void;
}) {
  const enqueue = useEnqueue();
  const barn = state.stores.farm ?? {};
  const stored = cargoCount(barn);
  // §10 — the cutting house is offered only once the player holds overproof
  // jenever with no legal buyer: the building is caused by the problem it solves.
  const hasOverproofJenever =
    state.carts.some((c) => (c.cargo.jenever ?? 0) > 0) ||
    Object.values(state.stores).some((st) => (st.jenever ?? 0) > 0);

  return (
    <>
      <h4>Walland Farm</h4>
      {/* §6.18 (M5½e playtest) — the pasture's cap in the headline, beside the
          barn's: they are different numbers with different levers (the spade
          grows one, and 24 = 24 at the start made them read as one limit). */}
      <p className="flavour">
        {state.flockSize} sheep of a pasture for {flockCapOf(state)}
        {state.sheepArriving > 0 ? ` (+${state.sheepArriving} on the drove road)` : ''} ·{' '}
        {state.fleeceReady} wool on their backs · barn {stored}/
        {FARM_STORE_CAPACITY}: {storeSummary(barn, 'empty')}
      </p>
      <StoreFill count={stored} cap={FARM_STORE_CAPACITY} />

      <div className="popover-cols">
        <div>
          <Group id="farm-yard" title="the yard">
          <div className="menu-buttons">
            <button
              disabled={state.fleeceReady <= 0}
              title={state.fleeceReady <= 0 ? 'The wool grows by dawn.' : undefined}
              onClick={() => enqueue({ type: 'shear' })}
            >
              Shear
            </button>
            {hasOverproofJenever && !state.cuttingHouse && (
              <button
                disabled={state.coin < CUTTING_HOUSE_COST}
                title={
                  state.coin < CUTTING_HOUSE_COST
                    ? `${CUTTING_HOUSE_COST} coin, paid up front. Nobody out here gives credit.`
                    : 'Overproof jenever has no legal buyer. Cut it here with water and burnt sugar and it sells in Ryne as brandy.'
                }
                onClick={onPlace}
              >
                Raise a cutting house · {CUTTING_HOUSE_COST} coin
              </button>
            )}
            {/* §6.11 — not offered until the first rent has fallen due: before
                the squeeze is felt, 50 coin looks like a toy and is the rent. */}
            {(state.rentPending || state.dutchman.unlocked) &&
              state.carts.filter((c) => !c.vessel).length < MAX_CARTS && (
                <button
                  disabled={state.coin < CART_COST}
                  title="Cart, pony, and no questions from the wheelwright."
                  onClick={() => enqueue({ type: 'buyCart' })}
                >
                  Buy a cart · {CART_COST} coin
                </button>
              )}
            {/* §6.18 (M5½b) — a hull, not a stall: offered once water runs.
                M5½e: water that TOUCHES THE FARM — the boat launches here. */}
            {waterwayTouches(state, 'farm') &&
              state.carts.filter((c) => c.vessel === 'dyke').length < MAX_TUB_BOATS && (
                <button
                  disabled={state.coin < TUB_BOAT_COST}
                  title="Flat-bottomed, quiet as weed, and twelve tubs to the load. It rides the waterways you have dug, when the tide gives them depth."
                  onClick={() => enqueue({ type: 'buyTubBoat' })}
                >
                  Buy a tub-boat · {TUB_BOAT_COST} coin
                </button>
              )}
          </div>
          </Group>
        </div>

        <div>
          <Group id="farm-works" title={<>works &amp; men</>}>
          {/* Fortification appears once you have something worth guarding (§10). */}
          {state.dutchman.unlocked && <FortifyRow state={state} nodeId="farm" />}
          {/* §6.12 — the quiet twin, same gate as the works (§10). */}
          {state.dutchman.unlocked && <CellarRow state={state} nodeId="farm" />}
          {/* §6.13 — the men behind the works, same gate as the works. */}
          {state.dutchman.unlocked && <GarrisonRow state={state} nodeId="farm" />}
          {/* §6.14 M5c — the workshop, if the philosopher is behind these hides. */}
          <WorkshopRow state={state} nodeId="farm" />

          {/* §6.16 — the hired dawn, and the flock as a stock you trade. */}
          <ShearerRow state={state} />
          {state.dutchman.unlocked && <FlockMarketRow state={state} />}
          {state.dutchman.unlocked && <BenchRow state={state} />}
          </Group>
        </div>
      </div>

      {/* The stable roster: every cart answers to the yard, wherever its wheels
          are — and a cart standing here is loaded, sent, and hired from its own
          row, so no cart is left undirected behind the first (§20). */}
      {state.carts.length > 0 ? (
        <Group id="farm-stable" title="the stable">
          <CartsAtNode state={state} nodeId="farm" stable />
        </Group>
      ) : (
        <CartsAtNode state={state} nodeId="farm" stable />
      )}
    </>
  );
}
