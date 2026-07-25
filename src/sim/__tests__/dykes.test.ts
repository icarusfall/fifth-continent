// Spec §6.18 / §21.1 (M5½a) — the survey and the spade. Every formula gets
// its unit test (§13): the segment's price and clock, the one-crew rule, the
// stone's refusal, and the completed dig landing §21.2's whole axis — Debt to
// the marsh, Standing to the parish, pasture to the flock, water for ever.

import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY,
  DYKE_COST_PER_TILE,
  DYKE_DAYS_PER_TILE,
  DYKE_DEBT,
  DYKE_PARISH_STANDING,
  DYKE_PASTURE_HEAD,
  FLOCK_CAP,
  STANDING_START,
  TICKS_PER_DAY,
} from '../balance';
import { dykeCost, dykeDays, flockCapOf, stoneRefuses } from '../dykes';
import { DYKE_SEGMENTS, dykeById, dykeTiles } from '../map';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60;
  s.lastCrisisTick = -(20 * TICKS_PER_DAY);
  s.boundWights = 1; // the dyke's Debt needs someone bound to carry it
  mutate?.(s);
  return s;
}

const FIRST = DYKE_SEGMENTS[0];

describe('the survey (§6.18): authored, named, priced by the tile', () => {
  it('eight segments stand on the survey, each with a price and a clock', () => {
    expect(DYKE_SEGMENTS.length).toBe(8);
    for (const seg of DYKE_SEGMENTS) {
      expect(dykeCost(seg)).toBe(dykeTiles(seg) * DYKE_COST_PER_TILE);
      expect(dykeDays(seg)).toBe(Math.max(1, Math.ceil(dykeTiles(seg) * DYKE_DAYS_PER_TILE)));
      expect(dykeById(seg.id)).toBe(seg);
    }
  });
});

describe('the spade (§6.18): coin up front, one crew, done days later', () => {
  it('digs a segment: coin gone, the crew out, the water at the promised tick', () => {
    let s = fresh((st) => (st.coin = 500));
    s = tick(s, [{ type: 'digDyke', id: FIRST.id }]);
    expect(s.coin).toBe(500 - dykeCost(FIRST));
    expect(s.digging?.id).toBe(FIRST.id);
    expect(s.dykesDug).toEqual([]);

    s = runTicks(s, dykeDays(FIRST) * TICKS_PER_DAY + 1);
    expect(s.digging).toBeNull();
    expect(s.dykesDug).toEqual([FIRST.id]);
    expect(s.log.some((e) => e.text.includes('runs with water'))).toBe(true);
  });

  it('completion lands the whole §21.2 axis: Debt, Standing, pasture', () => {
    let s = fresh((st) => (st.coin = 500));
    const standingBefore = s.standing;
    s = tick(s, [{ type: 'digDyke', id: FIRST.id }]);
    s = runTicks(s, dykeDays(FIRST) * TICKS_PER_DAY + 1);
    expect(s.debt).toBeCloseTo(DYKE_DEBT * DIFFICULTY[s.difficulty].debtMult);
    expect(s.standing).toBe(standingBefore - DYKE_PARISH_STANDING);
    expect(flockCapOf(s)).toBe(FLOCK_CAP + DYKE_PASTURE_HEAD);
    expect(standingBefore).toBeLessThanOrEqual(STANDING_START);
  });

  it('one dig at a time; a dyke is never dug twice; the till must cover it', () => {
    let s = fresh((st) => (st.coin = 500));
    const second = DYKE_SEGMENTS[1];
    s = tick(s, [{ type: 'digDyke', id: FIRST.id }]);
    s = tick(s, [{ type: 'digDyke', id: second.id }]);
    expect(s.digging?.id).toBe(FIRST.id); // the crew is one crew
    expect(s.log.some((e) => e.text.includes('One dig at a time'))).toBe(true);

    s = runTicks(s, dykeDays(FIRST) * TICKS_PER_DAY + 1);
    s = tick(s, [{ type: 'digDyke', id: FIRST.id }]);
    expect(s.dykesDug).toEqual([FIRST.id]); // never twice
    expect(s.log.some((e) => e.text.includes('never dug twice'))).toBe(true);

    const poor = tick(
      fresh((st) => (st.coin = dykeCost(FIRST) - 1)),
      [{ type: 'digDyke', id: FIRST.id }],
    );
    expect(poor.digging).toBeNull();
    expect(poor.coin).toBe(dykeCost(FIRST) - 1);
  });

  it("the stone's ground refuses the spade while the stone stands", () => {
    const mid = FIRST.path[0];
    let s = fresh((st) => {
      st.coin = 500;
      st.wights.stone = { x: mid.x + 1, y: mid.y }; // a tile off the line
    });
    expect(stoneRefuses(s, FIRST)).toBe(true);
    s = tick(s, [{ type: 'digDyke', id: FIRST.id }]);
    expect(s.digging).toBeNull();
    expect(s.coin).toBe(500);
    expect(s.log.some((e) => e.text.includes('will not put a spade'))).toBe(true);

    // The same line digs freely when the stone stands elsewhere.
    const clear = fresh((st) => {
      st.coin = 500;
      st.wights.stone = { x: 30, y: 25 };
    });
    expect(stoneRefuses(clear, FIRST)).toBe(false);
  });

  it('drained pasture feeds the flock market: buySheep reads the raised cap', () => {
    let s = fresh((st) => {
      st.coin = 2000;
      st.flockSize = FLOCK_CAP; // the old pasture is full
      st.dykesDug = [FIRST.id]; // one channel already runs
    });
    s = tick(s, [{ type: 'buySheep', qty: DYKE_PASTURE_HEAD + 5 }]);
    expect(s.sheepArriving).toBe(DYKE_PASTURE_HEAD); // only the drained margin's worth
  });
});

// ---- House rule 5: 200 seeded games with the whole survey dug ----

const GAMES = 200;

describe(`${GAMES} seeded games — the improver (spec §13/§6.18)`, () => {
  it('digs the whole survey: every price lands exactly, and the tenancy stands', { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= GAMES; seed++) {
      let s = initialState(seed);
      s.tick = 60;
      s.lastCrisisTick = -(40 * TICKS_PER_DAY);
      s.boundWights = 3; // 180 bindings carry the survey's 120 Debt
      s.coin = 2000;
      const coinBefore = s.coin;
      const standingBefore = s.standing;

      for (const seg of DYKE_SEGMENTS) {
        s = tick(s, [{ type: 'digDyke', id: seg.id }]);
        s = runTicks(s, dykeDays(seg) * TICKS_PER_DAY + 1);
      }

      expect(s.dykesDug.length).toBe(DYKE_SEGMENTS.length);
      const totalCost = DYKE_SEGMENTS.reduce((a, d) => a + dykeCost(d), 0);
      // Coin only leaves by the digs' exact price; the farm may earn meanwhile.
      expect(s.coin).toBeGreaterThanOrEqual(coinBefore - totalCost);
      expect(s.debt).toBeCloseTo(
        DYKE_SEGMENTS.length * DYKE_DEBT * DIFFICULTY[s.difficulty].debtMult,
      );
      // Standing recovers a little at each dawn (§6.13), so weeks of digging
      // ding it without pinning it: colder than it began, never given up.
      expect(s.standing).toBeLessThan(standingBefore);
      expect(s.standing).toBeGreaterThan(0);
      expect(flockCapOf(s)).toBe(FLOCK_CAP + DYKE_SEGMENTS.length * DYKE_PASTURE_HEAD);
      expect(s.lost).toBe(false);
    }
  });
});
