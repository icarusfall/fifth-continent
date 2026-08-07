// Spec §6.15 — the Floor's first mechanic (M5c playtest): not worth the
// candle. Under PAUPER_FLOOR of condemnable worth the world notes but does
// not pounce — no seizures, no audit charges, no raid musters — while the
// player's own acts still make heat and the officer still keeps his notes.
// Alongside it, §6.10's late legibility: auditGapNow reads the charge before
// the audit does, and returnPen hands the book back to the agent.

import { describe, expect, it } from 'vitest';
import { breathe } from './breathe';
import {
  FLEECE_PER_HEAD_PER_DAY,
  PAUPER_FLOOR,
  PLAUSIBLE_YIELD_MIN,
  RAID_MUSTER_LEAD_DAYS,
  RYNE_PRICE,
  SEIZURE_HEAT,
  TICKS_PER_DAY,
  WOOL_GAP_COEFF,
} from '../balance';
import { raidTick } from '../raid';
import { auditGapNow, underTheCandle, worthOf } from '../revenue';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

function officerAtDoor(mutate?: (s: GameState) => void): GameState {
  const s = initialState(1);
  s.revenue.officer.arrived = true;
  s.revenue.officer.location = { kind: 'node', nodeId: 'customs' };
  s.revenue.officer.targetNodeId = 'farm';
  s.revenue.officer.inspectedToday = false;
  mutate?.(s);
  return s;
}

describe('worth (§6.15): coin plus condemnable goods', () => {
  it('prices contraband at Ryne rates, jenever at nothing, and wool not at all', () => {
    const s = initialState(1);
    s.coin = 100;
    s.stores.farm = { 'brandy-fair': 5, jenever: 50, fleece: 200 };
    s.carts[0].cargo = { tea: 3 };
    expect(worthOf(s)).toBe(100 + 5 * RYNE_PRICE['brandy-fair'] + 3 * RYNE_PRICE.tea);
    expect(underTheCandle(s)).toBe(worthOf(s) < PAUPER_FLOOR);
  });
});

describe('under the candle (§6.15): the world notes, and does not pounce', () => {
  it('a search finds, counts, and seizes nothing — no heat, no card tally', () => {
    let s = officerAtDoor((st) => {
      st.coin = 0;
      st.stores.farm = { jenever: 10 }; // 6 findable over cover — worth 0 to the Board
    });
    s = runTicks(s, 30);
    expect(s.stores.farm?.jenever).toBe(10); // nothing taken
    expect(s.goodsSeized).toBe(0); // no seizure card
    // Over-cover storage heat still drips (§18 — the world keeps score), but
    // the search itself charged nothing: well under one seizure's worth.
    expect(s.heat.regional).toBeLessThan(6 * SEIZURE_HEAT);
    expect(s.log.some((e) => e.text.includes('puts the notebook away'))).toBe(true);
  });

  it('the same search, worth the candle, seizes as ever', () => {
    let s = officerAtDoor((st) => {
      st.coin = PAUPER_FLOOR;
      st.stores.farm = { jenever: 10 };
    });
    s = runTicks(s, 30);
    expect(s.goodsSeized).toBe(6);
    expect(s.heat.regional).toBeGreaterThanOrEqual(6 * SEIZURE_HEAT);
  });

  it('an audit reads the shorted page, initials it, and charges nothing', () => {
    let pauper = officerAtDoor((st) => {
      st.coin = 0;
      st.fleeceReady = 0;
      st.ledger = {
        declaredYield: 4,
        penTaken: true,
        declaredToDate: 8,
        grownToDate: 24,
        soldLawfully: 20, // sold far past the page: a gap of 12
        soldToday: 0,
        openingStock: 0,
      };
    });
    const gap = auditGapNow(pauper);
    expect(gap).toBeGreaterThan(0);
    pauper = runTicks(pauper, 30);
    expect(pauper.heat.regional).toBe(0); // read, adrift, uncharged
    expect(pauper.log.some((e) => e.text.includes("worth the Board's ink"))).toBe(true);
    expect(pauper.ledger.declaredToDate).toBeLessThan(8); // the page was still initialled
  });

  it('no muster fires against a pauper — and the deferred blow lands once worth returns', () => {
    const s = initialState(1);
    s.coin = 0;
    s.cuttingHouse = { x: 24, y: 12 };
    s.stores['cutting-house'] = { 'brandy-fair': 2 }; // 12 worth: a pauper's cellar
    s.hawksmere = { provoked: true, raidsSurvived: 0, nextRaidTick: 1000 };
    s.tick = 1000 - RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;
    raidTick(s);
    expect(s.raid).toBeNull(); // not worth the men

    s.coin = PAUPER_FLOOR; // fortune returns…
    raidTick(s);
    expect(s.raid).not.toBeNull(); // …and so do they
  });
});

describe('the pen and the page (§6.10, M5c playtest)', () => {
  it('auditGapNow prices the shorted-page-sold-lawfully trap before the audit does', () => {
    const s = initialState(1);
    s.fleeceReady = 0;
    s.ledger = {
      declaredYield: 4,
      penTaken: true,
      declaredToDate: 12, // three days at 4…
      grownToDate: 48, // …against a flock giving 16
      soldLawfully: 12,
      soldToday: 0,
      openingStock: 0,
    };
    // |12 − 12| = 0 sold-side; the implausibility term prices the shorting.
    expect(auditGapNow(s)).toBeCloseTo(Math.max(0, 48 * PLAUSIBLE_YIELD_MIN - 12));
    expect(auditGapNow(s) * WOOL_GAP_COEFF).toBeGreaterThan(0);
  });

  it('returnPen hands the book back: the agent squares it and keeps it square', () => {
    let s = initialState(1);
    s = tick(s, [{ type: 'setDeclaredYield', fleecePerDay: 4 }]);
    expect(s.ledger.penTaken).toBe(true);
    s = tick(s, [{ type: 'returnPen' }]);
    expect(s.ledger.penTaken).toBe(false);
    expect(s.ledger.declaredYield).toBe(s.flockSize * FLEECE_PER_HEAD_PER_DAY);
    expect(s.log.some((e) => e.text.includes('hand the pen back'))).toBe(true);
    // The flock grows; the agent's page follows it without another word.
    s.flockSize += 4;
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.ledger.declaredYield).toBe(s.flockSize * FLEECE_PER_HEAD_PER_DAY);
  });
});

// ---- House rule 5: 200 seeded games under the candle ----

const GAMES = 200;
const POOR_DAYS = 5;

describe(`${GAMES} seeded games, ${POOR_DAYS} days — the pauper's grace (spec §6.15)`, () => {
  it('across every seed: found, counted, and never seized while under the floor', { timeout: 120_000 }, async () => {
    for (let seed = 1; seed <= GAMES; seed++) {
      await breathe(seed);
      let s = initialState(seed);
      s.coin = 20;
      s.stores.farm = { 'brandy-fair': 20 }; // 120 worth + 20 coin: under the floor
      s.revenue.officer.arrived = true;
      s.revenue.officer.location = { kind: 'node', nodeId: 'customs' };
      s.revenue.suspicion.farm = 50; // his target every dawn
      for (let i = 0; i < TICKS_PER_DAY * POOR_DAYS; i++) s = tick(s, []);

      expect(underTheCandle(s)).toBe(true);
      expect(s.goodsSeized).toBe(0); // five days of searches, nothing condemned
      expect(s.stores.farm?.['brandy-fair']).toBe(20);
      expect(s.heat.regional).toBeGreaterThan(0); // the world still keeps score (§18)
      expect(s.lost).toBe(false);
    }
  });
});
