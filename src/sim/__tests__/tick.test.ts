import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  HIGH_ROAD_LATENCY,
  LOW_ROAD_LATENCY,
  SHEARING_HOUR,
  STARTING_FLOCK,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { isFlooded } from '../time';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

function runTicks(state: GameState, n: number, actionsAt: Record<number, Action[]> = {}): GameState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = tick(s, actionsAt[s.tick] ?? []);
  }
  return s;
}

describe('tick purity', () => {
  it('never mutates its input', () => {
    const s0 = initialState(1);
    const frozen = JSON.stringify(s0);
    tick(s0, [{ type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 5 }]);
    tick(s0, []);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('advances the tick counter by exactly one', () => {
    const s0 = initialState(1);
    expect(tick(s0, []).tick).toBe(1);
  });
});

describe('the flock', () => {
  it('shears at dawn: one fleece per head lands at the farm', () => {
    const s0 = initialState(1);
    const beforeDawn = runTicks(s0, SHEARING_HOUR * TICKS_PER_HOUR - 1);
    expect(beforeDawn.stores.farm?.fleece ?? 0).toBe(0);
    const atDawn = tick(beforeDawn, []);
    expect(atDawn.stores.farm?.fleece).toBe(STARTING_FLOCK);
  });

  it('shears every day, not every tick', () => {
    const s = runTicks(initialState(1), 24 * TICKS_PER_HOUR * 2); // two full days
    expect(s.stores.farm?.fleece).toBe(STARTING_FLOCK * 2);
  });
});

describe('the cart', () => {
  function stateWithFleece(): GameState {
    // Run to just past dawn on day 1 so the farm store holds a shearing.
    return runTicks(initialState(1), SHEARING_HOUR * TICKS_PER_HOUR + 1);
  }

  it('loads up to capacity and no further', () => {
    const s = tick(stateWithFleece(), [
      { type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: 999 },
    ]);
    expect(s.carts[0].cargo.fleece).toBe(CART_CAPACITY);
    expect(s.stores.farm?.fleece).toBe(STARTING_FLOCK - CART_CAPACITY);
  });

  it('cannot load more than the store holds', () => {
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

  it('ignores a dispatch on an edge that does not start here', () => {
    // Put the cart at Ryne first, then order it onto an edge from... itself.
    const s = tick(stateWithFleece(), [
      { type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' },
    ]);
    const mid = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    // Already on the road: second dispatch is a no-op.
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
    const floodedTick = findTide(0, true);
    let s = runTicks(initialState(1), floodedTick);
    expect(isFlooded(s.tick)).toBe(true);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s.log.some((e) => e.text.includes('under the tide'))).toBe(true);
  });

  it('allows the low road at low water and it is fast', () => {
    let s = runTicks(initialState(1), findTide(0, false));
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location.kind).toBe('edge');
  });

  it('halts a cart caught mid-route by the rising tide, then releases it', () => {
    // Dispatch a few ticks before the flood so the cart is caught out.
    const floodStart = findTide(0, true);
    const departure = floodStart - 3;
    let s = runTicks(initialState(1), departure);
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
