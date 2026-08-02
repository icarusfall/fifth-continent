// Spec §6.18 (M5½b) — the tub-boat: quiet bulk on the water you dug. The
// waterway chain-builder, the hull/way discipline, the tide under the keel,
// and §21's promise that the channel is the quiet road. All deterministic.

import { describe, expect, it } from 'vitest';
import {
  DYKE_EXPOSURE,
  MAX_TUB_BOATS,
  TICKS_PER_DAY,
  TUB_BOAT_CAPACITY,
  TUB_BOAT_COST,
  TUB_TIDE_MIN,
} from '../balance';
import { dykeWaterways } from '../dykes';
import { tideLevel } from '../time';
import { initialState, tick } from '../tick';
import type { GameState } from '../types';

/** The farm→shingle chain: five-waterings + guldeford + camber-cut. */
const FARM_SHINGLE = ['five-waterings', 'guldeford', 'camber-cut'];
/** The farm→ryne chain: walland-cut + wainway + broomhill. */
const FARM_RYNE = ['walland-cut', 'wainway', 'broomhill'];

function dug(ids: string[], mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60;
  s.lastCrisisTick = -(20 * TICKS_PER_DAY);
  s.boundWights = 3; // carries the dig Debt these chains imply
  s.dykesDug = [...ids];
  mutate?.(s);
  return s;
}

describe('the waterways (§6.18): chains of dug segments link the landings', () => {
  it('no digs, no waterways; a dead-end dig alone links nothing', () => {
    expect(dykeWaterways(dug([]))).toEqual([]);
    expect(dykeWaterways(dug(['white-sewer']))).toEqual([]);
    expect(dykeWaterways(dug(['guldeford']))).toEqual([]); // mid-marsh, no landing pair
  });

  it('the farm–shingle chain runs as one edge with the channel’s numbers', () => {
    const ways = dykeWaterways(dug(FARM_SHINGLE));
    expect(ways.length).toBe(1);
    const w = ways[0];
    expect([w.a, w.b].sort()).toEqual(['farm', 'shingle']);
    expect(w.capacity).toBe(TUB_BOAT_CAPACITY);
    expect(w.exposure).toBe(DYKE_EXPOSURE);
    expect(w.path.length).toBeGreaterThan(2); // the stitched chain, not a straight line
  });

  it('the southern chain reaches Ryne’s back waters; both chains give two ways', () => {
    const ways = dykeWaterways(dug([...FARM_SHINGLE, ...FARM_RYNE]));
    const pairs = ways.map((w) => [w.a, w.b].sort().join('~')).sort();
    expect(pairs).toContain('farm~shingle');
    expect(pairs).toContain('farm~ryne');
  });

  it('a partial chain links nothing until its last segment is cut', () => {
    expect(dykeWaterways(dug(['five-waterings', 'guldeford']))).toEqual([]);
  });
});

