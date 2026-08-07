// Spec §6.12 (M5½ playtest) — the Cellar Hide, §8.1's Concealment rung 1:
// the fort ladder's quiet twin. Cover is bought with coin, invisibly; what
// rests under it leaks nothing and cannot be seized; and a cellar the parish
// never saw dug survives the informer. Alongside it, the patrol threshold's
// rise: the officer rides for sore stains, not every whisper.

import { describe, expect, it } from 'vitest';
import { breathe } from './breathe';
import {
  CELLAR_COST,
  CELLAR_COVER_PER_TIER,
  COVER_CAPACITY,
  MAX_CELLAR_TIER,
  PATROL_THRESHOLD,
  TICKS_PER_DAY,
} from '../balance';
import { coverOf, patrolTarget } from '../revenue';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

describe('the dig (§6.12): coin down, cover up, nobody the wiser', () => {
  it('climbs two tiers at the farm, charges the ladder, and stops at the well', () => {
    let s = initialState(1);
    s.coin = 500;
    s = tick(s, [{ type: 'digCellar', nodeId: 'farm' }]);
    expect(s.cellars.farm).toBe(1);
    expect(s.coin).toBe(500 - CELLAR_COST[1]);
    expect(coverOf(s, 'farm')).toBe((COVER_CAPACITY.farm ?? 0) + CELLAR_COVER_PER_TIER);

    s = tick(s, [{ type: 'digCellar', nodeId: 'farm' }, { type: 'digCellar', nodeId: 'farm' }]);
    expect(s.cellars.farm).toBe(MAX_CELLAR_TIER); // the third dig is a well
    expect(s.coin).toBe(500 - CELLAR_COST[1] - CELLAR_COST[2]);
    expect(s.log.some((e) => e.text.includes('Any deeper is a well'))).toBe(true);
  });

  it('digs only under your own floors, and only what the till covers', () => {
    let s = initialState(1);
    s.coin = 500;
    s = tick(s, [{ type: 'digCellar', nodeId: 'ryne' }]);
    expect(s.cellars.ryne ?? 0).toBe(0);
    expect(s.coin).toBe(500);

    const poor = tick(
      (() => {
        const p = initialState(1);
        p.coin = CELLAR_COST[1] - 1;
        return p;
      })(),
      [{ type: 'digCellar', nodeId: 'farm' }],
    );
    expect(poor.cellars.farm ?? 0).toBe(0);
  });

  it('what rests under the raised cover leaks nothing and cannot be seized', () => {
    let s = initialState(1);
    s.coin = 400; // worth the candle: the pounce is armed, the cellar defeats it
    s.cellars.farm = 2; // cover 4 + 8 = 12
    s.stores.farm = { jenever: 12 };
    s.revenue.officer.arrived = true;
    s.revenue.officer.location = { kind: 'node', nodeId: 'customs' };
    s.revenue.suspicion.farm = 50;
    s = runTicks(s, TICKS_PER_DAY * 2);
    expect(s.goodsSeized).toBe(0); // twelve tubs, none showing
    expect(s.stores.farm?.jenever).toBe(12);
    expect(s.heat.regional).toBe(0); // under cover, silence (§18)
  });

  it('the cellar survives the informer; the free hides do not (§6.15 Floor)', () => {
    const s = initialState(1);
    s.cellars.farm = 1;
    s.informer = true;
    expect(coverOf(s, 'farm')).toBe(CELLAR_COVER_PER_TIER); // base closed, cellar holds
    expect(coverOf(s, 'cutting-house')).toBe(0);
  });

  it('the philosopher in the loft costs the hides nothing (§6.14, M5½ playtest)', () => {
    const s = initialState(1);
    s.cellars.farm = 1;
    s.leiden = { ...s.leiden, state: 'housed', node: 'farm' };
    expect(coverOf(s, 'farm')).toBe((COVER_CAPACITY.farm ?? 0) + CELLAR_COVER_PER_TIER);
  });
});

describe('the patrol threshold (§6.10, raised 4 → 8)', () => {
  it('a whisper keeps him on his beat; a sore stain still brings him', () => {
    const s = initialState(1);
    s.revenue.suspicion.farm = PATROL_THRESHOLD - 1;
    expect(patrolTarget(s)).toBe('ryne'); // the old bar would have sent him
    s.revenue.suspicion.farm = PATROL_THRESHOLD;
    expect(patrolTarget(s)).toBe('farm');
  });
});

// ---- House rule 5: 200 seeded games with the hides dug ----

const GAMES = 200;
const DAYS = 5;

describe(`${GAMES} seeded games, ${DAYS} days — the cellared barn (spec §13)`, () => {
  it('across every seed: a lugger-load rests silent and unseized under dug hides', { timeout: 120_000 }, async () => {
    for (let seed = 1; seed <= GAMES; seed++) {
      await breathe(seed);
      let s = initialState(seed);
      s.coin = 400;
      s.cellars.farm = 2;
      s.stores.farm = { 'brandy-fair': 10, tea: 2 }; // a full night's landing
      s.revenue.officer.arrived = true;
      s.revenue.officer.location = { kind: 'node', nodeId: 'customs' };
      s.revenue.suspicion.farm = 50;
      for (let i = 0; i < TICKS_PER_DAY * DAYS; i++) s = tick(s, []);

      expect(s.goodsSeized).toBe(0);
      expect((s.stores.farm?.['brandy-fair'] ?? 0) + (s.stores.farm?.tea ?? 0)).toBe(12);
      expect(s.heat.regional).toBe(0); // twelve hidden, zero leaked, five days
      expect(s.lost).toBe(false);
    }
  });
});
