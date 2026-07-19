// Spec §6.10–6.11 — the Revenue and the hired carter. The officer is
// deterministic, so every behaviour here is exact: no distributions, no
// tolerance for dice, only arithmetic.

import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  CART_COST,
  CARTER_WAGE,
  DITCH_HEAT,
  LEIDEN_PRICE_MULT,
  MARKET_TATTLE,
  MAX_CARTS,
  NATIONAL_HEAT_DECAY,
  OFFICER_ARRIVAL_HEAT,
  PROMOTION_RATE,
  PROMOTION_THRESHOLD,
  REGIONAL_HEAT_DECAY,
  RYNE_PRICE,
  SEARCH_HEAT_RELIEF,
  SEIZURE_HEAT,
  STARTING_FLOCK,
  STORAGE_HEAT_COEFF,
  SUSPICION_SHARE,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  SHEARING_HOUR,
  WOOL_GAP_COEFF,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { officerEdgesFor, FARM_SITE } from '../map';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

function runTicks(state: GameState, n: number, actionsAt: Record<number, Action[]> = {}): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, actionsAt[s.tick] ?? []);
  return s;
}

/** Advance to the next dawn strictly after the current tick — one dawn only. */
function toNextDawn(state: GameState): GameState {
  const dawnOffset = SHEARING_HOUR * TICKS_PER_HOUR;
  const dawnTick =
    Math.floor((state.tick - dawnOffset) / TICKS_PER_DAY + 1) * TICKS_PER_DAY + dawnOffset;
  return runTicks(state, dawnTick - state.tick);
}

