// Spec §6.9 — M2, The Crime. Every formula gets its unit test (spec §13):
// the Dutchman's window and hold, the cut table, the fixed prices, the
// daily appetite. States are built plainly and pushed through tick(); no
// randomness feeds any of these paths, so every expectation is exact.

import { describe, expect, it } from 'vitest';
import {
  CUTS,
  CUTTING_HOUSE_COST,
  CUT_SUGAR_COST,
  DAILY_DEMAND,
  DUTCHMAN_FLEECE_DEMAND,
  DUTCHMAN_HOLD,
  DUTCHMAN_PRICE,
  LEIDEN_PRICE_MULT,
  RENT_AMOUNT,
  RYNE_PRICE,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { dayPhaseOf, tideIsRising } from '../time';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

// tick() evaluates the world at the *incremented* counter, so build states
// one tick shy of the moment under test.
const NIGHT_FALLING = 120; // day 1 20:00; 121 % 76 = 45 ≥ 38 → falling
const NIGHT_RISING = 151; // day 2 01:10 ; 152 % 76 = 0 → rising
const FIRST_RENT_EVE = 6 * TICKS_PER_DAY + 5 * TICKS_PER_HOUR - 1;

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(1740);
  mutate?.(s);
  return s;
}

function atShingle(s: GameState, cargo: Partial<Record<string, number>> = {}): void {
  s.carts[0].location = { kind: 'node', nodeId: 'shingle' };
  s.carts[0].cargo = cargo;
  s.dutchman = {
    unlocked: true,
    present: true,
    hold: { ...DUTCHMAN_HOLD },
    fleeceAppetite: DUTCHMAN_FLEECE_DEMAND,
  };
  s.tick = NIGHT_FALLING; // stays in-window through the action tick
}

describe('the Dutchman — unlock (spec §6.9: the grind first)', () => {
  it('does not appear before the first rent, even on a perfect night', () => {
    const s = fresh((s) => (s.tick = NIGHT_FALLING));
    expect(dayPhaseOf(s.tick + 1)).toBe('night');
    expect(tideIsRising(s.tick + 1)).toBe(false);
    const next = tick(s, []);
    expect(next.dutchman.present).toBe(false);
  });

  // Rent is marked pending at the due dawn (§6.13) and settled by payRent the
  // next tick; the Dutchman unlocks when it is settled, paid or distrained.
  const rentSettled = (mutate: (s: GameState) => void): GameState =>
    tick(tick(fresh(mutate), []), [{ type: 'payRent' }]);

  it('the first rent, once settled, unlocks him — paid or distrained', () => {
    const paid = rentSettled((s) => {
      s.tick = FIRST_RENT_EVE;
      s.coin = RENT_AMOUNT;
    });
    expect(paid.dutchman.unlocked).toBe(true);

    const squeezed = rentSettled((s) => {
      s.tick = FIRST_RENT_EVE;
      s.coin = 50; // short: distraint, but the tenancy survives
    });
    expect(squeezed.lost).toBe(false);
    expect(squeezed.flockSize).toBeLessThan(12);
    expect(squeezed.dutchman.unlocked).toBe(true);
  });

  it('a forfeit tenancy unlocks nothing', () => {
    const lost = rentSettled((s) => {
      s.tick = FIRST_RENT_EVE;
      s.coin = 0; // 12 sheep at valuation cannot cover 120
      s.standing = 0; // §6.15: a parish that thinks well of you would vouch instead
    });
    expect(lost.lost).toBe(true);
    expect(lost.dutchman.unlocked).toBe(false);
  });
});

describe('the Dutchman — presence is night ∩ falling tide', () => {
  const unlockedAt = (t: number) =>
    tick(fresh((s) => {
      s.tick = t;
      s.dutchman.unlocked = true;
    }), []);

  it('arrives on the rising edge with a full hold and a fresh appetite', () => {
    const s = unlockedAt(NIGHT_FALLING);
    expect(s.dutchman.present).toBe(true);
    expect(s.dutchman.hold).toEqual(DUTCHMAN_HOLD);
    expect(s.dutchman.fleeceAppetite).toBe(DUTCHMAN_FLEECE_DEMAND);
    expect(s.log.some((e) => e.text.includes('lugger'))).toBe(true);
  });

  it('is absent at night on a rising tide', () => {
    expect(dayPhaseOf(NIGHT_RISING + 1)).toBe('night');
    expect(unlockedAt(NIGHT_RISING).dutchman.present).toBe(false);
  });

  it('is absent by day whatever the tide does', () => {
    const noon = 6 * TICKS_PER_HOUR * 2; // 12:00; 73 % 76 falling? irrelevant
    expect(dayPhaseOf(noon + 1)).toBe('day');
    expect(unlockedAt(noon).dutchman.present).toBe(false);
  });

  it('slips out when the window closes, and does not restock mid-visit', () => {
    // Mid-visit: present, hold partly drained. Still in-window next tick.
    const midVisit = fresh((s) => {
      s.tick = NIGHT_FALLING + 1;
      s.dutchman = { unlocked: true, present: true, hold: { jenever: 1 }, fleeceAppetite: 3 };
    });
    const still = tick(midVisit, []);
    expect(still.dutchman.present).toBe(true);
    expect(still.dutchman.hold).toEqual({ jenever: 1 }); // no mid-visit restock
    expect(still.dutchman.fleeceAppetite).toBe(3);

    // The tide turns under him: gone, with a line in the log.
    const turning = fresh((s) => {
      s.tick = NIGHT_RISING;
      s.dutchman = { unlocked: true, present: true, hold: { jenever: 1 }, fleeceAppetite: 3 };
    });
    const gone = tick(turning, []);
    expect(gone.dutchman.present).toBe(false);
    expect(gone.log.some((e) => e.text.includes('slips out'))).toBe(true);
  });
});

