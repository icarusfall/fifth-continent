// Spec §6.14 (M5c) — Leiden. Every formula gets its unit test (§13): the
// arrival roll (seeded, per qualifying landing), housing and the cover tax,
// the bench's gates, Publication and the floor, suppression and the
// strongbox, the fence, the lighter, and the wights' claim on him. The dice
// are the state's own, so every expectation is exact.

import { describe, expect, it } from 'vitest';
import {
  BINDING_CAPACITY,
  GALVANIC_ALPHA_MULT,
  GALVANIC_VISIBILITY,
  FACTION_ALPHA,
  LEIDEN_ARRIVAL_CHANCE,
  LEIDEN_ARRIVAL_MIN_RUN,
  LEIDEN_COVER,
  LIGHTER_CAPACITY,
  MAX_SUPPRESSIONS,
  NATIONAL_HEAT_DECAY,
  PERSON_DEBT,
  PUBLICATION_HEAT,
  SUPPRESS_STANDING,
  TICKS_PER_DAY,
} from '../balance';
import { leidenPolicy, runPolicyGame } from '../policy';
import { garrisonForce } from '../raid';
import { coverOf, fortVisibility } from '../revenue';
import { nextRandom } from '../rng';
import type { RngState } from '../rng';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

function fresh(mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60; // mid-morning
  s.lastCrisisTick = -(20 * TICKS_PER_DAY);
  mutate?.(s);
  return s;
}

/** An rng state whose next draw falls under (or over) the arrival chance. */
function rngWhere(under: boolean): RngState {
  for (let candidate = 1; ; candidate++) {
    const { value } = nextRandom(candidate);
    if (under === value < LEIDEN_ARRIVAL_CHANCE) return candidate;
  }
}

/** A night with the lugger standing off, a purchase made, run to departure.
 *  Departure comes with the rising tide / daylight; one day is plenty. */
function throughBuyingVisit(s: GameState): GameState {
  s.tick = 120; // 20:00 — night, lugger conditions below
  s.dutchman.unlocked = true;
  s.dutchman.met = true;
  s.dutchman.fleeceBought = 999; // full trust: every good in the hold
  s.coin = 200;
  s.carts[0].location = { kind: 'node', nodeId: 'shingle' };
  s = runTicks(s, 1); // the lugger stands off (falling tide at seed 7's clock)
  expect(s.dutchman.present).toBe(true);
  s = tick(s, [{ type: 'buyFromDutchman', cartId: 'cart-1', good: 'tea', qty: 1 }]);
  expect(s.leiden.boughtThisVisit).toBe(true);
  // Run until he has left; the roll fires at the moment of departure.
  for (let i = 0; i < TICKS_PER_DAY && s.dutchman.present; i++) s = tick(s, []);
  expect(s.dutchman.present).toBe(false);
  return s;
}

describe('the arrival (spec §6.14 M5c): a tub with a man inside, at random', () => {
  it('a buying visit counts a landing; the dice only roll from the minimum run', () => {
    let s = fresh((st) => {
      st.leiden.landingsBought = LEIDEN_ARRIVAL_MIN_RUN - 2; // still short after this one
      st.rngState = rngWhere(true); // even favourable dice must not fire
    });
    const rngBefore = s.rngState;
    s = throughBuyingVisit(s);
    expect(s.leiden.landingsBought).toBe(LEIDEN_ARRIVAL_MIN_RUN - 1);
    expect(s.leiden.state).toBe('unmet');
    expect(s.rngState).toBe(rngBefore); // the dice were never touched
  });

  it('from the minimum run, the seeded dice decide — and their state advances', () => {
    let hit = fresh((st) => {
      st.leiden.landingsBought = LEIDEN_ARRIVAL_MIN_RUN - 1;
      st.rngState = rngWhere(true);
    });
    hit = throughBuyingVisit(hit);
    expect(hit.leiden.state).toBe('offered');

    let miss = fresh((st) => {
      st.leiden.landingsBought = LEIDEN_ARRIVAL_MIN_RUN - 1;
      st.rngState = rngWhere(false);
    });
    miss = throughBuyingVisit(miss);
    expect(miss.leiden.state).toBe('unmet');
    expect(miss.leiden.landingsBought).toBe(LEIDEN_ARRIVAL_MIN_RUN);
  });

  it('a visit of selling only is no landing of his', () => {
    let s = fresh((st) => {
      st.leiden.landingsBought = LEIDEN_ARRIVAL_MIN_RUN + 3;
      st.rngState = rngWhere(true);
      st.tick = 120;
      st.dutchman.unlocked = true;
      st.dutchman.met = true;
      st.carts[0].cargo = { fleece: 4 };
      st.carts[0].location = { kind: 'node', nodeId: 'shingle' };
    });
    s = runTicks(s, 1);
    expect(s.dutchman.present).toBe(true);
    s = tick(s, [{ type: 'sellToDutchman', cartId: 'cart-1' }]);
    for (let i = 0; i < TICKS_PER_DAY && s.dutchman.present; i++) s = tick(s, []);
    expect(s.leiden.state).toBe('unmet');
    expect(s.leiden.landingsBought).toBe(LEIDEN_ARRIVAL_MIN_RUN + 3);
  });
});

