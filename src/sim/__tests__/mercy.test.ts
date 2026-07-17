// Spec §6.15 — difficulty & mercy. The dial scales the world's hand, never the
// player's yields; mercy is diegetic, visible, and priced. These tests pin the
// formulas: rent × rentMult, heat × heatMult, the Dutchman's book, the parish
// vouch, and the one-way dial.

import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  DIFFICULTY,
  DUTCHMAN_SLICE,
  DUTCHMAN_VIG,
  PARISH_VOUCH_COOLDOWN_DAYS,
  PARISH_VOUCH_COST,
  PARISH_VOUCH_STANDING,
  RENT_AMOUNT,
  RENT_PERIOD_DAYS,
  RYNE_PRICE,
  SHEARING_HOUR,
  STANDING_START,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from '../balance';
import { addHeat } from '../revenue';
import { initialState, rentAmount, tick } from '../tick';
import type { Difficulty, GameState } from '../types';

const FIRST_DUE = RENT_PERIOD_DAYS * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR;
const SETTLE = 2;

function runTicks(state: GameState, n: number, autopay = true): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, autopay && s.rentPending ? [{ type: 'payRent' }] : []);
  return s;
}

/** A cart standing in Ryne with fleece aboard, ready to sell. */
function cartInRyne(s: GameState, fleece: number): GameState {
  const next = JSON.parse(JSON.stringify(s)) as GameState;
  next.carts[0].location = { kind: 'node', nodeId: 'ryne' };
  next.carts[0].cargo = { fleece };
  return next;
}

describe('the dial (spec §6.15)', () => {
  it('scales the rent, rounded to whole coin', () => {
    for (const d of ['gentle', 'fair', 'hard'] as Difficulty[]) {
      expect(rentAmount(initialState(1, d))).toBe(Math.round(RENT_AMOUNT * DIFFICULTY[d].rentMult));
    }
    expect(rentAmount(initialState(1, 'gentle'))).toBe(90);
    expect(rentAmount(initialState(1, 'hard'))).toBe(150);
  });

  it('collects the scaled rent at the due dawn', () => {
    let s = { ...initialState(2, 'gentle'), coin: 200 };
    s = runTicks(s, FIRST_DUE + SETTLE);
    expect(s.rentPaid).toBe(90);
  });

  it('scales heat gained, never decay', () => {
    const gentle = initialState(3, 'gentle');
    const hard = initialState(3, 'hard');
    addHeat(gentle, 10, 'farm');
    addHeat(hard, 10, 'farm');
    expect(gentle.heat.regional).toBeCloseTo(8);
    expect(hard.heat.regional).toBeCloseTo(12);
    // The stain follows the scaled amount too: the world noticing is the world's hand.
    expect(gentle.revenue.suspicion.farm).toBeLessThan(hard.revenue.suspicion.farm);
  });

  it('turns one way: down, never up, logged as an action', () => {
    let s = initialState(4, 'fair');
    s = tick(s, [{ type: 'setDifficulty', difficulty: 'hard' }]);
    expect(s.difficulty).toBe('fair'); // no raising
    s = tick(s, [{ type: 'setDifficulty', difficulty: 'gentle' }]);
    expect(s.difficulty).toBe('gentle');
    s = tick(s, [{ type: 'setDifficulty', difficulty: 'fair' }]);
    expect(s.difficulty).toBe('gentle'); // and never back
  });
});

