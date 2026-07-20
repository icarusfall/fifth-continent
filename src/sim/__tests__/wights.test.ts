// Spec §6.14 (M5b) — the wight. Every formula gets its unit test (§13): the
// sign's threshold and recurrence, the trap's rising bait, the account that
// never decays, tribute, collection and its priority of the taken, and the
// three marsh tiers. All deterministic; every expectation is exact.

import { describe, expect, it } from 'vitest';
import {
  BINDING_CAPACITY,
  COLLECTION_GRACE_DAYS,
  DIFFICULTY,
  HOLLOW_WAY_DEBT,
  MARSH_LANTERN_DEBT,
  NIGHT_MARSH_UNITS,
  PERSON_DEBT,
  RESEARCH_COST,
  SIGN_RECURRENCE_DAYS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  SHEARING_HOUR,
  TRIBUTE_RELIEF,
  WIGHT_FOG_DEBT,
  WIGHT_TRAP_IRON,
} from '../balance';
import { simulateBattle } from '../combat';
import type { BattleSetup } from '../combat';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

const DAWN = SHEARING_HOUR * TICKS_PER_HOUR;

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

/** Run to just past the next dawn from wherever the state stands. */
function throughNextDawn(s: GameState): GameState {
  const next = Math.floor((s.tick - DAWN) / TICKS_PER_DAY + 1) * TICKS_PER_DAY + DAWN;
  return runTicks(s, next - s.tick + 1);
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60; // mid-morning
  s.lastCrisisTick = -(20 * TICKS_PER_DAY); // §6.15 spacing never blocks a test
  mutate?.(s);
  return s;
}

