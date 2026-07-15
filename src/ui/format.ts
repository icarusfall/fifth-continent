import { TICKS_PER_HOUR } from '../sim/balance';
import type { Good, Store } from '../sim/types';

/** "1h40" / "25m" from a tick count. */
export function spanOf(ticks: number): string {
  const mins = ticks * (60 / TICKS_PER_HOUR);
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}m`;
}

/** How the goods read in menus and the log. */
export const GOOD_LABEL: Record<Good, string> = {
  fleece: 'fleece',
  jenever: 'tubs of jenever',
  tea: 'bohea tea',
  lace: 'lace',
  'brandy-rough': 'rough brandy',
  'brandy-fair': 'fair brandy',
  'brandy-gent': "gentleman's brandy",
};

/** "8 fleece, 2 tubs of jenever" — empty stores read as given. */
export function storeSummary(store: Store, empty = 'Empty'): string {
  const parts = (Object.entries(store) as Array<[Good, number]>)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => `${n} ${GOOD_LABEL[g]}`);
  return parts.length > 0 ? parts.join(', ') : empty;
}
