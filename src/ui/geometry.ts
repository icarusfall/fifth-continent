// Render-side geometry helpers. Reads sim state, never writes it.

import type { MapEdge } from '../sim/types';

export const TILE = 20; // world px per tile
export const WORLD_W = 40 * TILE;
export const WORLD_H = 30 * TILE;

export function tileCenter(p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
}

export function pathPoints(edge: MapEdge, reversed: boolean): Array<{ x: number; y: number }> {
  const pts = edge.path.map(tileCenter);
  return reversed ? [...pts].reverse() : pts;
}

/** Point + heading at `fraction` (0..1) along a polyline, by arc length. */
export function pointAlong(
  pts: Array<{ x: number; y: number }>,
  fraction: number,
): { x: number; y: number; angle: number } {
  const f = Math.max(0, Math.min(1, fraction));
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lengths.push(d);
    total += d;
  }
  const angleOf = (i: number) =>
    Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
  if (total === 0) return { ...pts[0], angle: 0 };
  let remaining = f * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
        angle: angleOf(i),
      };
    }
    remaining -= lengths[i];
  }
  return { ...pts[pts.length - 1], angle: angleOf(pts.length - 2) };
}

// ---- Deterministic hand-wobble (spec §15.3) ----
// Seeded from tile/vertex coords so it never shimmers between frames.

export function hash2(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 974634721) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Jitter in [-amp, amp], deterministic per (x, y, salt). */
export function jitter(x: number, y: number, salt: number, amp: number): number {
  return (hash2(x, y, salt) * 2 - 1) * amp;
}

/** A hand-drawn polyline between two points: jittered midpoints. */
export function wobblyPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  salt: number,
  amp = 1.6,
): Array<{ x: number; y: number }> {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len / (TILE / 2)));
  const pts = [a];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    pts.push({
      x: a.x + (b.x - a.x) * t + jitter(Math.round(a.x + i), Math.round(a.y), salt + i, amp),
      y: a.y + (b.y - a.y) * t + jitter(Math.round(b.x + i), Math.round(b.y), salt + 7 * i, amp),
    });
  }
  pts.push(b);
  return pts;
}
