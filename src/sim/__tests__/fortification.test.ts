// Spec §6.12 — M4b fortification and the visibility trade-off. Hardening a
// building is bought with coin, adds latent defender alpha (spent only in a
// raid, M4c), and — the live half tested here — makes the building *louder*:
// it leaks more over-cover Heat (§6.1) and stands off suspicion of its own
// each dawn (§6.4). The works are visible, by design (§9).

import { describe, expect, it } from 'vitest';
import {
  FORT_COST,
  FORT_VISIBILITY,
  FORT_VISIBILITY_HEAT,
  MAX_FORT_TIER,
  RENT_AMOUNT,
  STARTING_FLOCK,
  STORAGE_HEAT_COEFF,
  SUSPICION_SHARE,
  TICKS_PER_DAY,
} from '../balance';
import { greedyCarterPolicy, runPolicyGame, smugglerPolicy } from '../policy';
import { accrueFortHeat, accrueStorageHeat, fortVisibility } from '../revenue';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

function withCoin(seed: number, coin: number): GameState {
  const s = initialState(seed);
  s.coin = coin;
  return s;
}

describe('the fortify verb (§6.12)', () => {
  it('climbs the ladder one rung at a time and charges the doubling cost', () => {
    let s = withCoin(1, 1000);
    s = tick(s, [{ type: 'fortifyBuilding', nodeId: 'farm' }]);
    expect(s.fortifications.farm).toBe(1);
    expect(s.coin).toBe(1000 - FORT_COST[1]);
    // Three more rungs in one tick: 2, 3, 4 — costs stack.
    s = tick(s, [
      { type: 'fortifyBuilding', nodeId: 'farm' },
      { type: 'fortifyBuilding', nodeId: 'farm' },
      { type: 'fortifyBuilding', nodeId: 'farm' },
    ]);
    expect(s.fortifications.farm).toBe(MAX_FORT_TIER);
    expect(s.coin).toBe(1000 - (FORT_COST[1] + FORT_COST[2] + FORT_COST[3] + FORT_COST[4]));
  });

  it('will not climb past the top rung', () => {
    let s = withCoin(1, 1000);
    for (let i = 0; i < 6; i++) s = tick(s, [{ type: 'fortifyBuilding', nodeId: 'farm' }]);
    expect(s.fortifications.farm).toBe(MAX_FORT_TIER);
    expect(s.coin).toBe(1000 - (FORT_COST[1] + FORT_COST[2] + FORT_COST[3] + FORT_COST[4]));
  });

  it('refuses when the till is short, leaving the works unchanged', () => {
    let s = withCoin(1, FORT_COST[1] - 1);
    s = tick(s, [{ type: 'fortifyBuilding', nodeId: 'farm' }]);
    expect(s.fortifications.farm ?? 0).toBe(0);
    expect(s.coin).toBe(FORT_COST[1] - 1);
  });

  it('fortifies only your own buildings — not the market, not a house unbuilt', () => {
    let s = withCoin(1, 1000);
    s = tick(s, [{ type: 'fortifyBuilding', nodeId: 'ryne' }]);
    expect(s.fortifications.ryne ?? 0).toBe(0); // Ryne is not yours
    s = tick(s, [{ type: 'fortifyBuilding', nodeId: 'cutting-house' }]);
    expect(s.fortifications['cutting-house'] ?? 0).toBe(0); // no cutting house yet
    expect(s.coin).toBe(1000); // nothing spent on either refusal
  });
});

describe('fortVisibility (§6.4)', () => {
  it('sums the tiers climbed, and climbs faster than the alpha does', () => {
    const s = initialState(1);
    expect(fortVisibility(s, 'farm')).toBe(0); // tier 0 is invisible
    s.fortifications.farm = 1;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(FORT_VISIBILITY[1]); // dogs, near-silent
    s.fortifications.farm = 3;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(
      FORT_VISIBILITY[1] + FORT_VISIBILITY[2] + FORT_VISIBILITY[3],
    );
    s.fortifications.farm = MAX_FORT_TIER;
    expect(fortVisibility(s, 'farm')).toBeCloseTo(2.0); // the fortress is loudest
  });
});

describe('the visibility trade-off (§6.1, §6.12)', () => {
  it('a hard building leaks more of what it cannot hide', () => {
    // Contraband over the cutting house cover (6), one soft and one hardened.
    const soft = initialState(1);
    soft.stores['cutting-house'] = { 'brandy-fair': 10 }; // 4 over cover
    const hard = initialState(1);
    hard.stores['cutting-house'] = { 'brandy-fair': 10 };
    hard.fortifications['cutting-house'] = 3;

    accrueStorageHeat(soft);
    accrueStorageHeat(hard);

    const over = 4;
    expect(soft.heat.regional).toBeCloseTo(over * STORAGE_HEAT_COEFF);
    expect(hard.heat.regional).toBeCloseTo(
      over * STORAGE_HEAT_COEFF * (1 + fortVisibility(hard, 'cutting-house')),
    );
    expect(hard.heat.regional).toBeGreaterThan(soft.heat.regional);
  });

  it('a hard building stains itself each dawn, even holding nothing', () => {
    const s = initialState(1);
    s.fortifications.farm = 2;
    accrueFortHeat(s);
    const vis = fortVisibility(s, 'farm');
    expect(s.heat.regional).toBeCloseTo(vis * FORT_VISIBILITY_HEAT);
    expect(s.revenue.suspicion.farm).toBeCloseTo(vis * FORT_VISIBILITY_HEAT * SUSPICION_SHARE);

    const bare = initialState(1);
    accrueFortHeat(bare);
    expect(bare.heat.regional).toBe(0); // nothing to see
  });
});

