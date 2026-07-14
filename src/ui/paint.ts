// Layer 0 (spec §15.1): the landscape, painted once to an offscreen canvas.
//
// The tile grid must never be visible (spec §15.2). The trick: terrain is
// classified PER PIXEL through a smooth noise warp, so class boundaries
// (coast, clay edge, dyke banks) wander organically and nothing aligns to
// the lattice. The ink coastline is then traced from the warped class map
// rather than from tile edges. All noise is seeded from coordinates:
// repaint is pixel-identical.

import { MAP_HEIGHT, MAP_WIDTH, terrainAt } from '../sim/map';
import { hash2 } from './geometry';
import { CLAY, DYKE, INK, LIMEWASH, MARSH, MARSH_DARK, SEA } from './palette';

export const PAINT_RES = 40; // painted px per tile
const W = MAP_WIDTH * PAINT_RES;
const H = MAP_HEIGHT * PAINT_RES;

// How far (in tiles) the class boundaries wander off the lattice.
const WARP_AMP = 1.4;
const WARP_SCALE = 2.6;

/** Blend two hex colours. Tints of palette colours, not new colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round(((pa >> sh) & 0xff) + (((pb >> sh) & 0xff) - ((pa >> sh) & 0xff)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function rgbOf(hex: string): [number, number, number] {
  const p = parseInt(hex.slice(1), 16);
  return [(p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff];
}

// Gentle tints — Bad North fields, not camouflage.
const MARSH_LIGHT = mix(MARSH, LIMEWASH, 0.12);
const MARSH_DEEP = mix(MARSH, MARSH_DARK, 0.5);
const MARSH_WET = mix(MARSH_DARK, DYKE, 0.35);
const CLAY_DARK = mix(CLAY, INK, 0.1);
const CLAY_LIGHT = mix(CLAY, LIMEWASH, 0.16);
const SEA_DEEP = mix(SEA, INK, 0.12);
const SEA_SHALLOW = mix(SEA, LIMEWASH, 0.16);
const SHINGLE = mix(LIMEWASH, CLAY, 0.25);

// ---- Value noise (bilinear over hashed lattice) ----

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function vnoise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);
  const a = hash2(xi, yi, salt);
  const b = hash2(xi + 1, yi, salt);
  const c = hash2(xi, yi + 1, salt);
  const d = hash2(xi + 1, yi + 1, salt);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Terrain class at a warped position (tile units). */
function warpedClass(tx: number, ty: number, wxGrid: WarpGrid): string {
  const { wx, wy } = wxGrid.at(tx, ty);
  return terrainAt(Math.floor(tx + wx), Math.floor(ty + wy));
}

// Warp offsets are sampled on a coarse grid and bilinearly interpolated —
// two vnoise calls per pixel would be slow, this is ~50ms for the map.
class WarpGrid {
  private step = 4; // painted px between samples
  private cols: number;
  private wxs: Float32Array;
  private wys: Float32Array;

  constructor() {
    this.cols = Math.ceil(W / this.step) + 2;
    const rows = Math.ceil(H / this.step) + 2;
    this.wxs = new Float32Array(this.cols * rows);
    this.wys = new Float32Array(this.cols * rows);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const tx = (gx * this.step) / PAINT_RES;
        const ty = (gy * this.step) / PAINT_RES;
        this.wxs[gy * this.cols + gx] = (vnoise(tx / WARP_SCALE, ty / WARP_SCALE, 71) - 0.5) * WARP_AMP;
        this.wys[gy * this.cols + gx] = (vnoise(tx / WARP_SCALE, ty / WARP_SCALE, 72) - 0.5) * WARP_AMP;
      }
    }
  }

  /** tx, ty in tile units. */
  at(tx: number, ty: number): { wx: number; wy: number } {
    const px = (tx * PAINT_RES) / this.step;
    const py = (ty * PAINT_RES) / this.step;
    const xi = Math.max(0, Math.min(this.cols - 2, Math.floor(px)));
    const yi = Math.max(0, Math.floor(py));
    const xf = px - xi;
    const yf = py - yi;
    const i = yi * this.cols + xi;
    const lerp = (arr: Float32Array) => {
      const a = arr[i];
      const b = arr[i + 1];
      const c = arr[i + this.cols] ?? a;
      const d = arr[i + this.cols + 1] ?? b;
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    return { wx: lerp(this.wxs), wy: lerp(this.wys) };
  }
}

// ---- Class ids and colours for the per-pixel pass ----

const CLASS_ID: Record<string, number> = { '~': 0, '.': 1, c: 2, s: 3, t: 4, d: 5 };
const SEA_ID = 0;
const DYKE_ID = 5;

