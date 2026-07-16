// Spec §6.13 — M4c-2: the Hawksmere raid. Your market footprint provokes the
// Company; it musters, and after a warning falls on your fattest building. The
// fight runs through the §14 engine (tested in combat.test.ts); here we test
// the raid *around* it — provocation, the timed muster, resolution, and the
// consequences it lands on the world.

import { describe, expect, it } from 'vitest';
import {
  FACTION_ALPHA,
  FACTION_BREAKPOINT,
  FIRST_RAID_SEIZE_FRAC,
  HAWKSMERE_FIRST_RAID,
  HAWKSMERE_FIRST_RAID_DELAY_DAYS,
  HAWKSMERE_PROVOKE,
  RAID_INTERVAL_DAYS,
  RAID_MUSTER_LEAD_DAYS,
  RENT_AMOUNT,
  STANDING_START,
  STARTING_FLOCK,
  TICKS_PER_DAY,
} from '../balance';
import { runPolicyGame, smugglerPolicy } from '../policy';
import { garrisonForce, raidTick, resolveRaid } from '../raid';
import { initialState } from '../tick';
import type { Action, GameState } from '../types';

/** A game already provoked, with a stocked cutting house to raid. */
function primed(mutate?: (s: GameState) => void): GameState {
  const s = initialState(1);
  s.dutchman.unlocked = true;
  s.cuttingHouse = { x: 24, y: 12 };
  s.stores['cutting-house'] = { 'brandy-fair': 12 };
  s.hawksmere = { provoked: true, raidsSurvived: 0, nextRaidTick: 1000 };
  mutate?.(s);
  return s;
}

/** Drive a primed game to a pending battle at its target. */
function toPendingBattle(s: GameState): GameState {
  s.tick = s.hawksmere.nextRaidTick - RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;
  raidTick(s); // muster
  s.tick = s.raid!.battleTick;
  raidTick(s); // the blow falls
  return s;
}

describe('provocation (§6.13)', () => {
  it('the Company takes notice once your footprint is wide enough', () => {
    const s = initialState(1);
    s.contrabandSold = HAWKSMERE_PROVOKE - 1;
    raidTick(s);
    expect(s.hawksmere.provoked).toBe(false);

    s.contrabandSold = HAWKSMERE_PROVOKE;
    raidTick(s);
    expect(s.hawksmere.provoked).toBe(true);
    expect(s.hawksmere.nextRaidTick).toBe(s.tick + HAWKSMERE_FIRST_RAID_DELAY_DAYS * TICKS_PER_DAY);
  });
});

describe('muster and the blow (§6.13)', () => {
  it('musters within the warning window, aimed at the fattest building', () => {
    const s = primed();
    s.tick = s.hawksmere.nextRaidTick - RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;
    raidTick(s);
    expect(s.raid).not.toBeNull();
    expect(s.raid!.target).toBe('cutting-house'); // the goods are there
    expect(s.raid!.size).toBe(HAWKSMERE_FIRST_RAID); // gentle first raid
    expect(s.raid!.battleTick).toBe(s.hawksmere.nextRaidTick);
    expect(s.raid!.pendingBattle).toBe(false); // still riding
  });

  it('the blow falls at the battle tick', () => {
    const s = toPendingBattle(primed());
    expect(s.raid!.pendingBattle).toBe(true);
  });
});

describe('the blended garrison (§6.13)', () => {
  it('is a headcount-blend of militia and crew, dogs excluded from alpha', () => {
    const s = primed((s) => {
      s.garrisons['cutting-house'] = { militia: 3, crew: 1 };
      s.fortifications['cutting-house'] = 1; // dogs — intelligence, not alpha (§22)
    });
    const f = garrisonForce(s, 'cutting-house');
    expect(f.strength).toBe(4);
    expect(f.alpha).toBeCloseTo(
      (3 * FACTION_ALPHA['marsh-militia'] + 1 * FACTION_ALPHA['smuggler-crew']) / 4,
    );
    expect(f.breakPoint).toBeCloseTo(
      (3 * FACTION_BREAKPOINT['marsh-militia'] + 1 * FACTION_BREAKPOINT['smuggler-crew']) / 4,
    );
    expect(f.techAlpha).toBe(0); // tier-1 dogs add no alpha
  });
});

