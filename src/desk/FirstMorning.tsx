// The first morning on the desk (§10 — the tutorial is the story): one
// pointing sentence pinned at the head of the table, and a ring on the map
// where it points. It never pauses, and it is gone for good at the first sale.
// The thread itself is the phone's (src/shared/firstMorning.ts); only the
// words that name a gesture are the desk's — on the desk you click the cart.

import { firstMorningHint, type FirstMorningHint } from '../shared/firstMorning';
import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';
import type { DeskSelection } from './sheet';

const DESK_WORDS: Record<string, string> = {
  'Ryne pays coin for wool. Send the cart.': 'Ryne pays coin for wool. Click the cart, then its road to Ryne.',
  'The stalls are open. Sell the clip.': 'The stalls are open. Click the cart, and sell the clip.',
  'The clip is in the barn. The cart in the yard will carry it.': 'The clip is in the barn. Click the cart in the yard, and load it.',
};

export function hintTarget(h: FirstMorningHint): DeskSelection {
  return h.sel.startsWith('cart:') ? { kind: 'cart', id: h.sel.slice(5) } : { kind: 'place', id: h.sel };
}

export function FirstMorning() {
  const state = useGameStore((s) => s.state);
  const hint = firstMorningHint(state);
  const select = useDeskUi((s) => s.select);
  if (!hint) return null;
  return (
    <button className="first-morning" onClick={() => select(hintTarget(hint), true)} title="Show me">
      <b aria-hidden="true">☞</b>
      {DESK_WORDS[hint.text] ?? hint.text}
    </button>
  );
}
