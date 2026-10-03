import { describe, expect, it } from 'vitest';
import { initialState } from '../../sim/tick';
import type { GameState } from '../../sim/types';
import { Fx } from './fx';

const next = (s: GameState, mutate: (n: GameState) => void): GameState => {
  const n: GameState = JSON.parse(JSON.stringify(s));
  n.tick += 1;
  mutate(n);
  return n;
};

describe('the map answers back (spec §20.4, D6a)', () => {
  it('a sale rings coin; a load lands aboard; shearing throws wool', () => {
    const fx = new Fx();
    let s = initialState(5);
    s.stores.farm = {};
    fx.observe(s, 0);
    s = next(s, (n) => (n.stores.farm = { fleece: 12 }));
    fx.observe(s, 0.1);
    expect(fx.live().tufts).toBeGreaterThan(0);
    s = next(s, (n) => {
      n.stores.farm = { fleece: 4 };
      n.carts[0].cargo = { fleece: 8 };
    });
    fx.observe(s, 0.2);
    expect(fx.live().texts).toContain('+8 aboard');
    s = next(s, (n) => {
      n.carts[0].location = { kind: 'node', nodeId: 'ryne' };
    });
    fx.observe(s, 0.3);
    s = next(s, (n) => {
      n.carts[0].cargo = {};
      n.coin += 24;
    });
    fx.observe(s, 0.4);
    expect(fx.live().texts).toContain('+24');
  });

  it('the Crown counting flares at the Customs House', () => {
    const fx = new Fx();
    let s = initialState(5);
    fx.observe(s, 0);
    s = next(s, (n) => (n.heat.regional += 3));
    fx.observe(s, 0.1);
    expect(fx.live().rings).toBe(1);
    expect(fx.live().texts).toContain('counted');
  });

  it('a load or a new game passes without fanfare', () => {
    const fx = new Fx();
    const s = initialState(5);
    s.tick = 500;
    fx.observe(s, 0);
    const loaded = initialState(9);
    loaded.coin = 300;
    fx.observe(loaded, 0.1);
    const back = JSON.parse(JSON.stringify(s)) as GameState;
    back.tick = 100;
    back.coin = 999;
    fx.observe(back, 0.2);
    expect(fx.live()).toEqual({ texts: [], tufts: 0, rings: 0 });
  });
});