const BASE_RGB: [number, number, number][] = [
  rgbOf(SEA),
  rgbOf(MARSH),
  rgbOf(CLAY),
  [0, 0, 0], // shingle — filled from SHINGLE below (it's an rgb() string)
  rgbOf(CLAY), // town sits on clay; houses are drawn as sprites
  rgbOf(DYKE),
];
{
  const m = SHINGLE.match(/\d+/g)!.map(Number);
  BASE_RGB[3] = [m[0], m[1], m[2]];
}

let cached: HTMLCanvasElement | null = null;

export function getTerrainCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const warp = new WarpGrid();

  // ---- Pass 1: per-pixel warped classification ----
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const cls = new Uint8Array(W * H);
  for (let py = 0; py < H; py++) {
    const ty = py / PAINT_RES;
    for (let px = 0; px < W; px++) {
      const tx = px / PAINT_RES;
      const ch = warpedClass(tx, ty, warp);
      const id = CLASS_ID[ch] ?? 1;
      cls[py * W + px] = id;
      const [r, g, b] = BASE_RGB[id];
      const o = (py * W + px) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- Pass 2: painterly mottling, off-lattice ----
  // Blob sites sit on their own jittered half-tile lattice, coloured by the
  // same warped classification, so patches straddle boundaries organically.
  const SITE = PAINT_RES / 2;
  for (let sy = 0; sy < H / SITE; sy++) {
    for (let sx = 0; sx < W / SITE; sx++) {
      const jx = (sx + hash2(sx, sy, 11)) * SITE;
      const jy = (sy + hash2(sx, sy, 12)) * SITE;
      const id = cls[Math.min(H - 1, Math.round(jy)) * W + Math.min(W - 1, Math.round(jx))];
      const pick = hash2(sx, sy, 13);
      let color: string | null = null;
      if (id === 1) {
        color = pick < 0.14 ? MARSH_LIGHT : pick < 0.28 ? MARSH_DEEP : pick < 0.31 ? MARSH_WET : null;
      } else if (id === 2 || id === 4) {
        color = pick < 0.14 ? CLAY_LIGHT : pick < 0.26 ? CLAY_DARK : null;
      } else if (id === 0) {
        color = pick < 0.1 ? SEA_DEEP : null;
      } else if (id === 3) {
        color = pick < 0.25 ? LIMEWASH : null;
      }
      if (!color) continue;
      const r = (0.35 + hash2(sx, sy, 14) * 0.5) * PAINT_RES;
      blob(ctx, jx, jy, r, color, sx, sy, 15);
    }
  }

  // ---- Pass 3: shallows — lighten sea pixels near the coast ----
  shallows(ctx, cls);

  // ---- Pass 4: details, placed off-lattice, typed by warped class ----
  details(ctx, cls);

  // ---- Pass 5: ink — trace the warped coast and dyke banks ----
  inkBoundaries(ctx, cls);

  cached = canvas;
  return canvas;
}

/** An irregular flat-colour blob — the whole painterly method. */
function blob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  sx: number,
  sy: number,
  salt: number,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.65 + hash2(sx, sy, salt + i) * 0.7);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * 0.85;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

/** Lighten sea within a few painted px of land — a soft standing shallow. */
function shallows(ctx: CanvasRenderingContext2D, cls: Uint8Array): void {
  const REACH = Math.round(PAINT_RES * 0.35);
  const STEP = 3;
  ctx.fillStyle = SEA_SHALLOW;
  ctx.globalAlpha = 0.55;
  for (let py = 0; py < H; py += STEP) {
    for (let px = 0; px < W; px += STEP) {
      if (cls[py * W + px] !== SEA_ID) continue;
      // any land within reach?
      let near = false;
      for (const [dx, dy] of [
        [-REACH, 0],
        [REACH, 0],
        [0, -REACH],
        [0, REACH],
        [-REACH, -REACH],
        [REACH, REACH],
      ]) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
        if (cls[qy * W + qx] !== SEA_ID && cls[qy * W + qx] !== DYKE_ID) {
          near = true;
          break;
        }
      }
      if (near) ctx.fillRect(px - 1, py - 1, STEP + 1, STEP + 1);
    }
  }
  ctx.globalAlpha = 1;
}

