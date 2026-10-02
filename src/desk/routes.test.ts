import { describe, expect, it } from 'vitest';
import { initialState } from '../sim/tick';
import type { GameState } from '../sim/types';
import { defaultTake, legOpen, routeRisk, routesBetween, waysFor } from './routes';

function world(mutate?: (s: GameState) => void): GameState {
  const s = initialState(2026);
  s.tick = 60;
  mutate?.(s);
  return s;
}

describe('cart command: the routes a hull may take (spec §20.4, D2)', () => {
  it('a cart rides roads only, and the marsh track only once the coast has spoken', () => {
    const s = world();
    const cart = s.carts[0];
    expect(waysFor(s, cart).map((e) => e.id).sort()).toEqual(['high-road', 'low-road']);
    s.dutchman.unlocked = true;
    expect(waysFor(s, cart).map((e) => e.id)).toContain('marsh-track');
    expect(waysFor(s, cart).map((e) => e.id)).not.toContain('sea-lane');
  });

  it('offers the two cheapest routes, cheapest first, each with its hours', () => {
    const s = world((st) => {
      st.dutchman.unlocked = true;
      st.cuttingHouse = { x: 24, y: 12 };
    });
    const routes = routesBetween(s, s.carts[0], 'farm', 'ryne');
    expect(routes.length).toBe(2);
    expect(routes[0].ticks).toBeLessThanOrEqual(routes[1].ticks);
    for (const r of routes) {
      expect(r.legs[0].from).toBe('farm');
      expect(r.legs[r.legs.length - 1].to).toBe('ryne');
      expect(r.ticks).toBe(r.legs.reduce((t, l) => t + l.edge.latency, 0));
    }
  });

  it('a hull with no way there is offered no route', () => {
    const s = world();
    const tub = { ...s.carts[0], vessel: 'dyke' as const };
    expect(routesBetween(s, tub, 'farm', 'ryne')).toEqual([]);
  });

  it('names the risk: the high road is the Customs House’s, the low road drowns', () => {
    const s = world();
    const [first, second] = routesBetween(s, s.carts[0], 'farm', 'ryne');
    const byRoad = Object.fromEntries([first, second].map((r) => [r.legs[0].edge.id, routeRisk(s, r)]));
    expect(byRoad['high-road'].tone).toBe('watched');
    expect(byRoad['low-road'].words.join(' ')).toMatch(/drown/);
  });

  it('a drowned road is not open this tick', () => {
    const s = world();
    const low = routesBetween(s, s.carts[0], 'farm', 'ryne').find((r) => r.legs[0].edge.id === 'low-road')!;
    let flooded = -1;
    for (let t = 0; t < 2000 && flooded < 0; t++) {
      s.tick = t;
      if (!legOpen(s, low.legs[0])) flooded = t;
    }
    expect(flooded).toBeGreaterThanOrEqual(0);
  });
});

describe('a round’s default pick-ups (spec §20.4 / §6.10 M5½f)', () => {
  it('wool goes by the colour its next dealing stop wants', () => {
    const s = world((st) => (st.ledger.books = 'short'));
    expect(defaultTake(s, [{ at: 'farm' }, { at: 'shingle' }], 0)).toBe('dark-fleece');
    expect(defaultTake(s, [{ at: 'farm' }, { at: 'ryne' }], 0)).toBe('fleece');
    // A store in between does not change the colour the far stop wants.
    expect(defaultTake(s, [{ at: 'farm' }, { at: 'cutting-house' }, { at: 'shingle' }], 0)).toBe('dark-fleece');
  });

  it('the beach and the town pick up nothing unless told to', () => {
    const s = world();
    expect(defaultTake(s, [{ at: 'ryne' }, { at: 'farm' }], 0)).toBeUndefined();
    expect(defaultTake(s, [{ at: 'shingle' }, { at: 'farm' }], 0)).toBeUndefined();
  });

  it('the house sends its most plentiful product to market', () => {
    const s = world((st) => {
      st.cuttingHouse = { x: 24, y: 12 };
      st.stores['cutting-house'] = { 'brandy-fair': 3, 'bulked-tea': 9 };
    });
    expect(defaultTake(s, [{ at: 'cutting-house' }, { at: 'ryne' }], 0)).toBe('bulked-tea');
  });
});
