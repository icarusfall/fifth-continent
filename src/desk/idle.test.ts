import { describe, expect, it } from 'vitest';
import { initialState } from '../sim/tick';
import type { GameState } from '../sim/types';
import { isFlooded } from '../sim/time';
import { idleReason, tideHold } from './idle';

function crewedAtFarm(mutate?: (s: GameState) => void): GameState {
  const s = initialState(5);
  s.carts[0].carter = { stops: [{ at: 'farm', take: 'fleece' }, { at: 'ryne' }] };
  s.carts[0].stop = 0;
  s.stores.farm = {};
  mutate?.(s);
  return s;
}

describe('why a hand stands still (spec §20.4)', () => {
  it('says the flock wants shearing when the wool is still on the sheep', () => {
    const s = crewedAtFarm((st) => (st.fleeceReady = 12));
    expect(idleReason(s, s.carts[0])).toBe('waits on white fleece — the flock wants shearing');
  });

  it('says nothing once there is wool in the barn to take', () => {
    const s = crewedAtFarm((st) => (st.stores.farm = { fleece: 4 }));
    expect(idleReason(s, s.carts[0])).toBeNull();
  });

  it('names square books as why no dark wool comes', () => {
    const s = crewedAtFarm((st) => {
      st.carts[0].carter = { stops: [{ at: 'farm', take: 'dark-fleece' }, { at: 'shingle' }] };
      st.fleeceReady = 0;
    });
    expect(idleReason(s, s.carts[0])).toMatch(/books are square/);
  });

  it('a laden hand on the beach waits on the lugger', () => {
    const s = crewedAtFarm((st) => {
      st.carts[0].location = { kind: 'node', nodeId: 'shingle' };
      st.carts[0].cargo = { 'dark-fleece': 8 };
      st.dutchman.present = false;
    });
    expect(idleReason(s, s.carts[0])).toBe('waits on the lugger');
  });

  it('a cart with no hand is nobody’s business here', () => {
    const s = initialState(5);
    expect(idleReason(s, s.carts[0])).toBeNull();
  });
});

describe('caught by the tide (desk playtest)', () => {
  const onLowRoad = (tick: number) => {
    const s = initialState(5);
    s.tick = tick;
    s.carts[0].location = { kind: 'edge', edgeId: 'low-road', from: 'farm', to: 'ryne', progress: 2 };
    return s;
  };
  const floodTick = () => {
    for (let t = 0; t < 500; t++) if (isFlooded(t)) return t;
    throw new Error('no flood');
  };

  it('a cart on the low road at high water waits, and says when it clears', () => {
    const t = floodTick();
    const s = onLowRoad(t);
    const h = tideHold(s, s.carts[0]);
    expect(h?.why).toBe('flood');
    expect(h!.clears).toBeGreaterThan(0);
    expect(isFlooded(t + h!.clears)).toBe(false);
    expect(isFlooded(t + h!.clears - 1)).toBe(true);
  });

  it('is nothing at low water, on the high road, or before the cart has set out', () => {
    let t = 0;
    while (isFlooded(t)) t++;
    const dry = onLowRoad(t);
    expect(tideHold(dry, dry.carts[0])).toBeNull();
    const fresh = onLowRoad(floodTick());
    fresh.carts[0].location = { kind: 'edge', edgeId: 'low-road', from: 'farm', to: 'ryne', progress: 0 };
    expect(tideHold(fresh, fresh.carts[0])).toBeNull();
    const high = onLowRoad(floodTick());
    high.carts[0].location = { kind: 'edge', edgeId: 'high-road', from: 'farm', to: 'ryne', progress: 2 };
    expect(tideHold(high, high.carts[0])).toBeNull();
  });
});
