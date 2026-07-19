// Spec §6.17 — M5, the cutting house as a working hub. Beat 1: the goods and
// the verbs. Every formula gets its unit test (spec §13): smouching by the
// table, the fence's uncapped haircut, and the cutting house's own store walls.
// No randomness feeds these paths, so every expectation is exact.

import { describe, expect, it } from 'vitest';
import {
  CUTS,
  CUTTING_HOUSE_STORE_CAPACITY,
  DAILY_DEMAND,
  FARM_STORE_CAPACITY,
  FENCE_PRICE_MULT,
  RYNE_PRICE,
  SMOUCH_COST,
  SMOUCH_YIELD,
} from '../balance';
import { illicitCount } from '../revenue';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(1740);
  s.tick = 60; // mid-morning: no dawn reset mid-test
  mutate?.(s);
  return s;
}

/** A cutting house standing, with a store seeded as given. */
function withCuttingHouse(store: GameState['stores'][string], coin = 100): GameState {
  return fresh((s) => {
    s.coin = coin;
    s.cuttingHouse = { x: 20, y: 12 };
    s.stores['cutting-house'] = store;
  });
}

describe('smouching — the second market for tea (spec §6.17)', () => {
  it('stretches bohea to twice the volume, at a coin a chest', () => {
    const next = tick(withCuttingHouse({ tea: 5 }), [{ type: 'smouch', chests: 5 }]);
    expect(next.stores['cutting-house']!['bulked-tea']).toBe(5 * SMOUCH_YIELD);
    expect(next.stores['cutting-house']!.tea).toBe(0);
    expect(next.coin).toBe(100 - 5 * SMOUCH_COST);
  });

  it('clamps to the bohea on hand and the ash money', () => {
    const next = tick(withCuttingHouse({ tea: 5 }, 1), [{ type: 'smouch', chests: 99 }]);
    expect(next.stores['cutting-house']!.tea).toBe(4); // one chest's ash, one chest smouched
    expect(next.stores['cutting-house']!['bulked-tea']).toBe(SMOUCH_YIELD);
    expect(next.coin).toBe(0);
  });

  it('refuses when there is no bohea to smouch', () => {
    const next = tick(withCuttingHouse({}), [{ type: 'smouch', chests: 5 }]);
    expect(next.stores['cutting-house']!['bulked-tea'] ?? 0).toBe(0);
    expect(next.coin).toBe(100);
  });

  it('bulked tea is contraband — it heats a store like the brandy it keeps', () => {
    expect(illicitCount({ 'bulked-tea': 3 })).toBe(3);
  });
});

describe('the cutting-house store — its own walls, larger than the barn (spec §6.17)', () => {
  it('holds 32, not the barn’s 24: a cut may grow the store past 24', () => {
    // A store of 24 would be full for the barn; the cutting house has room for 8 more.
    const next = tick(withCuttingHouse({ jenever: 24 }), [
      { type: 'cut', depth: 'gentle', tubs: 99 },
    ]);
    // gentle yields 2 and nets +1 per tub: 8 tubs fill the 8 units of headroom.
    expect(next.stores['cutting-house']!.jenever).toBe(16);
    expect(next.stores['cutting-house']!['brandy-gent']).toBe(8 * CUTS.gentle.yield);
    const total = Object.values(next.stores['cutting-house']!).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(CUTTING_HOUSE_STORE_CAPACITY);
    expect(CUTTING_HOUSE_STORE_CAPACITY).toBeGreaterThan(FARM_STORE_CAPACITY);
  });

  it('a smouch cannot overflow the walls: it clamps to the room', () => {
    // 27 brandy + 4 tea = 31 of 32; one unit of headroom. Smouch nets +1 a chest.
    const next = tick(withCuttingHouse({ 'brandy-rough': 27, tea: 4 }), [
      { type: 'smouch', chests: 99 },
    ]);
    expect(next.stores['cutting-house']!['bulked-tea']).toBe(SMOUCH_YIELD); // one chest only
    expect(next.stores['cutting-house']!.tea).toBe(3);
    const total = Object.values(next.stores['cutting-house']!).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBe(CUTTING_HOUSE_STORE_CAPACITY);
  });
});

describe('the fence — the way out of a sated market (spec §6.17)', () => {
  const atRyne = (cargo: GameState['stores'][string]) =>
    fresh((s) => {
      s.carts[0].location = { kind: 'node', nodeId: 'ryne' };
      s.carts[0].cargo = cargo;
    });

  it('takes the whole load at a haircut, uncapped by the day’s appetite', () => {
    const s = atRyne({ 'brandy-fair': 8 });
    // The town's appetite for fair brandy is only 6 — the fence ignores it.
    expect(DAILY_DEMAND['brandy-fair']).toBeLessThan(8);
    const next = tick(s, [{ type: 'sellToFence', cartId: 'cart-1', good: 'brandy-fair' }]);
    const price = Math.round(RYNE_PRICE['brandy-fair'] * FENCE_PRICE_MULT);
    expect(next.carts[0].cargo['brandy-fair'] ?? 0).toBe(0);
    expect(next.coin).toBe(8 * price);
    // The fence is a back door, not the market stall: the day's demand is untouched.
    expect(next.demandRemaining['brandy-fair']).toBe(DAILY_DEMAND['brandy-fair']);
  });

  it('pays a fraction of the town price', () => {
    const next = tick(atRyne({ 'brandy-gent': 4 }), [
      { type: 'sellToFence', cartId: 'cart-1', good: 'brandy-gent' },
    ]);
    const full = 4 * RYNE_PRICE['brandy-gent'];
    expect(next.coin).toBeLessThan(full); // strictly worse than the stall
  });

  it('will not touch honest wool — that goes through the front door', () => {
    const next = tick(atRyne({ fleece: 8 }), [
      { type: 'sellToFence', cartId: 'cart-1', good: 'fleece' },
    ]);
    expect(next.carts[0].cargo.fleece).toBe(8);
    expect(next.coin).toBe(0);
  });

  it('selling contraband to the fence still tattles (heat rises)', () => {
    const before = atRyne({ 'brandy-rough': 6 });
    const next = tick(before, [{ type: 'sellToFence', cartId: 'cart-1', good: 'brandy-rough' }]);
    expect(next.heat.regional).toBeGreaterThan(before.heat.regional);
  });
});
