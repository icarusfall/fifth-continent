// The desk's light (spec §20.4, D4): how dark it is, how warm the dusk, and
// every lamp in the world — windows, the cutting house's fire, the carts'
// lanterns, the lugger's signal, the officer's lamp. The reserved colours glow
// only where their owners are (§15.3): Leiden's workshop in Phlogiston orange,
// the wight-stone in Ichor green. Lamp light itself is warm limewash.

import { DAWN_HOUR, DAY_HOUR, DUSK_HOUR, NIGHT_HOUR } from '../../sim/balance';
import { SHINGLE } from '../../sim/map';
import { clockOf } from '../../sim/time';
import type { Cart, GameState } from '../../sim/types';
import { TILE, tileCenter } from '../../shared/geometry';
import { ICHOR_GREEN, PHLOGISTON_ORANGE } from '../../shared/palette';
import type { Lamp } from './compositor';

const LAMP: [number, number, number] = [0.98, 0.8, 0.52];
const rgb01 = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

const hourOf = (tick: number) => {
  const c = clockOf(tick);
  return c.hour + c.minute / 60;
};
const ramp = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/** 0 by day, 1 at night, eased across the game's own dusk and dawn hours. */
export function darknessAt(tick: number): number {
  const h = hourOf(tick);
  if (h >= NIGHT_HOUR || h < DAWN_HOUR) return 1;
  if (h >= DUSK_HOUR) return ramp((h - DUSK_HOUR) / (NIGHT_HOUR - DUSK_HOUR));
  if (h < DAY_HOUR) return 1 - ramp((h - DAWN_HOUR) / (DAY_HOUR - DAWN_HOUR));
  return 0;
}

/** The warm half-light, highest mid-dusk and mid-dawn. */
export function duskAt(tick: number): number {
  const h = hourOf(tick);
  const peak = (centre: number, half: number) => Math.max(0, 1 - Math.abs(h - centre) / half);
  return Math.max(peak((DUSK_HOUR + NIGHT_HOUR) / 2, 1.6), peak((DAWN_HOUR + DAY_HOUR) / 2, 1.4));
}

type Pos = { x: number; y: number; angle: number } | null;

/** Every lamp lit this frame, in world px. `now` (seconds) only flickers them. */
export function lampsOf(
  state: GameState,
  now: number,
  cartPos: (s: GameState, c: Cart) => Pos,
  officerPos: (s: GameState) => Pos,
): Lamp[] {
  const flick = (k: number) => 0.88 + 0.12 * Math.sin(now * 7.3 + k) * Math.sin(now * 3.1 + k * 2);
  const at = (x: number, y: number) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
  const lamps: Lamp[] = [];
  const f = tileCenter(state.farm);
  lamps.push({ x: f.x - 4, y: f.y - 2, r: 3.0 * TILE, i: 0.9, rgb: LAMP });
  for (const [x, y] of [[28.1, 20.6], [28.9, 21.5], [27.6, 21.9], [29.4, 20.5], [28.4, 22.6]]) {
    lamps.push({ ...at(x, y), r: 1.5 * TILE, i: 0.7, rgb: LAMP });
  }
  lamps.push({ ...at(26.4, 18.9), r: 1.8 * TILE, i: 0.6, rgb: LAMP });
  if (state.cuttingHouse) {
    const c = tileCenter(state.cuttingHouse);
    lamps.push({ x: c.x, y: c.y, r: 2.4 * TILE, i: flick(1), rgb: [1, 0.72, 0.42] });
  }
  if (state.leiden.state === 'housed' && state.leiden.node) {
    const host = state.leiden.node === 'farm' ? state.farm : state.cuttingHouse;
    if (host) {
      const c = tileCenter(host);
      lamps.push({ x: c.x, y: c.y - 6, r: 3.2 * TILE, i: 0.6 + 0.4 * flick(5), rgb: rgb01(PHLOGISTON_ORANGE) });
    }
  }
  if (state.wights.stone) {
    const c = tileCenter(state.wights.stone);
    lamps.push({ x: c.x, y: c.y, r: 2.2 * TILE, i: 0.5 + 0.3 * Math.sin(now * 1.4), rgb: rgb01(ICHOR_GREEN) });
  }
  if (state.dutchman.present) {
    const c = tileCenter(SHINGLE);
    // the lugger's signal: a light on the water, shown and hidden
    lamps.push({ x: c.x + 2.1 * TILE, y: c.y + 0.3 * TILE, r: 1.7 * TILE, i: Math.sin(now * 1.6) > -0.3 ? 1 : 0.15, rgb: LAMP });
  }
  state.carts.forEach((cart, k) => {
    const p = cartPos(state, cart);
    if (p) lamps.push({ x: p.x + Math.cos(p.angle) * 5, y: p.y + Math.sin(p.angle) * 5, r: 1.6 * TILE, i: flick(k * 3), rgb: LAMP });
  });
  const o = officerPos(state);
  if (o) lamps.push({ x: o.x, y: o.y, r: 1.3 * TILE, i: 0.8, rgb: LAMP });
  return lamps;
}
