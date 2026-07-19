import { describe, expect, it } from 'vitest';
import {
  CART_CAPACITY,
  CART_COST,
  CART_RESALE,
  FARM_STORE_CAPACITY,
  SHEARING_HOUR,
  STARTING_FLOCK,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { FARM_SITE, edgesFor } from '../map';
import { isFlooded } from '../time';
import { initialState, tick } from '../tick';
import type { Action, GameState } from '../types';

const HIGH_ROAD_LATENCY = edgesFor(FARM_SITE).find((e) => e.id === 'high-road')!.latency;
const LOW_ROAD_LATENCY = edgesFor(FARM_SITE).find((e) => e.id === 'low-road')!.latency;

function runTicks(state: GameState, n: number, actionsAt: Record<number, Action[]> = {}): GameState {
  let s = state;
  for (let i = 0; i < n; i++) {
    s = tick(s, actionsAt[s.tick] ?? []);
  }
  return s;
}

/**
 * A fresh game with the opening clip cleared (§6.7): the flock arrives in wool,
 * but the grow/shear/barn mechanics are cleaner to test from a bare flock, so
 * these tests isolate the mechanic from the starting stock. The opening clip
 * itself is covered in 'the opening state' above.
 */
function bareStart(seed = 1): GameState {
  const s = initialState(seed);
  s.fleeceReady = 0;
  s.ledger.openingStock = 0;
  return s;
}

describe('tick purity', () => {
  it('never mutates its input', () => {
    const s0 = initialState(1);
    const frozen = JSON.stringify(s0);
    tick(s0, [{ type: 'shear' }]);
    tick(s0, []);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('advances the tick counter by exactly one', () => {
    const s0 = initialState(1);
    expect(tick(s0, []).tick).toBe(1);
  });
});

describe('the opening state (spec §6.7: the farm is given)', () => {
  it('begins with the farm at Walland, the flock, the cart, and the store', () => {
    const s0 = initialState(1);
    expect(s0.farm).toEqual(FARM_SITE);
    expect(s0.carts).toHaveLength(1);
    expect(s0.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s0.stores.farm).toEqual({ fleece: 0 }); // the clip is on the sheep, not in the store
    expect(s0.flockSize).toBeGreaterThan(0);
  });

  it('the flock arrives already in wool — a shear is possible at tick 0 (§6.7)', () => {
    const s0 = initialState(1);
    expect(s0.fleeceReady).toBe(STARTING_FLOCK); // no waiting for the first dawn
    const sheared = tick(s0, [{ type: 'shear' }]);
    expect(sheared.stores.farm?.fleece).toBe(STARTING_FLOCK);
    expect(sheared.fleeceReady).toBe(0);
  });

  it('the rent clock starts at once', () => {
    expect(initialState(1).rentDueTick).toBeGreaterThan(0);
  });
});

describe('the flock and the shears', () => {
  /** Run to just past dawn: wool is on the sheep. */
  function dawnState(): GameState {
    return runTicks(bareStart(), SHEARING_HOUR * TICKS_PER_HOUR + 1);
  }

  it('wool grows onto the sheep at dawn, one fleece per head', () => {
    const s = dawnState();
    expect(s.fleeceReady).toBe(STARTING_FLOCK);
    expect(s.stores.farm?.fleece).toBe(0); // not in the store until sheared
  });

  it('grows every day and accumulates if unshorn', () => {
    const s = runTicks(bareStart(), 24 * TICKS_PER_HOUR * 2);
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
  /** Dawn passed, flock sheared: fleece in the store. */
  function stateWithFleece(): GameState {
    const s = runTicks(bareStart(), SHEARING_HOUR * TICKS_PER_HOUR);
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

describe('the barn and the ditch (spec §6.9)', () => {
  /** Three dawns unshorn: more wool on the sheep than the barn can hold. */
  function threeDawnsState(): GameState {
    return runTicks(bareStart(), 2 * TICKS_PER_DAY + SHEARING_HOUR * TICKS_PER_HOUR + 1);
  }

  it('shearing stops at the barn wall; the rest stays on the sheep', () => {
    const s0 = threeDawnsState();
    expect(s0.fleeceReady).toBe(3 * STARTING_FLOCK); // 36 > 24
    const s = tick(s0, [{ type: 'shear' }]);
    expect(s.stores.farm?.fleece).toBe(FARM_STORE_CAPACITY);
    expect(s.fleeceReady).toBe(3 * STARTING_FLOCK - FARM_STORE_CAPACITY);
    expect(s.log.some((e) => e.text.includes('barn takes no more'))).toBe(true);
  });

  it('shearing into a full barn moves nothing and says why', () => {
    const full = tick(threeDawnsState(), [{ type: 'shear' }]);
    const s = tick(full, [{ type: 'shear' }]);
    expect(s.stores.farm?.fleece).toBe(FARM_STORE_CAPACITY);
    expect(s.fleeceReady).toBe(3 * STARTING_FLOCK - FARM_STORE_CAPACITY);
    expect(s.log.some((e) => e.text.includes('full to the rafters'))).toBe(true);
  });

  it('unloading respects the barn wall at the farm', () => {
    // Fill the barn (24), put 8 on the cart, shear the barn full again:
    // the cart now has 8 fleece and nowhere at the farm to put them.
    let s = tick(threeDawnsState(), [{ type: 'shear' }]);
    s = tick(s, [{ type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: CART_CAPACITY }]);
    s = tick(s, [{ type: 'shear' }]);
    expect(cargoCountOf(s.stores.farm!)).toBe(FARM_STORE_CAPACITY);

    s = tick(s, [{ type: 'unloadCart', cartId: 'cart-1', good: 'fleece', qty: 999 }]);
    expect(s.carts[0].cargo.fleece).toBe(CART_CAPACITY); // nothing moved
    expect(cargoCountOf(s.stores.farm!)).toBe(FARM_STORE_CAPACITY);
    expect(s.log.some((e) => e.text.includes('Nothing more fits'))).toBe(true);
  });

  it('other stores have no walls yet — Ryne takes an unload freely', () => {
    let s = tick(threeDawnsState(), [{ type: 'shear' }]);
    s = tick(s, [{ type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: CART_CAPACITY }]);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    s = runTicks(s, HIGH_ROAD_LATENCY);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'ryne' });
    s = tick(s, [{ type: 'unloadCart', cartId: 'cart-1', good: 'fleece', qty: 999 }]);
    expect(s.carts[0].cargo.fleece).toBe(0);
    expect(s.stores.ryne?.fleece).toBe(CART_CAPACITY);
  });

  it('ditching tips the whole cargo into the marsh, anywhere, for nothing', () => {
    let s = tick(threeDawnsState(), [{ type: 'shear' }]);
    s = tick(s, [{ type: 'loadCart', cartId: 'cart-1', good: 'fleece', qty: CART_CAPACITY }]);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    expect(s.carts[0].location.kind).toBe('edge'); // mid-road is fine
    const coinBefore = s.coin;
    s = tick(s, [{ type: 'ditchCargo', cartId: 'cart-1' }]);
    expect(s.carts[0].cargo).toEqual({});
    expect(s.coin).toBe(coinBefore); // no refund
    expect(s.log.some((e) => e.text.includes('into a dyke'))).toBe(true);
  });

  it('ditching an empty cart is a no-op', () => {
    const s0 = initialState(1);
    const s = tick(s0, [{ type: 'ditchCargo', cartId: 'cart-1' }]);
    expect(s.log.some((e) => e.text.includes('dyke'))).toBe(false);
  });
});

function cargoCountOf(store: Partial<Record<string, number>>): number {
  return Object.values(store).reduce((a: number, b) => a + (b ?? 0), 0);
}

describe('the tide and the low road', () => {
  /** First tick t >= from where flooded(t) === want. */
  function findTide(from: number, want: boolean): number {
    for (let t = from; t < from + 500; t++) if (isFlooded(t) === want) return t;
    throw new Error('tide never turned');
  }

  it('refuses dispatch onto the low road at high water', () => {
    const floodedTick = findTide(1, true);
    let s = runTicks(initialState(1), floodedTick);
    expect(isFlooded(s.tick)).toBe(true);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location).toEqual({ kind: 'node', nodeId: 'farm' });
    expect(s.log.some((e) => e.text.includes('under the tide'))).toBe(true);
  });

  it('allows the low road at low water', () => {
    let s = runTicks(initialState(1), 3); // tick 3: still low water
    expect(isFlooded(s.tick)).toBe(false);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'low-road' }]);
    expect(s.carts[0].location.kind).toBe('edge');
  });

  it('halts a cart caught mid-route by the rising tide, then releases it', () => {
    // Dispatch a few ticks before the flood so the cart is caught out.
    const floodStart = findTide(1, true);
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

describe('the wheelwright buys back (spec §6.11: sellCart)', () => {
  function withCoin(coin: number): GameState {
    const s = initialState(1);
    s.coin = coin;
    return s;
  }

  it('a bought cart sells back at a small loss', () => {
    let s = tick(withCoin(200), [{ type: 'buyCart' }]);
    expect(s.carts).toHaveLength(2);
    s = tick(s, [{ type: 'sellCart', cartId: 'cart-2' }]);
    expect(s.carts).toHaveLength(1);
    expect(s.coin).toBe(200 - CART_COST + CART_RESALE); // the loss is the lesson
  });

  it('never the last cart', () => {
    const s = tick(withCoin(200), [{ type: 'sellCart', cartId: 'cart-1' }]);
    expect(s.carts).toHaveLength(1);
    expect(s.coin).toBe(200);
  });

  it('not while laden, and not with a man on the reins', () => {
    let s = tick(withCoin(200), [{ type: 'buyCart' }]);
    s = tick(s, [{ type: 'shear' }]);
    s = tick(s, [{ type: 'loadCart', cartId: 'cart-2', good: 'fleece', qty: 2 }]);
    s = tick(s, [{ type: 'sellCart', cartId: 'cart-2' }]);
    expect(s.carts).toHaveLength(2);

    s = tick(s, [{ type: 'unloadCart', cartId: 'cart-2', good: 'fleece', qty: 99 }]);
    s = tick(s, [
      { type: 'hireCarter', cartId: 'cart-2', order: { from: 'farm', to: 'ryne', good: 'fleece' } },
    ]);
    s = tick(s, [{ type: 'sellCart', cartId: 'cart-2' }]);
    expect(s.carts).toHaveLength(2);
  });

  it('only in the farmyard', () => {
    let s = tick(withCoin(200), [{ type: 'buyCart' }]);
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-2', edgeId: 'high-road' }]);
    s = tick(s, [{ type: 'sellCart', cartId: 'cart-2' }]);
    expect(s.carts).toHaveLength(2);
  });

  it('a sold cart frees its stall: ids are never duplicated', () => {
    let s = tick(withCoin(500), [{ type: 'buyCart' }]);
    s = tick(s, [{ type: 'buyCart' }]);
    expect(s.carts.map((c) => c.id)).toEqual(['cart-1', 'cart-2', 'cart-3']);
    s = tick(s, [{ type: 'sellCart', cartId: 'cart-2' }]);
    s = tick(s, [{ type: 'buyCart' }]);
    const ids = s.carts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('cart-2');
  });
});

describe('the carter takes new orders in place (spec §6.11)', () => {
  it('re-hiring redirects the same man — no paying off and rehiring', () => {
    let s = tick(initialState(1), [
      { type: 'hireCarter', cartId: 'cart-1', order: { from: 'farm', to: 'ryne', good: 'fleece' } },
    ]);
    expect(s.carts[0].carter).toEqual({ from: 'farm', to: 'ryne', good: 'fleece' });
    // Redirect without dismissing first: the order is overwritten in place.
    s = tick(s, [
      {
        type: 'hireCarter',
        cartId: 'cart-1',
        order: { from: 'farm', to: 'shingle', good: 'fleece', back: 'jenever' },
      },
    ]);
    expect(s.carts[0].carter).toEqual({
      from: 'farm',
      to: 'shingle',
      good: 'fleece',
      back: 'jenever',
    });
    expect(s.carts).toHaveLength(1);
  });
});
