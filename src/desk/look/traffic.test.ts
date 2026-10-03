import { describe, expect, it } from 'vitest';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../sim/balance';
import { TILE } from '../../shared/geometry';
import { coachAt, COACH_ARRIVES, COACH_GONE, COACH_LEAVES, COACH_RETURNS, SmoothClock } from './traffic';

const at = (h: number, day = 3) => coachAt(day * TICKS_PER_DAY + h * TICKS_PER_HOUR);

describe('the mail coach (spec §20.4, D6b)', () => {
  it('is off the map at night and in the early morning', () => {
    expect(at(2)).toBeNull();
    expect(at(COACH_LEAVES - 0.2)).toBeNull();
    expect(at(COACH_GONE + 0.2)).toBeNull();
  });

  it('comes from beyond the north edge and stands in Ryne through the early afternoon', () => {
    expect(at(COACH_LEAVES + 0.05)!.y).toBeLessThan(0);
    const standing = at((COACH_ARRIVES + COACH_RETURNS) / 2)!;
    expect(standing.moving).toBe(false);
    expect(Math.round(standing.x / TILE)).toBe(28);
    expect(Math.round(standing.y / TILE)).toBe(21);
  });

  it('halts at the toll gate on the way down', () => {
    let halted = false;
    for (let h = COACH_LEAVES; h < COACH_ARRIVES; h += 1 / 60) {
      const c = at(h)!;
      if (!c.moving && c.y < 3 * TILE && c.y > 0) halted = true;
    }
    expect(halted).toBe(true);
  });

  it('the smooth clock eases between ticks and holds when paused', () => {
    const k = new SmoothClock();
    expect(k.at(10, 0, 2, false)).toBe(10);
    expect(k.at(10, 0.25, 2, false)).toBeCloseTo(10.5);
    expect(k.at(10, 5, 2, false)).toBe(11);
    expect(k.at(10, 5, 2, true)).toBe(10);
  });
});
