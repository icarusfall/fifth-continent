// Spec §6.11 (M5a-4) — the carter's back leg: `order.back` is loaded at the
// destination (from the store, or over the gunwale with the till's coin) and
// unloaded at home before the next outbound load. The 200-game relay lives
// in distribution.test.ts; these pin the mechanics one trip at a time.

import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  CARTER_WAGE,
  DUTCHMAN_PRICE,
  LEIDEN_PRICE_MULT,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { BOT_CUTTING_HOUSE_SITE } from '../policy';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

describe("the carter's back leg (spec §6.11, M5a-4)", () => {
  it('shuttles a store backhaul: jenever out, brandy home to the barn', () => {
    let s = initialState(1);
    s.coin = 100;
    s.cuttingHouse = { ...BOT_CUTTING_HOUSE_SITE };
    s.stores['cutting-house'] = { 'brandy-fair': 5 };
    s.stores.farm = { jenever: 4 };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'cutting-house', good: 'jenever', back: 'brandy-fair' },
      },
    ]);
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.stores['cutting-house']?.jenever).toBe(4);
    expect(s.stores.farm?.['brandy-fair']).toBe(5);
    expect(s.carts[0].cargo['brandy-fair'] ?? 0).toBe(0); // landed, not hoarded
  });

  it("buys the shingle backhaul with the till's coin", () => {
    let s = initialState(1);
    s.coin = 100;
    s.dutchman.unlocked = true;
    s.stores.farm = { fleece: CART_CAPACITY };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'shingle', good: 'fleece', back: 'jenever' },
      },
    ]);
    s = runTicks(s, 3 * TICKS_PER_DAY);
    // One full round: the clip over the gunwale, the room filled with tubs,
    // the tubs landed in the barn. Caps: hold 12, room 8, purse plenty → 8.
    expect(s.stores.farm?.jenever).toBe(CART_CAPACITY);
    const sale = CART_CAPACITY * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
    const tubs = CART_CAPACITY * DUTCHMAN_PRICE.jenever!;
    const wages = 3 * CARTER_WAGE; // three dawns pass in three days
    expect(s.coin).toBe(100 + sale - tubs - wages);
  });

  it('no credit: an empty till buys only what the night’s wool paid for', () => {
    let s = initialState(1);
    s.coin = 20;
    s.dutchman.unlocked = true;
    s.stores.farm = { fleece: CART_CAPACITY };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'shingle', good: 'fleece', back: 'jenever' },
      },
    ]);
    s = runTicks(s, 3 * TICKS_PER_DAY);
    expect(s.coin).toBeGreaterThanOrEqual(0); // he never spends coin that is not there
    expect(s.stores.farm?.jenever ?? 0).toBeGreaterThan(0); // but the wool's coin bought tubs
  });
});
