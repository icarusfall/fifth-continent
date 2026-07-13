// Render-side geometry: interpolate a cart's position along an edge's
// polyline path. Reads sim state, never writes it.

import type { MapEdge } from '../sim/types';

export const TILE = 20; // px per tile in the SVG view

export function tileCenter(p: { x: number; y: number }): { x: number; y: number } {
  return { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
}

export function pathPoints(edge: MapEdge, reversed: boolean): Array<{ x: number; y: number }> {
  const pts = edge.path.map(tileCenter);
  return reversed ? [...pts].reverse() : pts;
}

/** Point at `fraction` (0..1) of the way along a polyline, by arc length. */
export function pointAlong(
  pts: Array<{ x: number; y: number }>,
  fraction: number,
): { x: number; y: number } {
  const f = Math.max(0, Math.min(1, fraction));
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    lengths.push(d);
    total += d;
  }
  if (total === 0) return pts[0];
  let remaining = f * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return {
        x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
        y: pts[i].y + (pts[i + 1].y - pts[i].y) * t,
      };
    }
    remaining -= lengths[i];
  }
  return pts[pts.length - 1];
}

export function svgPath(pts: Array<{ x: number; y: number }>): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}
