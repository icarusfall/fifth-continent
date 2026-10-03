import { describe, expect, it } from 'vitest';
import { initialState } from '../sim/tick';
import { cartSheet } from './sheets/cart';
import { sheetFor } from './sheets';
import type { Sheet, Verb } from './sheet';

const verbs = (s: Sheet | null): Verb[] => (s ? s.sections.flatMap((x) => x.verbs) : []);
const lit = (s: Sheet | null) => verbs(s).filter((v) => v.primary && !v.blocked).map((v) => v.key);

describe('the first morning: shear, load, send (desk playtest)', () => {
  it('an empty cart is offered no road before the first sale, and shearing is lit', () => {
    const s = initialState(5);
    s.stores.farm = {};
    const cart = cartSheet(s, s.carts[0].id);
    const roads = cart!.sections.find((x) => x.key === 'roads')!.verbs;
    expect(roads.length).toBeGreaterThan(0);
    expect(roads.every((v) => v.blocked?.startsWith('Load the wool first'))).toBe(true);
    expect(lit(sheetFor({ kind: 'place', id: 'farm' }, s, false))).toEqual(['shear']);
  });

  it('with wool in the barn the load is lit; once aboard, a Ryne road is lit', () => {
    const s = initialState(5);
    s.stores.farm = { fleece: 6 };
    expect(lit(cartSheet(s, s.carts[0].id))).toEqual(['load-fleece']);
    s.stores.farm = {};
    s.carts[0].cargo = { fleece: 6 };
    const on = lit(cartSheet(s, s.carts[0].id));
    expect(on).toHaveLength(1);
    expect(verbs(cartSheet(s, s.carts[0].id)).find((v) => v.key === on[0])!.label).toMatch(/^To Ryne/);
  });

  it('at Ryne before the first sale, selling the white wool is lit', () => {
    const s = initialState(5);
    s.carts[0].location = { kind: 'node', nodeId: 'ryne' };
    s.carts[0].cargo = { fleece: 8 };
    expect(lit(cartSheet(s, s.carts[0].id))).toEqual(['sell-fleece']);
  });

  it('after the first sale an empty cart may go where it likes', () => {
    const s = initialState(5);
    s.coin = 20;
    s.ledger.soldLawfully = 6;
    s.stores.farm = {};
    const roads = cartSheet(s, s.carts[0].id)!.sections.find((x) => x.key === 'roads')!.verbs;
    expect(roads.some((v) => !v.blocked)).toBe(true);
    expect(lit(cartSheet(s, s.carts[0].id))).toEqual([]);
  });
});
