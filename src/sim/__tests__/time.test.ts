import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TIDE_FLOOD_THRESHOLD,
  TIDE_PERIOD_TICKS,
  TIME_OF_DAY_MOD_DAY,
  TIME_OF_DAY_MOD_DUSK,
  TIME_OF_DAY_MOD_NIGHT,
} from '../balance';
import { clockOf, dayPhaseOf, isFlooded, tideLevel, timeOfDayMod } from '../time';

describe('clock', () => {
  it('starts at day 1, 00:00', () => {
    expect(clockOf(0)).toEqual({ day: 1, hour: 0, minute: 0 });
  });

  it('rolls over days', () => {
    expect(clockOf(TICKS_PER_DAY)).toEqual({ day: 2, hour: 0, minute: 0 });
    expect(clockOf(TICKS_PER_DAY - 1).day).toBe(1);
  });

  it('reads hours and minutes', () => {
    expect(clockOf(TICKS_PER_HOUR * 13 + 3)).toEqual({ day: 1, hour: 13, minute: 30 });
  });
});

describe('time-of-day modifier (spec §6.2)', () => {
  const atHour = (h: number) => h * TICKS_PER_HOUR;

  it('night is 0.4', () => {
    expect(timeOfDayMod(atHour(23))).toBe(TIME_OF_DAY_MOD_NIGHT);
    expect(timeOfDayMod(atHour(2))).toBe(TIME_OF_DAY_MOD_NIGHT);
    expect(TIME_OF_DAY_MOD_NIGHT).toBe(0.4);
  });

  it('dusk and dawn half-light are 0.7', () => {
    expect(timeOfDayMod(atHour(5))).toBe(TIME_OF_DAY_MOD_DUSK);
    expect(timeOfDayMod(atHour(19))).toBe(TIME_OF_DAY_MOD_DUSK);
    expect(TIME_OF_DAY_MOD_DUSK).toBe(0.7);
  });

  it('day is 1.0', () => {
    expect(timeOfDayMod(atHour(12))).toBe(TIME_OF_DAY_MOD_DAY);
    expect(TIME_OF_DAY_MOD_DAY).toBe(1.0);
  });

  it('covers every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      expect(['night', 'dusk', 'day']).toContain(dayPhaseOf(atHour(h)));
    }
  });
});

describe('tide', () => {
  it('is low at phase 0 and high at half period', () => {
    expect(tideLevel(0)).toBe(0);
    expect(tideLevel(TIDE_PERIOD_TICKS / 2)).toBe(1);
  });

  it('is periodic', () => {
    for (let t = 0; t < TIDE_PERIOD_TICKS; t++) {
      expect(tideLevel(t)).toBe(tideLevel(t + TIDE_PERIOD_TICKS * 3));
    }
  });

  it('is symmetric rising and falling', () => {
    expect(tideLevel(10)).toBe(tideLevel(TIDE_PERIOD_TICKS - 10));
  });

  it('floods exactly when level crosses the threshold', () => {
    for (let t = 0; t < TIDE_PERIOD_TICKS * 2; t++) {
      expect(isFlooded(t)).toBe(tideLevel(t) >= TIDE_FLOOD_THRESHOLD);
    }
  });

  it('game starts at low water — the low road is open at tick 0', () => {
    expect(isFlooded(0)).toBe(false);
  });

  it('floods for part of every cycle', () => {
    const floodedTicks = Array.from({ length: TIDE_PERIOD_TICKS }, (_, t) => isFlooded(t)).filter(
      Boolean,
    ).length;
    expect(floodedTicks).toBeGreaterThan(0);
    expect(floodedTicks).toBeLessThan(TIDE_PERIOD_TICKS / 2);
  });
});
