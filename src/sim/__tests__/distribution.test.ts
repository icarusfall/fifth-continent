// Spec §13: every mechanic ships with a headless test that plays 200 seeded
// games and asserts the outcome distribution is sane. M1's only "player" is
// the greedy carter policy; nothing random touches the economy yet, so the
// distribution is a point — but the harness, and the habit, start here.

import { describe, expect, it } from 'vitest';
import {
  FLEECE_PER_HEAD_PER_DAY,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { runPolicyGame } from '../policy';

const GAMES = 200;
const DAYS = 3;

describe(`${GAMES} seeded games, ${DAYS} days each`, () => {
  it('every game ends upright: coin earned, cart intact, books balanced', () => {
    const coins: number[] = [];

    for (let seed = 1; seed <= GAMES; seed++) {
      const s = runPolicyGame(seed, TICKS_PER_DAY * DAYS);

      // Theoretical ceiling: every fleece sheared, sold same day.
      const totalFleece = STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY * DAYS;
      const ceiling = totalFleece * WOOL_PRICE_DOMESTIC;

      expect(Number.isFinite(s.coin)).toBe(true);
      expect(s.coin).toBeGreaterThan(0); // the carter must earn *something*
      expect(s.coin).toBeLessThanOrEqual(ceiling); // and cannot conjure wool

      // Conservation: fleece sheared = fleece sold + fleece still in the world.
      const sold = s.coin / WOOL_PRICE_DOMESTIC;
      const atFarm = s.stores.farm?.fleece ?? 0;
      const atRyne = s.stores.ryne?.fleece ?? 0;
      const onCart = s.carts[0].cargo.fleece ?? 0;
      expect(sold + atFarm + atRyne + onCart).toBe(totalFleece);

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
    // The tide costs the carter some runs; expect a healthy if imperfect haul
    // (at least half the theoretical ceiling over three days).
    expect(coins[0]).toBeGreaterThanOrEqual(
      (STARTING_FLOCK * FLEECE_PER_HEAD_PER_DAY * DAYS * WOOL_PRICE_DOMESTIC) / 2,
    );
  });
});
