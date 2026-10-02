import { describe, expect, it } from 'vitest';
import { DAWN_HOUR, DAY_HOUR, DUSK_HOUR, NIGHT_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../sim/balance';
import { darknessAt, duskAt } from './light';

const at = (hour: number) => TICKS_PER_DAY * 3 + Math.round(hour * TICKS_PER_HOUR);

describe('the desk’s light follows the game’s own day (spec §20.4, D4)', () => {
  it('is full dark through the night and none at noon', () => {
    expect(darknessAt(at(0))).toBe(1);
    expect(darknessAt(at(NIGHT_HOUR))).toBe(1);
    expect(darknessAt(at(12))).toBe(0);
  });

  it('eases in across the dusk and out across the dawn, never jumping', () => {
    let prev = 0;
    for (let h = DUSK_HOUR; h <= NIGHT_HOUR; h += 1 / 6) {
      const d = darknessAt(at(h));
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(d - prev).toBeLessThan(0.2);
      prev = d;
    }
    prev = 1;
    for (let h = DAWN_HOUR; h <= DAY_HOUR; h += 1 / 6) {
      const d = darknessAt(at(h));
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });

  it('warms at dusk and dawn, and not at noon or midnight', () => {
    expect(duskAt(at((DUSK_HOUR + NIGHT_HOUR) / 2))).toBeGreaterThan(0.9);
    expect(duskAt(at((DAWN_HOUR + DAY_HOUR) / 2))).toBeGreaterThan(0.9);
    expect(duskAt(at(12))).toBe(0);
    expect(duskAt(at(1))).toBe(0);
  });
});