describe('route heat (spec §6.2, consumed at last)', () => {
  function marshRun(startTick: number): GameState {
    const s0 = initialState(1);
    s0.tick = startTick;
    s0.carts[0].cargo = { jenever: 8 };
    let s = tick(s0, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    while (s.carts[0].location.kind === 'edge') s = tick(s, []);
    return s;
  }

  // The arrival tick adds one standing-cart tick of storage heat (§18).
  const ARRIVAL_STANDING = 8 * STORAGE_HEAT_COEFF;

  it('a night run of 8 tubs over the marsh costs 8 × 0.7 × 0.4', () => {
    const s = marshRun(0); // 00:00 — deep night
    expect(s.heat.regional).toBeCloseTo(8 * 0.7 * 0.4 + ARRIVAL_STANDING, 5);
  });

  it('the same run by day costs night ÷ 0.4 — daylight is the tax', () => {
    const s = marshRun(10 * TICKS_PER_HOUR); // 10:00 — broad day
    expect(s.heat.regional).toBeCloseTo(8 * 0.7 * 1.0 + ARRIVAL_STANDING, 5);
  });

  it('stains both ends of the road, near end first', () => {
    const s = marshRun(0);
    expect(s.revenue.suspicion.farm ?? 0).toBeGreaterThan(0);
    expect(s.revenue.suspicion.shingle ?? 0).toBeGreaterThan(0);
  });

  it('honest wool moves free: fleece is not contraband on the road', () => {
    const s0 = initialState(1);
    s0.carts[0].cargo = { fleece: 8 };
    let s = tick(s0, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    while (s.carts[0].location.kind === 'edge') s = tick(s, []);
    expect(s.heat.regional).toBe(0);
  });
});

describe('storage heat (spec §18: a full chest is evidence)', () => {
  it('tubs in the barn leak past the cover, per tick', () => {
    const s0 = initialState(1);
    s0.stores.farm = { jenever: 8 }; // cover 4 → 4 over
    const s = tick(s0, []);
    expect(s.heat.regional).toBeCloseTo(4 * STORAGE_HEAT_COEFF, 8);
    expect(s.revenue.suspicion.farm).toBeCloseTo(4 * STORAGE_HEAT_COEFF * SUSPICION_SHARE, 8);
  });

  it('the cover hides what it can: under it, silence', () => {
    const s0 = initialState(1);
    s0.stores.farm = { jenever: 4 };
    const s = tick(s0, []);
    expect(s.heat.regional).toBe(0);
  });

  it('a standing cart hides nothing at all', () => {
    const s0 = initialState(1);
    s0.carts[0].cargo = { tea: 3 };
    const s = tick(s0, []);
    expect(s.heat.regional).toBeCloseTo(3 * STORAGE_HEAT_COEFF, 8);
  });
});

describe('market tattle and the ditch (spec §6.10)', () => {
  function cartAtRyne(cargo: GameState['carts'][0]['cargo']): GameState {
    const s0 = initialState(1);
    s0.carts[0].location = { kind: 'node', nodeId: 'ryne' };
    s0.carts[0].cargo = cargo;
    return s0;
  }

  it('selling brandy at Ryne makes the town talk', () => {
    const s = tick(cartAtRyne({ 'brandy-fair': 6 }), [
      { type: 'sell', cartId: 'cart-1', good: 'brandy-fair' },
    ]);
    expect(s.coin).toBe(6 * RYNE_PRICE['brandy-fair']);
    expect(s.heat.regional).toBeCloseTo(6 * MARKET_TATTLE, 5);
    expect(s.revenue.suspicion.ryne).toBeCloseTo(6 * MARKET_TATTLE * SUSPICION_SHARE, 5);
  });

  it('selling fleece is lawful, silent, and entered in the books', () => {
    const s = tick(cartAtRyne({ fleece: 4 }), [{ type: 'sell', cartId: 'cart-1', good: 'fleece' }]);
    expect(s.heat.regional).toBe(0);
    expect(s.ledger.soldLawfully).toBe(4);
  });

  it('ditched goods heat the parish but stain no node — tubs carry no name', () => {
    const s0 = initialState(1);
    s0.carts[0].cargo = { jenever: 5 };
    const s = tick(s0, [{ type: 'ditchCargo', cartId: 'cart-1' }]);
    // One tick also accrues storage heat? No: the cargo was ditched before processes ran.
    expect(s.heat.regional).toBeCloseTo(5 * DITCH_HEAT, 5);
    expect(Object.values(s.revenue.suspicion).every((v) => v === 0)).toBe(true);
  });
});

describe('heat decay and promotion at dawn (spec §6.3)', () => {
  it('regional cools, national barely, and the excess spills toward London', () => {
    const s0 = initialState(1);
    s0.heat.regional = 200;
    s0.heat.national = 10;
    const s = toNextDawn(s0);
    const cooled = 200 * REGIONAL_HEAT_DECAY;
    const spill = (cooled - PROMOTION_THRESHOLD) * PROMOTION_RATE;
    expect(s.heat.regional).toBeCloseTo(cooled - spill, 5);
    expect(s.heat.national).toBeCloseTo(10 * NATIONAL_HEAT_DECAY + spill, 5);
  });

  it('below the threshold nothing promotes', () => {
    const s0 = initialState(1);
    s0.heat.regional = 50;
    const s = toNextDawn(s0);
    expect(s.heat.national).toBe(0);
  });
});

describe('the Riding Officer (spec §6.10)', () => {
  it('arrives for good at the first hot dawn, and not before', () => {
    const cold = toNextDawn(initialState(1));
    expect(cold.revenue.officer.arrived).toBe(false);

    const s0 = initialState(1);
    s0.heat.regional = OFFICER_ARRIVAL_HEAT / REGIONAL_HEAT_DECAY + 1;
    const s = toNextDawn(s0);
    expect(s.revenue.officer.arrived).toBe(true);
    expect(s.revenue.officer.location).toEqual({ kind: 'node', nodeId: 'customs' });
    expect(s.log.some((e) => e.text.includes('Riding Officer'))).toBe(true);
  });

  it('never learns the low road: the blue coat keeps to the high ground', () => {
    expect(officerEdgesFor(FARM_SITE).some((e) => e.id === 'low-road')).toBe(false);
    expect(officerEdgesFor(FARM_SITE).some((e) => e.id === 'customs-lane')).toBe(true);
  });

  function officerBoundFor(target: string, mutate?: (s: GameState) => void): GameState {
    const s0 = initialState(1);
    s0.revenue.officer.arrived = true;
    s0.revenue.officer.location = { kind: 'node', nodeId: 'customs' };
    s0.revenue.officer.targetNodeId = target;
    s0.revenue.officer.inspectedToday = false;
    mutate?.(s0);
    return s0;
  }

  it('rides to the sorest stain and seizes what the cover cannot hide', () => {
    const s0 = officerBoundFor('farm', (s) => {
      s.stores.farm = { jenever: 10, fleece: 2 }; // cover 4 → 6 findable
    });
    const s = runTicks(s0, 30);
    expect(s.stores.farm?.jenever).toBe(4); // the cover's worth survives
    expect(s.stores.farm?.fleece).toBe(2); // wool is not his to take
    expect(s.log.some((e) => e.text.includes('seizes 6 goods'))).toBe(true);
    expect(s.heat.regional).toBeGreaterThanOrEqual(6 * SEIZURE_HEAT);
    // §6.10 (M5 hub polish) — the tally the seizure card watches.
    expect(s.goodsSeized).toBe(6);
    expect(s.lastSeizureNode).toBe('farm');
  });

  it('a clean search cools the trail — node suspicion and regional Heat both', () => {
    const s0 = officerBoundFor('shingle', (s) => {
      s.revenue.suspicion.shingle = 10;
      s.heat.regional = 40; // he has come; going straight should pay
    });
    const s = runTicks(s0, 60); // the shingle is a long, sour ride
    expect(s.log.some((e) => e.text.includes('honest clutter'))).toBe(true);
    expect(s.revenue.suspicion.shingle).toBeLessThan(6); // halved, then daily decay
    // The ×0.8 relief undercuts what dawn decay (×0.97) alone could reach in
    // this span, so hitting the relief ceiling proves the clean-search cut.
    expect(s.heat.regional).toBeLessThanOrEqual(40 * SEARCH_HEAT_RELIEF);
  });

  it('stops a cart sharing his road and takes the contraband, not the wool', () => {
    const s0 = officerBoundFor('farm');
    s0.revenue.officer.location = {
      kind: 'edge',
      edgeId: 'high-road',
      from: 'ryne',
      to: 'farm',
      progress: 0,
    };
    s0.carts[0].cargo = { fleece: 3, tea: 5 };
    const s = tick(s0, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    expect(s.carts[0].cargo.tea).toBe(0);
    expect(s.carts[0].cargo.fleece).toBe(3);
    expect(s.log.some((e) => e.text.includes('stops The Cart'))).toBe(true);
  });
});

describe('the books (spec §6.10 / §19.2)', () => {
  function inspectionAt(mutate: (s: GameState) => void): { before: GameState; after: GameState } {
    const before = initialState(1);
    before.fleeceReady = 0; // these tests set on-hand wool via the stores below
    before.revenue.officer.arrived = true;
    before.revenue.officer.location = { kind: 'node', nodeId: 'farm' };
    before.revenue.officer.targetNodeId = 'farm';
    mutate(before);
    // One tick: the officer is on the doorstep; nothing else is moving.
    const after = tick(before, []);
    return { before, after };
  }

  it('honest books balance: all wool declared, sold or on hand', () => {
    const { after } = inspectionAt((s) => {
      s.ledger = { declaredYield: 12, declaredToDate: 24, grownToDate: 24, soldLawfully: 16, openingStock: 0 };
      s.stores.farm = { fleece: 8 };
    });
    expect(after.heat.regional).toBe(0);
    expect(after.log.some((e) => e.text.includes('It balances'))).toBe(true);
  });

  it('vanished wool is priced at the gap', () => {
    const { after } = inspectionAt((s) => {
      // Declared 24, sold 8 lawfully, nothing on hand: 16 fleece adrift.
      s.ledger = { declaredYield: 12, declaredToDate: 24, grownToDate: 24, soldLawfully: 8, openingStock: 0 };
      s.stores.farm = { fleece: 0 };
    });
    expect(after.heat.regional).toBeCloseTo(16 * WOOL_GAP_COEFF, 5);
    expect(after.log.some((e) => e.text.includes('adrift'))).toBe(true);
  });

  it('swearing to less than half the clip is priced as a lie', () => {
    const { after } = inspectionAt((s) => {
      // Declared nothing, holds nothing, sold nothing — but 24 grew: floor is 12.
      s.ledger = { declaredYield: 0, declaredToDate: 0, grownToDate: 24, soldLawfully: 0, openingStock: 0 };
    });
    expect(after.heat.regional).toBeCloseTo(12 * WOOL_GAP_COEFF, 5);
  });

  it('the page is initialled: a gap is paid for once, not nightly', () => {
    const { after } = inspectionAt((s) => {
      s.ledger = { declaredYield: 12, declaredToDate: 24, grownToDate: 24, soldLawfully: 8, openingStock: 0 };
    });
    expect(after.ledger.declaredToDate).toBe(0);
    expect(after.ledger.grownToDate).toBe(0);
    expect(after.ledger.soldLawfully).toBe(0);
    // A second inspection on the fresh page finds nothing to price.
    const again = tick(
      {
        ...after,
        revenue: {
          ...after.revenue,
          officer: { arrived: true, location: { kind: 'node', nodeId: 'farm' }, targetNodeId: 'farm', inspectedToday: false },
        },
      },
      [],
    );
    // No new gap is priced (the page is fresh); the only change to Heat is the
    // clean-search relief now cooling the regional meter (×SEARCH_HEAT_RELIEF).
    expect(again.heat.regional).toBeCloseTo(after.heat.regional * SEARCH_HEAT_RELIEF, 5);
  });

  it('declaredYield clamps to the flock that exists', () => {
    const s = tick(initialState(1), [{ type: 'setDeclaredYield', fleecePerDay: 99 }]);
    expect(s.ledger.declaredYield).toBe(STARTING_FLOCK);
    const s2 = tick(s, [{ type: 'setDeclaredYield', fleecePerDay: -4 }]);
    expect(s2.ledger.declaredYield).toBe(0);
  });
});

describe('bought carts and the hired carter (spec §6.11)', () => {
  it('a cart costs 50 coin and the yard holds three', () => {
    const s0 = initialState(1);
    s0.coin = 200;
    let s = tick(s0, [{ type: 'buyCart' }, { type: 'buyCart' }]);
    expect(s.carts).toHaveLength(3);
    expect(s.coin).toBe(200 - 2 * CART_COST);
    s = tick(s, [{ type: 'buyCart' }]);
    expect(s.carts).toHaveLength(MAX_CARTS);
    expect(s.log.some((e) => e.text.includes('holds three'))).toBe(true);
  });

  it('a carter shuttles the wool round unattended', () => {
    const s0 = initialState(1);
    s0.stores.farm = { fleece: 12 };
    const s = runTicks(s0, 60, {
      0: [{ type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } }],
    });
    expect(s.ledger.soldLawfully).toBeGreaterThan(0); // wool reached Ryne without a hand on the reins
    expect(s.coin).toBeGreaterThan(0);
  });

  it('a carter shuttles loads, not air: empty store, he waits', () => {
    const s0 = initialState(1);
    s0.stores.farm = { fleece: 0 };
    const s = runTicks(s0, 20, {
      0: [{ type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } }],
    });
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
  });

  it('a crewed cart refuses the player’s reins', () => {
    const s0 = initialState(1);
    s0.stores.farm = { fleece: 12 };
    s0.carts[0].carter = { from: 'farm', to: 'ryne', good: 'fleece' };
    const s = tick(s0, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    expect(s.log.some((e) => e.text.includes('Dismiss him'))).toBe(true);
  });

  it('wages fall due at dawn; an unpaid man walks the same morning', () => {
    const paid = initialState(1);
    paid.coin = 10;
    paid.carts[0].carter = { from: 'farm', to: 'ryne', good: 'fleece' };
    paid.stores.farm = { fleece: 0 }; // nothing to haul: coin only moves by wage
    const afterDawn = toNextDawn(paid);
    expect(afterDawn.coin).toBe(10 - CARTER_WAGE);
    expect(afterDawn.carts[0].carter).not.toBeNull();

    const broke = initialState(1);
    broke.coin = 0;
    broke.carts[0].carter = { from: 'farm', to: 'ryne', good: 'fleece' };
    broke.stores.farm = { fleece: 0 };
    const walked = toNextDawn(broke);
    expect(walked.carts[0].carter).toBeNull();
    expect(walked.log.some((e) => e.text.includes('walks off'))).toBe(true);
  });

  it('capacity honoured: he loads a full cart and no more', () => {
    const s0 = initialState(1);
    s0.stores.farm = { fleece: 20 };
    const s = runTicks(s0, 2, {
      0: [{ type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } }],
    });
    const aboard = s.carts[0].cargo.fleece ?? 0;
    expect(aboard).toBeLessThanOrEqual(CART_CAPACITY);
    expect(aboard).toBeGreaterThan(0);
  });
});

describe('the shingle order (spec §6.11, M5a-3)', () => {
  const NIGHT_FALLING = 120; // day 1 20:00 — night ∩ falling tide (see crime.test)

  /** A carter standing on the shingle with fleece aboard, on a shingle order. */
  function carterOnBeach(tickAt: number, fleece: number): GameState {
    const s = initialState(1);
    s.tick = tickAt;
    s.dutchman.unlocked = true;
    s.carts[0].location = { kind: 'node', nodeId: 'shingle' };
    s.carts[0].cargo = { fleece };
    s.carts[0].carter = { from: 'farm', to: 'shingle', good: 'fleece' };
    return s;
  }

  it('sells fleece over the gunwale when the lugger stands off', () => {
    let s = carterOnBeach(NIGHT_FALLING, 8);
    s = tick(s, []); // dutchmanTide marks him present, the carter sells
    s = tick(s, []);
    expect(s.carts[0].cargo.fleece ?? 0).toBe(0);
    expect(s.coin).toBe(8 * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
    expect(s.log.some((e) => e.text.includes('does not look at the boat'))).toBe(true);
  });

  it('waits on the beach when the lugger is out — no unloading, no wandering', () => {
    const noon = 2 * 6 * TICKS_PER_HOUR; // 12:00: no lugger at midday
    let s = carterOnBeach(noon, 8);
    s = tick(s, []);
    s = tick(s, []);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'shingle' });
    expect(s.carts[0].cargo.fleece).toBe(8); // still aboard, not tipped on the beach
    expect(s.stores.shingle?.fleece ?? 0).toBe(0);
  });

  it('rides home for the next load once the gunwale has taken everything', () => {
    let s = carterOnBeach(NIGHT_FALLING, 4);
    s = tick(s, []);
    s = tick(s, []);
    expect(s.carts[0].cargo.fleece ?? 0).toBe(0);
    // Off the beach: heading home to `from` for the next load.
    expect(s.carts[0].location.kind === 'edge' || s.carts[0].location.nodeId !== 'shingle').toBe(
      true,
    );
  });

  it('sale proceeds pass through the Dutchman’s book like any other (§6.15)', () => {
    let s = carterOnBeach(NIGHT_FALLING, 8);
    s.dutchmanBook = 100;
    s = tick(s, []);
    s = tick(s, []);
    const proceeds = 8 * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT; // 64
    expect(s.coin).toBe(proceeds / 2); // half sliced to the book
    expect(s.dutchmanBook).toBe(100 - proceeds / 2);
  });
});