describe("the Dutchman's book (spec §6.15)", () => {
  /** At the rent dawn, short by exactly `coin`, with the Dutchman known. */
  function shortAtRentDay(coin: number): GameState {
    let s = { ...initialState(5), coin: 200 };
    s = runTicks(s, FIRST_DUE + SETTLE); // first rent felt: the Dutchman is unlocked
    expect(s.dutchman.unlocked).toBe(true);
    s.coin = coin;
    s = runTicks(s, s.rentDueTick - s.tick + 1, false); // to the second knock, unpaid
    expect(s.rentPending).toBe(true);
    return s;
  }

  it('covers the shortfall at the vig, and the rent is paid in full', () => {
    const short = shortAtRentDay(100); // 20 short of 120
    const s = tick(short, [{ type: 'takeDutchmanLoan' }]);
    expect(s.rentPending).toBe(false);
    expect(s.coin).toBe(0); // the covered rent went straight out the door
    expect(s.flockSize).toBe(short.flockSize); // no distraint
    expect(s.dutchmanBook).toBe(Math.ceil(20 * DUTCHMAN_VIG)); // 25
  });

  it('repays as a top-slice of every later sale until the book clears', () => {
    let s = tick(shortAtRentDay(100), [{ type: 'takeDutchmanLoan' }]);
    expect(s.dutchmanBook).toBe(25);
    s = cartInRyne(s, CART_CAPACITY);
    const before = s.coin;
    s = tick(s, [{ type: 'sell', cartId: 'cart-1', good: 'fleece' }]);
    const proceeds = CART_CAPACITY * RYNE_PRICE.fleece; // 16
    const slice = Math.floor(proceeds * DUTCHMAN_SLICE); // 8
    expect(s.coin).toBe(before + proceeds - slice);
    expect(s.dutchmanBook).toBe(25 - slice);
  });

  it('one loan at a time, and no loan before the Dutchman is known', () => {
    // Before the first rent: the lugger has never come, and nobody covers a stranger.
    let fresh = { ...initialState(6), coin: 0 };
    fresh = runTicks(fresh, FIRST_DUE + 1, false);
    const refused = tick(fresh, [{ type: 'takeDutchmanLoan' }]);
    expect(refused.dutchmanBook).toBe(0);
    expect(refused.rentPending).toBe(true); // still at the door

    // With a book open, a second loan is refused flat.
    const s = tick(shortAtRentDay(100), [{ type: 'takeDutchmanLoan' }]);
    const again = { ...s, rentPending: true, coin: 0 };
    const denied = tick(again, [{ type: 'takeDutchmanLoan' }]);
    expect(denied.dutchmanBook).toBe(s.dutchmanBook); // unchanged
  });
});

describe('the parish vouches (spec §6.15)', () => {
  it('covers a forfeit-grade distraint, priced in Standing, once per cooldown', () => {
    let s = { ...initialState(7), coin: 0 }; // nothing: distraint would take all 12
    s = runTicks(s, FIRST_DUE + SETTLE);
    expect(s.lost).toBe(false);
    expect(s.flockSize).toBe(12); // the flock stands
    expect(s.vouches).toBe(1);
    expect(s.standing).toBeCloseTo(STANDING_START - PARISH_VOUCH_COST, 0);
    expect(s.vouchCooldownUntil).toBeGreaterThan(s.tick);
    expect(s.vouchCooldownUntil - s.lastCrisisTick).toBe(
      PARISH_VOUCH_COOLDOWN_DAYS * TICKS_PER_DAY,
    );
  });

  it('does not vouch below the Standing bar — the forfeit stands', () => {
    let s = { ...initialState(8), coin: 0 };
    // Low enough that six dawns of drift (§6.13 recovery) cannot reach the bar.
    s.standing = 0;
    s = runTicks(s, FIRST_DUE + SETTLE);
    expect(s.lost).toBe(true);
  });

  it('does not vouch inside the cooldown', () => {
    let s = { ...initialState(9), coin: 0 };
    s.vouchCooldownUntil = FIRST_DUE + TICKS_PER_DAY; // vouched for, recently
    s = runTicks(s, FIRST_DUE + SETTLE);
    expect(s.lost).toBe(true);
  });

  it('an ordinary distraint is not vouched for — sheep are taken as ever', () => {
    let s = { ...initialState(10), coin: 70 }; // 50 short → 5 sheep, tenancy survives
    s = runTicks(s, FIRST_DUE + SETTLE);
    expect(s.flockSize).toBe(7);
    expect(s.vouches).toBe(0);
  });
});
