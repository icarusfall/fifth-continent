// Spec §14 — the combat engine. Deterministic attrition: no dice, so every
// assertion here is exact. The formulas under test are the two Lanchester laws
// (§14.1), morale and rout (§14.3), the three Calls (§14.4), fog (§14.5), and
// the economic consequences (§14.6). The final block is the house-rule §13
// distribution: 200 seeded battles that must all end sane.

import { describe, expect, it } from 'vitest';
import {
  BOUND_GUARDIAN_ALPHA,
  COMBAT_MAX_FRAMES,
  ENGINE_FIRE_HEAT,
  FACTION_ALPHA,
  FORT_ALPHA_PER_TIER,
  NATIONAL_HEAT_PER_DRAGOON_DEAD,
  NATIONAL_HEAT_PER_REVENUE_DEAD,
  STANDING_LOSS_PER_FRIENDLY_DEAD,
} from '../balance';
import {
  type BattleSetup,
  type Faction,
  canPayOff,
  effectiveAlpha,
  simulateBattle,
} from '../combat';
import { nextInt, nextRandom, seedRng } from '../rng';

// A defended raid: the player holds a building; the setup is otherwise minimal.
function raid(over: Partial<BattleSetup>): BattleSetup {
  return {
    attacker: { faction: 'riding-officer', strength: 8 },
    defender: { faction: 'marsh-militia', strength: 10 },
    law: 'square',
    playerSide: 'defender',
    ...over,
  };
}

describe('effectiveAlpha (§14.2)', () => {
  it('is the faction base, plus tech, plus guardian, plus fort when defending', () => {
    const militia: Faction = 'marsh-militia';
    // Fort works help only the defender.
    expect(effectiveAlpha({ faction: militia, strength: 10, fortTier: 3 }, false)).toBeCloseTo(
      FACTION_ALPHA[militia],
    );
    expect(effectiveAlpha({ faction: militia, strength: 10, fortTier: 3 }, true)).toBeCloseTo(
      FACTION_ALPHA[militia] + 3 * FORT_ALPHA_PER_TIER,
    );
    // Tech and the Guardian add regardless of side.
    expect(
      effectiveAlpha({ faction: militia, strength: 10, techAlpha: 0.12, guardian: true }, false),
    ).toBeCloseTo(FACTION_ALPHA[militia] + 0.12 + BOUND_GUARDIAN_ALPHA);
  });
});

describe('canPayOff (§14.4) — coin silences only the venal', () => {
  it('buys off the Company and the Officers, and no one else', () => {
    expect(canPayOff('hawksmere')).toBe(true);
    expect(canPayOff('riding-officer')).toBe(true);
    expect(canPayOff('water-guard')).toBe(false);
    expect(canPayOff('dragoons')).toBe(false);
    expect(canPayOff('wights')).toBe(false);
  });
});

describe('the two laws (§14.1)', () => {
  it('open ground squares numbers: fifty Dragoons rout ten militia at once', () => {
    const log = simulateBattle(
      raid({ attacker: { faction: 'dragoons', strength: 50 }, defender: { faction: 'marsh-militia', strength: 10 } }),
    );
    expect(log.outcome).toBe('defender_rout');
    expect(log.playerWon).toBe(false);
    // A rout, not a massacre: the militia break with men still alive (§14.3).
    expect(log.survivors.defenders).toBeGreaterThan(0);
    expect(log.frames.length).toBeLessThan(5);
  });

  it('prepared ground makes the attacker bleed for it, and helps the defender hold', () => {
    // Same forces, both laws. On prepared ground the crowd cannot bring numbers
    // to bear: the attacker always loses at least as many men, and the defender
    // holds at least as often. (Defender *survivors* is not the right metric —
    // routing early on open ground can leave more men alive-but-fled than
    // fighting on and bleeding down does; the deterrent is the attacker's cost.)
    let squareHolds = 0;
    let linearHolds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let r = seedRng(seed);
      let n = nextInt(r, 40);
      const attackers = 20 + n.value; // 20..59, always the larger host
      r = n.state;
      n = nextInt(r, 8);
      const defenders = 6 + n.value; // 6..13, below the linear reference cohort
      const forces: Omit<BattleSetup, 'law'> = {
        attacker: { faction: 'dragoons', strength: attackers },
        defender: { faction: 'marsh-militia', strength: defenders, fortTier: 3 },
        playerSide: 'defender',
      };
      const square = simulateBattle({ ...forces, law: 'square' });
      const linear = simulateBattle({ ...forces, law: 'linear' });
      expect(linear.survivors.attackers).toBeLessThanOrEqual(square.survivors.attackers);
      expect(square.playerWon && !linear.playerWon).toBe(false); // never worse on prepared ground
      if (square.playerWon) squareHolds++;
      if (linear.playerWon) linearHolds++;
    }
    expect(linearHolds).toBeGreaterThanOrEqual(squareHolds);
  });
});

