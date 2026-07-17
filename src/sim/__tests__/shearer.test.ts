// Spec §6.16 — the shearer and the flock market, and §6.14's first bench
// project. The centrepiece is the designed identity: the fully hired farm
// pays the rent to the coin, and not one coin more.

import { describe, expect, it } from 'vitest';
import {
  CARTER_WAGE,
  DAILY_DEMAND,
  FALSE_BOTTOM_COVER,
  FALSE_BOTTOM_EXPOSURE_MULT,
  FLEECE_PER_HEAD_PER_DAY,
  FLOCK_CAP,
  RENT_AMOUNT,
  RENT_PERIOD_DAYS,
  RESEARCH_COST,
  RESEARCH_DAYS,
  SHEARER_WAGE,
  SHEARING_HOUR,
  SHEEP_PRICE_BUY,
  SHEEP_PRICE_SELL,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

function runTicks(state: GameState, n: number, actions: (s: GameState) => Action[] = () => []): GameState {
  let s = state;
  for (let i = 0; i < n; i++) {
    const acts = actions(s);
    if (s.rentPending) acts.unshift({ type: 'payRent' });
    s = tick(s, acts);
  }
  return s;
}

describe('the designed identity (spec §6.16 — check it in a test)', () => {
  it('flock × price − carter − shearer = rent per day, to the coin', () => {
    expect(
      STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY * WOOL_PRICE_DOMESTIC - CARTER_WAGE - SHEARER_WAGE,
    ).toBe(RENT_AMOUNT / RENT_PERIOD_DAYS);
  });

  it('the town buys just over the starting clip: surplus wool is owling, not income', () => {
    expect(DAILY_DEMAND.fleece).toBeGreaterThanOrEqual(STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY);
    expect(DAILY_DEMAND.fleece).toBeLessThan(FLOCK_CAP * FLEECE_PER_HEAD_PER_DAY);
  });

  it('the fully hired farm survives two rent periods hands-free', () => {
    // Hire the shearer and a carter on day one, then touch nothing but the
    // rent card. The farm must pay its way — barely — without a single verb.
    let s = { ...initialState(11), coin: 20 }; // float for the first wages
    s = tick(s, [
      { type: 'hireShearer' },
      { type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } },
    ]);
    s = runTicks(s, 2 * RENT_PERIOD_DAYS * TICKS_PER_DAY + DAWN + 2);
    expect(s.lost).toBe(false);
    expect(s.flockSize).toBe(STARTING_FLOCK); // no distraint along the way
    expect(s.shearer.hired).toBe(true); // nobody walked off
    expect(s.carts[0].carter).not.toBeNull();
    expect(s.rentPaid).toBe(2 * RENT_AMOUNT);
  });
});

describe('the shearer (spec §6.16)', () => {
  it('shears the clip into the barn at dawn and draws his wage', () => {
    let s = { ...initialState(12), coin: 10 };
    s = tick(s, [{ type: 'shear' }]); // clear the opening clip by hand
    s = tick(s, [{ type: 'hireShearer' }]);
    const coinBefore = s.coin;
    s = runTicks(s, DAWN + 2 - s.tick); // through the first dawn
    expect(s.coin).toBe(coinBefore - SHEARER_WAGE);
    expect(s.fleeceReady).toBe(0);
    expect(s.stores.farm?.fleece).toBe(2 * STARTING_FLOCK); // hand clip + dawn clip
  });

  it('walks off the morning the wage cannot be met', () => {
    let s = { ...initialState(13), coin: 0 };
    s = tick(s, [{ type: 'hireShearer' }]);
    s = runTicks(s, DAWN + 2 - s.tick);
    expect(s.shearer.hired).toBe(false);
    expect(s.fleeceReady).toBeGreaterThan(0); // the wool stayed on the sheep
  });

  it('counts hand-shears toward his offer', () => {
    let s = initialState(14);
    s = tick(s, [{ type: 'shear' }]);
    expect(s.shearer.handShears).toBe(1);
  });
});

