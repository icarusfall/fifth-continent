// Spec §6.18 (M5½b playtest) — the light order and the hull-aware picker.
//
// The tub-boat shipped able and unusable: a standing order had to name a good
// to load, and the shingle is a beach that keeps nothing, so the one sentence
// that puts a boat to work ("lie there, take twelve off the lugger, carry
// them home on quiet water") could not be written. These pin the grammar and
// the reachability the menu now reads.

import { describe, expect, it } from 'vitest';
import { CARTER_DANGER_WAGE, TICKS_PER_DAY, TUB_BOAT_CAPACITY, TUB_TIDE_MIN } from '../balance';
import { dykeWaterways } from '../dykes';
import { BOT_CUTTING_HOUSE_SITE } from '../policy';
import { tideLevel } from '../time';
import { carterWageOf, initialState, reachableNodesFor, tick } from '../tick';
import type { GameState } from '../types';

/** The farm→shingle chain: five-waterings + guldeford + camber-cut. */
const FARM_SHINGLE = ['five-waterings', 'guldeford', 'camber-cut'];

function runTicks(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) s = tick(s, []);
  return s;
}

function watered(mutate?: (s: GameState) => void): GameState {
  const s = initialState(7);
  s.tick = 60;
  s.lastCrisisTick = -(20 * TICKS_PER_DAY);
  s.boundWights = 3; // carries the dig Debt this chain implies
  s.dykesDug = [...FARM_SHINGLE];
  s.coin = 500;
  mutate?.(s);
  return s;
}

describe('the light order (§6.18): he runs out empty and comes home laden', () => {
  it('refuses an order with neither a load to take nor a thing to fetch', () => {
    let s = initialState(1);
    s.cuttingHouse = { ...BOT_CUTTING_HOUSE_SITE };
    s = tick(s, [
      { type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'cutting-house' } },
    ]);
    expect(s.carts[0].carter).toBeNull(); // out empty and home empty is not an order
  });

  it('departs empty, fetches at the far end, and unloads at home', () => {
    let s = initialState(1);
    s.coin = 100;
    s.cuttingHouse = { ...BOT_CUTTING_HOUSE_SITE };
    s.stores['cutting-house'] = { 'brandy-fair': 5 };
    s.stores.farm = {};
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'cutting-house', back: 'brandy-fair' },
      },
    ]);
    expect(s.carts[0].carter?.stops[0].take).toBeUndefined();

    // He leaves with nothing aboard — the one order that departs empty.
    s = tick(s, []);
    expect(s.carts[0].location.kind).toBe('edge');
    expect(Object.values(s.carts[0].cargo).reduce((a, b) => a + (b ?? 0), 0)).toBe(0);

    s = runTicks(s, TICKS_PER_DAY);
    expect(s.stores.farm?.['brandy-fair']).toBeGreaterThan(0);
    expect(s.stores['cutting-house']?.['brandy-fair'] ?? 0).toBe(0);
  });

  it('lies where it is sent while there is nothing to carry, and does not shuttle empty', () => {
    let s = initialState(1);
    s.coin = 100;
    s.cuttingHouse = { ...BOT_CUTTING_HOUSE_SITE };
    s.stores['cutting-house'] = {}; // nothing to fetch, yet
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'cutting-house', back: 'brandy-fair' },
      },
    ]);
    s = runTicks(s, TICKS_PER_DAY);
    const cart = s.carts[0];
    expect(cart.location).toEqual({ kind: 'node', nodeId: 'cutting-house' });
    // Announced once a visit, not once a tick: the log is a history.
    expect(s.log.filter((e) => e.text.includes('waiting on something to carry')).length).toBe(1);

    // And the moment there IS something, he takes it home.
    s.stores['cutting-house'] = { 'brandy-fair': 3 };
    s = runTicks(s, TICKS_PER_DAY);
    expect(s.stores.farm?.['brandy-fair']).toBe(3);
  });

  it('still pays danger money by the §6.11 rules — the shingle names the risk', () => {
    expect(carterWageOf({ from: 'farm', to: 'shingle', back: 'jenever' })).toBe(
      CARTER_DANGER_WAGE,
    );
    expect(carterWageOf({ from: 'farm', to: 'cutting-house', back: 'brandy-fair' })).toBe(
      CARTER_DANGER_WAGE, // contraband on the back leg, by whichever hand
    );
  });

  it('puts a tub to work: light to the shingle, and the hull rides its own water', () => {
    let s = watered();
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const tub = s.carts.find((c) => c.vessel === 'dyke')!;
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: tub.id,
        order: { from: 'farm', to: 'shingle', back: 'jenever' },
      },
    ]);
    expect(s.carts.find((c) => c.id === tub.id)!.carter).not.toBeNull();

    // High water, and he goes — on the waterway, never the marsh track.
    let t = s.tick;
    while (tideLevel(t) < TUB_TIDE_MIN) t++;
    s.tick = t;
    const wayId = dykeWaterways(s)[0].id;
    for (let i = 0; i < 40; i++) {
      s = tick(s, []);
      const at = s.carts.find((c) => c.id === tub.id)!.location;
      if (at.kind === 'edge') {
        expect(at.edgeId).toBe(wayId);
        return;
      }
    }
    throw new Error('the tub never left the farm');
  });
});

describe('reachability (§6.18): the picker asks the sim what floats where', () => {
  it('a tub reaches only the landings its dug water joins; wheels reach the roads', () => {
    let s = watered();
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const tub = s.carts.find((c) => c.vessel === 'dyke')!;
    const cart = s.carts.find((c) => !c.vessel)!;

    expect(reachableNodesFor(s, tub, 'farm')).toEqual(['shingle']);
    expect(reachableNodesFor(s, tub, 'shingle')).toEqual(['farm']);
    expect(reachableNodesFor(s, tub, 'ryne')).toEqual([]); // no water runs there yet

    const byRoad = reachableNodesFor(s, cart, 'farm');
    expect(byRoad).toContain('ryne');
    expect(byRoad).toContain('shingle');
    expect(byRoad).not.toContain('farm');
  });

  it('the hull and the way agree: what the picker offers, the dispatch accepts', () => {
    let s = watered();
    s = tick(s, [{ type: 'buyTubBoat' }]);
    const tub = s.carts.find((c) => c.vessel === 'dyke')!;
    // Ryne is unreachable, so the menu greys it — and the sim would refuse it.
    expect(reachableNodesFor(s, tub, 'farm')).not.toContain('ryne');
    s = tick(s, [{ type: 'dispatchCart', cartId: tub.id, edgeId: 'low-road' }]);
    expect(s.carts.find((c) => c.id === tub.id)!.location.kind).toBe('node');
    expect(tub.capacity).toBe(TUB_BOAT_CAPACITY);
  });
});
