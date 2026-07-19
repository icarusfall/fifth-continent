// Spec §6.17 — M5, the hub's Beat 2: the refiner. One hired hand who works
// the whole cutting house at dawn to a standing instruction — a cut depth,
// and a smouch toggle — on the shearer's pattern (§6.16). Every formula gets
// its unit test (spec §13); nothing random feeds these paths.

import { describe, expect, it } from 'vitest';
import {
  CUTS,
  CUT_SUGAR_COST,
  REFINER_UNLOCK,
  REFINER_WAGE,
  SHEARING_HOUR,
  SMOUCH_COST,
  SMOUCH_YIELD,
  TICKS_PER_HOUR,
} from '../balance';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

function runTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

/** A cutting house standing mid-morning, the refiner's world seeded as given. */
function withHouse(mutate: (s: GameState) => void): GameState {
  const s = initialState(1740);
  s.tick = 60; // mid-morning: the next dawn is a clean day away
  s.cuttingHouse = { x: 20, y: 12 };
  s.stores['cutting-house'] = {};
  mutate(s);
  return s;
}

/** Ticks from mid-morning (tick 60) to just past the next dawn. */
const TO_NEXT_DAWN = 144 + DAWN - 60 + 1;

describe('the refiner — the house that runs itself (spec §6.17)', () => {
  it('at dawn he cuts all jenever at the standing depth, for his wage', () => {
    let s = withHouse((st) => {
      st.coin = 50;
      st.stores['cutting-house'] = { jenever: 4 };
      st.refiner = { hired: true, cutDepth: 'deep', smouch: false, handRefines: 0 };
    });
    s = runTicks(s, TO_NEXT_DAWN);
    expect(s.stores['cutting-house']!.jenever).toBe(0);
    expect(s.stores['cutting-house']!['brandy-rough']).toBe(4 * CUTS.deep.yield);
    expect(s.coin).toBe(50 - REFINER_WAGE - 4 * CUT_SUGAR_COST);
  });

  it('smouches the leaf only when told to', () => {
    const seed = (smouch: boolean) =>
      withHouse((st) => {
        st.coin = 50;
        st.stores['cutting-house'] = { tea: 3 };
        st.refiner = { hired: true, cutDepth: 'standard', smouch, handRefines: 0 };
      });
    const told = runTicks(seed(true), TO_NEXT_DAWN);
    expect(told.stores['cutting-house']!.tea).toBe(0);
    expect(told.stores['cutting-house']!['bulked-tea']).toBe(3 * SMOUCH_YIELD);
    expect(told.coin).toBe(50 - REFINER_WAGE - 3 * SMOUCH_COST);

    const notTold = runTicks(seed(false), TO_NEXT_DAWN);
    expect(notTold.stores['cutting-house']!.tea).toBe(3);
    expect(notTold.stores['cutting-house']!['bulked-tea'] ?? 0).toBe(0);
  });

  it('works both trades in one dawn when both stand ready', () => {
    let s = withHouse((st) => {
      st.coin = 50;
      st.stores['cutting-house'] = { jenever: 2, tea: 2 };
      st.refiner = { hired: true, cutDepth: 'gentle', smouch: true, handRefines: 0 };
    });
    s = runTicks(s, TO_NEXT_DAWN);
    expect(s.stores['cutting-house']!.jenever).toBe(0);
    expect(s.stores['cutting-house']!['brandy-gent']).toBe(2 * CUTS.gentle.yield);
    expect(s.stores['cutting-house']!.tea).toBe(0);
    expect(s.stores['cutting-house']!['bulked-tea']).toBe(2 * SMOUCH_YIELD);
  });

  it('unpaid, he walks the same morning and the house stands idle', () => {
    let s = withHouse((st) => {
      st.coin = REFINER_WAGE - 1;
      st.stores['cutting-house'] = { jenever: 4 };
      st.refiner = { hired: true, cutDepth: 'standard', smouch: false, handRefines: 0 };
    });
    s = runTicks(s, TO_NEXT_DAWN);
    expect(s.refiner.hired).toBe(false);
    expect(s.stores['cutting-house']!.jenever).toBe(4); // untouched
    expect(s.coin).toBe(REFINER_WAGE - 1); // no wage taken
  });

  it('holds to the walls like any hand: a full house clamps the dawn cut', () => {
    let s = withHouse((st) => {
      st.coin = 100;
      // 24 jenever + 6 brandy = 30 of 32: two units of headroom. A gentle cut
      // nets +1 per tub, so only two tubs can be worked.
      st.stores['cutting-house'] = { jenever: 24, 'brandy-gent': 6 };
      st.refiner = { hired: true, cutDepth: 'gentle', smouch: false, handRefines: 0 };
    });
    s = runTicks(s, TO_NEXT_DAWN);
    expect(s.stores['cutting-house']!.jenever).toBe(22);
    expect(s.stores['cutting-house']!['brandy-gent']).toBe(6 + 2 * CUTS.gentle.yield);
  });

  it('the standing instruction is the player’s to set, and he holds to it', () => {
    const s = withHouse((st) => {
      st.refiner = { hired: true, cutDepth: 'standard', smouch: false, handRefines: 0 };
    });
    const next = tick(s, [{ type: 'setRefinerOrders', cutDepth: 'deep', smouch: true }]);
    expect(next.refiner.cutDepth).toBe('deep');
    expect(next.refiner.smouch).toBe(true);
  });

  it('hand cuts and smouches together count toward his offer', () => {
    let s = withHouse((st) => {
      st.coin = 50;
      st.stores['cutting-house'] = { jenever: 2, tea: 2 };
    });
    s = tick(s, [{ type: 'cut', depth: 'standard', tubs: 1 }]);
    s = tick(s, [{ type: 'smouch', chests: 1 }]);
    expect(s.refiner.handRefines).toBe(2);
    // A refused act is no chore: an empty house counts nothing.
    s.stores['cutting-house'] = {};
    s = tick(s, [{ type: 'cut', depth: 'standard', tubs: 1 }]);
    expect(s.refiner.handRefines).toBe(2);
    expect(REFINER_UNLOCK).toBeGreaterThan(0); // the offer has a threshold to earn
  });

  it('no cutting house, no refiner: the hire is refused', () => {
    const s = initialState(1740);
    s.tick = 60;
    const next = tick(s, [{ type: 'hireRefiner' }]);
    expect(next.refiner.hired).toBe(false);
  });
});
