// Spec §6.18 (M5½c) / §14.1 — the water fights back, and the raid is
// straightened. The frontage as a HELD property of the ground, the moat that
// grants it, the Company's capped muster, and cut-the-crossing with its price.
//
// The battle engine is deterministic, so these are exact: the ceilings below
// are the promise §6.18 makes, and CI keeps it.

import { describe, expect, it } from 'vitest';
import {
  CROSSING_FRONTAGE,
  CUT_CROSSING_STANDING,
  DYKE_PASTURE_HEAD,
  FACTION_ALPHA,
  FACTION_BREAKPOINT,
  FLOCK_CAP,
  FORT_ALPHA_PER_TIER,
  HAWKSMERE_MAX_MUSTER,
  MOAT_MIN_TILES,
  RAID_MUSTER_LEAD_DAYS,
  RENT_AMOUNT,
  TICKS_PER_DAY,
  WATER_GUARD_HEAT,
} from '../balance';
import { simulateBattle } from '../combat';
import type { CombatLog } from '../combat';
import { dykeWaterways, flockCapOf, moatTilesAt, moatedAt, nearestDugSegment } from '../dykes';
import { hubPolicy, runPolicyGame } from '../policy';
import { raidBattleSetup, raidTick, resolveRaid } from '../raid';
import { initialState } from '../tick';
import type { Action, GameState } from '../types';

type Foe = 'hawksmere' | 'water-guard' | 'dragoons';

/** A garrison of `crew` behind `tier` of works, as raid.ts raises it. */
function defence(crew: number, tier: number) {
  return {
    faction: 'smuggler-crew' as const,
    strength: crew,
    alpha: FACTION_ALPHA['smuggler-crew'],
    breakPoint: FACTION_BREAKPOINT['smuggler-crew'],
    techAlpha: Math.max(0, tier - 1) * FORT_ALPHA_PER_TIER,
  };
}

function battle(crew: number, tier: number, raiders: number, foe: Foe, frontage?: number): CombatLog {
  return simulateBattle({
    attacker: { faction: foe, strength: raiders },
    defender: defence(crew, tier),
    law: 'square',
    frontage,
    playerSide: 'defender',
  });
}

/** The largest raid this defence turns back. */
function ceiling(crew: number, tier: number, foe: Foe, frontage?: number): number {
  let best = 0;
  for (let n = 1; n <= 200; n++) {
    if (!battle(crew, tier, n, foe, frontage).playerWon) break;
    best = n;
  }
  return best;
}

describe('the frontage (§14.1): the ground admits only so many at once', () => {
  it('turns a fight that was lost on open ground', () => {
    expect(battle(12, 4, 20, 'hawksmere').playerWon).toBe(false);
    expect(battle(12, 4, 20, 'hawksmere', CROSSING_FRONTAGE).playerWon).toBe(true);
  });

  it('is HELD, not owned: too few men and the crossing is never manned', () => {
    // Fewer defenders than the frontage — the water buys them nothing.
    const thin = ceiling(4, 0, 'hawksmere', CROSSING_FRONTAGE);
    expect(thin).toBe(ceiling(4, 0, 'hawksmere'));
  });

  it('a garrison of exactly the frontage is a trap: one man falls and it is forced', () => {
    const log = battle(CROSSING_FRONTAGE, 4, 12, 'hawksmere', CROSSING_FRONTAGE);
    const forcedAt = log.frames.findIndex((f) =>
      f.events.some((e) => e.kind === 'crossing_forced'),
    );
    expect(forcedAt).toBeGreaterThanOrEqual(0); // the moment the first man falls
    expect(log.playerWon).toBe(false);
  });

  it('bounds the fortress — a deep garrison BREAKS rather than losing the line', () => {
    const log = battle(12, 4, 60, 'hawksmere', CROSSING_FRONTAGE);
    expect(log.playerWon).toBe(false); // sixty is past the ceiling: not invulnerable
    // …and they did not lose the ditch. The constant bleed of a frontage fight
    // took their morale with nine of twelve still standing (§14.1).
    expect(log.frames.some((f) => f.events.some((e) => e.kind === 'crossing_forced'))).toBe(false);
    expect(log.outcome).toBe('defender_rout');
    expect(log.survivors.defenders).toBeGreaterThan(CROSSING_FRONTAGE);
  });

  it('never caps the defenders — the ground narrows the assault, not the wall', () => {
    // Twelve behind the water beat far more than six behind it do.
    expect(ceiling(12, 4, 'hawksmere', CROSSING_FRONTAGE)).toBeGreaterThan(
      2 * ceiling(6, 4, 'hawksmere', CROSSING_FRONTAGE),
    );
  });

  it('depth is what buys the crossing its time (§6.18)', () => {
    const ladder = [4, 6, 8, 10, 12].map((n) => ceiling(n, 4, 'hawksmere', CROSSING_FRONTAGE));
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
  });
});

