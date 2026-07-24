import { TICKS_PER_HOUR } from '../sim/balance';
import { GOOD_LABEL, goodsSummary } from '../sim/revenue';
import type { Store } from '../sim/types';

/** "1h40" / "25m" from a tick count. */
export function spanOf(ticks: number): string {
  const mins = ticks * (60 / TICKS_PER_HOUR);
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}

// The goods' names live sim-side now (§6.10 — seizures name what they take);
// the UI re-exports them so every menu and log speaks the same words.
export { GOOD_LABEL };

/** "8 fleece, 2 tubs of jenever" — empty stores read as given. */
export function storeSummary(store: Store, empty = 'Empty'): string {
  const summary = goodsSummary(store);
  return summary.length > 0 ? summary : empty;
}
