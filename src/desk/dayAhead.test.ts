import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY } from '../sim/balance';
import { initialState, luggerStandsOff, tick } from '../sim/tick';
import { isFlooded } from '../sim/time';
import type { GameState } from '../sim/types';
import { dayAhead, tripOf, WINDOW } from './dayAhead';
import { routesBetween } from './routes';

describe('the day ahead (spec §20.4, D3)', () => {
  it('draws no lugger before the coast has spoken', () => {
    const s = initialState(7);
    expect(dayAhead(s).lugger).toEqual([]);
  });

  it('the strip’s lugger is the sim’s lugger, tick for tick', () => {
    let s = initialState(7);
    s.dutchman.unlocked = true;
    s.dutchman.met = true;
    const predicted = dayAhead(s).lugger;
    const inSpan = (t: number) => predicted.some((p) => t >= p.from && t < p.to);
    for (let t = 1; t < WINDOW; t++) {
      s = tick(s, []);
      expect(s.dutchman.present).toBe(luggerStandsOff(s, s.tick));
      expect(inSpan(t)).toBe(luggerStandsOff(s, s.tick));
    }
  });

  it('marks the rent inside the window, and names the days to it beyond', () => {
    const s = initialState(7);
    expect(dayAhead(s).rentBeyond).toBeGreaterThan(1);
    s.tick = s.rentDueTick - 10;
    const d = dayAhead(s);
    expect(d.rentBeyond).toBeNull();
    expect(d.marks.find((m) => m.kind === 'rent')?.at).toBe(10);
  });

  it('a travelling cart’s arrival is marked with its number', () => {
    let s: GameState = initialState(7);
    s.carts[0].cargo = { fleece: 8 };
    s = tick(s, [{ type: 'dispatchCart', cartId: 'cart-1', edgeId: 'high-road' }]);
    const arrival = dayAhead(s).marks.find((m) => m.kind === 'arrival');
    expect(arrival?.num).toBe(1);
    expect(arrival!.at).toBeGreaterThan(0);
  });

  it('a trip on the low road is marked where high water would drown it', () => {
    const s = initialState(7);
    const low = routesBetween(s, s.carts[0], 'farm', 'ryne').find((r) => r.legs[0].edge.id === 'low-road')!;
    // Find a start that rides into the flood.
    let start = -1;
    for (let t = 0; t < TICKS_PER_DAY && start < 0; t++) {
      if (!isFlooded(s.tick + t) && isFlooded(s.tick + t + low.legs[0].edge.latency - 1)) start = t;
    }
    expect(start).toBeGreaterThanOrEqual(0);
    const [leg] = tripOf(s, low, start);
    expect(leg.drownsAt).not.toBeNull();
    expect(leg.drownsAt!).toBeGreaterThan(start);
    const high = routesBetween(s, s.carts[0], 'farm', 'ryne').find((r) => r.legs[0].edge.id === 'high-road')!;
    expect(tripOf(s, high, start)[0].drownsAt).toBeNull();
  });
});