describe('the book audit — the Board’s calendar bends for no stain (spec §6.10, M5 hub-3)', () => {
  const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

  /** An arrived officer at home, mid-run, with suspicion painted as given. */
  function arrivedOfficer(suspicion: Record<string, number>): GameState {
    const s = initialState(9);
    s.revenue.officer.arrived = true;
    s.revenue.suspicion = suspicion;
    s.heat.regional = OFFICER_ARRIVAL_HEAT;
    return s;
  }

  it('the dawn after a rent day, the farm is his target no matter how loud Ryne is', () => {
    // Day 7 dawn (rent fell day 6): tick lands on the audit cadence.
    let s = arrivedOfficer({ ryne: 99 });
    s.tick = 7 * TICKS_PER_DAY + DAWN - 1;
    s = tick(s, []);
    expect(s.revenue.officer.targetNodeId).toBe('farm');
  });

  it('every other dawn the sorest stain still rules', () => {
    let s = arrivedOfficer({ ryne: 99 });
    s.tick = 8 * TICKS_PER_DAY + DAWN - 1;
    s = tick(s, []);
    expect(s.revenue.officer.targetNodeId).toBe('ryne');
  });

  it('a lawful life is never audited: no Heat, no officer, no knock (§6.10)', () => {
    // Day 7 dawn with no officer arrived: the audit exists only once he does.
    let s = initialState(9);
    s.tick = 7 * TICKS_PER_DAY + DAWN - 1;
    s = tick(s, []);
    expect(s.revenue.officer.arrived).toBe(false);
    expect(s.revenue.officer.targetNodeId).toBeNull();
  });
});