describe('resolution and consequences (§6.13 / §14.6)', () => {
  it('an undefended first raid takes only its share and reschedules', () => {
    const s = toPendingBattle(primed()); // no garrison
    resolveRaid(s);
    expect(s.raid).toBeNull();
    expect(s.hawksmere.raidsSurvived).toBe(1);
    // First raid seizes only FIRST_RAID_SEIZE_FRAC of the 12 tubs.
    expect(s.stores['cutting-house']['brandy-fair']).toBe(12 - Math.floor(12 * FIRST_RAID_SEIZE_FRAC));
    expect(s.hawksmere.nextRaidTick).toBe(s.tick + RAID_INTERVAL_DAYS * TICKS_PER_DAY);
    expect(s.standing).toBe(STANDING_START); // no men posted, none to lose
  });

  it('a strong garrison holds the wall and keeps the goods', () => {
    const s = toPendingBattle(
      primed((s) => {
        s.garrisons['cutting-house'] = { militia: 0, crew: 30 };
        s.fortifications['cutting-house'] = 4;
      }),
    );
    resolveRaid(s);
    expect(s.stores['cutting-house']['brandy-fair']).toBe(12); // nothing carried off
    expect(s.garrisons['cutting-house']!.crew).toBeGreaterThan(0); // survivors remain
    expect(s.log.some((e) => e.text.includes('fall back'))).toBe(true);
  });

  it('a thin wall is overrun — the goods go, but the men mostly flee (§14.3)', () => {
    const s = toPendingBattle(
      primed((s) => {
        s.garrisons['cutting-house'] = { militia: 2, crew: 0 };
      }),
    );
    const before = s.stores['cutting-house']['brandy-fair']!;
    resolveRaid(s);
    expect(s.stores['cutting-house']['brandy-fair']).toBeLessThan(before); // carried off
    expect(s.lost).toBe(false); // a raid never forfeits the tenancy
  });

  it('an overwhelming raid actually kills, and the parish grieves (§14.6)', () => {
    const s = toPendingBattle(
      primed((s) => {
        s.garrisons['cutting-house'] = { militia: 0, crew: 2 };
      }),
    );
    s.raid!.size = 40; // a later, heavier host — no fleeing this
    resolveRaid(s);
    expect(s.standing).toBeLessThan(STANDING_START); // men died; the regard falls
    expect(s.standing).toBeGreaterThan(0); // severe, still survivable
    const g = s.garrisons['cutting-house']!;
    expect(g.militia + g.crew).toBeLessThan(2); // the wall is thinner for it
  });
});

// ---- House rule §13: 200 seeded games with a defending smuggler ----

// The smuggler of §6.9 who posts a few crew and digs in the cutting house once
// crime pays — and so has something to answer the Company with when it comes.
function defendingSmuggler(state: GameState): Action[] {
  const actions = smugglerPolicy(state);
  const cart = state.carts[0];
  const atCut = cart?.location.kind === 'node' && cart.location.nodeId === 'cutting-house';
  if (state.cuttingHouse && atCut) {
    const tier = state.fortifications['cutting-house'] ?? 0;
    const g = state.garrisons['cutting-house'];
    const men = (g?.militia ?? 0) + (g?.crew ?? 0);
    // Keep a rent's reserve behind any spend, so the defence never costs the flock.
    if (tier < 2 && state.coin >= 80 + RENT_AMOUNT) {
      actions.unshift({ type: 'fortifyBuilding', nodeId: 'cutting-house' });
    } else if (men < 4 && state.coin >= 40 + RENT_AMOUNT) {
      actions.unshift({ type: 'raiseGarrison', nodeId: 'cutting-house', kind: 'crew' });
    }
  }
  return actions;
}

const GAMES = 200;
const DAYS = 30;

describe(`${GAMES} seeded games, ${DAYS} days — the defending smuggler (spec §13)`, () => {
  it('the Company comes, the smuggler answers, and the tenancy survives', { timeout: 120_000 }, () => {
    const coins: number[] = [];
    let raidedGames = 0;

    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS, defendingSmuggler);

      expect(s.lost).toBe(false); // a raid never ends the tenancy
      expect(s.flockSize).toBe(STARTING_FLOCK); // they take goods, not sheep
      expect(s.standing).toBeGreaterThan(0); // bloodied, perhaps, but not given up
      expect(s.hawksmere.provoked).toBe(true); // 30 days of trade draws them
      if (s.hawksmere.raidsSurvived > 0) raidedGames++;
      coins.push(s.coin);
    }

    // Deterministic economy and deterministic raids: 200 games, one outcome.
    expect(new Set(coins).size).toBe(1);
    expect(raidedGames).toBe(GAMES); // every one of them was raided at least once
  });
});
