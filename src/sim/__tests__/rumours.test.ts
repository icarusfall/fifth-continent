// Spec §6.9 (M5a-4) — asking on the quay: a fixed rumour chain, priced in
// coin and trust, whose last link opens the Dutchman days before the first
// rent would. The rent remains the unasked floor (rent.test.ts holds that).

import { describe, expect, it } from 'vitest';
import { ROUND_COST, RUMOUR_TRUST, TICKS_PER_DAY } from '../balance';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

/** A farmer with his own cart on the Ryne quay and some wool on the books. */
function quayState(soldLawfully: number, coin = 50): GameState {
  const s = initialState(1);
  s.coin = coin;
  s.ledger.soldLawfully = soldLawfully;
  s.carts[0].location = { kind: 'node', nodeId: 'ryne' };
  return s;
}

describe('asking on the quay (spec §6.9, M5a-4)', () => {
  it('a round buys the next rumour, at a price', () => {
    const s = tick(quayState(RUMOUR_TRUST[0]), [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(1);
    expect(s.coin).toBe(50 - ROUND_COST);
    expect(s.dutchman.unlocked).toBe(false); // one rumour is not the hour
  });

  it('the quay refuses a stranger: trust is lawful wool sold', () => {
    const s = tick(quayState(RUMOUR_TRUST[0] - 1), [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(0);
    expect(s.coin).toBe(50); // the coin stays on the bar
  });

  it('once a day, and no more', () => {
    let s = tick(quayState(RUMOUR_TRUST[1]), [{ type: 'buyRound' }]);
    s = tick(s, [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(1);
    expect(s.coin).toBe(50 - ROUND_COST);
    s.tick += TICKS_PER_DAY; // tomorrow is another thirst
    s = tick(s, [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(2);
    expect(s.coin).toBe(50 - 2 * ROUND_COST);
  });

  it('no cart of yours on the quay, no round', () => {
    const s0 = quayState(RUMOUR_TRUST[0]);
    s0.carts[0].location = { kind: 'node', nodeId: 'farm' };
    const s = tick(s0, [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(0);
  });

  it('a hired man will not ask around for you', () => {
    const s0 = quayState(RUMOUR_TRUST[0]);
    s0.carts[0].carter = { from: 'farm', to: 'ryne', good: 'fleece' };
    const s = tick(s0, [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(0);
  });

  it('an empty till buys no rounds', () => {
    const s = tick(quayState(RUMOUR_TRUST[0], ROUND_COST - 1), [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(0);
  });

  it('the third rumour opens the shingle — days before the rent would', () => {
    let s = quayState(RUMOUR_TRUST[RUMOUR_TRUST.length - 1]);
    for (let n = 0; n < RUMOUR_TRUST.length; n++) {
      s = tick(s, [{ type: 'buyRound' }]);
      s.tick += TICKS_PER_DAY;
    }
    expect(s.rumoursHeard).toBe(RUMOUR_TRUST.length);
    expect(s.dutchman.unlocked).toBe(true);
    expect(s.rentPaid).toBe(0); // earned on the quay, not squeezed at the door
  });

  it('an unlocked quay has nothing left to sell', () => {
    const s0 = quayState(RUMOUR_TRUST[0]);
    s0.dutchman.unlocked = true;
    const s = tick(s0, [{ type: 'buyRound' }]);
    expect(s.rumoursHeard).toBe(0);
    expect(s.coin).toBe(50);
  });
});
