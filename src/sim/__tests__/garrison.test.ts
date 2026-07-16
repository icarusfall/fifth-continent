// Spec §6.13 — M4c-1: the standing garrison and Standing. The defensive
// apparatus stands ready before any raider comes (M4c-2). Men are posted at a
// building, draw a wage at dawn, and desert if unpaid; the building's fort tier
// sets how many it can quarter. Standing is the parish's regard — it only falls
// under fire (combat, M4c-2), drifts back in peace, and at zero sets the
// informer that closes the marsh's free hides.

import { describe, expect, it } from 'vitest';
import {
  COVER_CAPACITY,
  CREW_MUSTER,
  CREW_WAGE,
  GARRISON_BASE,
  GARRISON_PER_TIER,
  INFORMER_COVER,
  MILITIA_MUSTER,
  MILITIA_WAGE,
  RENT_AMOUNT,
  SHEARING_HOUR,
  STANDING_RECOVERY,
  STANDING_START,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from '../balance';
import { runPolicyGame, smugglerPolicy } from '../policy';
import { coverOf } from '../revenue';
import { garrisonCap, initialState, loseStanding, tick } from '../tick';
import type { Action, GameState } from '../types';

function withCoin(seed: number, coin: number): GameState {
  const s = initialState(seed);
  s.coin = coin;
  return s;
}

function runTicks(state: GameState, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

const count = (s: GameState, node: string) =>
  (s.garrisons[node]?.militia ?? 0) + (s.garrisons[node]?.crew ?? 0);

describe('raising a garrison (§6.13)', () => {
  it('posts a man of a kind and charges the muster', () => {
    let s = withCoin(1, 200);
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' }]);
    expect(s.garrisons.farm?.militia).toBe(1);
    expect(s.coin).toBe(200 - MILITIA_MUSTER);
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'farm', kind: 'crew' }]);
    expect(s.garrisons.farm).toEqual({ militia: 1, crew: 1 });
    expect(s.coin).toBe(200 - MILITIA_MUSTER - CREW_MUSTER);
  });

  it('will not quarter more men than the building holds, and the cap is the fort tier', () => {
    expect(garrisonCap(initialState(1), 'farm')).toBe(GARRISON_BASE);
    let s = withCoin(1, 1000);
    // Fill a bare farm to its base cap, then the next man is turned away.
    for (let i = 0; i < GARRISON_BASE + 2; i++) {
      s = tick(s, [{ type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' }]);
    }
    expect(count(s, 'farm')).toBe(GARRISON_BASE);
    // Dig in: the wall now quarters more.
    s.fortifications.farm = 2;
    expect(garrisonCap(s, 'farm')).toBe(GARRISON_BASE + 2 * GARRISON_PER_TIER);
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' }]);
    expect(count(s, 'farm')).toBe(GARRISON_BASE + 1);
  });

  it('refuses when the till is short, and only in your own walls', () => {
    let s = withCoin(1, MILITIA_MUSTER - 1);
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' }]);
    expect(count(s, 'farm')).toBe(0);

    s = withCoin(1, 1000);
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'ryne', kind: 'militia' }]); // not yours
    s = tick(s, [{ type: 'raiseGarrison', nodeId: 'cutting-house', kind: 'crew' }]); // no house yet
    expect(count(s, 'ryne')).toBe(0);
    expect(count(s, 'cutting-house')).toBe(0);
    expect(s.coin).toBe(1000);
  });

  it('stands a man down on dismissal', () => {
    let s = withCoin(1, 200);
    s = tick(s, [
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'crew' },
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'crew' },
    ]);
    s = tick(s, [{ type: 'dismissGarrison', nodeId: 'farm', kind: 'crew' }]);
    expect(s.garrisons.farm?.crew).toBe(1);
  });
});

