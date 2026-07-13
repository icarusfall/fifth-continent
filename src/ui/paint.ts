// Layer 0 (spec §15.1): the landscape, painted once to an offscreen canvas.
// Painterly, not tiled — every tile scatters irregular blobs of its own
// colour across itself and over its neighbours, so class boundaries
// interlock organically and the grid is never visible (spec §15.2).
// All jitter is seeded from tile coords: repaint is pixel-identical.

import { MAP_HEIGHT, MAP_WIDTH, TERRAIN, terrainAt } from '../sim/map';
import { hash2, jitter, wobblyPoints } from './geometry';
import { CLAY, DYKE, INK, LIMEWASH, MARSH, MARSH_DARK, SEA } from './palette';

export const PAINT_RES = 40; // painted px per tile
const W = MAP_WIDTH * PAINT_RES;
const H = MAP_HEIGHT * PAINT_RES;

/** Blend two hex colours. Tints of palette colours, not new colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) =>
    Math.round(((pa >> sh) & 0xff) + (((pb >> sh) & 0xff) - ((pa >> sh) & 0xff)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Gentle tints — Bad North fields, not camouflage. Low contrast, large shapes.
const MARSH_LIGHT = mix(MARSH, LIMEWASH, 0.12);
const MARSH_DEEP = mix(MARSH, MARSH_DARK, 0.5);
const MARSH_WET = mix(MARSH_DARK, DYKE, 0.35);
const CLAY_DARK = mix(CLAY, INK, 0.1);
const CLAY_LIGHT = mix(CLAY, LIMEWASH, 0.16);
const SEA_SHALLOW = mix(SEA, LIMEWASH, 0.18);
const SHINGLE = mix(LIMEWASH, CLAY, 0.25);

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

type Painter = (ctx: CanvasRenderingContext2D, x: number, y: number) => void;

/** Scatter blobs for one tile; centres may stray into neighbours. */
function scatter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  colors: string[],
  count: number,
  saltBase: number,
  rMin = 0.28,
  rMax = 0.55,
): void {
  for (let i = 0; i < count; i++) {
    const s = saltBase + i * 13;
    const cx = (x + hash2(x, y, s) * 1.3 - 0.15) * PAINT_RES;
    const cy = (y + hash2(x, y, s + 1) * 1.3 - 0.15) * PAINT_RES;
    const r = (rMin + hash2(x, y, s + 2) * (rMax - rMin)) * PAINT_RES;
    const color = colors[Math.floor(hash2(x, y, s + 3) * colors.length)];
    blob(ctx, cx, cy, r, color, x, y, s + 4);
  }
}

const isSea = (x: number, y: number) => terrainAt(x, y) === '~';
const isDyke = (x: number, y: number) => terrainAt(x, y) === 'd';

function paintMarsh(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  scatter(ctx, x, y, [MARSH, MARSH, MARSH, MARSH_LIGHT, MARSH_DEEP], 2, 10, 0.4, 0.8);
  // Wet hollows.
  if (hash2(x, y, 90) > 0.9) {
    scatter(ctx, x, y, [MARSH_WET], 1, 91, 0.16, 0.26);
  }
}

function paintClay(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  scatter(ctx, x, y, [CLAY, CLAY, CLAY, CLAY_LIGHT, CLAY_DARK], 2, 20, 0.4, 0.8);
}

function paintShingle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  scatter(ctx, x, y, [SHINGLE, LIMEWASH], 3, 30, 0.25, 0.45);
}

function paintSea(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // Shallows near the land, deep water elsewhere.
  const nearLand =
    !isSea(x - 1, y) || !isSea(x + 1, y) || !isSea(x, y - 1) || !isSea(x, y + 1);
  if (nearLand) scatter(ctx, x, y, [SEA_SHALLOW, SEA], 2, 40, 0.25, 0.45);
}

const PAINTERS: Record<string, Painter> = {
  '.': paintMarsh,
  c: paintClay,
  s: paintShingle,
  '~': paintSea,
  t: paintClay,
  d: () => {},
};