describe('the flock market (spec §6.16)', () => {
  it('bought sheep cost now and join at the next dawn', () => {
    let s = { ...initialState(15), coin: 100 };
    s = tick(s, [{ type: 'buySheep', qty: 4 }]);
    expect(s.coin).toBe(100 - 4 * SHEEP_PRICE_BUY);
    expect(s.flockSize).toBe(STARTING_FLOCK);
    expect(s.sheepArriving).toBe(4);
    s = runTicks(s, DAWN + 2 - s.tick);
    expect(s.flockSize).toBe(STARTING_FLOCK + 4);
    expect(s.sheepArriving).toBe(0);
  });

  it('the pasture is a wall: no purchase past FLOCK_CAP', () => {
    let s = { ...initialState(16), coin: 1000 };
    s = tick(s, [{ type: 'buySheep', qty: 99 }]);
    expect(s.flockSize + s.sheepArriving).toBe(FLOCK_CAP);
    const again = tick(s, [{ type: 'buySheep', qty: 1 }]);
    expect(again.flockSize + again.sheepArriving).toBe(FLOCK_CAP);
  });

  it('sold sheep pay cash, thin the wool on the backs, and clamp the books', () => {
    let s = { ...initialState(17), coin: 0 };
    // Opening clip still on the sheep: 12 ready, declared 12.
    s = tick(s, [{ type: 'sellSheep', qty: 4 }]);
    expect(s.coin).toBe(4 * SHEEP_PRICE_SELL);
    expect(s.flockSize).toBe(STARTING_FLOCK - 4);
    expect(s.fleeceReady).toBe(s.flockSize * FLEECE_PER_HEAD_PER_DAY);
    expect(s.ledger.declaredYield).toBeLessThanOrEqual(s.flockSize);
  });

  it('a grown flock clips more wool than the town will buy', () => {
    let s = { ...initialState(18), coin: 1000 };
    s = tick(s, [{ type: 'buySheep', qty: FLOCK_CAP - STARTING_FLOCK }]);
    s = runTicks(s, DAWN + 2 - s.tick); // they arrive, shorn of the morning
    s = runTicks(s, TICKS_PER_DAY); // the first full-flock dawn
    expect(s.flockSize).toBe(FLOCK_CAP);
    const clip = s.flockSize * FLEECE_PER_HEAD_PER_DAY;
    expect(clip).toBeGreaterThan(DAILY_DEMAND.fleece); // the surplus is owling (§6.16)
  });
});

describe('the research bench (spec §6.14)', () => {
  it('one project at a time, coin up front, done when the days are served', () => {
    let s = { ...initialState(19), coin: 100 };
    s = tick(s, [{ type: 'startResearch', tree: 'trade' }]);
    expect(s.coin).toBe(100 - RESEARCH_COST.trade[0]);
    expect(s.research.active?.tree).toBe('trade');
    const second = tick(s, [{ type: 'startResearch', tree: 'trade' }]);
    expect(second.coin).toBe(s.coin); // the bench holds one project
    s = runTicks(s, RESEARCH_DAYS.trade[0] * TICKS_PER_DAY + 1);
    expect(s.research.active).toBeNull();
    expect(s.research.completed.trade).toBe(1);
  });

  it('marsh and leiden wait on their unlocks', () => {
    let s = { ...initialState(20), coin: 1000 };
    s = tick(s, [{ type: 'startResearch', tree: 'marsh' }]);
    expect(s.research.active).toBeNull();
    s = tick(s, [{ type: 'startResearch', tree: 'leiden' }]);
    expect(s.research.active).toBeNull();
    expect(s.coin).toBe(1000); // no coin taken for a refusal
  });

  it('the false bottom quiets the road and hides from the road-stop', () => {
    expect(FALSE_BOTTOM_EXPOSURE_MULT).toBeLessThan(1);
    expect(FALSE_BOTTOM_COVER).toBeGreaterThan(0);
    // Route heat: same cargo, same road, quieter with the hollow floor.
    const base = { ...initialState(21), coin: 0 };
    const fitted = JSON.parse(JSON.stringify(base)) as GameState;
    fitted.research.completed.trade = 1;
    for (const s of [base, fitted]) {
      s.carts[0].cargo = { tea: 4 };
      s.carts[0].location = { kind: 'edge', edgeId: 'high-road', from: 'farm', to: 'ryne', progress: 0 };
    }
    const afterBase = tick(base, []);
    const afterFitted = tick(fitted, []);
    expect(afterFitted.heat.regional).toBeCloseTo(
      afterBase.heat.regional * FALSE_BOTTOM_EXPOSURE_MULT,
      6,
    );
  });
});
