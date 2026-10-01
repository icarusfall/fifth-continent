// Spec §6.10 M5½f — white wool and dark wool: the books become a switch, and
// the lie gets a colour. Every formula gets its unit test (spec §13), and the
// owling hub plays 200 seeded games on short books (house rule 5).

import { describe, expect, it } from 'vitest';
import {
  FARM_STORE_CAPACITY,
  FLEECE_PER_HEAD_PER_DAY,
  LEIDEN_PRICE_MULT,
  PLAUSIBLE_YIELD_MIN,
  SHEARING_HOUR,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_GAP_COEFF,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { hubPolicy } from '../policy';
import { auditGapNow, darkOnHand } from '../revenue';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';
import { capWoolOnBacks, whiteShare, woolMismatches } from '../wool';
import { breathe } from './breathe';

const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

/** Mid-morning, nothing pending: a clean bench for one rule at a time. */
function bench(mutate?: (s: GameState) => void): GameState {
  const s = initialState(2026);
  s.tick = 60;
  mutate?.(s);
  return s;
}

describe('the clip splits at dawn (§6.10 M5½f)', () => {
  it('square books grow every fleece white; short books admit the ceiling of half', () => {
    expect(whiteShare('square', 24)).toBe(24);
    expect(whiteShare('short', 24)).toBe(12);
    expect(whiteShare('short', 13)).toBe(7); // the ceil keeps the page on the floor
    expect(whiteShare('short', 0)).toBe(0);
  });

  it('dawn writes exactly the white onto the page, and the dark onto the backs', () => {
    let s = bench((st) => {
      st.fleeceReady = 0;
      st.flockSize = 13;
      st.ledger.books = 'short';
      st.ledger.declaredToDate = 0;
      st.ledger.grownToDate = 0;
    });
    s = runTicks(s, TICKS_PER_DAY + DAWN + 1 - s.tick); // through the next dawn
    const grown = 13 * FLEECE_PER_HEAD_PER_DAY;
    expect(s.fleeceReady).toBe(7);
    expect(s.darkReady).toBe(grown - 7);
    expect(s.ledger.declaredToDate).toBe(7);
    expect(s.ledger.grownToDate).toBe(grown);
    // never under the plausibility floor, so that term of the gap never fires
    expect(s.ledger.declaredToDate).toBeGreaterThanOrEqual(s.ledger.grownToDate * PLAUSIBLE_YIELD_MIN);
  });

  it('the switch changes tomorrow’s clip, never wool already grown', () => {
    let s = bench((st) => {
      st.fleeceReady = 12;
      st.darkReady = 0;
    });
    s = tick(s, [{ type: 'setBooks', books: 'short' }]);
    expect(s.ledger.books).toBe('short');
    expect(s.fleeceReady).toBe(12);
    expect(s.darkReady).toBe(0);
  });
});

describe('shearing takes both colours into the barn (§6.10 M5½f)', () => {
  it('a roomy barn takes everything', () => {
    const s = tick(bench((st) => { st.fleeceReady = 6; st.darkReady = 6; st.stores.farm = {}; }), [{ type: 'shear' }]);
    expect(s.stores.farm!.fleece).toBe(6);
    expect(s.stores.farm!['dark-fleece']).toBe(6);
    expect(s.fleeceReady + s.darkReady).toBe(0);
  });

  it('a nearly full barn takes the colours in proportion, the rest stays on the sheep', () => {
    const s = tick(
      bench((st) => {
        st.fleeceReady = 6;
        st.darkReady = 6;
        st.stores.farm = { tea: FARM_STORE_CAPACITY - 5 };
      }),
      [{ type: 'shear' }],
    );
    // 5 of room: floor(5 × 6/12) = 2 dark, 3 white.
    expect(s.stores.farm!['dark-fleece']).toBe(2);
    expect(s.stores.farm!.fleece).toBe(3);
    expect(s.darkReady).toBe(4);
    expect(s.fleeceReady).toBe(3);
  });
});

describe('each colour has its buyer (§6.10 M5½f)', () => {
  function inRyne(cargo: GameState['carts'][number]['cargo']): GameState {
    return bench((st) => {
      st.coin = 0;
      st.carts[0].cargo = cargo;
      st.carts[0].location = { kind: 'node', nodeId: 'ryne' };
    });
  }

  it('the stapler will not weigh dark wool, and says so', () => {
    const s = tick(inRyne({ 'dark-fleece': 8 }), [{ type: 'sell', cartId: 'cart-1', good: 'dark-fleece' }]);
    expect(s.carts[0].cargo['dark-fleece']).toBe(8);
    expect(s.coin).toBe(0);
    expect(s.log.some((e) => e.text.includes('will not weigh dark wool'))).toBe(true);
  });

  it('the lugger takes both colours, dark first, at one price into one appetite', () => {
    const s0 = bench((st) => {
      st.coin = 0;
      st.dutchman.unlocked = true;
      st.dutchman.present = true;
      st.dutchman.fleeceAppetite = 10;
      st.carts[0].cargo = { fleece: 6, 'dark-fleece': 6 };
      st.carts[0].location = { kind: 'node', nodeId: 'shingle' };
    });
    const s = tick(s0, [{ type: 'sellToDutchman', cartId: 'cart-1' }]);
    expect(s.carts[0].cargo['dark-fleece']).toBe(0);
    expect(s.carts[0].cargo.fleece).toBe(2); // only 4 white fitted the appetite
    expect(s.coin).toBe(10 * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
    expect(s.log.some((e) => e.text.includes('4 of it was white'))).toBe(true);
  });

  it('a carter at a market never waits on dark wool: he names it and carries it on', () => {
    let s = bench((st) => {
      st.coin = 100;
      st.dutchman.unlocked = true; // carters are offered once crime has begun
      st.carts[0].cargo = { 'dark-fleece': 8 };
      st.carts[0].location = { kind: 'node', nodeId: 'ryne' }; // the round takes up where he stands
    });
    s = tick(s, [
      { type: 'hireCarter', cartId: 'cart-1', order: { stops: [{ at: 'ryne' }, { at: 'farm', take: 'fleece' }] } },
    ]);
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.log.some((e) => e.text.includes('carries 8 dark fleece on'))).toBe(true);
    expect(s.carts[0].marketPatienceUntil).toBeUndefined();
  });
});

describe('the audit counts wool, not paperwork (§6.10 M5½f)', () => {
  function audit(mutate: (s: GameState) => void): { before: GameState; after: GameState } {
    const before = bench((st) => {
      st.coin = 400; // worth the candle
      st.fleeceReady = 0;
      st.darkReady = 0;
      st.revenue.officer.arrived = true;
      st.revenue.officer.location = { kind: 'node', nodeId: 'farm' };
      st.revenue.officer.targetNodeId = 'farm';
      st.ledger = { books: 'short', declaredToDate: 12, grownToDate: 24, soldLawfully: 12, soldToday: 0, openingStock: 0 };
      mutate(st);
    });
    return { before, after: tick(before, []) };
  }

  it('a short page with its white sold and its dark gone over the side balances', () => {
    const { after } = audit(() => {});
    expect(after.heat.regional).toBe(0);
  });

  it('dark wool he finds is priced once, and written onto the page: it turns white', () => {
    const { before, after } = audit((st) => {
      st.stores.farm = { 'dark-fleece': 5 };
      st.darkReady = 3;
    });
    expect(darkOnHand(before)).toBe(8);
    expect(auditGapNow(before)).toBe(8);
    expect(after.heat.regional).toBeCloseTo(8 * WOOL_GAP_COEFF, 5);
    expect(after.stores.farm!['dark-fleece'] ?? 0).toBe(0);
    expect(after.stores.farm!.fleece).toBe(5);
    expect(after.darkReady).toBe(0);
    expect(after.fleeceReady).toBe(3);
    expect(after.log.some((e) => e.text.includes('8 dark fleece onto the page'))).toBe(true);
  });

  it('white wool that went over the gunwale is the gap', () => {
    const { after } = audit((st) => {
      st.ledger.soldLawfully = 4; // 8 of the declared 12 went to the lugger
    });
    expect(after.heat.regional).toBeCloseTo(8 * WOOL_GAP_COEFF, 5);
  });
});

describe('losses and orders (§6.10 M5½f)', () => {
  it('wool lost off the backs goes dark first', () => {
    const s = bench((st) => { st.fleeceReady = 6; st.darkReady = 6; });
    capWoolOnBacks(s, 8);
    expect(s.darkReady).toBe(2);
    expect(s.fleeceReady).toBe(6);
    capWoolOnBacks(s, 4);
    expect(s.darkReady).toBe(0);
    expect(s.fleeceReady).toBe(4);
  });

  it('a round reads its wool aloud: dark to Ryne and white to the lugger are named', () => {
    expect(woolMismatches([{ at: 'farm', take: 'dark-fleece' }, { at: 'ryne' }])).toEqual([
      'Dark wool bound for Ryne: the stapler won’t weigh it.',
    ]);
    expect(woolMismatches([{ at: 'farm', take: 'fleece' }, { at: 'shingle' }])).toEqual([
      'White wool bound for the lugger: every fleece shows at the audit.',
    ]);
    // The one-cart strategy, written as a round: nothing to say.
    expect(
      woolMismatches([
        { at: 'farm', take: 'fleece' },
        { at: 'ryne' },
        { at: 'farm', take: 'dark-fleece' },
        { at: 'shingle' },
      ]),
    ).toEqual([]);
    // A store in between unloads him: the question ends there.
    expect(woolMismatches([{ at: 'farm', take: 'dark-fleece' }, { at: 'cutting-house' }, { at: 'ryne' }])).toEqual([]);
  });
});

// ---- House rule 5: 200 seeded games on short books ----

const GAMES = 200;
const DAYS = 30;

describe('200 seeded games, 30 days — the owling hub on short books (spec §13/§6.10 M5½f)', () => {
  it('the page never falls under the floor, the dark half goes over the side, and the tenancy stands', async () => {
    let survived = 0;
    let owled = 0;
    for (let seed = 1; seed <= GAMES; seed++) {
      await breathe(seed);
      let s = initialState(seed);
      let floorBreached = false;
      for (let t = 0; t < DAYS * TICKS_PER_DAY; t++) {
        const actions = hubPolicy(s);
        if (s.rentPending) actions.unshift({ type: 'payRent' });
        if (s.raid?.pendingBattle) actions.unshift({ type: 'resolveRaid' });
        s = tick(s, actions);
        if (s.ledger.declaredToDate + 1e-9 < s.ledger.grownToDate * PLAUSIBLE_YIELD_MIN) floorBreached = true;
        // Ryne's stapler can never have weighed a dark fleece.
        expect(s.demandRemaining['dark-fleece'] ?? 0).toBe(0);
      }
      expect(floorBreached).toBe(false);
      expect(s.ledger.books).toBe('short');
      if (!s.lost) survived++;
      if (s.dutchman.fleeceBought > 0) owled++;
    }
    // Every life owls; the colours never cost a working smuggler the farm.
    expect(owled).toBe(GAMES);
    expect(survived).toBe(GAMES);
  }, 300_000);
});
