// Spec §13: every mechanic ships with a headless test that plays 200 seeded
// games and asserts the outcome distribution is sane. M1's only "player" is
// the greedy carter policy; nothing random touches the economy yet, so the
// distribution is a point — but the harness, and the habit, start here.
// Fourteen days covers two rent collections (spec §6.8): the bot must
// survive the squeeze on lawful wool alone.

import { describe, expect, it } from 'vitest';
import {
  FLEECE_PER_HEAD_PER_DAY,
  RENT_AMOUNT,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { runPolicyGame } from '../policy';

const GAMES = 200;
const DAYS = 14; // two rent dues fall inside this window

describe(`${GAMES} seeded games, ${DAYS} days each`, () => {
  // 200 × 14 days ≈ 400k ticks: give the harness room to breathe.
  it('every game ends upright: rent paid, flock intact, books balanced', { timeout: 60_000 }, () => {
    const coins: number[] = [];

    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS);

      // The bot survives the squeeze on lawful wool alone.
      expect(s.lost).toBe(false);
      expect(s.flockSize).toBe(STARTING_FLOCK); // no distraint
      expect(s.rentPaid).toBe(2 * RENT_AMOUNT); // both dues met in full

      // Theoretical ceiling: every fleece sheared, sold same day, rent paid.
      const totalFleece = STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY * DAYS;
      const ceiling = totalFleece * WOOL_PRICE_DOMESTIC - s.rentPaid;

      expect(Number.isFinite(s.coin)).toBe(true);
      expect(s.coin).toBeGreaterThan(0); // solvent after two rents
      expect(s.coin).toBeLessThanOrEqual(ceiling); // and cannot conjure wool

      // Conservation: fleece grown = sold + still in the world;
      // coin earned = coin held + rent paid.
      const sold = (s.coin + s.rentPaid) / WOOL_PRICE_DOMESTIC;
      const atFarm = s.stores.farm?.fleece ?? 0;
      const atRyne = s.stores.ryne?.fleece ?? 0;
      const onCart = s.carts[0].cargo.fleece ?? 0;
      expect(sold + atFarm + atRyne + onCart + s.fleeceReady).toBe(totalFleece);

      // The cart is somewhere real.
      const loc = s.carts[0].location;
      if (loc.kind === 'node') {
        expect(['farm', 'ryne']).toContain(loc.nodeId);
      } else {
        expect(loc.progress).toBeGreaterThanOrEqual(0);
      }

      coins.push(s.coin);
    }

    // Sanity on the distribution itself: the policy is deterministic and no
    // randomness feeds the economy in M1, so all 200 games must agree. When
    // a mechanic makes this fail, that mechanic just became load-bearing —
    // widen this into a real distribution check, don't delete it.
    const distinct = new Set(coins);
    expect(distinct.size).toBe(1);
    // The margin of a lawful life: solvent, but thin (spec §6.8).
    expect(coins[0]).toBeGreaterThan(0);
    expect(coins[0]).toBeLessThan(RENT_AMOUNT);
  });
});
