// Spec §6.4 / §6.14 Marsh 4 (M5c playtest) — the Reed-Veil, §6.4's promised
// concealment finally built. While the veil stands every building's
// fortVisibility reads divided (the galvanic apparatus included) and the
// marsh charges MARSH_VEIL_DEBT per hidden building each dawn. The point of
// the tier is §6.12's equilibrium trap: dawn fort heat against 3% decay
// parks the parish where no amount of lying low can cool it; the veil is
// the payable price that unpins the meter. All deterministic; the 200-game
// block is house rule 5's.

import { describe, expect, it } from 'vitest';
import { breathe } from './breathe';
import {
  DIFFICULTY,
  FORT_VISIBILITY_HEAT,
  GALVANIC_VISIBILITY,
  MARSH_VEIL_DEBT,
  MARSH_VEIL_DIV,
  OFFICER_ARRIVAL_HEAT,
  REGIONAL_HEAT_DECAY,
  SHEARING_HOUR,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from '../balance';
import { fortVisibility, fortVisibilityRaw, standingDawnHeat } from '../revenue';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60; // mid-morning
  s.lastCrisisTick = -(20 * TICKS_PER_DAY); // §6.15 spacing never blocks a test
  // The real research gate guarantees a binding; the fixtures set completed
  // tiers directly, so carry the guarantee too — the veil's rent must not
  // breach an account with nobody bound to hold it.
  s.boundWights = 1;
  mutate?.(s);
  return s;
}

describe('the divide (§6.4): the veil reads every work a quarter as loud', () => {
  it('divides the whole sum — tiers and the galvanic apparatus alike — only once learned and raised', () => {
    const s = fresh((st) => {
      st.fortifications.farm = 4;
      st.leiden = { ...st.leiden, state: 'housed', node: 'farm' };
      st.research.completed.leiden = 1; // the fence is wired
    });
    const raw = fortVisibilityRaw(s, 'farm');
    expect(raw).toBeCloseTo(2.0 + GALVANIC_VISIBILITY); // fortress + fence

    // Unlearned: raising the veil in state alone changes nothing.
    s.wights.veil = true;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(raw);

    // Learned and raised: the whole sum reads divided; raw stands unchanged.
    s.research.completed.marsh = 4;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(raw / MARSH_VEIL_DIV);
    expect(fortVisibilityRaw(s, 'farm')).toBeCloseTo(raw);

    // Lowered: the works stand showing again.
    s.wights.veil = false;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(raw);
  });
});

describe('the verb (§6.14): raise the veil, let the reeds fall', () => {
  it('refuses before the reed-word is learned', () => {
    let s = fresh();
    s = tick(s, [{ type: 'setVeil', up: true }]);
    expect(s.wights.veil).toBe(false);
    expect(s.log.some((e) => e.text.includes('has not taught the reed-word'))).toBe(true);
  });

  it('toggles freely once learned — reversible, no coin', () => {
    let s = fresh((st) => {
      st.research.completed.marsh = 4;
    });
    const coin = s.coin;
    s = tick(s, [{ type: 'setVeil', up: true }]);
    expect(s.wights.veil).toBe(true);
    s = tick(s, [{ type: 'setVeil', up: false }]);
    expect(s.wights.veil).toBe(false);
    expect(s.coin).toBe(coin);
  });
});

describe("the rent (§6.14): the marsh charges per hidden building, per dawn", () => {
  it('charges each dawn for each building with works to hide, dial-scaled', () => {
    let s = fresh((st) => {
      st.research.completed.marsh = 4;
      st.wights.veil = true;
      st.fortifications.farm = 2;
      st.cuttingHouse = { x: 24, y: 12 };
      st.fortifications['cutting-house'] = 1;
    });
    const mult = DIFFICULTY[s.difficulty].debtMult;
    s = runTicks(s, TICKS_PER_DAY * 3);
    const dawns = countDawns(60, s.tick);
    expect(s.debt).toBeCloseTo(dawns * 2 * MARSH_VEIL_DEBT * mult);
  });

  it('charges nothing for a building with nothing to hide, and nothing once the reeds fall', () => {
    let bare = fresh((st) => {
      st.research.completed.marsh = 4;
      st.wights.veil = true;
      st.fortifications.farm = 2;
      st.cuttingHouse = { x: 24, y: 12 }; // tier 0 — invisible, uncharged
    });
    const mult = DIFFICULTY[bare.difficulty].debtMult;
    bare = runTicks(bare, TICKS_PER_DAY * 3);
    expect(bare.debt).toBeCloseTo(countDawns(60, bare.tick) * 1 * MARSH_VEIL_DEBT * mult);

    let fallen = fresh((st) => {
      st.research.completed.marsh = 4;
      st.wights.veil = false;
      st.fortifications.farm = 4;
    });
    fallen = runTicks(fallen, TICKS_PER_DAY * 3);
    expect(fallen.debt).toBe(0);
  });
});