describe('morale and rout (§14.3)', () => {
  it('Riding Officers break after one volley', () => {
    // Forted militia against a small patrol: the officers run, the player holds.
    const log = simulateBattle(
      raid({
        attacker: { faction: 'riding-officer', strength: 8 },
        defender: { faction: 'marsh-militia', strength: 10, fortTier: 2 },
      }),
    );
    expect(log.outcome).toBe('attacker_rout');
    expect(log.playerWon).toBe(true);
    expect(log.frames.length).toBeLessThan(12); // gone quickly
  });

  it('Dragoons do not rout: they only ever leave the field annihilated', () => {
    // An overwhelming defence — Guardian, deep works — grinds them to nothing.
    const log = simulateBattle(
      raid({
        attacker: { faction: 'dragoons', strength: 6 },
        defender: { faction: 'smuggler-crew', strength: 40, fortTier: 4, guardian: true },
      }),
    );
    expect(log.outcome).toBe('attacker_rout');
    expect(log.playerWon).toBe(true);
    // Because they never broke, when they leave it is as corpses, not runners.
    expect(log.survivors.attackers).toBe(0);
  });
});

describe('the three Calls (§14.4)', () => {
  it('Commit the Reserve turns a loss around when the held-back men enter', () => {
    const base = raid({
      attacker: { faction: 'hawksmere', strength: 22 },
      defender: { faction: 'smuggler-crew', strength: 12, reserve: 12, fortTier: 2 },
    });
    const withoutReserve = simulateBattle(base); // the reserve sits idle and is wasted
    const withReserve = simulateBattle({ ...base, calls: [{ frame: 2, call: 'commitReserve' }] });

    expect(withReserve.frames.some((f) => f.events.some((e) => e.kind === 'reserve_committed'))).toBe(
      true,
    );
    // Fresh men in the line: the player ends with more of his own standing.
    expect(withReserve.survivors.defenders).toBeGreaterThan(withoutReserve.survivors.defenders);
  });

  it('Fire the Engine spikes alpha and stains London once (§14.6)', () => {
    const base = raid({
      attacker: { faction: 'hawksmere', strength: 26 },
      defender: { faction: 'smuggler-crew', strength: 14, fortTier: 2 },
    });
    const plain = simulateBattle(base);
    const engine = simulateBattle({ ...base, calls: [{ frame: 1, call: 'fireEngine' }] });

    expect(engine.frames.some((f) => f.events.some((e) => e.kind === 'engine_fired'))).toBe(true);
    expect(engine.consequences.nationalHeat).toBeGreaterThanOrEqual(ENGINE_FIRE_HEAT);
    // The spike is real: the enemy fares worse than against a plain defence.
    expect(engine.survivors.attackers).toBeLessThan(plain.survivors.attackers);
  });

  it('Sound Retreat ends the fight early and spares the player his people', () => {
    const base = raid({
      attacker: { faction: 'dragoons', strength: 50 },
      defender: { faction: 'smuggler-crew', strength: 16 },
    });
    const toTheEnd = simulateBattle(base);
    const retreat = simulateBattle({ ...base, calls: [{ frame: 1, call: 'soundRetreat' }] });

    expect(retreat.outcome).toBe('defender_rout');
    expect(retreat.playerWon).toBe(false);
    expect(retreat.frames.at(-1)?.events.some((e) => e.kind === 'rout' && e.side === 'defender')).toBe(
      true,
    );
    // Walking off the field early costs fewer of your own than dying on it.
    expect(retreat.consequences.friendlyDead).toBeLessThan(toTheEnd.consequences.friendlyDead);
  });

  it('Pay Them Off works on the Company and is inert against Dragoons', () => {
    const company = simulateBattle(
      raid({
        attacker: { faction: 'hawksmere', strength: 24 },
        defender: { faction: 'smuggler-crew', strength: 12 },
        calls: [{ frame: 3, call: 'payOff' }],
      }),
    );
    expect(company.outcome).toBe('paid_off');
    expect(company.consequences.payOffCost).toBeGreaterThan(0);
    expect(company.playerWon).toBe(false); // survival, not victory

    const dragoons = simulateBattle(
      raid({
        attacker: { faction: 'dragoons', strength: 24 },
        defender: { faction: 'smuggler-crew', strength: 12 },
        calls: [{ frame: 3, call: 'payOff' }],
      }),
    );
    expect(dragoons.outcome).not.toBe('paid_off'); // the button was greyed
    expect(dragoons.consequences.payOffCost).toBe(0);
  });
});