describe('housing (spec §6.14): the workshop, the cover tax, the two refusals', () => {
  const offered = (mutate?: (s: GameState) => void) =>
    fresh((st) => {
      st.leiden.state = 'offered';
      mutate?.(st);
    });

  it('housing him takes the cover, permanently, and opens the workshop', () => {
    const before = coverOf(offered(), 'farm');
    let s = tick(offered(), [{ type: 'houseLeiden', nodeId: 'farm' }]);
    expect(s.leiden.state).toBe('housed');
    expect(s.leiden.node).toBe('farm');
    expect(coverOf(s, 'farm')).toBe(before - LEIDEN_COVER);
  });

  it('a building with full hides cannot take him', () => {
    const s0 = offered((st) => {
      st.stores.farm = { tea: 99 }; // the hides are stuffed
    });
    const s = tick(s0, [{ type: 'houseLeiden', nodeId: 'farm' }]);
    expect(s.leiden.state).toBe('offered'); // still dripping on the shingle
  });

  it('two refusals and no boat brings him again', () => {
    let s = tick(offered(), [{ type: 'refuseLeiden' }]);
    expect(s.leiden.state).toBe('unmet');
    expect(s.leiden.refusals).toBe(1);
    s.leiden.state = 'offered';
    s = tick(s, [{ type: 'refuseLeiden' }]);
    expect(s.leiden.state).toBe('gone');
  });
});

describe('the bench and the letters (spec §6.14): Publication is the price', () => {
  const housed = (mutate?: (s: GameState) => void) =>
    fresh((st) => {
      st.leiden.state = 'housed';
      st.leiden.node = 'farm';
      st.coin = 500;
      mutate?.(st);
    });

  /** Run the active leiden project to completion, one tick past done. */
  function completeTier(s: GameState): GameState {
    s.research.active = { tree: 'leiden', doneTick: s.tick + 1 };
    return runTicks(s, 2);
  }

  it('no philosopher, no bench; a sealed letter blocks it too', () => {
    let s = tick(fresh((st) => (st.coin = 500)), [{ type: 'startResearch', tree: 'leiden' }]);
    expect(s.research.active).toBeNull();
    s = housed((st) => (st.leiden.letterPending = 0));
    s = tick(s, [{ type: 'startResearch', tree: 'leiden' }]);
    expect(s.research.active).toBeNull();
  });

  it('a completed tier seals a letter; publishing raises the floor for good', () => {
    let s = completeTier(housed());
    expect(s.research.completed.leiden).toBe(1);
    expect(s.leiden.letterPending).toBe(0);
    s = tick(s, [{ type: 'publishLetter' }]);
    expect(s.leiden.letterPending).toBeNull();
    expect(s.nationalHeatFloor).toBe(PUBLICATION_HEAT[0]); // fair: heatMult 1
    // Decay can never take the national side below the floor again.
    s.heat.national = 2;
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.heat.national).toBeGreaterThanOrEqual(PUBLICATION_HEAT[0]);
  });

  it('the floor only holds the bottom: above it, decay works as ever', () => {
    let s = housed((st) => {
      st.nationalHeatFloor = 5;
      st.heat.national = 50;
    });
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.heat.national).toBeCloseTo(50 * NATIONAL_HEAT_DECAY); // decayed, not floored
  });

  it('the strongbox: Standing paid, no floor — and a third held letter downs tools', () => {
    let s = completeTier(housed());
    const standing = s.standing;
    s = tick(s, [{ type: 'suppressLetter' }]);
    expect(s.nationalHeatFloor).toBe(0);
    expect(s.standing).toBe(standing - SUPPRESS_STANDING);
    expect(s.leiden.heldLetters).toEqual([PUBLICATION_HEAT[0]]);
    // Stuff the strongbox to the limit: the bench is refused.
    s.leiden.heldLetters = [6, 10, 16].slice(0, MAX_SUPPRESSIONS);
    s = tick(s, [{ type: 'startResearch', tree: 'leiden' }]);
    expect(s.research.active).toBeNull();
    // A letter released: the floor rises late, and the bench is his again.
    s = tick(s, [{ type: 'releaseLetter' }]);
    expect(s.nationalHeatFloor).toBe(6);
    expect(s.leiden.heldLetters.length).toBe(MAX_SUPPRESSIONS - 1);
  });
});