describe('the equilibrium (§6.12): the veil unpins what lying low cannot', () => {
  // One tub of brandy sits *under* the farm's cover throughout: never seized,
  // never leaking, but blocking §6.10's clean-search relief — so the works'
  // own dawn arithmetic is all that separates the twins.
  function stew(veiled: boolean, seed: number, days: number): GameState {
    let s = initialState(seed);
    s.tick = 60;
    s.lastCrisisTick = -(20 * TICKS_PER_DAY);
    s.boundWights = 1; // the research gate's guarantee, carried by hand
    s.fortifications.farm = 4;
    s.stores.farm = { ...(s.stores.farm ?? {}), 'brandy-rough': 1 };
    s.research.completed.marsh = 4;
    s.wights.veil = veiled;
    return runTicks(s, TICKS_PER_DAY * days);
  }

  it('bare tier-4 works park the parish hot for good; veiled, the same life cools under the notch', () => {
    const bare = stew(false, 7, 50);
    const veiled = stew(true, 7, 50);

    // Bare: the works' dawn tell (2.0 × 1.3) against 3% decay settles near
    // ~87 — over the officer's notch forever, crime or no crime.
    expect(bare.heat.regional).toBeGreaterThan(60);
    expect(bare.revenue.officer.arrived).toBe(true);

    // Veiled: the same fortress settles near ~22 — warm, never summoning.
    expect(veiled.heat.regional).toBeLessThan(OFFICER_ARRIVAL_HEAT);
    expect(veiled.revenue.officer.arrived).toBe(false);
    expect(veiled.heat.regional).toBeLessThan(bare.heat.regional);

    // And the price ran: a dawn-rent the bare twin never paid.
    expect(veiled.debt).toBeGreaterThan(0);
    expect(bare.debt).toBe(0);
  });

  it('standingDawnHeat reads the charge the gauge speaks (§20.2)', () => {
    const s = fresh((st) => {
      st.fortifications.farm = 4;
    });
    // Fort tell only: no over-cover stock in a fresh yard.
    expect(standingDawnHeat(s)).toBeCloseTo(2.0 * FORT_VISIBILITY_HEAT);
    // The settling point it implies is the §6.12 equilibrium.
    const settles = standingDawnHeat(s) / (1 - REGIONAL_HEAT_DECAY);
    expect(settles).toBeCloseTo((2.0 * FORT_VISIBILITY_HEAT) / 0.03);
    // Veiled, the same works read a quarter of it.
    s.research.completed.marsh = 4;
    s.wights.veil = true;
    expect(standingDawnHeat(s)).toBeCloseTo((2.0 / MARSH_VEIL_DIV) * FORT_VISIBILITY_HEAT);
  });
});

/** Dawns strictly after `fromTick`, up to and including `toTick`. */
function countDawns(fromTick: number, toTick: number): number {
  let n = 0;
  for (let t = fromTick + 1; t <= toTick; t++) {
    if (t % TICKS_PER_DAY === DAWN % TICKS_PER_DAY) n++;
  }
  return n;
}

// ---- House rule 5: 200 seeded games with the veil up ----

const GAMES = 200;
const STEW_DAYS = 30;

describe(`${GAMES} seeded games, ${STEW_DAYS} days — the veiled fortress (spec §13)`, () => {
  it('across every seed: hidden works cool under the notch, bare works never do, and the rent is exact', { timeout: 120_000 }, async () => {
    for (let seed = 1; seed <= GAMES; seed++) {
      await breathe(seed);
      let s = initialState(seed);
      s.tick = 60;
      s.lastCrisisTick = -(20 * TICKS_PER_DAY);
      s.boundWights = 1; // the research gate's guarantee, carried by hand
      s.fortifications.farm = 4;
      s.stores.farm = { ...(s.stores.farm ?? {}), 'brandy-rough': 1 };
      s.research.completed.marsh = 4;
      s = tick(s, [{ type: 'setVeil', up: true }]);
      const start = s.tick;
      s = (function run(state: GameState) {
        for (let i = 0; i < TICKS_PER_DAY * STEW_DAYS; i++) state = tick(state, []);
        return state;
      })(s);

      expect(s.wights.veil).toBe(true);
      expect(s.heat.regional).toBeLessThan(OFFICER_ARRIVAL_HEAT);
      expect(s.revenue.officer.arrived).toBe(false);
      const mult = DIFFICULTY[s.difficulty].debtMult;
      expect(s.debt).toBeCloseTo(countDawns(start, s.tick) * MARSH_VEIL_DEBT * mult);
      expect(s.lost).toBe(false);
    }
  });
});
