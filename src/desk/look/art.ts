// The desk's buildings and carts (spec §20.4, D4 — the art). Straight
// top-down with the slight lean §15.3 asks for: roofs seen from above, the
// south wall face showing beneath, windows that light at night. Flat fills,
// one ink, a little hand-wobble from the seeded hash. Drawn in world px with
// the camera's transform applied; `t` (seconds) only animates — smoke, a
// pony's legs, a hull on the swell. None of it touches GameState.

import { SHINGLE } from '../../sim/map';
import type { Good, Store } from '../../sim/types';
import { hash2, TILE, tileCenter } from '../../shared/geometry';
import { CLAY, INK, LIMEWASH, MARSH, MARSH_DARK, REVENUE_BLUE, ROOF, SEA } from '../../shared/palette';

/** Blend two colours given as '#rrggbb' or 'rgb(r,g,b)' — the art mixes its
 *  own mixes, which the shared hex-only mix() cannot read. */
function blend(a: string, b: string, t: number): string {
  const parse = (c: string) =>
    c[0] === '#' ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c.match(/\d+/g)!.slice(0, 3).map(Number);
  const pa = parse(a);
  const pb = parse(b);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

const OUT = 1.1; // ink at world scale
const SHADOW = 'rgba(20, 16, 12, 0.3)';
const LIT = '#f6d28c';
const UNLIT = blend(INK, SEA, 0.35);
const TAR = blend(INK, '#3a3430', 0.5);
const THATCH = blend(CLAY, '#c2a86a', 0.55);
const SLATE = blend(SEA, INK, 0.25);
const WALL = blend(LIMEWASH, CLAY, 0.12);

const wob = (x: number, y: number, s: number, amp = 0.5) => (hash2(Math.round(x * 3), Math.round(y * 3), s) - 0.5) * 2 * amp;

interface Building {
  x: number; // centre, world px
  y: number;
  w: number; // footprint width
  d: number; // roof depth (north-south, as seen from above)
  wall: number; // the south face's showing height
  roof: string;
  wallCol?: string;
  style?: 'gable' | 'hip' | 'lean';
  windows?: number;
  door?: boolean;
  chimney?: -1 | 0 | 1; // which end, if any
  lit: number; // 0 by day .. 1 at night (and someone home)
  seed: number;
}

/** Where a building's chimney stands, for the smoke above it. */
export function chimneyTop(b: Pick<Building, 'x' | 'y' | 'w' | 'd' | 'chimney'>): { x: number; y: number } | null {
  if (!b.chimney) return null;
  return { x: b.x + b.chimney * b.w * 0.3, y: b.y - b.d / 2 + b.d * 0.42 - 4 };
}

export function building(ctx: CanvasRenderingContext2D, b: Building): void {
  const x0 = b.x - b.w / 2;
  const y0 = b.y - b.d / 2;
  const wy = y0 + b.d;
  const j = (s: number) => wob(b.x, b.y, b.seed * 17 + s, 0.45);
  ctx.save();
  ctx.lineJoin = 'round';
  // shadow, cast south-east
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.moveTo(x0 + 2, y0 + 3);
  ctx.lineTo(x0 + b.w + 4, y0 + 3);
  ctx.lineTo(x0 + b.w + 4, wy + b.wall + 3);
  ctx.lineTo(x0 + 2, wy + b.wall + 3);
  ctx.closePath();
  ctx.fill();
  // the south wall
  ctx.fillStyle = b.wallCol ?? WALL;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.rect(x0, wy, b.w, b.wall);
  ctx.fill();
  ctx.stroke();
  // windows, and the door
  const n = b.windows ?? Math.max(1, Math.round(b.w / 7));
  for (let k = 0; k < n; k++) {
    const wx = x0 + ((k + 0.5) * b.w) / n - 1.2;
    if (b.door && Math.abs(wx + 1.2 - b.x) < 2) continue;
    const on = b.lit > 0.2 && hash2(b.seed, k, 77) < 0.8;
    ctx.fillStyle = on ? blend(UNLIT, LIT, Math.min(1, b.lit * 1.2)) : UNLIT;
    ctx.fillRect(wx, wy + b.wall * 0.25, 2.4, b.wall * 0.45);
  }
  if (b.door) {
    ctx.fillStyle = blend(INK, CLAY, 0.25);
    ctx.fillRect(b.x - 1.6, wy + b.wall * 0.3, 3.2, b.wall * 0.7);
  }
  // the roof, seen from above
  const ridge = y0 + b.d * 0.44;
  const back = blend(b.roof, INK, 0.22);
  const front = blend(b.roof, LIMEWASH, 0.06);
  const style = b.style ?? 'gable';
  const inset = style === 'hip' ? Math.min(b.w * 0.3, b.d * 0.42) : 0;
  ctx.lineWidth = OUT;
  if (style === 'lean') {
    ctx.fillStyle = front;
    ctx.beginPath();
    ctx.moveTo(x0 - 1 + j(1), y0 + j(2));
    ctx.lineTo(x0 + b.w + 1 + j(3), y0 + j(4));
    ctx.lineTo(x0 + b.w + 1, wy);
    ctx.lineTo(x0 - 1, wy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillStyle = back;
    ctx.beginPath();
    ctx.moveTo(x0 - 1 + j(1), y0 + j(2));
    ctx.lineTo(x0 + b.w + 1 + j(3), y0 + j(4));
    ctx.lineTo(x0 + b.w + 1 - inset, ridge);
    ctx.lineTo(x0 - 1 + inset, ridge);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = front;
    ctx.beginPath();
    ctx.moveTo(x0 - 1 + inset, ridge);
    ctx.lineTo(x0 + b.w + 1 - inset, ridge);
    ctx.lineTo(x0 + b.w + 1, wy);
    ctx.lineTo(x0 - 1, wy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (style === 'hip') {
      for (const side of [-1, 1]) {
        const ex = side < 0 ? x0 - 1 : x0 + b.w + 1;
        const rx = side < 0 ? x0 - 1 + inset : x0 + b.w + 1 - inset;
        ctx.fillStyle = blend(b.roof, INK, 0.1);
        ctx.beginPath();
        ctx.moveTo(ex, y0);
        ctx.lineTo(rx, ridge);
        ctx.lineTo(ex, wy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  // courses of tile or thatch, faint
  ctx.strokeStyle = 'rgba(36, 28, 24, 0.16)';
  ctx.lineWidth = 0.45;
  for (let yy = y0 + 2.2; yy < wy - 0.5; yy += 2.2) {
    if (Math.abs(yy - ridge) < 0.8) continue;
    ctx.beginPath();
    ctx.moveTo(x0 + (style === 'hip' ? inset * (1 - Math.abs(yy - ridge) / (b.d * 0.5)) : 0), yy);
    ctx.lineTo(x0 + b.w - (style === 'hip' ? inset * (1 - Math.abs(yy - ridge) / (b.d * 0.5)) : 0), yy);
    ctx.stroke();
  }
  // the chimney
  const ch = chimneyTop(b);
  if (ch) {
    ctx.fillStyle = blend(ROOF, INK, 0.35);
    ctx.strokeStyle = INK;
    ctx.lineWidth = OUT;
    ctx.fillRect(ch.x - 1.6, ch.y, 3.2, 4.5);
    ctx.strokeRect(ch.x - 1.6, ch.y, 3.2, 4.5);
  }
  ctx.restore();
}

/** Smoke from a chimney: soft puffs rising and leaning on the wind. */
export function smoke(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, t: number, dark: number, seed: number): void {
  ctx.save();
  for (let k = 0; k < 6; k++) {
    const age = (t * 0.35 + k / 6 + hash2(seed, k, 9) * 0.1) % 1;
    const x = at.x + age * 9 + Math.sin(t + k) * 0.8;
    const y = at.y - age * 14;
    ctx.fillStyle = `rgba(${dark > 0.5 ? '120,118,120' : '226,222,214'}, ${0.42 * (1 - age)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.4 + age * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---- the places ----

export function farm(ctx: CanvasRenderingContext2D, site: { x: number; y: number }, lit: number, t: number): void {
  const c = tileCenter(site);
  // the yard: beaten clay, ruts
  ctx.save();
  ctx.fillStyle = blend(CLAY, MARSH, 0.25);
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.ellipse(c.x + 1, c.y + 4, 21, 13, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(36, 28, 24, 0.25)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(c.x - 16, c.y + 10);
  ctx.quadraticCurveTo(c.x, c.y + 6, c.x + 18, c.y + 11);
  ctx.moveTo(c.x - 15, c.y + 12);
  ctx.quadraticCurveTo(c.x, c.y + 8, c.x + 17, c.y + 13);
  ctx.stroke();
  // the paddock fence
  ctx.strokeStyle = blend(INK, CLAY, 0.3);
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2.2, 1.6]);
  ctx.beginPath();
  ctx.ellipse(c.x - 2, c.y + 22, 30, 14, 0, Math.PI * 1.05, Math.PI * 1.95, true);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // the haystack
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(c.x + 18, c.y - 5, 5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = THATCH;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.arc(c.x + 16.5, c.y - 6.5, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(36,28,24,0.3)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.arc(c.x + 16.5, c.y - 6.5, 2.4, 0, Math.PI * 2);
  ctx.stroke();
  // the barn, thatched, and the house, tiled
  const barn: Building = { x: c.x + 9, y: c.y + 1, w: 17, d: 10, wall: 4.5, roof: THATCH, wallCol: TAR, windows: 0, door: true, lit: 0, seed: 2 };
  const house: Building = { x: c.x - 8, y: c.y - 5, w: 15, d: 11, wall: 5.5, roof: ROOF, windows: 3, door: true, chimney: 1, lit, seed: 1 };
  building(ctx, barn);
  building(ctx, house);
  const ch = chimneyTop(house);
  if (ch) smoke(ctx, ch, t, lit, 1);
}

const RYNE_HOUSES: Array<[number, number, number, number, number]> = [
  // tile x, tile y, w, d, roof tint
  [27.2, 20.3, 12, 9, 0.0],
  [28.4, 20.0, 10, 8, 0.15],
  [29.7, 20.6, 13, 9, 0.05],
  [27.0, 21.5, 11, 8, 0.2],
  [30.2, 21.8, 10, 8, 0.1],
  [27.6, 22.7, 12, 9, 0.0],
  [29.3, 23.1, 11, 8, 0.25],
  [30.6, 23.2, 9, 7, 0.1],
  [28.3, 23.8, 10, 8, 0.15],
  [26.6, 22.9, 9, 7, 0.3],
];

export function ryne(ctx: CanvasRenderingContext2D, lit: number): void {
  // the hill's streets, beaten pale
  ctx.save();
  ctx.strokeStyle = blend(CLAY, LIMEWASH, 0.25);
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(26.3 * TILE, 21.2 * TILE);
  ctx.quadraticCurveTo(28.6 * TILE, 21.0 * TILE, 31.0 * TILE, 22.3 * TILE);
  ctx.moveTo(28.6 * TILE, 19.7 * TILE);
  ctx.lineTo(28.8 * TILE, 24.2 * TILE);
  ctx.stroke();
  ctx.restore();
  // the quay, and two hulls tied up
  ctx.fillStyle = blend(INK, CLAY, 0.35);
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  // the quay stands on the river's mouth, Ryne's whole reason for being here
  ctx.fillRect(28.4 * TILE, 23.9 * TILE, 2.6 * TILE, 4);
  ctx.strokeRect(28.4 * TILE, 23.9 * TILE, 2.6 * TILE, 4);
  for (const dx of [0.7, 1.8]) {
    ctx.fillStyle = blend(INK, CLAY, 0.45);
    ctx.beginPath();
    ctx.ellipse((28.4 + dx) * TILE, 24.6 * TILE + 2, 6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // the houses, north to south so the nearer overlaps the farther
  const sorted = [...RYNE_HOUSES].sort((a, b) => a[1] - b[1]);
  sorted.forEach(([tx, ty, w, d, tint], i) => {
    building(ctx, {
      x: tx * TILE,
      y: ty * TILE,
      w,
      d,
      wall: 4.5,
      roof: blend(ROOF, INK, tint),
      style: i % 3 === 1 ? 'hip' : 'gable',
      windows: Math.max(1, Math.round(w / 5)),
      door: i % 2 === 0,
      chimney: i % 2 === 0 ? -1 : 1,
      lit: hash2(i, 3, 5) < 0.75 ? lit : 0,
      seed: 10 + i,
    });
  });
  // the church: a long nave and a tower with its spire
  const nx = 28.9 * TILE;
  const ny = 21.6 * TILE;
  building(ctx, { x: nx, y: ny, w: 9, d: 15, wall: 5, roof: SLATE, wallCol: blend(LIMEWASH, CLAY, 0.3), windows: 1, lit: lit * 0.6, seed: 30 });
  const tx = nx;
  const ty = ny - 11;
  ctx.fillStyle = SHADOW;
  ctx.fillRect(tx - 3, ty + 2, 9, 12);
  ctx.fillStyle = blend(LIMEWASH, CLAY, 0.32);
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.fillRect(tx - 4, ty, 8, 10);
  ctx.strokeRect(tx - 4, ty, 8, 10);
  ctx.fillStyle = SLATE;
  ctx.beginPath();
  ctx.moveTo(tx - 4.5, ty);
  ctx.lineTo(tx + 4.5, ty);
  ctx.lineTo(tx, ty - 10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function customs(ctx: CanvasRenderingContext2D, lit: number, flag: boolean, t: number): void {
  const c = tileCenter({ x: 26, y: 19 });
  building(ctx, { x: c.x, y: c.y, w: 19, d: 12, wall: 6.5, roof: SLATE, style: 'hip', windows: 5, door: true, chimney: -1, lit, seed: 40 });
  // the flagstaff; the Crown's colour flies once its officer has come (§15.3)
  const px = c.x + 12;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(px, c.y + 6);
  ctx.lineTo(px, c.y - 16);
  ctx.stroke();
  if (flag) {
    const flap = Math.sin(t * 3.2) * 1.2;
    ctx.fillStyle = REVENUE_BLUE;
    ctx.beginPath();
    ctx.moveTo(px, c.y - 16);
    ctx.quadraticCurveTo(px + 4, c.y - 16 + flap, px + 8, c.y - 15 + flap);
    ctx.lineTo(px + 8, c.y - 11 + flap);
    ctx.quadraticCurveTo(px + 4, c.y - 12 + flap, px, c.y - 12);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
}

export function cuttingHouse(ctx: CanvasRenderingContext2D, site: { x: number; y: number }, lit: number, t: number): void {
  const c = tileCenter(site);
  const shed: Building = { x: c.x, y: c.y - 1, w: 20, d: 9, wall: 5, roof: blend(MARSH_DARK, INK, 0.3), wallCol: TAR, style: 'lean', windows: 2, door: true, chimney: 1, lit: Math.max(lit, 0.35), seed: 50 };
  building(ctx, shed);
  // tubs stacked by the wall, and a cask on its side
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  for (const [dx, dy] of [[-13, 3], [-10.5, 3.4], [-12, 0.6]]) {
    ctx.fillStyle = blend(CLAY, INK, 0.25);
    ctx.beginPath();
    ctx.ellipse(c.x + dx, c.y + dy, 1.9, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = blend(CLAY, INK, 0.15);
  ctx.beginPath();
  ctx.roundRect(c.x + 11, c.y + 4, 6, 3.4, 1.4);
  ctx.fill();
  ctx.stroke();
  const ch = chimneyTop(shed);
  if (ch) smoke(ctx, ch, t, lit, 50);
}

export function shingle(ctx: CanvasRenderingContext2D, lit: number): void {
  const c = tileCenter(SHINGLE);
  // the hut, tarred black
  building(ctx, { x: c.x - 8, y: c.y - 6, w: 9, d: 6, wall: 4, roof: blend(INK, CLAY, 0.2), wallCol: TAR, windows: 1, lit: lit * 0.5, seed: 60 });
  // net poles and a hung net
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(c.x - 1, c.y - 9);
  ctx.lineTo(c.x - 1, c.y - 2);
  ctx.moveTo(c.x + 7, c.y - 9);
  ctx.lineTo(c.x + 7, c.y - 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(36,28,24,0.45)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let k = 0; k <= 4; k++) {
    ctx.moveTo(c.x - 1 + k * 2, c.y - 8.5);
    ctx.quadraticCurveTo(c.x - 1 + k * 2 + 0.6, c.y - 5.5, c.x - 1 + k * 2, c.y - 3);
  }
  ctx.moveTo(c.x - 1, c.y - 8.5);
  ctx.quadraticCurveTo(c.x + 3, c.y - 6.8, c.x + 7, c.y - 8.5);
  ctx.stroke();
  // two boats drawn up on the stones
  for (const [dx, dy, a] of [[-2, 6, -0.25], [8, 8, 0.3]]) {
    ctx.save();
    ctx.translate(c.x + dx, c.y + dy);
    ctx.rotate(a);
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(1.2, 1.4, 7, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blend(INK, CLAY, 0.4);
    ctx.strokeStyle = INK;
    ctx.lineWidth = OUT;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.quadraticCurveTo(0, -3.4, 7, 0);
    ctx.quadraticCurveTo(0, 3.4, -7, 0);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,225,210,0.3)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.restore();
  }
}

/** The Dutchman's lugger, standing off the shingle, rising on the swell. */
export function lugger(ctx: CanvasRenderingContext2D, t: number): void {
  const c = tileCenter({ x: SHINGLE.x + 2.4, y: SHINGLE.y + 0.4 });
  const bob = Math.sin(t * 1.1) * 0.8;
  const roll = Math.sin(t * 0.8) * 0.04;
  ctx.save();
  ctx.translate(c.x, c.y + bob);
  ctx.rotate(roll);
  ctx.fillStyle = 'rgba(10, 18, 22, 0.35)';
  ctx.beginPath();
  ctx.ellipse(2, 4, 15, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // hull, planked
  ctx.fillStyle = blend(INK, CLAY, 0.3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.moveTo(-14, 0);
  ctx.quadraticCurveTo(-2, 7.5, 14, 0);
  ctx.lineTo(11, -3.5);
  ctx.lineTo(-12, -3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232,225,210,0.22)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-12, -1.2);
  ctx.quadraticCurveTo(-1, 3.4, 12.5, -1.2);
  ctx.stroke();
  // masts and lug sails, pale enough to read at night, shaded on the lee
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.moveTo(-5, -3.5);
  ctx.lineTo(-4, -24);
  ctx.moveTo(6, -3.5);
  ctx.lineTo(6.6, -18);
  ctx.stroke();
  const sail = (pts: Array<[number, number]>, shade: number) => {
    ctx.fillStyle = blend(LIMEWASH, CLAY, shade);
    ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  sail([[-11, -6], [-4.2, -22.5], [2, -6.5]], 0.18);
  sail([[2.8, -6.5], [6.4, -17], [11.5, -6]], 0.28);
  ctx.restore();
}

// ---- what moves ----

function loadKind(cargo: Store): Array<'white' | 'dark' | 'tub' | 'chest'> {
  const out: Array<'white' | 'dark' | 'tub' | 'chest'> = [];
  for (const [g, n] of Object.entries(cargo) as Array<[Good, number]>) {
    if (!n) continue;
    const kind = g === 'fleece' ? 'white' : g === 'dark-fleece' ? 'dark' : g === 'jenever' || g.startsWith('brandy') ? 'tub' : 'chest';
    for (let k = 0; k < Math.min(3, Math.ceil(n / 3)); k++) out.push(kind);
  }
  return out.slice(0, 4);
}

/** A cart: a pony walking (when it moves), two spoked wheels, and its load. */
export function cart(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, cargo: Store, moving: boolean, t: number, seed: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'round';
  const step = moving ? Math.sin(t * 9 + seed) : 0;
  // shadow
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(4, 2.5, 15, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // the pony: legs, body, neck and head, a dark mane
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const [lx, ph] of [[10, 0], [11.5, Math.PI], [15.5, Math.PI], [17, 0]]) {
    const s = Math.sin(ph) * step * 1.4;
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx + s, 4);
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx - s, -4);
  }
  ctx.stroke();
  ctx.fillStyle = blend(CLAY, INK, 0.35);
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.ellipse(13.5, 0, 5, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(19.5, 0, 2.6, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(18, 0);
  ctx.stroke();
  // shafts
  ctx.strokeStyle = blend(CLAY, INK, 0.45);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(5, -3);
  ctx.lineTo(13, -2.6);
  ctx.moveTo(5, 3);
  ctx.lineTo(13, 2.6);
  ctx.stroke();
  // wheels, side-on as a top-down eye takes them: dark bars with a hub
  ctx.fillStyle = INK;
  ctx.fillRect(-4.5, -6.6, 8, 2);
  ctx.fillRect(-4.5, 4.6, 8, 2);
  // the bed
  ctx.fillStyle = blend(CLAY, INK, 0.12);
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.roundRect(-8, -4.6, 13.5, 9.2, 1.2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(36,28,24,0.3)';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(-8, -1.5);
  ctx.lineTo(5.5, -1.5);
  ctx.moveTo(-8, 1.5);
  ctx.lineTo(5.5, 1.5);
  ctx.stroke();
  // the load
  const load = loadKind(cargo);
  load.forEach((k, i) => {
    const lx = -5.2 + (i % 2) * 6;
    const ly = i < 2 ? -1.9 : 1.9;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = INK;
    if (k === 'white' || k === 'dark') {
      ctx.fillStyle = k === 'white' ? LIMEWASH : blend(INK, CLAY, 0.4);
      ctx.beginPath();
      ctx.ellipse(lx, ly, 3, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (k === 'tub') {
      ctx.fillStyle = blend(CLAY, INK, 0.3);
      ctx.beginPath();
      ctx.arc(lx, ly, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, 1, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = blend(CLAY, MARSH, 0.3);
      ctx.fillRect(lx - 2.4, ly - 1.7, 4.8, 3.4);
      ctx.strokeRect(lx - 2.4, ly - 1.7, 4.8, 3.4);
    }
  });
  // the lantern on its pole
  ctx.fillStyle = LIT;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(5.8, -5, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The Riding Officer: a big horse, a blue coat, a tricorne. */
export function officer(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, moving: boolean, t: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const step = moving ? Math.sin(t * 7) : 0;
  ctx.fillStyle = SHADOW;
  ctx.beginPath();
  ctx.ellipse(1, 2.5, 10, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [lx, ph] of [[-5, 0], [-3.5, Math.PI], [3.5, Math.PI], [5, 0]]) {
    const s = Math.sin(ph) * step * 1.6;
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx + s, 4.6);
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx - s, -4.6);
  }
  ctx.stroke();
  ctx.fillStyle = blend(INK, CLAY, 0.3);
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.ellipse(0, 0, 7, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(8.2, 0, 3, 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // the rider: the coat is the entire point
  ctx.fillStyle = REVENUE_BLUE;
  ctx.beginPath();
  ctx.ellipse(-0.5, 0, 3, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(-2.8, -2.2);
  ctx.lineTo(1.8, 0);
  ctx.lineTo(-2.8, 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The flock, at a size that sits beside the buildings: wool, a dark face,
 *  grazing — each drifts a little about its spot as the day goes. */
export function sheep(ctx: CanvasRenderingContext2D, site: { x: number; y: number }, count: number, t: number): void {
  const c = tileCenter(site);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const angle = hash2(site.x, site.y, 100 + i) * Math.PI * 2;
    const dist = (1.2 + hash2(site.x, site.y, 200 + i) * 2.1) * TILE;
    const drift = Math.sin(t * 0.07 + i) * 1.6;
    const sx = c.x + Math.cos(angle) * dist + drift;
    const sy = c.y + 6 + Math.sin(angle) * dist * 0.7 + Math.cos(t * 0.05 + i * 2) * 0.8;
    const facing = hash2(site.x, site.y, 300 + i) > 0.5 ? 1 : -1;
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.ellipse(sx + 0.8, sy + 1.2, 2.8, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LIMEWASH;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.7, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(sx + 2.5 * facing, sy - 0.3, 1.05, 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The uplands' tell (desk playtest, 2026-10-03): this is the way to Applesham
 * and the City — gentry country, the law's country. A turnpike leaves the high
 * road northward off the map, through a toll gate past a milestone; a great
 * house stands in its park among the enclosures.
 */
export function uplands(ctx: CanvasRenderingContext2D, lit: number): void {
  const T = TILE;
  const road: Array<[number, number]> = [[17, 5.2], [17.3, 3.5], [17.1, 1.6], [17.6, -0.5], [17.4, -6], [18, -14]];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, col] of [[6.2, 'rgba(36, 28, 24, 0.55)'], [4.4, blend(CLAY, LIMEWASH, 0.4)]] as Array<[number, string]>) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    road.forEach(([x, y], i) => (i ? ctx.lineTo(x * T, y * T) : ctx.moveTo(x * T, y * T)));
    ctx.stroke();
  }
  // the toll gate: a bar across the road and the keeper's cottage
  building(ctx, { x: 18.3 * T, y: 1.4 * T, w: 7, d: 5, wall: 3.5, roof: ROOF, windows: 1, lit: lit * 0.8, seed: 70 });
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(16.7 * T, 2.2 * T);
  ctx.lineTo(17.7 * T, 2.2 * T);
  ctx.stroke();
  ctx.strokeStyle = LIMEWASH;
  ctx.lineWidth = 0.6;
  ctx.setLineDash([1.2, 1.2]);
  ctx.beginPath();
  ctx.moveTo(16.7 * T, 2.2 * T);
  ctx.lineTo(17.7 * T, 2.2 * T);
  ctx.stroke();
  ctx.setLineDash([]);
  // the milestone
  ctx.fillStyle = blend(LIMEWASH, INK, 0.3);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.roundRect(16.3 * T, 3.4 * T, 2.4, 3.2, 1);
  ctx.fill();
  ctx.stroke();
  // the great house in its park: a lawn, a carriage sweep, a few great trees
  ctx.fillStyle = blend(MARSH, LIMEWASH, 0.18);
  ctx.beginPath();
  ctx.ellipse(8.4 * T, 1.9 * T, 2.6 * T, 1.5 * T, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = blend(CLAY, LIMEWASH, 0.35);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8.4 * T, 2.6 * T);
  ctx.quadraticCurveTo(10.8 * T, 3.4 * T, 12.6 * T, 4.6 * T);
  ctx.stroke();
  for (const [tx, ty] of [[6.4, 1.2], [6.9, 2.7], [10.3, 1.0], [10.6, 2.4]]) {
    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.arc(tx * T + 2, ty * T + 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blend(MARSH_DARK, MARSH, 0.3);
    ctx.strokeStyle = 'rgba(36,28,24,0.5)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(tx * T, ty * T, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  building(ctx, { x: 8.4 * T, y: 1.5 * T, w: 24, d: 11, wall: 6.5, roof: SLATE, wallCol: blend(LIMEWASH, CLAY, 0.22), style: 'hip', windows: 7, door: true, chimney: 1, lit, seed: 71 });
  ctx.restore();
}
