import { TICKS_PER_HOUR } from '../sim/balance';

/** "1h40" / "25m" from a tick count. */
export function spanOf(ticks: number): string {
  const mins = ticks * (60 / TICKS_PER_HOUR);
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}