describe('the three rungs (§6.18): what answers whom', () => {
  it('the Company is answered by WORKS AND MEN — a full defence beats its worst', () => {
    expect(ceiling(12, 4, 'hawksmere')).toBeGreaterThanOrEqual(HAWKSMERE_MAX_MUSTER);
    expect(ceiling(12, 4, 'hawksmere')).toBe(15); // the measured promise
  });

  it('the Crown’s Water Guard is answered by THE WATER, and not otherwise', () => {
    expect(ceiling(12, 4, 'water-guard')).toBe(13); // a full defence loses on open ground
    expect(ceiling(12, 4, 'water-guard', CROSSING_FRONTAGE)).toBe(34);
  });

  it('the Dragoons are answered by NOTHING you can post', () => {
    const open = ceiling(12, 4, 'dragoons');
    expect(open).toBe(5);
    expect(ceiling(12, 4, 'dragoons', CROSSING_FRONTAGE)).toBe(open); // they do not rout
  });

  it('the works ladder is felt: each tier moves the ceiling', () => {
    expect(ceiling(8, 2, 'hawksmere')).toBeGreaterThan(ceiling(8, 0, 'hawksmere'));
    expect(ceiling(12, 4, 'hawksmere')).toBeGreaterThan(ceiling(12, 2, 'hawksmere'));
  });
});

