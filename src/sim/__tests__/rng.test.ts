import { describe, expect, it } from 'vitest';
import { nextInt, nextRandom, seedRng } from '../rng';

describe('seeded PRNG', () => {
  it('is deterministic for a given seed', () => {
    let a = seedRng(42);
    let b = seedRng(42);
    for (let i = 0; i < 100; i++) {
      const ra = nextRandom(a);
      const rb = nextRandom(b);
      expect(ra.value).toBe(rb.value);
      expect(ra.state).toBe(rb.state);
      a = ra.state;
      b = rb.state;
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = nextRandom(seedRng(1));
    const b = nextRandom(seedRng(2));
    expect(a.value).not.toBe(b.value);
  });

  it('yields values in [0, 1)', () => {
    let s = seedRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = nextRandom(s);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(1);
      s = r.state;
    }
  });

  it('nextInt stays in range', () => {
    let s = seedRng(99);
    for (let i = 0; i < 1000; i++) {
      const r = nextInt(s, 6);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(6);
      s = r.state;
    }
  });

  it('never produces a zero initial state', () => {
    expect(seedRng(0)).not.toBe(0);
  });
});
