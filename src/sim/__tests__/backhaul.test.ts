// Spec §6.11 (M5a-4) — the carter's back leg: `order.back` is loaded at the
// destination (from the store, or over the gunwale with the till's coin) and
// unloaded at home before the next outbound load. The 200-game relay lives
// in distribution.test.ts; these pin the mechanics one trip at a time.

import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  CARTER_DANGER_WAGE,
  CARTER_MARKET_PATIENCE_DAYS,
  CARTER_WAGE,
  DUTCHMAN_PRICE,
  LEIDEN_PRICE_MULT,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { BOT_CUTTING_HOUSE_SITE } from '../policy';
import { carterWageOf, initialState, tick } from '../tick';
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
    s.dutchman.met = true; // an old hand: the ladder is climbed (§6.9)
    s.dutchman.fleeceBought = 99;
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
    const wages = 3 * CARTER_DANGER_WAGE; // three dawns, at the shingle rate (§6.11)
    expect(s.coin).toBe(100 + sale - tubs - wages);
  });

  it('drops the backhaul at `backTo` on the way home — contraband never enters the barn (§6.17)', () => {
    let s = initialState(1);
    s.coin = 200;
    s.dutchman.unlocked = true;
    s.dutchman.met = true;
    s.dutchman.fleeceBought = 99;
    s.cuttingHouse = { ...BOT_CUTTING_HOUSE_SITE };
    s.stores['cutting-house'] = {};
    s.stores.farm = { fleece: CART_CAPACITY };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: {
          from: 'farm',
          to: 'shingle',
          good: 'fleece',
          back: 'jenever',
          backTo: 'cutting-house',
        },
      },
    ]);
    s = runTicks(s, 4 * TICKS_PER_DAY);
    // The whole owling loop, one cart: fleece over the gunwale, tubs home by
    // way of the cutting house. The wool barn never smells the jenever.
    expect(s.stores['cutting-house']?.jenever).toBe(CART_CAPACITY);
    expect(s.stores.farm?.jenever ?? 0).toBe(0);
    expect(s.carts[0].cargo.jenever ?? 0).toBe(0); // landed, not hoarded
  });

  it('a drop at either end of the run is no drop at all: backTo degrades to home', () => {
    let s = initialState(1);
    s.stores.farm = { fleece: CART_CAPACITY };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'shingle', good: 'fleece', back: 'jenever', backTo: 'shingle' },
      },
    ]);
    expect(s.carts[0].carter?.backTo).toBeUndefined();
    // And a node the map does not know (no cutting house stands) degrades too.
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: {
          from: 'farm',
          to: 'shingle',
          good: 'fleece',
          back: 'jenever',
          backTo: 'cutting-house',
        },
      },
    ]);
    expect(s.carts[0].carter?.backTo).toBeUndefined();
  });

  it('no credit: an empty till buys only what the night’s wool paid for', () => {
    let s = initialState(1);
    s.coin = 20;
    s.dutchman.unlocked = true;
    s.dutchman.met = true;
    s.dutchman.fleeceBought = 99;
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

describe('the sated market — the carter waits, exposed (spec §6.11 / §6.17)', () => {
  it('waits at the market for the appetite to refresh, and sells into the new dawn', () => {
    let s = initialState(1);
    s.tick = 60; // mid-morning: the day's appetite is spent long before dawn refreshes it
    s.coin = 100;
    // Ryne drinks only DAILY_DEMAND['brandy-fair'] = 6 a day; the cart holds 8.
    s.stores.farm = { 'brandy-fair': CART_CAPACITY };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'brandy-fair' },
      },
    ]);
    // Half a day in he has sold what the town would take and stands laden in town.
    const midday = runTicks(s, TICKS_PER_DAY / 2);
    expect(midday.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
    expect(midday.carts[0].cargo['brandy-fair']).toBeGreaterThan(0);
    expect(midday.carts[0].marketPatienceUntil).toBeDefined();
    // By the day after the next dawn, the refreshed appetite has taken the rest.
    const later = runTicks(midday, TICKS_PER_DAY);
    const held = later.carts[0].cargo['brandy-fair'] ?? 0;
    const landed = later.stores.farm?.['brandy-fair'] ?? 0;
    expect(held + landed).toBe(0); // all sold, none sloshed home
  });

  it('patience runs out: he holds his ground to the tick, then turns for home laden', () => {
    let s = initialState(1);
    s.coin = 100;
    // No buyer in Ryne touches jenever at any price: the order is a dead one.
    // (Legal to write and stupid to keep, §6.11 — the carter keeps trying it;
    // what the patience cap buys is that he no longer stands in town forever.)
    s.stores.farm = { jenever: 4 };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'jenever' },
      },
    ]);
    // Run until the sated market sets his patience clock.
    let guard = 0;
    while (s.carts[0].marketPatienceUntil === undefined && guard++ < 2 * TICKS_PER_DAY) {
      s = tick(s, []);
    }
    const until = s.carts[0].marketPatienceUntil!;
    expect(until - s.tick).toBe(CARTER_MARKET_PATIENCE_DAYS * TICKS_PER_DAY);
    // He is a fixture of the town square while it runs — laden, in plain view.
    s = runTicks(s, until - s.tick - 1);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
    expect(s.carts[0].cargo.jenever).toBe(4);
    // The tick it expires, he gives the town up and takes the load with him.
    s = runTicks(s, 2);
    const loc = s.carts[0].location;
    expect(loc.kind === 'node' && loc.nodeId === 'ryne').toBe(false);
    expect(s.carts[0].cargo.jenever).toBe(4);
    expect(s.carts[0].marketPatienceUntil).toBeUndefined();
  });
});