describe('the moat (§6.18): water at the foot of the walls', () => {
  const sited = (dug: string[]): GameState => {
    const s = initialState(1);
    s.cuttingHouse = { x: 24, y: 12 };
    s.dykesDug = [...dug];
    return s;
  };

  it('counts dug channel tiles within reach, and needs enough of them', () => {
    expect(moatedAt(sited([]), 'farm')).toBe(false);
    // The farm's own ground takes two cuts to prepare.
    expect(moatTilesAt(sited(['walland-cut']), 'farm')).toBeLessThan(MOAT_MIN_TILES);
    expect(moatTilesAt(sited(['walland-cut', 'five-waterings']), 'farm')).toBeGreaterThanOrEqual(
      MOAT_MIN_TILES,
    );
    expect(moatedAt(sited(['walland-cut', 'five-waterings']), 'farm')).toBe(true);
  });

  it('a house sited on a channel is prepared by that one cut (§6.9’s siting)', () => {
    expect(moatedAt(sited(['guldeford']), 'cutting-house')).toBe(true);
    expect(moatedAt(sited(['guldeford']), 'farm')).toBe(false);
    // …and one sited away from the water is not, however much you dig elsewhere.
    const inland = sited(['guldeford']);
    inland.cuttingHouse = { x: 14, y: 24 };
    expect(moatedAt(inland, 'cutting-house')).toBe(false);
  });

  it('is nobody’s ground but yours: the town and the beach are never moated', () => {
    const s = sited(['guldeford', 'camber-cut', 'broomhill']);
    expect(moatedAt(s, 'ryne')).toBe(false);
    expect(moatedAt(s, 'shingle')).toBe(false);
  });

  it('reads state and never touches it (house rule 1)', () => {
    const s = sited(['guldeford']);
    const before = JSON.stringify(s);
    moatTilesAt(s, 'cutting-house');
    moatedAt(s, 'farm');
    nearestDugSegment(s, 'cutting-house');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('the raid setup carries the frontage only where the water runs', () => {
    const dry = sited([]);
    dry.raid = { faction: 'hawksmere', size: 12, target: 'cutting-house', battleTick: 0, pendingBattle: true };
    expect(raidBattleSetup(dry)?.frontage).toBeUndefined();

    const wet = sited(['guldeford']);
    wet.raid = { faction: 'hawksmere', size: 12, target: 'cutting-house', battleTick: 0, pendingBattle: true };
    expect(raidBattleSetup(wet)?.frontage).toBe(CROSSING_FRONTAGE);
  });
});

describe('the muster (§6.13): a gang has a payroll, the Crown does not', () => {
  const provoked = (mutate?: (s: GameState) => void): GameState => {
    const s = initialState(1);
    s.dutchman.unlocked = true;
    s.coin = 400; // above the pauper's floor, or nobody musters at all
    s.cuttingHouse = { x: 24, y: 12 };
    s.stores['cutting-house'] = { 'brandy-fair': 12 };
    s.hawksmere = { provoked: true, raidsSurvived: 6, nextRaidTick: 1000 };
    s.contrabandSold = 4000; // a footprint far past anything a game reaches
    mutate?.(s);
    s.tick = s.hawksmere.nextRaidTick - RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;
    raidTick(s);
    return s;
  };

  it('caps the Company however wide the footprint grows', () => {
    expect(provoked().raid!.size).toBe(HAWKSMERE_MAX_MUSTER);
  });

  it('does not cap the Crown — its growth is the doom clock', () => {
    const crown = provoked((s) => (s.heat.national = WATER_GUARD_HEAT + 1));
    expect(crown.raid!.faction).toBe('water-guard');
    expect(crown.raid!.size).toBeGreaterThan(HAWKSMERE_MAX_MUSTER);
  });
});

describe('cut the crossing (§6.18): the trump card eats the network', () => {
  /** A moated house under a raid, with the whole waterway chain dug. */
  const underAttack = (): GameState => {
    const s = initialState(1);
    s.coin = 400;
    s.cuttingHouse = { x: 24, y: 12 };
    s.stores['cutting-house'] = { 'brandy-fair': 12 };
    s.dykesDug = ['five-waterings', 'guldeford', 'camber-cut'];
    s.garrisons['cutting-house'] = { militia: 0, crew: 12 };
    s.fortifications['cutting-house'] = 4;
    s.hawksmere = { provoked: true, raidsSurvived: 3, nextRaidTick: 1000 };
    s.tick = s.hawksmere.nextRaidTick - RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;
    raidTick(s);
    s.tick = s.raid!.battleTick;
    raidTick(s);
    return s;
  };

  it('strands everyone not yet across, for good', () => {
    const s = underAttack();
    const cut = simulateBattle({
      ...raidBattleSetup(s)!,
      attacker: { faction: 'hawksmere', strength: 40 },
      calls: [{ frame: 3, call: 'cutCrossing' }],
    });
    const atCut = cut.frames[3].attackers;
    expect(atCut).toBeLessThanOrEqual(CROSSING_FRONTAGE);
    expect(cut.consequences.crossingCut).toBe(true);
    expect(cut.playerWon).toBe(true); // five men do not take a fortress
  });

  it('is no verb at all where there is no bank to break', () => {
    const dry = initialState(1);
    dry.cuttingHouse = { x: 24, y: 12 };
    const log = simulateBattle({
      attacker: { faction: 'hawksmere', strength: 20 },
      defender: defence(12, 4),
      law: 'square',
      playerSide: 'defender',
      calls: [{ frame: 1, call: 'cutCrossing' }],
    });
    expect(log.consequences.crossingCut).toBe(false);
  });

  it('the water takes the level back: the channel, the grazing, and the parish', () => {
    const s = underAttack();
    const standingBefore = s.standing;
    const debtBefore = s.debt;
    const capBefore = flockCapOf(s);
    const doomed = nearestDugSegment(s, 'cutting-house')!;
    const waysBefore = dykeWaterways(s).map((w) => w.id);
    expect(waysBefore.length).toBeGreaterThan(0); // a waterway ran through it

    resolveRaid(s, [{ frame: 3, call: 'cutCrossing' }]);

    expect(s.dykesDug).not.toContain(doomed.id); // undug, and dear to re-cut
    expect(flockCapOf(s)).toBe(capBefore - DYKE_PASTURE_HEAD); // the grazing drowns
    // The tub-boat's road is broken where the bank went: fewer waterways than
    // there were, and the chain that ran through the cut is gone.
    const waysAfter = dykeWaterways(s).map((w) => w.id);
    expect(waysAfter.length).toBeLessThan(waysBefore.length);
    expect(waysAfter).not.toContain('waterway-farm-shingle');
    expect(s.standing).toBeLessThanOrEqual(standingBefore - CUT_CROSSING_STANDING);
    expect(s.debt).toBe(debtBefore); // the marsh never forgives; §6.14's invariant
    expect(s.log.some((e) => e.text.includes('goes out under them'))).toBe(true);
  });

  it('costs the flock cap for good — re-cutting is the only way back', () => {
    const s = underAttack();
    resolveRaid(s, [{ frame: 3, call: 'cutCrossing' }]);
    expect(flockCapOf(s)).toBe(FLOCK_CAP + s.dykesDug.length * DYKE_PASTURE_HEAD);
  });
});

// ---- House rule 5: 200 seeded games behind the water ----

/** The hub that digs its own moat: the Guldeford runs past the bots' siting,
 *  so one cut prepares the ground the Company comes for (§6.18, §6.9). */
function moatedHub(state: GameState): Action[] {
  const actions = hubPolicy(state);
  const cart = state.carts[0];
  const atCut = cart?.location.kind === 'node' && cart.location.nodeId === 'cutting-house';
  if (!state.cuttingHouse || !atCut) return actions;
  const tier = state.fortifications['cutting-house'] ?? 0;
  const g = state.garrisons['cutting-house'];
  const men = (g?.militia ?? 0) + (g?.crew ?? 0);
  // A rent's reserve stays behind every spend, so the defence never eats the flock.
  if (!state.dykesDug.includes('guldeford') && state.digging === null && state.coin >= 200) {
    actions.unshift({ type: 'digDyke', id: 'guldeford' });
  } else if (tier < 2 && state.coin >= 80 + RENT_AMOUNT) {
    actions.unshift({ type: 'fortifyBuilding', nodeId: 'cutting-house' });
  } else if (men < CROSSING_FRONTAGE + 2 && state.coin >= 40 + RENT_AMOUNT) {
    actions.unshift({ type: 'raiseGarrison', nodeId: 'cutting-house', kind: 'crew' });
  }
  return actions;
}

const GAMES = 200;
const DAYS = 30;

describe(`${GAMES} seeded games, ${DAYS} days — the hub behind the water (spec §13/§6.18)`, () => {
  it('digs its moat, mans it deeper than the crossing, and keeps the tenancy', { timeout: 240_000 }, () => {
    let moatedGames = 0;
    let raidedGames = 0;
    const coins: number[] = [];

    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS, moatedHub);

      expect(s.lost).toBe(false);
      expect(s.standing).toBeGreaterThan(0);
      expect(s.debt).toBeGreaterThanOrEqual(0);
      if (moatedAt(s, 'cutting-house')) {
        moatedGames++;
        // The water is only ever worth what stands behind it (§14.1).
        const men =
          (s.garrisons['cutting-house']?.militia ?? 0) + (s.garrisons['cutting-house']?.crew ?? 0);
        expect(men).toBeGreaterThanOrEqual(CROSSING_FRONTAGE);
        expect(raidBattleSetup({ ...s, raid: { faction: 'hawksmere', size: 12, target: 'cutting-house', battleTick: 0, pendingBattle: true } })?.frontage).toBe(CROSSING_FRONTAGE);
      }
      if (s.hawksmere.raidsSurvived > 0) raidedGames++;
      coins.push(s.coin);
    }

    // Every seed digs it: the cut is affordable inside the wealth clock (§6.15).
    expect(moatedGames).toBe(GAMES);
    expect(raidedGames).toBe(GAMES); // and every one of them was raided
    expect(new Set(coins).size).toBe(1); // deterministic economy, deterministic war
  });
});