describe('garrison wages at dawn (§6.13)', () => {
  const toDawn = SHEARING_HOUR * TICKS_PER_HOUR + 1;

  it('draws the wall\'s wage at dawn', () => {
    let s = withCoin(1, 200);
    s = tick(s, [
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' },
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' },
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'crew' },
    ]);
    const afterMuster = s.coin;
    s = runTicks(s, toDawn);
    // 2 militia + 1 crew = 2×MILITIA_WAGE + 1×CREW_WAGE, paid once at dawn.
    expect(s.coin).toBe(afterMuster - (2 * MILITIA_WAGE + CREW_WAGE));
    expect(count(s, 'farm')).toBe(3); // all paid, all present
  });

  it('deserts the cheapest men first when the wage cannot be met', () => {
    let s = withCoin(1, 200);
    s = tick(s, [
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' },
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'militia' },
      { type: 'raiseGarrison', nodeId: 'farm', kind: 'crew' },
    ]);
    s.coin = 3; // bill is 2×1 + 1×3 = 5; only 3 in the till
    s = runTicks(s, toDawn);
    // Two militia walk (bill 5→4→3), then the crew is paid: 3 coin gone.
    expect(s.garrisons.farm).toEqual({ militia: 0, crew: 1 });
    expect(s.coin).toBe(0);
    expect(s.log.some((e) => e.text.includes('walks off the wall'))).toBe(true);
  });
});

describe('Standing (§6.13 / §11)', () => {
  it('recovers slowly in peace, capped at the start', () => {
    const s0 = initialState(1);
    s0.standing = STANDING_START - 10;
    const s = runTicks(s0, SHEARING_HOUR * TICKS_PER_HOUR + 1); // one dawn
    expect(s.standing).toBeCloseTo(STANDING_START - 10 + STANDING_RECOVERY);
    // A game that starts full stays full — recovery never overflows.
    const full = runTicks(initialState(1), TICKS_PER_DAY * 3);
    expect(full.standing).toBe(STANDING_START);
  });

  it('falls under fire, floors at zero, and sets the informer once', () => {
    const s = initialState(1);
    loseStanding(s, 30);
    expect(s.standing).toBe(STANDING_START - 30);
    expect(s.informer).toBe(false);

    loseStanding(s, 999); // more than remains
    expect(s.standing).toBe(0); // floored, not negative
    expect(s.informer).toBe(true);
    expect(s.log.filter((e) => e.text.includes('Someone talks')).length).toBe(1);

    loseStanding(s, 5); // already at the floor
    expect(s.standing).toBe(0);
    expect(s.log.filter((e) => e.text.includes('Someone talks')).length).toBe(1); // not twice
  });

  it('the informer closes the marsh\'s free hides', () => {
    const clean = initialState(1);
    expect(coverOf(clean, 'cutting-house')).toBe(COVER_CAPACITY['cutting-house']);
    const talked = initialState(1);
    loseStanding(talked, STANDING_START);
    expect(coverOf(talked, 'cutting-house')).toBe(INFORMER_COVER);
    expect(coverOf(talked, 'farm')).toBe(INFORMER_COVER);
  });
});

// ---- House rule §13: 200 seeded games with a garrisoning smuggler ----

// The smuggler of §6.9 who also posts a couple of men at the cutting house once
// crime can pay for it. No raider comes yet (M4c-2), so the men only cost —
// like fortification's latent alpha, the apparatus stands ready.
function garrisoningSmuggler(state: GameState): Action[] {
  const actions = smugglerPolicy(state);
  const cart = state.carts[0];
  const atCut = cart?.location.kind === 'node' && cart.location.nodeId === 'cutting-house';
  if (state.cuttingHouse && atCut) {
    if (count(state, 'cutting-house') < 2 && state.coin >= MILITIA_MUSTER + RENT_AMOUNT) {
      actions.unshift({ type: 'raiseGarrison', nodeId: 'cutting-house', kind: 'militia' });
    }
  }
  return actions;
}

const GAMES = 200;
const DAYS = 20;

describe(`${GAMES} seeded games, ${DAYS} days — the garrisoning smuggler (spec §13)`, () => {
  it('posts men, pays their wage, and ends upright with the parish still with him', { timeout: 120_000 }, () => {
    const coins: number[] = [];
    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS, garrisoningSmuggler);

      expect(s.lost).toBe(false);
      expect(s.flockSize).toBe(STARTING_FLOCK);
      expect(s.cuttingHouse).not.toBeNull();
      expect(count(s, 'cutting-house')).toBeGreaterThanOrEqual(1); // the wall is manned
      expect(s.coin).toBeGreaterThan(0); // solvent after muster and wages
      // No fight has happened, so the parish's regard is untouched — and the
      // informer never turns on honest-to-the-parish smuggling alone.
      expect(s.standing).toBe(STANDING_START);
      expect(s.informer).toBe(false);
      coins.push(s.coin);
    }
    expect(new Set(coins).size).toBe(1); // deterministic economy, one outcome
  });
});
