import { describe, expect, it } from 'vitest';
import { EDGES, MAP_HEIGHT, MAP_WIDTH, NODES, TERRAIN, nodeById, otherEnd } from '../map';

describe('the Gault (hand-authored map)', () => {
  it('is exactly 40×30 tiles', () => {
    expect(TERRAIN.length).toBe(MAP_HEIGHT);
    TERRAIN.forEach((row, y) => {
      expect(row.length, `row ${y} has length ${row.length}`).toBe(MAP_WIDTH);
    });
  });

  it('uses only legend characters', () => {
    const legend = new Set(['c', '.', 'p', 'f', 'd', 't', 's', '~']);
    for (const row of TERRAIN) {
      for (const ch of row) expect(legend.has(ch), `unknown tile '${ch}'`).toBe(true);
    }
  });

  it('places every node on dry land inside the map', () => {
    for (const node of NODES) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(MAP_WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThan(MAP_HEIGHT);
      const tile = TERRAIN[node.y][node.x];
      expect(tile, `${node.id} sits on '${tile}'`).not.toBe('~');
    }
  });

  it('every edge connects two real nodes and its path spans them', () => {
    for (const edge of EDGES) {
      const a = nodeById(edge.a);
      const b = nodeById(edge.b);
      const first = edge.path[0];
      const last = edge.path[edge.path.length - 1];
      expect({ x: a.x, y: a.y }).toEqual(first);
      expect({ x: b.x, y: b.y }).toEqual(last);
      expect(edge.latency).toBeGreaterThan(0);
    }
  });

  it('the low road is tide-locked and faster than the high road', () => {
    const low = EDGES.find((e) => e.id === 'low-road')!;
    const high = EDGES.find((e) => e.id === 'high-road')!;
    expect(low.condition).toBe('tideLocked');
    expect(high.condition).toBe('open');
    expect(low.latency).toBeLessThan(high.latency);
    // The high road passes the Customs House: more exposed. (Consumed in M3.)
    expect(high.exposure).toBeGreaterThan(low.exposure);
  });

  it('otherEnd traverses both directions and rejects strangers', () => {
    const low = EDGES.find((e) => e.id === 'low-road')!;
    expect(otherEnd(low, 'farm')).toBe('ryne');
    expect(otherEnd(low, 'ryne')).toBe('farm');
    expect(() => otherEnd(low, 'customs')).toThrow();
  });
});
