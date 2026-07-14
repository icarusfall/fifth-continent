// Clock and tide. Pure functions of the tick counter — integer arithmetic
// only, so replay is byte-identical on any engine.

import {
  TICKS_PER_HOUR,
  TICKS_PER_DAY,
  HOURS_PER_DAY,
  TIDE_PERIOD_TICKS,
  TIDE_FLOOD_THRESHOLD,
  DAWN_HOUR,
  DAY_HOUR,
  DUSK_HOUR,
  NIGHT_HOUR,
  TIME_OF_DAY_MOD_NIGHT,
  TIME_OF_DAY_MOD_DUSK,
  TIME_OF_DAY_MOD_DAY,
} from './balance';

export interface ClockReading {
  day: number; // 1-based
  hour: number; // 0–23
  minute: number; // 0–59
}

export function clockOf(tick: number): ClockReading {
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  const tickOfDay = tick % TICKS_PER_DAY;
  const hour = Math.floor(tickOfDay / TICKS_PER_HOUR) % HOURS_PER_DAY;
  const minute = (tickOfDay % TICKS_PER_HOUR) * (60 / TICKS_PER_HOUR);
  return { day, hour, minute };
}

export type DayPhase = 'night' | 'dusk' | 'day';

export function dayPhaseOf(tick: number): DayPhase {
  const { hour } = clockOf(tick);
  if (hour >= NIGHT_HOUR || hour < DAWN_HOUR) return 'night';
  if (hour < DAY_HOUR || (hour >= DUSK_HOUR && hour < NIGHT_HOUR)) return 'dusk';
  return 'day';
}

/** Spec §6.2 — night 0.4, dusk 0.7, day 1.0. */
export function timeOfDayMod(tick: number): number {
  switch (dayPhaseOf(tick)) {
    case 'night':
      return TIME_OF_DAY_MOD_NIGHT;
    case 'dusk':
      return TIME_OF_DAY_MOD_DUSK;
    case 'day':
      return TIME_OF_DAY_MOD_DAY;
  }
}

/**
 * Tide level in [0, 1] as a triangle wave: 0 at low water, 1 at high water.
 * Integer arithmetic scaled by the period so there is no floating-point
 * drift; the returned float is an exact dyadic-free ratio of small ints.
 */
export function tideLevel(tick: number): number {
  const phase = tick % TIDE_PERIOD_TICKS;
  const half = TIDE_PERIOD_TICKS / 2;
  const distFromLow = phase <= half ? phase : TIDE_PERIOD_TICKS - phase;
  return distFromLow / half;
}

export function isFlooded(tick: number): boolean {
  return tideLevel(tick) >= TIDE_FLOOD_THRESHOLD;
}

export function tideIsRising(tick: number): boolean {
  return tick % TIDE_PERIOD_TICKS < TIDE_PERIOD_TICKS / 2;
}

/**
 * Ticks until the low road next changes state (floods if open, clears if
 * drowned). Any marsh carter knows this by heart; the player gets it too.
 */
export function ticksUntilTideTurn(tick: number): number {
  const now = isFlooded(tick);
  for (let t = 1; t <= TIDE_PERIOD_TICKS; t++) {
    if (isFlooded(tick + t) !== now) return t;
  }
  return TIDE_PERIOD_TICKS; // unreachable: the tide always turns
}