describe('fortification pulls the Revenue toward you (§6.12)', () => {
  it('a full fortress summons the officer and becomes his sorest stain — on lawful wool', () => {
    // A wholly lawful farmer who builds a fortress. The wool stays invisible
    // (§6.10); the *works* are the tell.
    let s = withCoin(1, 1000);
    s = tick(s, [
      { type: 'fortifyBuilding', nodeId: 'farm' },
      { type: 'fortifyBuilding', nodeId: 'farm' },
      { type: 'fortifyBuilding', nodeId: 'farm' },
      { type: 'fortifyBuilding', nodeId: 'farm' },
    ]);
    // His suspicion of the works sawtooths around the patrol threshold (it
    // climbs each dawn, he halves it each time he searches), so "he rides to
    // the fort" is a thing that happens across days, not a fact of one instant.
    let rodeToFort = false;
    for (let t = 0; t < TICKS_PER_DAY * 18; t++) {
      s = tick(s, greedyCarterPolicy(s));
      if (s.revenue.officer.targetNodeId === 'farm') rodeToFort = true;
    }

    expect(s.revenue.officer.arrived).toBe(true); // the fortress alone brought him
    expect(rodeToFort).toBe(true); // and he rides to it by choice
    expect(s.revenue.suspicion.farm ?? 0).toBeGreaterThan(s.revenue.suspicion.ryne ?? 0);
  });

  it('the same lawful life, unfortified, stays invisible (M3 invariant holds)', () => {
    let s = initialState(1);
    for (let t = 0; t < TICKS_PER_DAY * 12; t++) s = tick(s, greedyCarterPolicy(s));
    expect(s.revenue.officer.arrived).toBe(false);
    expect(s.heat.regional).toBe(0); // it is the fort that is seen, never the wool
  });
});

// ---- House rule §13: 200 seeded games with a fortifying smuggler ----

// The smuggler of §6.9, who also digs in the cutting house once crime can pay
// for it — hardening the very building he stores contraband in, which is the
// trap M4b sets (§9): hard and hidden pull apart.
const BOT_FORT_CAP = 2; // dig in enough to prove the trade-off, not enough to bankrupt

function fortifyingSmuggler(state: GameState): Action[] {
  const actions = smugglerPolicy(state);
  const cart = state.carts[0];
  const atCut = cart?.location.kind === 'node' && cart.location.nodeId === 'cutting-house';
  if (state.cuttingHouse && atCut) {
    const tier = state.fortifications['cutting-house'] ?? 0;
    // Keep a rent's reserve so the works never cost the flock (§6.8).
    if (tier < BOT_FORT_CAP && state.coin >= FORT_COST[tier + 1] + RENT_AMOUNT) {
      actions.unshift({ type: 'fortifyBuilding', nodeId: 'cutting-house' });
    }
  }
  return actions;
}

const GAMES = 200;
const DAYS = 20;

describe(`${GAMES} seeded games, ${DAYS} days — the fortifying smuggler (spec §13)`, () => {
  it('digs in, runs hotter for it, and still ends upright', { timeout: 120_000 }, () => {
    const coins: number[] = [];

    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS, fortifyingSmuggler);

      expect(s.lost).toBe(false);
      expect(s.flockSize).toBe(STARTING_FLOCK); // fort money came from crime, not the flock
      expect(s.cuttingHouse).not.toBeNull();
      // He hardened the shed — at least the first rung, bought from proceeds.
      expect(s.fortifications['cutting-house'] ?? 0).toBeGreaterThanOrEqual(1);
      expect(s.coin).toBeGreaterThan(0); // solvent after the works
      coins.push(s.coin);
    }

    // Deterministic economy: 200 games, one outcome (matches the M1–M3 pattern).
    expect(new Set(coins).size).toBe(1);
  });

  it('the visibility trade-off is real: identical stock, hard building runs hotter', () => {
    // Controlled — no coin, no bot, so nothing but the works differ. A cutting
    // house sitting on over-cover brandy, one soft and one hardened, left to
    // stew for five days. The hard one accrues strictly more Heat (leak, §6.1)
    // and, once dawns pass, its own standing stain (fortHeat, §6.12).
    function stew(fortTier: number): GameState {
      let s = initialState(1);
      s.cuttingHouse = { x: 24, y: 12 };
      s.stores['cutting-house'] = { 'brandy-fair': 7 }; // 1 over cover — kept low
      if (fortTier > 0) s.fortifications['cutting-house'] = fortTier;
      for (let t = 0; t < TICKS_PER_DAY * 4; t++) s = tick(s, []);
      return s;
    }
    const soft = stew(0);
    const hard = stew(3);
    // Held below the arrival threshold on purpose: no officer, no seizure, so
    // nothing but the works differ.
    expect(hard.revenue.officer.arrived).toBe(false);
    expect(hard.heat.regional).toBeGreaterThan(soft.heat.regional);
    expect(hard.heat.national).toBeGreaterThanOrEqual(soft.heat.national);
  });
});