describe('danger money (spec §6.11, M5 tutorial pass)', () => {
  it('the honest round pays the honest rate; contraband and the shingle pay danger money', () => {
    expect(carterWageOf({ from: 'farm', to: 'ryne', good: 'fleece' })).toBe(CARTER_WAGE);
    expect(carterWageOf({ from: 'farm', to: 'shingle', good: 'fleece' })).toBe(CARTER_DANGER_WAGE);
    expect(carterWageOf({ from: 'cutting-house', to: 'ryne', good: 'brandy-fair' })).toBe(
      CARTER_DANGER_WAGE,
    );
    expect(
      carterWageOf({ from: 'farm', to: 'ryne', good: 'fleece', back: 'tea', backTo: 'farm' }),
    ).toBe(CARTER_DANGER_WAGE);
  });

  it('the dawn bill charges by the order', () => {
    let s = initialState(2);
    s.coin = 20;
    s.dutchman.unlocked = true;
    s.carts[0].carter = { from: 'farm', to: 'shingle', good: 'fleece' };
    s = runTicks(s, TICKS_PER_DAY); // through one dawn; no goods move (empty barn)
    // One dawn's wage at the danger rate has left the purse.
    expect(s.coin).toBe(20 - CARTER_DANGER_WAGE);
  });
});

describe('the load cap (spec §6.11, M5b playtest) — the wool-split lever', () => {
  it('an order with maxLoad takes at most that much per run, and no more', () => {
    let s = initialState(1);
    s.tick = 60;
    s.stores.farm = { fleece: 24 }; // a full barn: plenty to take
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'fleece', maxLoad: 4 },
      },
    ]);
    s = tick(s, []); // the carter loads and sets out
    expect(s.carts[0].cargo.fleece).toBe(4); // half a cart, as ordered
    expect(s.stores.farm?.fleece).toBe(20); // the rest stays for other rounds
  });

  it('absent means the full cart, and silly values degrade to it', () => {
    let s = initialState(1);
    s.tick = 60;
    s.stores.farm = { fleece: 24 };
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'fleece', maxLoad: 99 },
      },
    ]);
    expect(s.carts[0].carter?.maxLoad).toBeUndefined(); // ≥ capacity: dropped
    s = tick(s, []);
    expect(s.carts[0].cargo.fleece).toBe(CART_CAPACITY);

    let z = initialState(1);
    z.tick = 60;
    z = tick(z, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'fleece', maxLoad: 0 },
      },
    ]);
    expect(z.carts[0].carter?.maxLoad).toBeUndefined(); // a cap of nothing is no order
  });

  it('the cap counts what already rides aboard, so a returning remainder is honoured', () => {
    let s = initialState(1);
    s.tick = 60;
    s.stores.farm = { fleece: 24 };
    s.carts[0].cargo = { fleece: 3 }; // came home with a remainder aboard
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'ryne', good: 'fleece', maxLoad: 4 },
      },
    ]);
    s = tick(s, []);
    expect(s.carts[0].cargo.fleece).toBe(4); // topped up to the cap, not past it
  });
});
