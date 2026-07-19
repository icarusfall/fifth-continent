import { describe, expect, it } from 'vitest';
import {
  RENT_AMOUNT,
  RENT_PERIOD_DAYS,
  SHEARING_HOUR,
  SHEEP_VALUE,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from '../balance';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

const FIRST_DUE = RENT_PERIOD_DAYS * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR;

// Rent no longer auto-collects (§6.13): it is marked pending at the due dawn
// and settled by a payRent action. Like the headless bots, this helper meets
// the agent at once, so the §6.8 arithmetic below is unchanged.
function runTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, s.rentPending ? [{ type: 'payRent' }] : []);
  return s;
}

// The agent knocks at the due tick; the coin moves on the next. A short margin
// past each due date lets the pending rent settle before the assertions.
const SETTLE = 2;

/** A fresh game with coin set by fiat for the scenario. */
function placedWithCoin(coin: number): GameState {
  return { ...initialState(1), coin };
}

describe('rent (spec §6.8)', () => {
  it('the tenancy schedules the first due dawn, six days out', () => {
    expect(initialState(1).rentDueTick).toBe(FIRST_DUE);
  });

  it('collects in full when the coin is there', () => {
    let s = placedWithCoin(150);
    s = runTicks(s, FIRST_DUE - s.tick + SETTLE);
    expect(s.coin).toBe(150 - RENT_AMOUNT);
    expect(s.rentPaid).toBe(RENT_AMOUNT);
    expect(s.flockSize).toBe(STARTING_FLOCK);
    expect(s.rentDueTick).toBe(FIRST_DUE + RENT_PERIOD_DAYS * TICKS_PER_DAY);
    expect(s.log.some((e) => e.text.includes('tips his hat'))).toBe(true);
  });

  it('distrains sheep at valuation when short', () => {
    let s = placedWithCoin(70); // 50 short → ceil(50/10) = 5 sheep
    s = runTicks(s, FIRST_DUE - s.tick + SETTLE);
    expect(s.coin).toBe(0);
    expect(s.rentPaid).toBe(70);
    expect(s.flockSize).toBe(STARTING_FLOCK - Math.ceil((RENT_AMOUNT - 70) / SHEEP_VALUE));
    expect(s.lost).toBe(false);
    expect(s.log.some((e) => e.text.includes('Distraint'))).toBe(true);
    // §6.8 (M5 hub polish) — the tally the distraint card watches.
    expect(s.distraintSheep).toBe(Math.ceil((RENT_AMOUNT - 70) / SHEEP_VALUE));
  });

  it('a smaller flock grows less wool the next dawn', () => {
    let s = placedWithCoin(70);
    s = runTicks(s, FIRST_DUE - s.tick + SETTLE); // 5 seized → 7 left
    const before = s.fleeceReady;
    s = runTicks(s, TICKS_PER_DAY); // through the next dawn
    expect(s.fleeceReady - before).toBe(s.flockSize);
  });

  it('losing the whole flock forfeits the tenancy and freezes the sim', () => {
    let s = placedWithCoin(0); // 120 short → 12 sheep → all of them
    s.standing = 0; // §6.15: a parish that thinks well of you would vouch instead
    s = runTicks(s, FIRST_DUE - s.tick + SETTLE);
    expect(s.flockSize).toBe(0);
    expect(s.lost).toBe(true);
    expect(s.log.some((e) => e.text.includes('forfeit'))).toBe(true);

    // Frozen: ticks stop counting, actions do nothing.
    const after = tick(s, [{ type: 'shear' }]);
    expect(after.tick).toBe(s.tick);
    expect(JSON.stringify(after)).toBe(JSON.stringify(s));
  });

  it('rent recurs every period', () => {
    let s = placedWithCoin(1000);
    s = runTicks(s, FIRST_DUE + RENT_PERIOD_DAYS * TICKS_PER_DAY - s.tick + SETTLE);
    expect(s.rentPaid).toBe(2 * RENT_AMOUNT);
    expect(s.coin).toBe(1000 - 2 * RENT_AMOUNT);
  });

  it('the arithmetic of the squeeze: perfect play clears rent with 24 to spare', () => {
    // Spec §6.8: 12 fleece/day × 2 coin × 6 days = 144 against 120.
    expect(STARTING_FLOCK * 2 * RENT_PERIOD_DAYS - RENT_AMOUNT).toBe(24);
  });
});
