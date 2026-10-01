// §6.10 M5½f — white wool and dark wool: the books split the clip on the
// sheep's backs. Pure helpers, shared by the tick and the wights (who take
// sheep, and the wool on them, with no import of the tick).

import { SHORT_BOOKS_SHARE } from './balance';
import type { Books, GameState } from './types';

/** §6.10 M5½f — the white part of a clip: all of it square, the floor short. */
export function whiteShare(books: Books, grown: number): number {
  return books === 'square' ? grown : Math.ceil(grown * SHORT_BOOKS_SHARE);
}

/** Both colours still on the sheep. */
export function woolOnBacks(state: GameState): number {
  return state.fleeceReady + state.darkReady;
}

/** §6.10 M5½f — wool lost off the backs (a sale, a collection) goes dark first. */
export function capWoolOnBacks(state: GameState, cap: number): void {
  let excess = woolOnBacks(state) - cap;
  if (excess <= 0) return;
  const dark = Math.min(state.darkReady, excess);
  state.darkReady -= dark;
  excess -= dark;
  state.fleeceReady = Math.max(0, state.fleeceReady - excess);
}


/**
 * §6.10 M5½f — a round's wool, read aloud where the order is written: dark
 * wool whose next sale is Ryne, or white wool whose next sale is the lugger.
 * Walks forward from each wool pick-up to the first stop that deals (a store
 * in between unloads him, and the question ends there), as the forecast does.
 */
export function woolMismatches(stops: ReadonlyArray<{ at: string; take?: string }>): string[] {
  const out: string[] = [];
  stops.forEach((s, i) => {
    if (s.take !== 'fleece' && s.take !== 'dark-fleece') return;
    if (s.at === 'shingle' || s.at === 'ryne') return;
    for (let step = 1; step <= stops.length; step++) {
      const there = stops[(i + step) % stops.length].at;
      if (there === 'ryne') {
        if (s.take === 'dark-fleece') out.push('Dark wool bound for Ryne: the stapler won’t weigh it.');
        return;
      }
      if (there === 'shingle') {
        if (s.take === 'fleece') out.push('White wool bound for the lugger: every fleece shows at the audit.');
        return;
      }
      return; // a store: he unloads there
    }
  });
  return [...new Set(out)];
}