describe('the tiers (spec §6.14): fence, lighter, and their prices', () => {
  const withTier = (tier: number, mutate?: (s: GameState) => void) =>
    fresh((st) => {
      st.leiden.state = 'housed';
      st.leiden.node = 'farm';
      st.research.completed.leiden = tier;
      mutate?.(st);
    });

  it('the galvanic fence: the workshop’s men kill the better, and the wall reads for miles', () => {
    const fenced = withTier(1, (st) => {
      st.garrisons.farm = { militia: 0, crew: 2 };
    });
    expect(garrisonForce(fenced, 'farm').alpha).toBeCloseTo(
      FACTION_ALPHA['smuggler-crew'] * GALVANIC_ALPHA_MULT,
    );
    expect(fortVisibility(fenced, 'farm')).toBe(GALVANIC_VISIBILITY);
    // Not at the other building, and not without the tier.
    const bare = withTier(0, (st) => {
      st.garrisons.farm = { militia: 0, crew: 2 };
    });
    expect(garrisonForce(bare, 'farm').alpha).toBeCloseTo(FACTION_ALPHA['smuggler-crew']);
    expect(fortVisibility(bare, 'farm')).toBe(0);
  });

  it('tier 2 launches the lighter at the shingle — a hull, not a stall', () => {
    let s = withTier(1, (st) => {
      st.coin = 500;
      st.research.active = { tree: 'leiden', doneTick: st.tick + 1 };
    });
    s = runTicks(s, 2);
    const lighter = s.carts.find((c) => c.vessel);
    expect(lighter).toBeDefined();
    expect(lighter!.capacity).toBe(LIGHTER_CAPACITY);
    expect(lighter!.location).toEqual({ kind: 'node', nodeId: 'shingle' });
    // It never counts against the yard: three carts may still be bought.
    expect(s.carts.filter((c) => !c.vessel).length).toBe(1);
    s.coin = 500;
    s = tick(s, [{ type: 'buyCart' }]);
    expect(s.carts.filter((c) => !c.vessel).length).toBe(2);
  });

  it('hulls and wheels never share a way', () => {
    let s = withTier(2, (st) => {
      st.carts.push({
        id: 'lighter-1',
        name: 'The Steam-Lighter',
        capacity: LIGHTER_CAPACITY,
        cargo: {},
        location: { kind: 'node', nodeId: 'shingle' },
        carter: null,
        vessel: true,
      });
      st.carts[0].location = { kind: 'node', nodeId: 'shingle' };
    });
    // The cart is refused the sea; the lighter is refused the marsh.
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'sea-lane' }]);
    expect(s.carts[0].location.kind).toBe('node');
    s = tick(s, [{ type: 'dispatchCart', cartId: 'lighter-1', edgeId: 'marsh-track' }]);
    expect(s.carts.find((c) => c.vessel)!.location.kind).toBe('node');
    // The lighter takes the lane, and the tide is nothing to steam.
    s = tick(s, [{ type: 'dispatchCart', cartId: 'lighter-1', edgeId: 'sea-lane' }]);
    const loc = s.carts.find((c) => c.vessel)!.location;
    expect(loc.kind).toBe('edge');
    expect(loc.kind === 'edge' && loc.edgeId).toBe('sea-lane');
  });
});

describe('200 seeded games, 40 days — the philosopher (spec §6.14, M5c)', () => {
  it('the sea sends him when it pleases; each letter prices the floor exactly; the clock keeps it', () => {
    let housed = 0;
    let published = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = runPolicyGame(seed, 40 * TICKS_PER_DAY, leidenPolicy);
      if (s.leiden.state === 'housed') housed++;
      const tiers = s.research.completed.leiden;
      if (tiers > 0) published++;
      // The bot never suppresses: every completed tier's letter is out (bar
      // one still sealed at the whistle), and the floor is that sum exactly.
      expect(s.leiden.heldLetters).toEqual([]);
      const expected = PUBLICATION_HEAT.slice(0, tiers).reduce((a, b) => a + b, 0);
      const stillSealed =
        s.leiden.letterPending !== null ? PUBLICATION_HEAT[s.leiden.letterPending] : 0;
      expect(s.nationalHeatFloor).toBeCloseTo(expected - stillSealed);
      // And decay never leaves the national side below the floor.
      expect(s.heat.national).toBeGreaterThanOrEqual(s.nationalHeatFloor - 1e-9);
    }
    // Random, not scheduled — but common enough to be a game system, not a rumour.
    expect(housed).toBeGreaterThan(100);
    expect(published).toBeGreaterThan(50);
  }, 300000);
});

describe('the wights’ claim (spec §6.14): he is a person in the collection sense', () => {
  it('with nobody else to take, they take the philosopher — the workshop goes dark', () => {
    let s = fresh((st) => {
      st.leiden.state = 'housed';
      st.leiden.node = 'farm';
      st.boundWights = 1;
      st.debt = BINDING_CAPACITY + 30; // breach
      st.collection = { graceDawnsLeft: 1 }; // the third dawn comes next
    });
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.leiden.state).toBe('gone');
    expect(s.lastCollected).toContain('philosopher');
    expect(s.debt).toBeCloseTo(BINDING_CAPACITY + 30 - PERSON_DEBT);
    expect(s.lost).toBe(false);
  });
});
