// Spec §6.19 (M5½d) — the round: a standing order with more than one stop.
// The engine is deterministic, so every expectation here is exact.
//
// The playtest that forced this section (2026-08): a Steam Lighter that can
// only ply shingle↔Ryne could not be given ANY order — the shingle keeps no
// store, so nothing could be loaded there, and the four-beat sentence bought
// only at the turn-around. Its round is the first test below.

import { describe, expect, it } from 'vitest';
import {
  CARTER_DANGER_WAGE,
  CARTER_MAX_STOPS,
  CARTER_WAGE,
  DUTCHMAN_PRICE,
  RYNE_PRICE,
  TICKS_PER_DAY,
} from '../balance';
import { carterWageOf, initialState, stopsFromLegacy, tick } from '../tick';
import type { Action, CarterStop, GameState } from '../types';

function runTicks(state: GameState, n: number, at: Record<number, Action[]> = {}): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, at[s.tick] ?? []);
  return s;
}

/** A world where the coast is open and the lugger is standing off with lace. */
function coastOpen(seed = 1): GameState {
  const s = initialState(seed);
  s.coin = 400;
  s.dutchman.unlocked = true;
  s.dutchman.met = true;
  s.dutchman.present = true;
  s.dutchman.hold = { lace: 12 };
  return s;
}

const order = (stops: CarterStop[]): Action => ({
  type: 'hireCarter',
  cartId: 'cart-1',
  order: { stops },
});

describe('§6.19 — the model is a generalisation, not a rewrite', () => {
  it('maps the old four-beat sentence onto stops exactly', () => {
    expect(stopsFromLegacy({ from: 'farm', to: 'ryne', good: 'fleece' })).toEqual({
      stops: [{ at: 'farm', take: 'fleece' }, { at: 'ryne' }],
    });
    expect(
      stopsFromLegacy({
        from: 'farm',
        to: 'shingle',
        good: 'fleece',
        maxLoad: 4,
        back: 'tea',
        backTo: 'cutting-house',
      }),
    ).toEqual({
      stops: [
        { at: 'farm', take: 'fleece', max: 4 },
        { at: 'shingle', take: 'tea' },
        { at: 'cutting-house' },
      ],
    });
  });

  it('still accepts the old shape from an action — a saved log replays for ever', () => {
    const s = tick(initialState(1), [
      { type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } },
    ]);
    expect(s.carts[0].carter?.stops).toHaveLength(2);
  });
});

describe('§6.19 — the refusals', () => {
  const refused = (stops: CarterStop[]): boolean => {
    const s = tick(initialState(1), [order(stops)]);
    return s.carts[0].carter === null;
  };

  it('refuses a round that is a place, not a journey', () => {
    expect(refused([{ at: 'farm', take: 'fleece' }])).toBe(true);
  });

  it('refuses a round that picks nothing up anywhere', () => {
    expect(refused([{ at: 'farm' }, { at: 'ryne' }])).toBe(true);
  });

  it('collapses the same call twice, including across the wrap', () => {
    let s = tick(initialState(1), [
      order([{ at: 'farm', take: 'fleece' }, { at: 'farm' }, { at: 'ryne' }]),
    ]);
    expect(s.carts[0].carter?.stops.map((x) => x.at)).toEqual(['farm', 'ryne']);
    // …and a last stop that repeats the first is the wrap said twice.
    s = tick(initialState(1), [
      order([{ at: 'farm', take: 'fleece' }, { at: 'ryne' }, { at: 'farm' }]),
    ]);
    expect(s.carts[0].carter?.stops.map((x) => x.at)).toEqual(['farm', 'ryne']);
  });

  it('keeps the sentence short enough to say', () => {
    const s = tick(initialState(1), [
      order([
        { at: 'farm', take: 'fleece' },
        { at: 'ryne' },
        { at: 'shingle' },
        { at: 'farm' },
        { at: 'ryne' },
      ]),
    ]);
    expect(s.carts[0].carter!.stops.length).toBeLessThanOrEqual(CARTER_MAX_STOPS);
  });
});

