// The Cutting House and its refiner (stage 2). Moved verbatim.



import { GOOD_LABEL, storeSummary } from '../format';
import { CUTS, CUTTING_HOUSE_STORE_CAPACITY, CUT_SUGAR_COST, REFINER_UNLOCK, REFINER_WAGE, RYNE_PRICE, SMOUCH_COST, SMOUCH_YIELD } from '../../sim/balance';
import type { CutDepth, GameState } from '../../sim/types';
import { CartsAtNode } from './CartRows';
import { Group, StoreFill, cargoCount, useEnqueue } from './shared';
import { CellarRow, FortifyRow, GarrisonRow, WorkshopRow } from './works';
export function CuttingHouseMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const store = state.stores['cutting-house'] ?? {};
  const stored = cargoCount(store);
  const room = CUTTING_HOUSE_STORE_CAPACITY - stored;
  const tubs = store.jenever ?? 0;
  const cuttable = Math.min(tubs, Math.floor(state.coin / CUT_SUGAR_COST));
  const chests = store.tea ?? 0;
  // Smouching nets one unit a chest (two out, one in), so room caps it directly.
  const smouchable = Math.min(chests, Math.floor(state.coin / SMOUCH_COST), Math.max(0, room));

  return (
    <>
      <h4>The Cutting House</h4>
      <p className="flavour">
        In store {stored}/{CUTTING_HOUSE_STORE_CAPACITY}: {storeSummary(store, 'bare shelves')}.
      </p>
      <StoreFill count={stored} cap={CUTTING_HOUSE_STORE_CAPACITY} />

      <div className="menu-buttons">
        {tubs > 0 &&
          (['gentle', 'standard', 'deep'] as CutDepth[]).map((depth) => {
            const { yield: perTub, brandy } = CUTS[depth];
            return (
              <button
                key={depth}
                disabled={cuttable <= 0}
                title={
                  cuttable <= 0
                    ? room <= 0
                      ? 'The store is full — move the brandy on before cutting more.'
                      : 'Burnt sugar costs coin, and the till is empty.'
                    : `Sugar: ${cuttable * CUT_SUGAR_COST} coin.`
                }
                onClick={() => enqueue({ type: 'cut', depth, tubs: 99 })}
              >
                Cut {depth} · {cuttable} tubs → {cuttable * perTub} {GOOD_LABEL[brandy]} (
                {RYNE_PRICE[brandy]} coin ea)
              </button>
            );
          })}
        {chests > 0 && (
          <button
            disabled={smouchable <= 0}
            title={
              smouchable <= 0
                ? room <= 0
                  ? 'The store is full — move the leaf on before smouching more.'
                  : 'Ash and sloe cost coin, and the till is empty.'
                : `Ash & sloe: ${smouchable * SMOUCH_COST} coin. Bulk sells cheap, but sells.`
            }
            onClick={() => enqueue({ type: 'smouch', chests: 99 })}
          >
            Smouch · {smouchable} chests → {smouchable * SMOUCH_YIELD} {GOOD_LABEL['bulked-tea']} (
            {RYNE_PRICE['bulked-tea']} coin ea)
          </button>
        )}
      </div>

      <RefinerRow state={state} />

      <Group id="house-works" title={<>works &amp; men</>}>
        <FortifyRow state={state} nodeId="cutting-house" />
        <CellarRow state={state} nodeId="cutting-house" />
        <GarrisonRow state={state} nodeId="cutting-house" />
        <WorkshopRow state={state} nodeId="cutting-house" />
      </Group>

      <Group id="house-yard" title="the yard">
        <CartsAtNode state={state} nodeId="cutting-house" />
      </Group>
    </>
  );
}


/**
 * Spec §6.17 — the refiner: offered once the chore is felt (six hand cuts and
 * smouches together, or a carter already on the reins — the §6.11 pattern).
 * Hired, he takes a standing instruction: a cut depth, and a smouch toggle.
 */
export function RefinerRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const r = state.refiner;
  const offered =
    r.hired || r.handRefines >= REFINER_UNLOCK || state.carts.some((c) => c.carter !== null);
  if (!offered) return null;
  if (!r.hired) {
    return (
      <div className="menu-buttons">
        <button
          title="At dawn he cuts every tub at your standing depth, and smouches the leaf if told to. He does nothing else, and asks nothing."
          onClick={() => enqueue({ type: 'hireRefiner' })}
        >
          Hire a refiner · {REFINER_WAGE} coin a day
        </button>
      </div>
    );
  }
  return (
    <>
      <p className="flavour">
        The refiner works the house at dawn: cut {r.cutDepth},{' '}
        {r.smouch ? 'and smouch the leaf' : 'leaf left alone'} · {REFINER_WAGE} coin a day.
      </p>
      <div className="menu-buttons">
        {(['gentle', 'standard', 'deep'] as CutDepth[])
          .filter((depth) => depth !== r.cutDepth)
          .map((depth) => (
            <button
              key={depth}
              onClick={() => enqueue({ type: 'setRefinerOrders', cutDepth: depth, smouch: r.smouch })}
            >
              Have him cut {depth} · {CUTS[depth].yield} {GOOD_LABEL[CUTS[depth].brandy]} a tub
            </button>
          ))}
        <button
          title={
            r.smouch
              ? 'The bohea stays bohea: the fine market pays better a chest, and buys less.'
              : 'Ash and sloe at dawn: every chest becomes two of bulked tea for the cheap market.'
          }
          onClick={() => enqueue({ type: 'setRefinerOrders', cutDepth: r.cutDepth, smouch: !r.smouch })}
        >
          {r.smouch ? 'Have him leave the leaf alone' : 'Have him smouch the leaf too'}
        </button>
        <button
          title="The cutting and the smouching become your hands again."
          onClick={() => enqueue({ type: 'dismissRefiner' })}
        >
          Dismiss the refiner
        </button>
      </div>
    </>
  );
}
