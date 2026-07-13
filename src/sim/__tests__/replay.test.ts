import { describe, expect, it } from 'vitest';
import { SHEARING_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR, WOOL_PRICE_DOMESTIC } from '../balance';
import { deserialise, runGame, serialise } from '../run';
import { tick } from '../tick';
import type { ActionLog } from '../types';

// A hand-scripted first day: site the farm, wait for dawn, shear, load,
// take the high road (the tide has the low road at the scripted hour),
// sell, come home.
const dawn = SHEARING_HOUR * TICKS_PER_HOUR; // tick 30
const script: ActionLog = {
  0: [{ type: 'placeFarm', x: 8, y: 11 }],
  [dawn + 1]: [{ type: 'shear' }],
  [dawn + 2]: [{ type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 8 }],
  [dawn + 3]: [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }],
  [dawn + 31]: [{ type: 'sell', cartId: 'cart-1', good: 'fleece' }],
  [dawn + 32]: [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }],
};

describe('replay (spec §0: a full game is (seed, actionLog))', () => {
  it('produces a byte-identical final state when replayed', () => {
    const a = runGame(1740, script, TICKS_PER_DAY);
    const b = runGame(1740, script, TICKS_PER_DAY);
    expect(serialise(a)).toBe(serialise(b));
  });

  it('the scripted day actually plays out — wool became coin', () => {
    const s = runGame(1740, script, TICKS_PER_DAY);
    expect(s.coin).toBe(8 * WOOL_PRICE_DOMESTIC);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s.stores.farm?.fleece).toBe(4); // the shearing the cart couldn't hold
  });

  it('a different seed differs only where randomness has flowed', () => {
    const a = runGame(1, script, TICKS_PER_DAY);
    const b = runGame(2, script, TICKS_PER_DAY);
    expect(a.rngState).not.toBe(b.rngState);
    expect(a.coin).toBe(b.coin); // no random process touches the economy yet
  });

  it('survives a JSON round-trip byte-identically (persistence contract)', () => {
    const s = runGame(1740, script, TICKS_PER_DAY);
    expect(serialise(deserialise(serialise(s)))).toBe(serialise(s));
  });

  it('resumes from a mid-game save to the same final state', () => {
    // Play to noon, save, load, play on — must equal an unbroken run.
    const half = Math.floor(TICKS_PER_DAY / 2);
    const unbroken = runGame(1740, script, TICKS_PER_DAY);

    let s = runGame(1740, script, half);
    s = deserialise(serialise(s));
    for (let t = 0; t < TICKS_PER_DAY - half; t++) {
      s = tick(s, script[s.tick] ?? []);
    }
    expect(serialise(s)).toBe(serialise(unbroken));
  });
});