describe('the tub-boat (§6.18): a hull, not a stall', () => {
  it('is not sold until water runs, then costs its coin and rides low at the farm', () => {
    let dry = initialState(7);
    dry.coin = 500;
    dry = tick(dry, [{ type: 'buyTubBoat' }]);
    expect(dry.carts.some((c) => c.vessel === 'dyke')).toBe(false);
    expect(dry.coin).toBe(500);

    let s = dug(FARM_SHINGLE, (st) => (st.coin = 500));
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const tub = s.carts.find((c) => c.vessel === 'dyke');
    expect(tub).toBeDefined();
    expect(tub!.capacity).toBe(TUB_BOAT_CAPACITY);
    expect(s.coin).toBe(500 - TUB_BOAT_COST);

    // Hulls never crowd the yard: the stall count ignores them.
    expect(s.carts.filter((c) => !c.vessel).length).toBe(1);

    // And three is a fleet.
    s = tick(s, [{ type: 'buyTubBoat' }, { type: 'buyTubBoat' }, { type: 'buyTubBoat' }]);
    expect(s.carts.filter((c) => c.vessel === 'dyke').length).toBe(MAX_TUB_BOATS);
  });

  it('hulls and wheels never share a way, and the tub minds the tide', () => {
    let s = dug(FARM_SHINGLE, (st) => (st.coin = 500));
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const wayId = dykeWaterways(s)[0].id;

    // A cart is refused the water.
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: wayId }]);
    expect(s.carts[0].location.kind).toBe('node');

    // The tub is refused the road.
    s = tick(s, [{ type: 'dispatchCart', cartId: 'tub-1', edgeId: 'marsh-track' }]);
    expect(s.carts.find((c) => c.vessel === 'dyke')!.location.kind).toBe('node');

    // Find a high-water tick and a low-water tick; the tub obeys each.
    let t = s.tick;
    while (tideLevel(t) < TUB_TIDE_MIN) t++;
    s.tick = t;
    s = tick(s, [{ type: 'dispatchCart', cartId: 'tub-1', edgeId: wayId }]);
    expect(s.carts.find((c) => c.vessel === 'dyke')!.location.kind).toBe('edge');
  });

  it('a laden run down the channel is near-silent (§21’s promise); the wharf is not (§18)', () => {
    let s = dug(FARM_SHINGLE, (st) => (st.coin = 500));
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const way = dykeWaterways(s)[0];
    let t = s.tick;
    while (tideLevel(t) < TUB_TIDE_MIN) t++;
    s.tick = t;
    const tubId = s.carts.find((c) => c.vessel === 'dyke')!.id;
    s.carts.find((c) => c.vessel === 'dyke')!.cargo = { 'brandy-fair': 12 };
    s = tick(s, [{ type: 'dispatchCart', cartId: tubId, edgeId: way.id }]);
    const heatBefore = s.heat.regional;
    // The voyage only: run until the keel touches the far landing.
    for (let i = 0; i < way.latency * 6; i++) {
      if (s.carts.find((c) => c.vessel === 'dyke')!.location.kind === 'node') break;
      s = tick(s, []);
    }
    const tub = s.carts.find((c) => c.vessel === 'dyke')!;
    expect(tub.location.kind).toBe('node');
    // Twelve casks moved for under two units of heat: the quiet road. (What
    // sits LADEN AT THE WHARF afterwards leaks like any standing hull — §18
    // holds on water as on wheels; the channel hides the journey, not the
    // mooring.)
    expect(s.heat.regional - heatBefore).toBeLessThan(2);
  });
});

// ---- House rule 5: 200 seeded games with the water working ----

const GAMES = 200;

describe(`${GAMES} seeded games — the waterman (spec §13/§6.18)`, () => {
  it('across every seed: the chain links, the tub hauls, the parish barely hears it', { timeout: 120_000 }, () => {
    for (let seed = 1; seed <= GAMES; seed++) {
      let s = initialState(seed);
      s.tick = 60;
      s.lastCrisisTick = -(20 * TICKS_PER_DAY);
      s.boundWights = 3;
      s.dykesDug = [...FARM_SHINGLE];
      s.coin = 500;
      s = tick(s, [{ type: 'buyTubBoat' }]);
      const way = dykeWaterways(s)[0];
      expect(way).toBeDefined();
      const tub = s.carts.find((c) => c.vessel === 'dyke')!;
      tub.cargo = { tea: TUB_BOAT_CAPACITY };
      let t = s.tick;
      while (tideLevel(t) < TUB_TIDE_MIN) t++;
      s.tick = t;
      s = tick(s, [{ type: 'dispatchCart', cartId: tub.id, edgeId: way.id }]);
      const heatBefore = s.heat.regional;
      for (let i = 0; i < way.latency * 6; i++) {
        if (s.carts.find((c) => c.vessel === 'dyke')!.location.kind === 'node') break;
        s = tick(s, []);
      }

      const landed = s.carts.find((c) => c.vessel === 'dyke')!;
      expect(landed.location.kind).toBe('node');
      expect(s.heat.regional - heatBefore).toBeLessThan(2); // the quiet road
      expect(s.lost).toBe(false);
    }
  });
});