describe('§6.19 — the wage is read over the whole round', () => {
  it('pays the honest rate for an honest round, of any length', () => {
    expect(carterWageOf({ stops: [{ at: 'farm', take: 'fleece' }, { at: 'ryne' }] })).toBe(
      CARTER_WAGE,
    );
    expect(
      carterWageOf({
        stops: [
          { at: 'farm', take: 'fleece' },
          { at: 'cutting-house' },
          { at: 'ryne' },
        ],
      }),
    ).toBe(CARTER_WAGE);
  });

  it('one wage however many stops — and danger money if ANY stop is risky', () => {
    // Three stops, a coast call and a contraband load, and still one wage:
    // deliberately generous, and the reward for collapsing a two-cart relay
    // into one man's sentence.
    const owl = {
      stops: [
        { at: 'farm', take: 'fleece' as const },
        { at: 'shingle', take: 'lace' as const },
        { at: 'ryne', fenceRest: true },
      ],
    };
    expect(carterWageOf(owl)).toBe(CARTER_DANGER_WAGE);
    // Contraband anywhere in the round is enough, even inland.
    expect(
      carterWageOf({ stops: [{ at: 'cutting-house', take: 'brandy-fair' }, { at: 'ryne' }] }),
    ).toBe(CARTER_DANGER_WAGE);
  });
});

describe('§6.19 — the Steam Lighter’s round, which could not be written before', () => {
  it('buys off the lugger at the shingle and sells it at Ryne', () => {
    const s0 = coastOpen();
    // The lighter: a hull that plies the sea lane and nothing else.
    const lighter = s0.carts[0];
    lighter.vessel = 'sea';
    lighter.capacity = 16;
    lighter.location = { kind: 'node', nodeId: 'shingle' };
    // The order is WRITABLE at all, which is the whole complaint: the four-beat
    // sentence could load nothing at a storeless beach and bought only at the
    // turn-around, so this hull could be given no job whatever.
    const s1 = tick(s0, [order([{ at: 'shingle', take: 'lace' }, { at: 'ryne' }])]);
    expect(s1.carts[0].carter).not.toBeNull();
    expect(s1.carts[0].carter?.stops).toEqual([{ at: 'shingle', take: 'lace' }, { at: 'ryne' }]);

    // Over a few tides he buys off the lugger and sells the lace in town —
    // which the four-beat order could never do: a backhaul was only ever
    // unloaded, never sold.
    const s2 = runTicks(s1, 4 * TICKS_PER_DAY);
    expect(s2.ledger.soldLawfully).toBe(0); // lace is nobody's lawful trade
    expect(s2.contrabandSold).toBeGreaterThan(0);
    expect(DUTCHMAN_PRICE.lace!).toBeLessThan(RYNE_PRICE.lace); // and at a profit
  });
});

describe('§6.19 — the pass-through rule', () => {
  it('does nothing at a node that is not its stop', () => {
    // shingle → Ryne has no land edge (the sea lane is for hulls), so a cart
    // walks it by way of the farm. It must not unload there.
    const s0 = coastOpen();
    s0.carts[0].location = { kind: 'node', nodeId: 'shingle' };
    s0.carts[0].cargo = { lace: 6 };
    const s1 = tick(s0, [order([{ at: 'shingle', take: 'lace' }, { at: 'ryne' }])]);
    // Walk him until he next stands at the farm, mid-route.
    let s = s1;
    let guard = 0;
    while (guard++ < 4 * TICKS_PER_DAY) {
      s = tick(s, []);
      const loc = s.carts[0].location;
      if (loc.kind === 'node' && loc.nodeId === 'farm') break;
    }
    const loc = s.carts[0].location;
    if (loc.kind === 'node' && loc.nodeId === 'farm') {
      // He is standing in his own yard with contraband aboard and does not
      // touch it: the wool barn stays lawful (§6.17's deadlock, avoided).
      expect(s.stores.farm?.lace ?? 0).toBe(0);
    }
  });
});

describe('§6.19 — a market stop sells everything the town will take', () => {
  it('sells a load it did not carry out, at the stop that names the town', () => {
    const s0 = initialState(1);
    s0.cuttingHouse = { x: 24, y: 12 };
    s0.stores['cutting-house'] = { 'brandy-fair': 8 };
    s0.carts[0].location = { kind: 'node', nodeId: 'cutting-house' };
    const s1 = tick(s0, [order([{ at: 'cutting-house', take: 'brandy-fair' }, { at: 'ryne' }])]);
    expect(s1.carts[0].cargo['brandy-fair']).toBeGreaterThan(0);
    const s2 = runTicks(s1, 2 * TICKS_PER_DAY);
    expect(s2.coin).toBeGreaterThan(s0.coin);
    expect(RYNE_PRICE['brandy-fair']).toBeGreaterThan(0);
  });
});