describe('the Dutchman — trade (no credit, no questions)', () => {
  it('buys fleece at four times the Ryne price', () => {
    const s = fresh((s) => atShingle(s, { fleece: 8 }));
    const next = tick(s, [{ type: 'sellToDutchman', cartId: 'cart-1' }]);
    expect(next.coin).toBe(8 * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
    expect(next.carts[0].cargo.fleece).toBe(0);
    expect(next.dutchman.fleeceAppetite).toBe(DUTCHMAN_FLEECE_DEMAND - 8);
  });

  it('his appetite is per-visit and finite', () => {
    const s = fresh((s) => {
      atShingle(s, { fleece: 8 });
      s.dutchman.fleeceAppetite = 3;
    });
    const next = tick(s, [{ type: 'sellToDutchman', cartId: 'cart-1' }]);
    expect(next.coin).toBe(3 * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
    expect(next.carts[0].cargo.fleece).toBe(5);
    expect(next.dutchman.fleeceAppetite).toBe(0);
  });

  it('sells nothing to an empty beach: absent means absent', () => {
    const s = fresh((s) => {
      atShingle(s, { fleece: 8 });
      s.dutchman.present = false;
    });
    const next = tick(s, [{ type: 'sellToDutchman', cartId: 'cart-1' }]);
    expect(next.coin).toBe(0);
    expect(next.carts[0].cargo.fleece).toBe(8);
  });

  it('sells tubs for coin, clamped by hold, cart room, and coin — no credit', () => {
    const roomy = fresh((s) => {
      atShingle(s);
      s.coin = 100;
    });
    // qty 99 → min(hold 12, room 8, floor(100/10)=10) = 8
    const bought = tick(roomy, [
      { type: 'buyFromDutchman', cartId: 'cart-1', good: 'jenever', qty: 99 },
    ]);
    expect(bought.carts[0].cargo.jenever).toBe(8);
    expect(bought.coin).toBe(100 - 8 * DUTCHMAN_PRICE.jenever!);
    expect(bought.dutchman.hold.jenever).toBe(DUTCHMAN_HOLD.jenever! - 8);

    const broke = fresh((s) => {
      atShingle(s);
      s.coin = 5; // less than one tub
    });
    const refused = tick(broke, [
      { type: 'buyFromDutchman', cartId: 'cart-1', good: 'jenever', qty: 1 },
    ]);
    expect(refused.carts[0].cargo.jenever ?? 0).toBe(0);
    expect(refused.coin).toBe(5);
    expect(refused.log.some((e) => e.text.includes('credit'))).toBe(true);
  });

  it('fleece is not in his hold: he sells only what he ran in', () => {
    const s = fresh((s) => {
      atShingle(s);
      s.coin = 100;
    });
    const next = tick(s, [{ type: 'buyFromDutchman', cartId: 'cart-1', good: 'fleece', qty: 5 }]);
    expect(next.carts[0].cargo.fleece ?? 0).toBe(0);
    expect(next.coin).toBe(100);
  });
});

describe('the cutting house (spec §6.9)', () => {
  it('goes up on open marsh for the asking price', () => {
    const s = fresh((s) => (s.coin = 100));
    const next = tick(s, [{ type: 'placeCuttingHouse', x: 20, y: 12 }]);
    expect(next.cuttingHouse).toEqual({ x: 20, y: 12 });
    expect(next.coin).toBe(100 - CUTTING_HOUSE_COST);
    expect(next.stores['cutting-house']).toEqual({});
  });

  it('refuses clay, sea, town, thin purses, and second helpings', () => {
    const clay = tick(fresh((s) => (s.coin = 100)), [{ type: 'placeCuttingHouse', x: 2, y: 1 }]);
    expect(clay.cuttingHouse).toBeNull();
    expect(clay.coin).toBe(100);

    const broke = tick(fresh((s) => (s.coin = CUTTING_HOUSE_COST - 1)), [
      { type: 'placeCuttingHouse', x: 20, y: 12 },
    ]);
    expect(broke.cuttingHouse).toBeNull();
    expect(broke.coin).toBe(CUTTING_HOUSE_COST - 1);

    const second = tick(fresh((s) => {
      s.coin = 200;
      s.cuttingHouse = { x: 20, y: 12 };
      s.stores['cutting-house'] = {};
    }), [{ type: 'placeCuttingHouse', x: 22, y: 12 }]);
    expect(second.cuttingHouse).toEqual({ x: 20, y: 12 });
    expect(second.coin).toBe(200);
  });

  it('cuts by the table: depth trades volume against tier', () => {
    for (const depth of ['gentle', 'standard', 'deep'] as const) {
      const s = fresh((s) => {
        s.coin = 100;
        s.cuttingHouse = { x: 20, y: 12 };
        s.stores['cutting-house'] = { jenever: 5 };
      });
      const next = tick(s, [{ type: 'cut', depth, tubs: 5 }]);
      const { yield: perTub, brandy } = CUTS[depth];
      expect(next.stores['cutting-house']![brandy]).toBe(5 * perTub);
      expect(next.stores['cutting-house']!.jenever).toBe(0);
      expect(next.coin).toBe(100 - 5 * CUT_SUGAR_COST);
    }
  });

  it('clamps the cut to tubs on hand and sugar money', () => {
    const s = fresh((s) => {
      s.coin = 3; // one tub's worth of sugar, not two
      s.cuttingHouse = { x: 20, y: 12 };
      s.stores['cutting-house'] = { jenever: 5 };
    });
    const next = tick(s, [{ type: 'cut', depth: 'deep', tubs: 99 }]);
    expect(next.stores['cutting-house']!.jenever).toBe(4);
    expect(next.stores['cutting-house']!['brandy-rough']).toBe(CUTS.deep.yield);
    expect(next.coin).toBe(3 - CUT_SUGAR_COST);
  });
});

describe('the Ryne market — fixed prices, daily appetite (spec §6.9)', () => {
  const atRyne = (cargo: Partial<Record<string, number>>) =>
    fresh((s) => {
      s.carts[0].location = { kind: 'node', nodeId: 'ryne' };
      s.carts[0].cargo = cargo;
      s.tick = 60; // mid-morning: no dawn reset mid-test
    });

  it('quality multiplies price: 0.6 / 1.0 / 1.8 of the brandy base (§17.3)', () => {
    expect(RYNE_PRICE['brandy-rough']).toBe(4);
    expect(RYNE_PRICE['brandy-fair']).toBe(6);
    expect(RYNE_PRICE['brandy-gent']).toBe(11);
  });

  it('sells at the fixed price and eats the day’s appetite', () => {
    const next = tick(atRyne({ tea: 5 }), [{ type: 'sell', cartId: 'cart-1', good: 'tea' }]);
    expect(next.coin).toBe(5 * RYNE_PRICE.tea);
    expect(next.demandRemaining.tea).toBe(DAILY_DEMAND.tea - 5);
  });

  it('a sated town buys no more until dawn', () => {
    const first = tick(atRyne({ 'brandy-fair': 10 }), [
      { type: 'sell', cartId: 'cart-1', good: 'brandy-fair' },
    ]);
    expect(first.coin).toBe(DAILY_DEMAND['brandy-fair'] * RYNE_PRICE['brandy-fair']);
    expect(first.carts[0].cargo['brandy-fair']).toBe(10 - DAILY_DEMAND['brandy-fair']);
    expect(first.demandRemaining['brandy-fair']).toBe(0);

    const again = tick(first, [{ type: 'sell', cartId: 'cart-1', good: 'brandy-fair' }]);
    expect(again.coin).toBe(first.coin);
    expect(again.log.some((e) => e.text.includes('had its fill'))).toBe(true);
  });

  it('dawn resets the appetite (saturation is a wall, not a grave)', () => {
    const sated = fresh((s) => {
      s.tick = 5 * TICKS_PER_HOUR - 1; // the tick before dawn
      s.demandRemaining = { ...DAILY_DEMAND, 'brandy-fair': 0, tea: 1 };
    });
    const dawn = tick(sated, []);
    expect(dawn.demandRemaining).toEqual(DAILY_DEMAND);
  });

  it('no buyer in Ryne touches overproof jenever', () => {
    const next = tick(atRyne({ jenever: 4 }), [{ type: 'sell', cartId: 'cart-1', good: 'jenever' }]);
    expect(next.coin).toBe(0);
    expect(next.carts[0].cargo.jenever).toBe(4);
    expect(next.log.some((e) => e.text.includes('overproof'))).toBe(true);
  });
});