/** Sedge, waves, pebbles — sites jittered off-lattice, typed by class. */
function details(ctx: CanvasRenderingContext2D, cls: Uint8Array): void {
  for (let sy = 0; sy < MAP_HEIGHT; sy++) {
    for (let sx = 0; sx < MAP_WIDTH; sx++) {
      const jx = (sx + hash2(sx, sy, 50)) * PAINT_RES;
      const jy = (sy + hash2(sx, sy, 51)) * PAINT_RES;
      const id = cls[Math.min(H - 1, Math.round(jy)) * W + Math.min(W - 1, Math.round(jx))];
      const r = hash2(sx, sy, 52);

      if (id === 1 && r < 0.34) {
        // Sedge tufts.
        ctx.strokeStyle = MARSH_DARK;
        ctx.lineWidth = PAINT_RES * 0.06;
        ctx.lineCap = 'round';
        const n = r < 0.11 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const bx = jx + (hash2(sx, sy, 60 + i) - 0.5) * PAINT_RES * 0.8;
          const by = jy + (hash2(sx, sy, 70 + i) - 0.5) * PAINT_RES * 0.6;
          const lean = (hash2(sx, sy, 80 + i) - 0.5) * PAINT_RES * 0.24;
          ctx.beginPath();
          ctx.moveTo(bx - PAINT_RES * 0.08, by + PAINT_RES * 0.12);
          ctx.quadraticCurveTo(bx + lean, by - PAINT_RES * 0.05, bx + lean * 1.5, by - PAINT_RES * 0.2);
          ctx.moveTo(bx + PAINT_RES * 0.06, by + PAINT_RES * 0.12);
          ctx.quadraticCurveTo(bx + lean * 0.6, by, bx + lean, by - PAINT_RES * 0.15);
          ctx.stroke();
        }
      } else if (id === SEA_ID && r < 0.26) {
        // Wave strokes.
        ctx.strokeStyle = 'rgba(232,225,210,0.16)';
        ctx.lineWidth = PAINT_RES * 0.05;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(jx, jy);
        ctx.quadraticCurveTo(jx + PAINT_RES * 0.15, jy - PAINT_RES * 0.1, jx + PAINT_RES * 0.3, jy);
        ctx.quadraticCurveTo(jx + PAINT_RES * 0.45, jy + PAINT_RES * 0.1, jx + PAINT_RES * 0.6, jy);
        ctx.stroke();
      } else if (id === 3) {
        // Pebbles.
        const n = 2 + Math.floor(hash2(sx, sy, 57) * 3);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 ? mix(CLAY, INK, 0.1) : CLAY;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(
            jx + (hash2(sx, sy, 58 + i) - 0.5) * PAINT_RES,
            jy + (hash2(sx, sy, 64 + i) - 0.5) * PAINT_RES,
            (0.03 + hash2(sx, sy, 71 + i) * 0.045) * PAINT_RES,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (id === DYKE_ID && r < 0.5) {
        // A still ripple on the dyke.
        ctx.strokeStyle = 'rgba(232,225,210,0.2)';
        ctx.lineWidth = PAINT_RES * 0.04;
        ctx.beginPath();
        ctx.moveTo(jx - PAINT_RES * 0.22, jy);
        ctx.lineTo(jx + PAINT_RES * 0.22, jy);
        ctx.stroke();
      }
    }
  }
}

/**
 * Trace ink along the warped class boundaries: dots stamped where land
 * meets sea (bold) or dyke (fine). Because the class map itself wanders,
 * the line is naturally wobbly — no straight tile edge survives.
 */
function inkBoundaries(ctx: CanvasRenderingContext2D, cls: Uint8Array): void {
  const STEP = 2;
  const coastR = PAINT_RES * 0.05;
  const dykeR = PAINT_RES * 0.028;
  for (let py = 0; py < H; py += STEP) {
    for (let px = 0; px < W; px += STEP) {
      const id = cls[py * W + px];
      if (id === SEA_ID) continue;
      let coast = false;
      let bank = false;
      for (const [dx, dy] of [
        [-STEP, 0],
        [STEP, 0],
        [0, -STEP],
        [0, STEP],
      ]) {
        const qx = px + dx;
        const qy = py + dy;
        const q = qx < 0 || qy < 0 || qx >= W || qy >= H ? SEA_ID : cls[qy * W + qx];
        if (q === SEA_ID && id !== DYKE_ID) coast = true;
        else if (q === DYKE_ID && id !== DYKE_ID) bank = true;
      }
      if (!coast && !bank) continue;
      const jx = px + (hash2(px, py, 96) - 0.5) * 2;
      const jy = py + (hash2(px, py, 97) - 0.5) * 2;
      ctx.fillStyle = INK;
      ctx.globalAlpha = coast ? 0.8 : 0.45;
      ctx.beginPath();
      ctx.arc(jx, jy, coast ? coastR : dykeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
