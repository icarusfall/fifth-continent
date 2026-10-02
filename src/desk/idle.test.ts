import { describe, expect, it } from 'vitest';
import { initialState } from '../sim/tick';
import type { GameState } from '../sim/types';
import { idleReason } from './idle';

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
