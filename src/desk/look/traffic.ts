// The world beyond the marsh (spec §20.4, D6b): the mail coach from the City.
// Every day it comes down the turnpike from Applesham, pays at the toll gate,
// takes the high road past the Customs House into Ryne, stands in the square
// through the early afternoon, and goes home before dusk. It carries nothing
// of yours and nobody stops it; it is there to say that the road north leads
// to people with more authority than an officer on a horse. It runs on the
// game's clock, so it halts when the game is paused. Pure UI.

import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../sim/balance';
import { TILE } from '../../shared/geometry';

/** The coach's road, in tiles: down the turnpike, then the high road to Ryne. */
const ROAD: Array<[number, number]> = [
  [18, -14], [17.4, -6], [17.6, -0.5], [17.1, 1.6], [17.3, 3.5], [17, 5.1],
  [22, 5], [26, 8], [26, 19], [27, 20], [28.3, 21.2],
];
const TOLL_AT: [number, number] = [17.2, 1.1]; // the coach body, so the horses stand at the bar

/** Hours of the game day. */
export const COACH_LEAVES = 9.5;
export const COACH_ARRIVES = 12.5;
export const COACH_RETURNS = 15;
export const COACH_GONE = 18;
const TOLL_STOP_H = 1 / 6;

const segLen = ROAD.slice(1).map((p, i) => Math.hypot(p[0] - ROAD[i][0], p[1] - ROAD[i][1]));
const TOTAL = segLen.reduce((a, b) => a + b, 0);
const TOLL_D = (() => {
  // the distance along the road at which the gate bar stands
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 0; i < segLen.length; i++) {
    const [ax, ay] = ROAD[i];
    const [bx, by] = ROAD[i + 1];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const d = Math.hypot(ax + (bx - ax) * t - TOLL_AT[0], ay + (by - ay) * t - TOLL_AT[1]);
      if (d < best) {
        best = d;
        at = acc + segLen[i] * t;
      }
    }
    acc += segLen[i];
  }
  return at;
})();

function pointAt(d: number): { x: number; y: number; angle: number } {
  let rest = Math.max(0, Math.min(TOTAL, d));
  for (let i = 0; i < segLen.length; i++) {
    if (rest <= segLen[i] || i === segLen.length - 1) {
      const [ax, ay] = ROAD[i];
      const [bx, by] = ROAD[i + 1];
      const t = Math.min(1, rest / segLen[i]);
      return { x: (ax + (bx - ax) * t) * TILE, y: (ay + (by - ay) * t) * TILE, angle: Math.atan2(by - ay, bx - ax) };
    }
    rest -= segLen[i];
  }
  return { x: ROAD[0][0] * TILE, y: ROAD[0][1] * TILE, angle: 0 };
}

/** Distance along the road after `h` hours on the move, a toll stop included. */
function travelled(h: number, hours: number): number {
  const speed = TOTAL / (hours - TOLL_STOP_H);
  const reach = TOLL_D / speed;
  if (h < reach) return h * speed;
  if (h < reach + TOLL_STOP_H) return TOLL_D;
  return Math.min(TOTAL, (h - TOLL_STOP_H) * speed);
}

export interface Coach {
  x: number;
  y: number;
  angle: number;
  moving: boolean;
}

/** Where the coach is at a (fractional) tick, or null when it is off the map. */
export function coachAt(tick: number): Coach | null {
  const h = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_HOUR;
  if (h >= COACH_LEAVES && h < COACH_ARRIVES) {
    const d = travelled(h - COACH_LEAVES, COACH_ARRIVES - COACH_LEAVES);
    const p = pointAt(d);
    return { ...p, moving: d !== TOLL_D && d < TOTAL };
  }
  if (h >= COACH_ARRIVES && h < COACH_RETURNS) {
    const p = pointAt(TOTAL);
    return { ...p, angle: Math.PI * 0.75, moving: false };
  }
  if (h >= COACH_RETURNS && h < COACH_GONE) {
    // home the same way: the toll is paid going north too
    const d = TOTAL - travelled(h - COACH_RETURNS, COACH_GONE - COACH_RETURNS);
    const p = pointAt(d);
    return { ...p, angle: p.angle + Math.PI, moving: d !== TOLL_D && d > 0 };
  }
  return null;
}

/**
 * A fractional tick for smooth motion between the sim's ten-minute steps:
 * eased from the moment the tick last changed, at the store's pace.
 */
export class SmoothClock {
  private tick = -1;
  private since = 0;

  at(tick: number, now: number, ticksPerSecond: number, paused: boolean): number {
    if (tick !== this.tick) {
      this.tick = tick;
      this.since = now;
    }
    if (paused || ticksPerSecond <= 0) return tick;
    return tick + Math.min(1, (now - this.since) * ticksPerSecond);
  }
}