describe('the sign (spec §6.14): the marsh notices being used', () => {
  it('appears at dawn once the night trade crosses the threshold, near the busiest crossing', () => {
    let s = fresh((st) => {
      st.wights.nightUnits = NIGHT_MARSH_UNITS;
      st.wights.nightUnitsByEdge = { 'marsh-track': NIGHT_MARSH_UNITS };
    });
    expect(s.wights.sign).toBeNull();
    s = throughNextDawn(s);
    expect(s.wights.sign).not.toBeNull();
    expect(s.log.some((e) => e.text.includes('wight-sign'))).toBe(true);
  });

  it('does not appear below the threshold', () => {
    let s = fresh((st) => {
      st.wights.nightUnits = NIGHT_MARSH_UNITS - 1;
    });
    s = throughNextDawn(s);
    expect(s.wights.sign).toBeNull();
  });

  it('a laden night crossing of the marsh accrues unit-tiles; a day crossing does not', () => {
    const nightRun = fresh((st) => {
      st.tick = 120; // 20:00, night
      st.carts[0].cargo = { fleece: 8 };
    });
    let s = tick(nightRun, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    s = runTicks(s, 3);
    expect(s.wights.nightUnits).toBeGreaterThan(0);

    const dayRun = fresh((st) => {
      st.tick = 60; // 10:00, broad day
      st.carts[0].cargo = { fleece: 8 };
    });
    let d = tick(dayRun, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    d = runTicks(d, 3);
    expect(d.wights.nightUnits).toBe(0);
  });

  it('a recurring ring announces itself as another, and never rises on the stone’s tile', () => {
    const recurring = (stone: { x: number; y: number }) =>
      fresh((st) => {
        st.tick = (SIGN_RECURRENCE_DAYS + 1) * TICKS_PER_DAY + 60;
        st.boundWights = 1; // marsh powers see use: signs recur
        st.wights.lastSignDay = 0;
        st.wights.nightUnits = NIGHT_MARSH_UNITS;
        st.wights.nightUnitsByEdge = { 'marsh-track': NIGHT_MARSH_UNITS };
        st.wights.stone = stone;
      });
    // With the stone far off, the ring takes its preferred footing…
    const clear = throughNextDawn(recurring({ x: 1, y: 1 }));
    expect(clear.wights.sign).not.toBeNull();
    expect(clear.log.some((e) => e.text.includes('Another ring'))).toBe(true);
    // …and where that footing IS the stone, the ring steps aside: co-located,
    // its click target shadowed the stone's menu (playtest).
    const shadowed = throughNextDawn(recurring({ ...clear.wights.sign! }));
    expect(shadowed.wights.sign).not.toBeNull();
    expect(shadowed.wights.sign).not.toEqual(clear.wights.sign);
  });
});

describe('the trap (spec §6.14): iron, salt, and a rising bait', () => {
  const signed = () =>
    fresh((st) => {
      st.coin = 100;
      st.wights.sign = { x: 20, y: 12 };
      st.wights.lastSignDay = 0;
    });

  it('stakes coin and sheep, and binds at dawn — deterministic, no roll', () => {
    let s = tick(signed(), [{ type: 'trapWight' }]);
    expect(s.coin).toBe(100 - WIGHT_TRAP_IRON);
    expect(s.flockSize).toBe(11); // first bait: 1 sheep
    expect(s.wights.trap).toEqual({ bait: 1 });
    s = throughNextDawn(s);
    expect(s.boundWights).toBe(1);
    expect(s.wights.trap).toBeNull();
    expect(s.wights.sign).toBeNull();
    expect(s.wights.stone).toEqual({ x: 20, y: 12 }); // fixed where first bound
  });

  it('the bait rises with each binding: the flock pays', () => {
    let s = tick(
      fresh((st) => {
        st.coin = 100;
        st.boundWights = 2;
        st.wights.stone = { x: 20, y: 12 };
        st.wights.sign = { x: 22, y: 14 };
      }),
      [{ type: 'trapWight' }],
    );
    expect(s.flockSize).toBe(12 - 3); // third binding wants 3 sheep
    s = throughNextDawn(s);
    expect(s.boundWights).toBe(3);
    expect(s.wights.stone).toEqual({ x: 20, y: 12 }); // the stone does not move
  });

  it('refuses without the coin or the sheep', () => {
    const broke = tick(
      fresh((st) => {
        st.coin = WIGHT_TRAP_IRON - 1;
        st.wights.sign = { x: 20, y: 12 };
      }),
      [{ type: 'trapWight' }],
    );
    expect(broke.wights.trap).toBeNull();
    const fleeceless = tick(
      fresh((st) => {
        st.coin = 100;
        st.flockSize = 0;
        st.wights.sign = { x: 20, y: 12 };
      }),
      [{ type: 'trapWight' }],
    );
    expect(fleeceless.wights.trap).toBeNull();
  });

  it('signs recur while marsh powers see use, on the recurrence cadence', () => {
    // Bound once, threshold long met: the next sign waits SIGN_RECURRENCE days.
    let s = fresh((st) => {
      st.wights.nightUnits = NIGHT_MARSH_UNITS * 2;
      st.wights.nightUnitsByEdge = { 'marsh-track': NIGHT_MARSH_UNITS };
      st.boundWights = 1;
      st.wights.stone = { x: 20, y: 12 };
      st.wights.lastSignDay = 0;
    });
    s = throughNextDawn(s); // day 1: too soon
    expect(s.wights.sign).toBeNull();
    s = runTicks(s, SIGN_RECURRENCE_DAYS * TICKS_PER_DAY); // past the cadence
    expect(s.wights.sign).not.toBeNull();
  });
});

describe('Debt (spec §6.14): the account that never closes', () => {
  it('never decays: a week of quiet moves it not one grain', () => {
    let s = fresh((st) => {
      st.debt = 50;
      st.boundWights = 1; // under bindings: no collection to muddy the water
      st.wights.stone = { x: 20, y: 12 };
    });
    s = runTicks(s, 7 * TICKS_PER_DAY);
    expect(s.debt).toBe(50);
  });

  it('tribute: one sheep forgives TRIBUTE_RELIEF, and floors at nothing', () => {
    let s = fresh((st) => {
      st.debt = 20;
      st.boundWights = 1;
      st.wights.stone = { x: 20, y: 12 };
    });
    s = tick(s, [{ type: 'payTribute' }]);
    expect(s.flockSize).toBe(11);
    expect(s.debt).toBe(20 - TRIBUTE_RELIEF);
    s = tick(s, [{ type: 'payTribute' }]);
    expect(s.debt).toBe(0); // floored, not negative
    // The account at nothing takes no gifts.
    const again = tick(s, [{ type: 'payTribute' }]);
    expect(again.flockSize).toBe(s.flockSize);
  });

  it('the dial scales Debt gained, never the account itself (§6.15)', () => {
    const gentle = fresh((st) => {
      st.difficulty = 'gentle';
      st.boundWights = 1;
      st.wights.stone = { x: 20, y: 12 };
      st.wights.hollowWay = 'marsh-track';
      st.research.completed.marsh = 3;
      st.tick = 60;
      st.carts[0].cargo = { tea: 4 };
    });
    let s = tick(gentle, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    while (s.carts[0].location.kind === 'edge') s = tick(s, []);
    expect(s.debt).toBeCloseTo(HOLLOW_WAY_DEBT * DIFFICULTY.gentle.debtMult, 8);
  });
});

describe('collection (spec §6.14): they do not raid — they collect', () => {
  const breached = (mutate?: (s: GameState) => void) =>
    fresh((st) => {
      st.coin = 100; // wages must not fell the men before the wights do
      st.boundWights = 1;
      st.wights.stone = { x: 20, y: 12 };
      st.debt = BINDING_CAPACITY + 30; // over the bound
      mutate?.(st);
    });

  it('a breach opens the grace, and the third dawn takes a person — the wall first', () => {
    let s = breached((st) => {
      st.garrisons.farm = { militia: 2, crew: 1 };
    });
    s = throughNextDawn(s);
    expect(s.collection).toEqual({ graceDawnsLeft: COLLECTION_GRACE_DAYS });
    s = throughNextDawn(s);
    s = throughNextDawn(s);
    expect(s.peopleCollected).toBe(0); // grace holds through the second dawn
    s = throughNextDawn(s);
    expect(s.peopleCollected).toBe(1);
    expect(s.garrisons.farm!.militia).toBe(1); // militia fall first
    expect(s.debt).toBeCloseTo(BINDING_CAPACITY + 30 - PERSON_DEBT, 8);
    expect(s.lost).toBe(false);
  });

  it('the taking runs down the payroll: carter, then shearer, then refiner', () => {
    let s = breached((st) => {
      st.coin = 100; // wages must not fell the men before the wights do
      st.carts[0].carter = { from: 'farm', to: 'ryne', good: 'fleece' };
      st.shearer.hired = true;
    });
    for (let i = 0; i < COLLECTION_GRACE_DAYS + 1; i++) s = throughNextDawn(s);
    expect(s.carts[0].carter).toBeNull(); // the carter went first
    expect(s.shearer.hired).toBe(true);
    expect(s.lastCollected).toContain('carter');
  });

  it('nobody left to take → they take you: the tenancy is lost', () => {
    let s = breached((st) => {
      st.debt = BINDING_CAPACITY + 500; // no single taking settles it
    });
    for (let i = 0; i < COLLECTION_GRACE_DAYS + 1; i++) s = throughNextDawn(s);
    expect(s.lost).toBe(true);
    expect(s.lastCollected).toBe('you');
  });

  it('tribute down inside the grace calls it off', () => {
    let s = breached((st) => {
      st.debt = BINDING_CAPACITY + 10; // one sheep from settled
    });
    s = throughNextDawn(s);
    expect(s.collection).not.toBeNull();
    s = tick(s, [{ type: 'payTribute' }]);
    s = throughNextDawn(s);
    expect(s.collection).toBeNull();
    expect(s.peopleCollected).toBe(0);
  });
});

describe('the marsh tiers (spec §6.14): power priced in Debt, per use', () => {
  it('marsh research wants a bound wight; the stone then teaches', () => {
    const unbound = tick(
      fresh((st) => {
        st.coin = 200;
      }),
      [{ type: 'startResearch', tree: 'marsh' }],
    );
    expect(unbound.research.active).toBeNull();

    const bound = tick(
      fresh((st) => {
        st.coin = 200;
        st.boundWights = 1;
        st.wights.stone = { x: 20, y: 12 };
      }),
      [{ type: 'startResearch', tree: 'marsh' }],
    );
    expect(bound.research.active?.tree).toBe('marsh');
    expect(bound.coin).toBe(200 - RESEARCH_COST.marsh[0]);
  });

  it('lantern haulers: a night marsh run reads a tenth as loud, and owes one', () => {
    const run = (marshTier: number) => {
      let s = fresh((st) => {
        st.tick = 120; // night
        st.research.completed.marsh = marshTier;
        st.boundWights = 1;
        st.wights.stone = { x: 20, y: 12 };
        st.carts[0].cargo = { tea: 8 };
      });
      s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
      while (s.carts[0].location.kind === 'edge') s = tick(s, []);
      return s;
    };
    const dark = run(0);
    const lantern = run(1);
    expect(lantern.heat.regional).toBeLessThan(dark.heat.regional * 0.2); // ×0.1 on the road
    expect(lantern.debt).toBeCloseTo(MARSH_LANTERN_DEBT, 8);
    expect(dark.debt).toBe(0);
  });

  it('the hollow way: no heat, no road-stop, one owed per laden crossing', () => {
    let s = fresh((st) => {
      st.tick = 60; // broad day — and still silent
      st.research.completed.marsh = 3;
      st.boundWights = 1;
      st.wights.stone = { x: 20, y: 12 };
      st.wights.hollowWay = 'marsh-track';
      st.carts[0].cargo = { tea: 8 };
    });
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'marsh-track' }]);
    while (s.carts[0].location.kind === 'edge') s = tick(s, []);
    // The only stain is the arrival tick's standing cart at the node
    // (8 illicit × STORAGE_HEAT_COEFF × SUSPICION_SHARE = 0.04): the road
    // itself, in broad day and fully laden, contributed exactly nothing.
    expect(s.revenue.suspicion.shingle ?? 0).toBeCloseTo(0.04, 8);
    expect(s.debt).toBeCloseTo(HOLLOW_WAY_DEBT, 8);
  });

  it('the hollow way must be earned and named once, through marsh', () => {
    const early = tick(fresh(), [{ type: 'designateHollowWay', edgeId: 'marsh-track' }]);
    expect(early.wights.hollowWay).toBeNull();
    const road = tick(
      fresh((st) => {
        st.research.completed.marsh = 3;
      }),
      [{ type: 'designateHollowWay', edgeId: 'low-road' }],
    );
    expect(road.wights.hollowWay).toBeNull(); // roads are the Crown's
  });

  it('wight-fog: the raiders fight half-blind, at 8 Debt', () => {
    const setup: BattleSetup = {
      attacker: { faction: 'hawksmere', strength: 18 },
      defender: { faction: 'smuggler-crew', strength: 20, fortTier: 3 },
      law: 'square',
      playerSide: 'defender',
    };
    const plain = simulateBattle(setup);
    const fogged = simulateBattle({ ...setup, calls: [{ frame: 1, call: 'wightFog' }] });
    expect(fogged.frames.some((f) => f.events.some((e) => e.kind === 'fog_called'))).toBe(true);
    expect(fogged.consequences.debt).toBeCloseTo(WIGHT_FOG_DEBT, 8);
    // Half-blind raiders lose a fight they were winning: the wall that broke
    // without the fog holds behind it, and far fewer of yours fall.
    expect(plain.outcome).toBe('defender_rout');
    expect(fogged.outcome).toBe('attacker_rout');
    expect(fogged.consequences.friendlyDead).toBeLessThan(plain.consequences.friendlyDead);
  });
});
