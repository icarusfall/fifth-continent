import { describe, expect, it } from 'vitest';
import { HIGH_ROAD_TICKS_PER_TILE, LOW_ROAD_TICKS_PER_TILE } from '../balance';
import {
  FARM_SITE,
  MAP_HEIGHT,
  MAP_WIDTH,
  TERRAIN,
  edgesFor,
  isPlaceable,
  nodeById,
  nodesFor,
  otherEnd,
  pathTileLength,
  roadLatency,
} from '../map';

const SITE = { x: 8, y: 11 };

describe('the Gault (hand-authored map)', () => {
  it('is exactly 40×30 tiles', () => {
    expect(TERRAIN.length).toBe(MAP_HEIGHT);
    TERRAIN.forEach((row, y) => {
      expect(row.length, `row ${y} has length ${row.length}`).toBe(MAP_WIDTH);
    });
  });

  it('uses only legend characters', () => {
    const legend = new Set(['c', '.', 'd', 't', 's', '~']);
    for (const row of TERRAIN) {
      for (const ch of row) expect(legend.has(ch), `unknown tile '${ch}'`).toBe(true);
    }
  });

  it('places every node on dry land inside the map', () => {
    for (const node of nodesFor(FARM_SITE)) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThan(MAP_WIDTH);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThan(MAP_HEIGHT);
      const tile = TERRAIN[node.y][node.x];
      expect(tile, `${node.id} sits on '${tile}'`).not.toBe('~');
    }
  });
});

describe('the farm site and buildable ground', () => {
  it('Walland Farm sits on open marsh', () => {
    expect(FARM_SITE).toEqual(SITE);
    expect(isPlaceable(FARM_SITE.x, FARM_SITE.y)).toBe(true);
  });

  it('buildable ground is marsh and nothing else (M2+ buildings site through this)', () => {
    expect(isPlaceable(8, 11)).toBe(true); // open marsh
    expect(isPlaceable(2, 1)).toBe(false); // clay upland
    expect(isPlaceable(38, 10)).toBe(false); // the sea
    expect(isPlaceable(28, 22)).toBe(false); // Ryne
    expect(isPlaceable(5, 17)).toBe(false); // a dyke
    expect(isPlaceable(-1, 5)).toBe(false); // off the map
    expect(isPlaceable(5, 400)).toBe(false); // off the map
  });

  it('the farm node and both roads exist at the site', () => {
    expect(nodeById('farm', SITE)).toMatchObject({ kind: 'farm', ...SITE });
    expect(edgesFor(SITE).map((e) => e.id).sort()).toEqual(['high-road', 'low-road']);
  });
});

describe('roads', () => {
  const edges = edgesFor(SITE);
  const low = edges.find((e) => e.id === 'low-road')!;
  const high = edges.find((e) => e.id === 'high-road')!;

  it('every edge connects two real nodes and its path spans them', () => {
    for (const edge of edges) {
      const a = nodeById(edge.a, SITE);
      const b = nodeById(edge.b, SITE);
      expect({ x: a.x, y: a.y }).toEqual(edge.path[0]);
      expect({ x: b.x, y: b.y }).toEqual(edge.path[edge.path.length - 1]);
      expect(edge.latency).toBeGreaterThan(0);
    }
  });

  it('derives latency from path length (spec §6.7)', () => {
    expect(low.latency).toBe(roadLatency(low.path, LOW_ROAD_TICKS_PER_TILE));
    expect(high.latency).toBe(
      Math.max(1, Math.round(pathTileLength(high.path) * HIGH_ROAD_TICKS_PER_TILE)),
    );
  });

  it('keeps the canonical latencies at the bot’s site (8, 11)', () => {
    // These are the tuned M1 values; if a waypoint edit moves them, notice.
    expect(low.latency).toBe(8);
    expect(high.latency).toBe(20);
  });

  it('a farm sited farther away takes longer to reach Ryne', () => {
    const far = edgesFor({ x: 2, y: 6 });
    expect(far.find((e) => e.id === 'low-road')!.latency).toBeGreaterThan(low.latency);
  });

  it('the low road is tide-locked and faster than the high road', () => {
    expect(low.condition).toBe('tideLocked');
    expect(high.condition).toBe('open');
    expect(low.latency).toBeLessThan(high.latency);
    // The high road passes the Customs House: more exposed. (Consumed in M3.)
    expect(high.exposure).toBeGreaterThan(low.exposure);
  });

  it('otherEnd traverses both directions and rejects strangers', () => {
    expect(otherEnd(low, 'farm')).toBe('ryne');
    expect(otherEnd(low, 'ryne')).toBe('farm');
    expect(() => otherEnd(low, 'customs')).toThrow();
  });
});