/** Second pass: linework and per-tile detail on top of the blobs. */
function detail(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const ch = TERRAIN[y][x];
      const px = x * PAINT_RES;
      const py = y * PAINT_RES;
      const r = hash2(x, y, 50);

      if (ch === '.' && r < 0.32) {
        // Sedge tufts.
        const n = r < 0.1 ? 3 : 2;
        ctx.strokeStyle = MARSH_DARK;
        ctx.lineWidth = PAINT_RES * 0.06;
        ctx.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const bx = px + (0.15 + hash2(x, y, 60 + i) * 0.7) * PAINT_RES;
          const by = py + (0.2 + hash2(x, y, 70 + i) * 0.6) * PAINT_RES;
          const lean = jitter(x, y, 80 + i, PAINT_RES * 0.12);
          ctx.beginPath();
          ctx.moveTo(bx - PAINT_RES * 0.08, by + PAINT_RES * 0.12);
          ctx.quadraticCurveTo(bx + lean, by - PAINT_RES * 0.05, bx + lean * 1.5, by - PAINT_RES * 0.2);
          ctx.moveTo(bx + PAINT_RES * 0.06, by + PAINT_RES * 0.12);
          ctx.quadraticCurveTo(bx + lean * 0.6, by, bx + lean, by - PAINT_RES * 0.15);
          ctx.stroke();
        }
      } else if (ch === '~' && r < 0.28) {
        // Wave strokes.
        ctx.strokeStyle = `rgba(232,225,210,0.18)`;
        ctx.lineWidth = PAINT_RES * 0.05;
        ctx.lineCap = 'round';
        const wy = py + (0.2 + hash2(x, y, 55) * 0.6) * PAINT_RES;
        const wx = px + hash2(x, y, 56) * 0.3 * PAINT_RES;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.quadraticCurveTo(wx + PAINT_RES * 0.15, wy - PAINT_RES * 0.1, wx + PAINT_RES * 0.3, wy);
        ctx.quadraticCurveTo(wx + PAINT_RES * 0.45, wy + PAINT_RES * 0.1, wx + PAINT_RES * 0.6, wy);
        ctx.stroke();
      } else if (ch === 's') {
        // Pebbles.
        const n = 3 + Math.floor(hash2(x, y, 57) * 3);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i % 2 ? mix(CLAY, INK, 0.1) : CLAY;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(
            px + (0.1 + hash2(x, y, 58 + i) * 0.8) * PAINT_RES,
            py + (0.1 + hash2(x, y, 64 + i) * 0.8) * PAINT_RES,
            (0.03 + hash2(x, y, 71 + i) * 0.045) * PAINT_RES,
            0,
            Math.PI * 2,
          );
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}

/** Dykes: drawn as waterways with soft banks, not tiles. */
function paintDykes(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (!isDyke(x, y)) continue;
      const cx = (x + 0.5) * PAINT_RES;
      const cy = (y + 0.5) * PAINT_RES;
      // Water body.
      ctx.strokeStyle = DYKE;
      ctx.lineWidth = PAINT_RES * 0.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (isDyke(x + 1, y)) {
        ctx.moveTo(cx, cy + jitter(x, y, 85, PAINT_RES * 0.06));
        ctx.lineTo(cx + PAINT_RES, cy + jitter(x + 1, y, 85, PAINT_RES * 0.06));
      } else if (!isDyke(x - 1, y)) {
        ctx.moveTo(cx - PAINT_RES * 0.2, cy);
        ctx.lineTo(cx + PAINT_RES * 0.2, cy);
      }
      ctx.stroke();
      // A still ripple.
      if (hash2(x, y, 86) < 0.45) {
        ctx.strokeStyle = 'rgba(232,225,210,0.2)';
        ctx.lineWidth = PAINT_RES * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx - PAINT_RES * 0.25, cy + jitter(x, y, 87, PAINT_RES * 0.08));
        ctx.lineTo(cx + PAINT_RES * 0.25, cy + jitter(x, y, 88, PAINT_RES * 0.08));
        ctx.stroke();
      }
    }
  }
}

/** Wobbly ink along the coastline (spec §15.3). */
function inkCoast(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = PAINT_RES * 0.09;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  const scale = PAINT_RES / 20; // wobblyPoints works in TILE=20 world units
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (isSea(x, y)) continue;
      const edges: Array<[boolean, [number, number], [number, number]]> = [
        [isSea(x - 1, y), [x, y], [x, y + 1]],
        [isSea(x + 1, y), [x + 1, y], [x + 1, y + 1]],
        [isSea(x, y - 1), [x, y], [x + 1, y]],
        [isSea(x, y + 1), [x, y + 1], [x + 1, y + 1]],
      ];
      edges.forEach(([hit, a, b], i) => {
        if (!hit) return;
        const pts = wobblyPoints(
          { x: a[0] * 20, y: a[1] * 20 },
          { x: b[0] * 20, y: b[1] * 20 },
          95 + i,
          1.8,
        );
        ctx.beginPath();
        pts.forEach((p, j) => {
          if (j === 0) ctx.moveTo(p.x * scale, p.y * scale);
          else ctx.lineTo(p.x * scale, p.y * scale);
        });
        ctx.stroke();
      });
    }
  }
  ctx.globalAlpha = 1;
}

let cached: HTMLCanvasElement | null = null;

export function getTerrainCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Base coat: sea everywhere, marsh over the land mass.
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (!isSea(x, y)) {
        ctx.fillStyle = MARSH;
        ctx.fillRect(x * PAINT_RES - 1, y * PAINT_RES - 1, PAINT_RES + 2, PAINT_RES + 2);
      }
    }
  }

  // Blob passes. Sea last near the coast so water laps over land edges.
  for (const pass of ['c', 's', '.', 't', '~'] as const) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (TERRAIN[y][x] === pass) PAINTERS[pass](ctx, x, y);
      }
    }
  }

  paintDykes(ctx);
  detail(ctx);
  inkCoast(ctx);

  cached = canvas;
  return canvas;
}
