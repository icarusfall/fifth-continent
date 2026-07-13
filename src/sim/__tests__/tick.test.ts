import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  SHEARING_HOUR,
  STARTING_FLOCK,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { edgesFor } from '../map';
import { isFlooded } from '../time';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

const SITE = { x: 8, y: 11 };
const HIGH_ROAD_LATENCY = edgesFor(SITE).find((e) => e.id === 'high-road')!.latency;
const LOW_ROAD_LATENCY = edgesFor(SITE).find((e) => e.id === 'low-road')!.latency;

function runTicks(state: GameState, n: number, actionsAt: Record<number, Action[]> = {}): GameState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = tick(s, actionsAt[s.tick] ?? []);
  }
  return s;
}

/** A fresh game with the farm already sited at the bot's spot. */
function placedState(): GameState {
  return tick(initialState(1), [{ type: 'placeFarm', ...SITE }]);
}

describe('tick purity', () => {
  it('never mutates its input', () => {
    const s0 = initialState(1);
    const frozen = JSON.stringify(s0);
    tick(s0, [{ type: 'placeFarm', ...SITE }]);
    tick(s0, []);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('advances the tick counter by exactly one', () => {
    const s0 = initialState(1);
    expect(tick(s0, []).tick).toBe(1);
  });
});

describe('placing the farm (spec §6.7)', () => {
  it('starts with no farm, no cart, no roads', () => {
    const s0 = initialState(1);
    expect(s0.farm).toBeNull();
    expect(s0.carts).toHaveLength(0);
  });

  it('siting the farm creates the flock, the cart, and the store', () => {
    const s = placedState();
    expect(s.farm).toEqual(SITE);
    expect(s.carts).toHaveLength(1);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s.stores.farm).toEqual({ fleece: 0 });
  });

  it('rejects bad ground and stays in the placement phase', () => {
    const s = tick(initialState(1), [{ type: 'placeFarm', x: 38, y: 10 }]); // the sea
    expect(s.farm).toBeNull();
    expect(s.carts).toHaveLength(0);
    expect(s.log.some((e) => e.text.includes('will not take a farm'))).toBe(true);
  });

  it('cannot be placed twice', () => {
    const s = tick(placedState(), [{ type: 'placeFarm', x: 9, y: 12 }]);
    expect(s.farm).toEqual(SITE);
  });

  it('no wool grows before the farm exists', () => {
    const s = runTicks(initialState(1), SHEARING_HOUR * TICKS_PER_HOUR + 2);
    expect(s.fleeceReady).toBe(0);
  });
});

describe('the flock and the shears', () => {
  /** Farm placed at tick 0, run to just past dawn: wool is on the sheep. */
  function dawnState(): GameState {
    return runTicks(placedState(), SHEARING_HOUR * TICKS_PER_HOUR);
  }

  it('wool grows onto the sheep at dawn, one fleece per head', () => {
    const s = dawnState();
    expect(s.fleeceReady).toBe(STARTING_FLOCK);
    expect(s.stores.farm?.fleece).toBe(0); // not in the store until sheared
  });

  it('grows every day and accumulates if unshorn', () => {
    const s = runTicks(placedState(), 24 * TICKS_PER_HOUR * 2);
    expect(s.fleeceReady).toBe(STARTING_FLOCK * 2);
  });

  it('shearing moves the wool into the farm store', () => {
    const s = tick(dawnState(), [{ type: 'shear' }]);
    expect(s.fleeceReady).toBe(0);
    expect(s.stores.farm?.fleece).toBe(STARTING_FLOCK);
  });

  it('shearing bare sheep does nothing but bleat', () => {
    const once = tick(dawnState(), [{ type: 'shear' }]);
    const twice = tick(once, [{ type: 'shear' }]);
    expect(twice.stores.farm?.fleece).toBe(STARTING_FLOCK);
    expect(twice.log.some((e) => e.text.includes('shorn bare'))).toBe(true);
  });
});

describe('the cart', () => {
  /** Farm placed, dawn passed, flock sheared: fleece in the store. */
  function stateWithFleece(): GameState {
    const s = runTicks(placedState(), SHEARING_HOUR * TICKS_PER_HOUR);
    return tick(s, [{ type: 'shear' }]);
  }

  it('loads up to capacity and no further', () => {
    const s = tick(stateWithFleece(), [
      { type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 999 },
    ]);
    expect(s.carts[0].cargo.fleece).toBe(CART_CAPACITY);
    expect(s.stores.farm?.fleece).toBe(STARTING_FLOCK - CART_CAPACITY);
  });

  it('unloads back into the store', () => {
    const s1 = tick(stateWithFleece(), [
      { type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 3 },
    ]);
    const s2 = tick(s1, [{ type: 'unloadCart', cartId: 'cart-1', good: 'fleece', qty: 999 }]);
    expect(s2.carts[0].cargo.fleece).toBe(0);
    expect(s2.stores.farm?.fleece).toBe(STARTING_FLOCK);
  });

  it('travels the high road in exactly its latency', () => {
    let s = tick(stateWithFleece(), [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    expect(s.carts[0].location.kind).toBe('edge');
    s = runTicks(s, HIGH_ROAD_LATENCY - 1);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
  });

  it('sells fleece at Ryne for the insulting domestic price', () => {
    let s = tick(stateWithFleece(), [
      { type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 4 },
    ]);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    s = runTicks(s, HIGH_ROAD_LATENCY);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
    s = tick(s, [{ type: 'sell', cartId: 'cart-1', good: 'fleece' }]);
    expect(s.coin).toBe(4 * WOOL_PRICE_DOMESTIC);
    expect(s.carts[0].cargo.fleece).toBe(0);
  });

  it('will not sell at the farm — no buyer there', () => {
    const s = tick(stateWithFleece(), [{ type: 'sell', cartId: 'cart-1', good: 'fleece' }]);
    expect(s.coin).toBe(0);
  });

  it('a dispatch while already on the road is a no-op', () => {
    const s = tick(stateWithFleece(), [
      { type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' },
    ]);
    const mid = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(mid.carts[0].location.kind).toBe('edge');
    if (mid.carts[0].location.kind === 'edge') {
      expect(mid.carts[0].location.edgeId).toBe('high-road');
    }
  });
});

describe('the tide and the low road', () => {
  /** First tick t >= from where flooded(t) === want. */
  function findTide(from: number, want: boolean): number {
    for (let t = from; t < from + 500; t++) if (isFlooded(t) === want) return t;
    throw new Error('tide never turned');
  }

  it('refuses dispatch onto the low road at high water', () => {
    const floodedTick = findTide(1, true);
    let s = runTicks(placedState(), floodedTick - 1);
    expect(isFlooded(s.tick)).toBe(true);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s.log.some((e) => e.text.includes('under the tide'))).toBe(true);
  });

  it('allows the low road at low water', () => {
    let s = runTicks(placedState(), 2); // tick 3: still low water
    expect(isFlooded(s.tick)).toBe(false);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location.kind).toBe('edge');
  });

  it('halts a cart caught mid-route by the rising tide, then releases it', () => {
    // Dispatch a few ticks before the flood so the cart is caught out.
    const floodStart = findTide(1, true);
    const departure = floodStart - 3;
    let s = runTicks(placedState(), departure - 1);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);

    // Run deep into the flood window: the cart must still be on the edge,
    // its progress frozen below the road's latency.
    s = runTicks(s, LOW_ROAD_LATENCY);
    expect(isFlooded(s.tick)).toBe(true);
    expect(s.carts[0].location.kind).toBe('edge');
    if (s.carts[0].location.kind === 'edge') {
      expect(s.carts[0].location.progress).toBeLessThan(LOW_ROAD_LATENCY);
    }

    // Once the tide falls it finishes the journey.
    const floodEnd = findTide(s.tick, false);
    s = runTicks(s, floodEnd - s.tick + LOW_ROAD_LATENCY);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
  });
});