describe('consequences (§14.6)', () => {
  it('a dead officer costs national Heat by the officer, not by the man', () => {
    const log = simulateBattle(
      raid({
        attacker: { faction: 'riding-officer', strength: 6 },
        defender: { faction: 'smuggler-crew', strength: 30, fortTier: 3 },
      }),
    );
    const c = log.consequences;
    expect(c.revenueDead).toBeGreaterThan(0);
    expect(c.standingLoss).toBe(c.friendlyDead * STANDING_LOSS_PER_FRIENDLY_DEAD);
    expect(c.nationalHeat).toBe(
      c.revenueDead * NATIONAL_HEAT_PER_REVENUE_DEAD + c.dragoonDead * NATIONAL_HEAT_PER_DRAGOON_DEAD,
    );
  });

  it('a Bound Guardian accrues Debt for every frame it fights', () => {
    const log = simulateBattle(
      raid({
        attacker: { faction: 'hawksmere', strength: 20 },
        defender: { faction: 'smuggler-crew', strength: 16, guardian: true },
      }),
    );
    expect(log.consequences.guardianActiveFrames).toBeGreaterThan(0);
    expect(log.consequences.debt).toBe(log.consequences.guardianActiveFrames * 2);
  });
});

describe('fog of war (§14.5) and determinism', () => {
  it('carries the fog flag so the render can hide the enemy counter', () => {
    expect(simulateBattle(raid({ fog: true })).fogged).toBe(true);
    expect(simulateBattle(raid({})).fogged).toBe(false);
  });

  it('is a pure function: the same battle twice is byte-identical', () => {
    const setup = raid({
      attacker: { faction: 'hawksmere', strength: 25 },
      defender: { faction: 'smuggler-crew', strength: 14, reserve: 6, fortTier: 2 },
      calls: [
        { frame: 3, call: 'commitReserve' },
        { frame: 6, call: 'fireEngine' },
      ],
    });
    expect(JSON.stringify(simulateBattle(setup))).toBe(JSON.stringify(simulateBattle(setup)));
  });
});

// ---- House rule §13: 200 seeded battles, and every one must end sane ----

const GAMES = 200;

describe(`${GAMES} seeded battles (spec §13)`, () => {
  it('every fight resolves, conserves its men, and reports honest consequences', () => {
    const factions: Faction[] = ['riding-officer', 'hawksmere', 'water-guard', 'dragoons'];
    let attackerWins = 0;
    let defenderWins = 0;
    let capHits = 0; // battles that fell through to the exhaustion safety net

    for (let seed = 1; seed <= GAMES; seed++) {
      let s = seedRng(seed);
      const draw = (n: number) => {
        const r = nextInt(s, n);
        s = r.state;
        return r.value;
      };
      const drawf = () => {
        const r = nextRandom(s);
        s = r.state;
        return r.value;
      };

      const attacker = { faction: factions[draw(factions.length)], strength: 12 + draw(48) };
      const defenderFaction: Faction = drawf() < 0.5 ? 'marsh-militia' : 'smuggler-crew';
      const defender = {
        faction: defenderFaction,
        strength: 8 + draw(24),
        fortTier: draw(5),
        reserve: draw(10),
      };
      const law = drawf() < 0.5 ? 'square' : 'linear';
      const setup: BattleSetup = { attacker, defender, law: law as 'square' | 'linear', playerSide: 'defender' };
      const log = simulateBattle(setup);

      // 1. A terminal outcome, reached before the safety cap (a real rout or
      //    annihilation, not the exhaustion fallback).
      expect(log.frames.length).toBeGreaterThan(0);
      expect(log.frames.length).toBeLessThanOrEqual(COMBAT_MAX_FRAMES);
      if (log.frames.length === COMBAT_MAX_FRAMES) capHits++;

      // 2. No side conjures men or ends below zero (§14 — headcount is bounded).
      expect(log.survivors.attackers).toBeGreaterThanOrEqual(0);
      expect(log.survivors.defenders).toBeGreaterThanOrEqual(0);
      expect(log.survivors.attackers).toBeLessThanOrEqual(attacker.strength);
      expect(log.survivors.defenders).toBeLessThanOrEqual(defender.strength + defender.reserve);

      // 3. Consequences are non-negative and follow §14.6 exactly.
      const c = log.consequences;
      for (const v of [c.friendlyDead, c.revenueDead, c.dragoonDead, c.nationalHeat, c.debt]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(c.standingLoss).toBe(c.friendlyDead * STANDING_LOSS_PER_FRIENDLY_DEAD);

      // 4. Dragoons never rout — if they lost, it was annihilation (§14.3).
      if (attacker.faction === 'dragoons' && log.outcome === 'attacker_rout') {
        expect(log.survivors.attackers).toBe(0);
      }

      if (log.outcome === 'attacker_rout') defenderWins++;
      if (log.outcome === 'defender_rout') attackerWins++;
    }

    // The distribution is not degenerate: both sides win somewhere, and no run
    // stalled into the exhaustion fallback.
    expect(attackerWins).toBeGreaterThan(0);
    expect(defenderWins).toBeGreaterThan(0);
    expect(capHits).toBe(0);
  });
});
