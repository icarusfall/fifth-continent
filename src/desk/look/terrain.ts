// The desk's marsh (spec §20.4, D4): Romney Marsh as it lies — irregular
// fields bounded by water-filled ditches, the clay uplands hedged, a softened
// coast inked once, the sea deepening east. Calm and low-contrast (the
// designer rejected busy camouflage); painted once to offscreen canvases. And
// the WATER MASK the shader pass reads: red = water, green = nearness to the
// sea, which the tide floods as it rises.

import { MAP_HEIGHT, MAP_WIDTH, terrainAt } from '../../sim/map';
import { hash2, TILE } from '../../shared/geometry';
import { mix } from '../../shared/paint';
import { CLAY, DYKE, INK, LIMEWASH, MARSH, MARSH_DARK, SEA } from '../../shared/palette';

export interface Painted {
  canvas: HTMLCanvasElement;
  /** The rect painted, in tiles. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  res: number; // canvas px per tile
}

const WARP_AMP = 0.75;
const WARP_SCALE = 2.3;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, salt);
  const b = hash2(xi + 1, yi, salt);
  const c = hash2(xi, yi + 1, salt);
  const d = hash2(xi + 1, yi + 1, salt);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Terrain class clamped to the nearest tile: past the edge the marsh runs on
 *  inland, the coast runs on north and south, the sea east (§15.2). */
function classAt(tx: number, ty: number): string {
  return terrainAt(Math.max(0, Math.min(MAP_WIDTH - 1, Math.floor(tx))), Math.max(0, Math.min(MAP_HEIGHT - 1, Math.floor(ty))));
}

/** The class under a warped point — soft, organic edges from a tile grid. */
function classWarped(tx: number, ty: number): string {
  const wx = (vnoise(tx / WARP_SCALE, ty / WARP_SCALE, 31) - 0.5) * 2 * WARP_AMP;
  const wy = (vnoise(tx / WARP_SCALE, ty / WARP_SCALE, 32) - 0.5) * 2 * WARP_AMP;
  return classAt(tx + wx, ty + wy);
}

const rgb = (s: string): [number, number, number] => {
  if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
  return s.match(/\d+/g)!.slice(0, 3).map(Number) as [number, number, number];
};

const SEA_SHALLOW = rgb(mix(SEA, LIMEWASH, 0.18));
const SEA_MID = rgb(SEA);
const SEA_DEEP = rgb(mix(SEA, INK, 0.28));
const SHINGLE = rgb(mix(LIMEWASH, CLAY, 0.3));
const TOWN = rgb(mix(CLAY, LIMEWASH, 0.12));
const WATER = rgb(DYKE);
const INK_RGB = rgb(INK);

const FIELD_GREENS = [MARSH, mix(MARSH, LIMEWASH, 0.08), mix(MARSH, MARSH_DARK, 0.22), mix(MARSH, '#8d9a63', 0.55), mix(MARSH, '#6f8257', 0.5)];
const FIELD_CLAYS = [mix(CLAY, MARSH, 0.35), mix(CLAY, MARSH, 0.5), mix(CLAY, LIMEWASH, 0.08), mix(CLAY, MARSH_DARK, 0.3)];
const DITCH_WATER = mix(DYKE, LIMEWASH, 0.08);
const DITCH_DRY = mix(MARSH_DARK, INK, 0.15);
const HEDGE = mix(MARSH_DARK, INK, 0.25);

const isLand = (c: string) => c === '.' || c === 'c';
const wet = (c: string) => c === '~' || c === 'd';

function paint(x0: number, y0: number, w: number, h: number, res: number, detail: boolean): Painted {
  const W = Math.round(w * res);
  const H = Math.round(h * res);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // ---- pass 1: classes per pixel, and the base colours ----
  const cls = new Array<string>(W * H);
  for (let py = 0; py < H; py++) {
    const ty = y0 + (py + 0.5) / res;
    for (let px = 0; px < W; px++) cls[py * W + px] = classWarped(x0 + (px + 0.5) / res, ty);
  }
  // Where each row's land gives way to the sea: the sea deepens from there.
  const coast = new Float32Array(H);
  for (let py = 0; py < H; py++) {
    let last = 0;
    for (let px = 0; px < W; px++) if (cls[py * W + px] !== '~') last = px;
    coast[py] = last;
  }
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      const c = cls[i];
      let col: [number, number, number];
      if (c === '~') {
        const depth = Math.min(1, Math.max(0, (px - coast[py]) / (res * 7)));
        const a = depth < 0.35 ? SEA_SHALLOW : SEA_MID;
        const b = depth < 0.35 ? SEA_MID : SEA_DEEP;
        const t = depth < 0.35 ? depth / 0.35 : (depth - 0.35) / 0.65;
        const n = (vnoise((x0 + px / res) / 5, (y0 + py / res) / 5, 9) - 0.5) * 5;
        col = [a[0] + (b[0] - a[0]) * t + n, a[1] + (b[1] - a[1]) * t + n, a[2] + (b[2] - a[2]) * t + n];
      } else if (c === 's') {
        const speck = hash2(px, py, 3) < 0.05 ? -30 : hash2(px, py, 4) < 0.05 ? 14 : 0;
        col = [SHINGLE[0] + speck, SHINGLE[1] + speck, SHINGLE[2] + speck];
      } else if (c === 't') {
        col = TOWN;
      } else if (c === 'd') {
        col = WATER;
      } else {
        col = rgb(c === 'c' ? FIELD_CLAYS[0] : MARSH);
      }
      // the coast and the water's edge, inked once, two pixels deep
      const here = wet(cls[i]);
      const edge =
        (px > 0 && here !== wet(cls[i - 1])) ||
        (px > 1 && here !== wet(cls[i - 2])) ||
        (py > 0 && here !== wet(cls[i - W])) ||
        (py > 1 && here !== wet(cls[i - 2 * W]));
      if (edge) col = [INK_RGB[0], INK_RGB[1], INK_RGB[2]];
      d[i * 4] = col[0];
      d[i * 4 + 1] = col[1];
      d[i * 4 + 2] = col[2];
      d[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- pass 2: the fields, drawn over the land and clipped to it ----
  const fields = document.createElement('canvas');
  fields.width = W;
  fields.height = H;
  const f = fields.getContext('2d')!;
  f.setTransform(res, 0, 0, res, -x0 * res, -y0 * res);
  const step = 1.9;
  const gx0 = Math.floor(x0 / step) - 1;
  const gy0 = Math.floor(y0 / step) - 1;
  const gx1 = Math.ceil((x0 + w) / step) + 1;
  const gy1 = Math.ceil((y0 + h) / step) + 1;
  const corner = (i: number, j: number) => ({
    x: i * step + (hash2(i, j, 11) - 0.5) * 1.35,
    y: j * step + (hash2(i, j, 12) - 0.5) * 1.35,
  });
  const cellClass = (i: number, j: number) => classAt((i + 0.5) * step, (j + 0.5) * step);
  for (let j = gy0; j < gy1; j++) {
    for (let i = gx0; i < gx1; i++) {
      const c = cellClass(i, j);
      if (!isLand(c)) continue;
      const pal = c === 'c' ? FIELD_CLAYS : FIELD_GREENS;
      const q = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
      f.fillStyle = pal[Math.floor(hash2(i, j, 13) * pal.length)];
      f.beginPath();
      q.forEach((p, k) => (k ? f.lineTo(p.x, p.y) : f.moveTo(p.x, p.y)));
      f.closePath();
      f.fill();
      if (detail) {
        // furrows: a field's grain, faint
        const ang = hash2(i, j, 14) * Math.PI;
        const cx = (q[0].x + q[2].x) / 2;
        const cy = (q[0].y + q[2].y) / 2;
        f.strokeStyle = 'rgba(36, 28, 24, 0.06)';
        f.lineWidth = 0.05;
        for (let k = -2; k <= 2; k++) {
          const ox = Math.cos(ang + Math.PI / 2) * k * 0.28;
          const oy = Math.sin(ang + Math.PI / 2) * k * 0.28;
          f.beginPath();
          f.moveTo(cx + ox - Math.cos(ang) * 0.6, cy + oy - Math.sin(ang) * 0.6);
          f.lineTo(cx + ox + Math.cos(ang) * 0.6, cy + oy + Math.sin(ang) * 0.6);
          f.stroke();
        }
      }
    }
  }
  // the ditches between marsh fields; hedges on the clay
  f.lineCap = 'round';
  for (let j = gy0; j < gy1; j++) {
    for (let i = gx0; i < gx1; i++) {
      const c = cellClass(i, j);
      if (!isLand(c)) continue;
      const edges: Array<[{ x: number; y: number }, { x: number; y: number }, string]> = [
        [corner(i, j), corner(i + 1, j), cellClass(i, j - 1)],
        [corner(i, j), corner(i, j + 1), cellClass(i - 1, j)],
      ];
      for (const [a, b, other] of edges) {
        if (!isLand(other)) continue;
        if (c === 'c' || other === 'c') {
          f.strokeStyle = HEDGE;
          f.lineWidth = 0.12;
          f.setLineDash([0.18, 0.12]);
        } else {
          // Some boundaries are wet ditches, some a faint dry line, and some
          // nothing at all — two fields grazed as one. That breaks the lattice.
          const roll = hash2(i * 3 + (b.x > a.x + 0.5 ? 0 : 1), j, 15);
          if (roll < 0.28) {
            f.strokeStyle = DITCH_WATER;
            f.lineWidth = 0.1;
          } else if (roll < 0.62) {
            f.strokeStyle = DITCH_DRY;
            f.lineWidth = 0.045;
          } else {
            continue;
          }
          f.setLineDash([]);
        }
        f.beginPath();
        f.moveTo(a.x, a.y);
        f.lineTo(b.x, b.y);
        f.stroke();
      }
    }
  }
  f.setLineDash([]);
  // clip the fields to the land itself
  const landMask = f.createImageData(W, H);
  for (let i = 0; i < W * H; i++) landMask.data[i * 4 + 3] = isLand(cls[i]) ? 255 : 0;
  const mask = document.createElement('canvas');
  mask.width = W;
  mask.height = H;
  mask.getContext('2d')!.putImageData(landMask, 0, 0);
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'destination-in';
  f.drawImage(mask, 0, 0);
  ctx.drawImage(fields, 0, 0);

  return { canvas, x0, y0, w, h, res };
}

let world: Painted | null = null;
let apron: Painted | null = null;

/** The world and a margin past it, crisp. */
export function deskWorld(): Painted {
  if (!world) world = paint(-6, -6, MAP_WIDTH + 12, MAP_HEIGHT + 12, 26, true);
  return world;
}

/** The far apron, coarse: only ever seen small, under the world (§15.2). */
export function deskApron(): Painted {
  if (!apron) apron = paint(-48, -48, MAP_WIDTH + 96, MAP_HEIGHT + 96, 5, false);
  return apron;
}

/** Draw a painted rect into world px (the camera's space). */
export function drawPainted(ctx: CanvasRenderingContext2D, p: Painted): void {
  ctx.drawImage(p.canvas, p.x0 * TILE, p.y0 * TILE, p.w * TILE, p.h * TILE);
}

// ---- the water mask, for the shader ----

export interface Mask extends Painted {
  /** Bumped when the dug channels change and the texture must be re-sent. */
  key: string;
}

let maskBase: HTMLCanvasElement | null = null;
const MASK = { x0: -10, y0: -10, w: MAP_WIDTH + 20, h: MAP_HEIGHT + 20, res: 6 };
const NEAR_TILES = 2.6;

function baseMask(): HTMLCanvasElement {
  if (maskBase) return maskBase;
  const { x0, y0, w, h, res } = MASK;
  const W = w * res;
  const H = h * res;
  const sea = new Uint8Array(W * H);
  const water = new Uint8Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const c = classWarped(x0 + (px + 0.5) / res, y0 + (py + 0.5) / res);
      sea[py * W + px] = c === '~' ? 1 : 0;
      water[py * W + px] = c === '~' || c === 'd' ? 1 : 0;
    }
  }
  // Distance to the sea, in mask px, by a two-pass chamfer.
  const INF = 1e6;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = sea[i] ? 0 : INF;
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++) {
      const i = py * W + px;
      if (px > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (py > 0) dist[i] = Math.min(dist[i], dist[i - W] + 1);
      if (px > 0 && py > 0) dist[i] = Math.min(dist[i], dist[i - W - 1] + 1.414);
      if (px < W - 1 && py > 0) dist[i] = Math.min(dist[i], dist[i - W + 1] + 1.414);
    }
  for (let py = H - 1; py >= 0; py--)
    for (let px = W - 1; px >= 0; px--) {
      const i = py * W + px;
      if (px < W - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (py < H - 1) dist[i] = Math.min(dist[i], dist[i + W] + 1);
      if (px < W - 1 && py < H - 1) dist[i] = Math.min(dist[i], dist[i + W + 1] + 1.414);
      if (px > 0 && py < H - 1) dist[i] = Math.min(dist[i], dist[i + W - 1] + 1.414);
    }
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const reach = NEAR_TILES * res;
  for (let i = 0; i < W * H; i++) {
    img.data[i * 4] = water[i] ? 255 : 0;
    img.data[i * 4 + 1] = Math.round(255 * Math.max(0, 1 - dist[i] / reach));
    img.data[i * 4 + 2] = 0;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  maskBase = c;
  return c;
}

/** The mask with the dug channels laid in (they are water too, §6.18). */
export function waterMask(dug: Array<Array<{ x: number; y: number }>>): Mask {
  const base = baseMask();
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  const g = c.getContext('2d')!;
  g.drawImage(base, 0, 0);
  g.setTransform(MASK.res, 0, 0, MASK.res, -MASK.x0 * MASK.res, -MASK.y0 * MASK.res);
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgb(255, 0, 0)';
  g.lineWidth = 0.32;
  g.lineCap = 'round';
  for (const path of dug) {
    g.beginPath();
    path.forEach((p, i) => (i ? g.lineTo(p.x + 0.5, p.y + 0.5) : g.moveTo(p.x + 0.5, p.y + 0.5)));
    g.stroke();
  }
  return { canvas: c, ...MASK, key: JSON.stringify(dug) };
}
