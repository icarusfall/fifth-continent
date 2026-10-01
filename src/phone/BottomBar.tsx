// The bottom bar (clean-sheet UI pass): the thumb zone. Places opens the
// dock on a phone; the overlay cycles A → B → C with one tap (§20.2 — "the
// killer feature, and it must be one keystroke"); the speeds ride along; the
// ledger opens from here where the spine tab is too small to hit.

import { useEffect } from 'react';
import type { GameState } from '../sim/types';
import { gossipAvailable, useUiStore } from '../state/ui';
import { SpeedControls, SystemControls } from './SpeedControls';

/** What the overlay button says: the mode it is IN, briefly. */
function overlayLabel(mode: 'off' | 'a' | 'b' | 'c', telegraph: boolean): string {
  switch (mode) {
    case 'a':
      return 'yours';
    case 'b':
      return telegraph ? 'telegraph' : 'theirs';
    case 'c':
      return 'both';
    default:
      return 'overlay';
  }
}

export function BottomBar({ state }: { state: GameState }) {
  const overlay = useUiStore((s) => s.overlay);
  const cycleOverlay = useUiStore((s) => s.cycleOverlay);
  // §20.2 — "the killer feature, and it must be one keystroke": Tab cycles
  // the overlay on a desktop; the bar's button is the phone's thumb version.
  const hasGossipNow = gossipAvailable(state);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const el = document.activeElement;
      // Leave Tab alone while something focusable is actually being used.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      cycleOverlay(hasGossipNow);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cycleOverlay, hasGossipNow]);
  const ledgerOpen = useUiStore((s) => s.ledgerOpen);
  const setLedgerOpen = useUiStore((s) => s.setLedgerOpen);
  const hasGossip = gossipAvailable(state);
  const telegraph = state.research.completed.leiden >= 3;

  return (
    <div className="bottom-bar" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={overlay === 'off' ? 'bar-overlay' : 'bar-overlay on'}
        title={
          hasGossip
            ? `One control, three readings (§20.2): what you are doing (yours), what the Revenue thinks you are doing (${
                telegraph ? 'the telegraph — their mind, live' : 'theirs — yesterday’s gossip'
              }), and both at once. The gap between the two maps is the game.`
            : 'What sits where, what the town still buys, and where the walls press.'
        }
        onClick={() => cycleOverlay(hasGossip)}
      >
        {overlayLabel(overlay, telegraph)}
      </button>

      <SpeedControls />
      {/* Rare verbs: shown here on a desktop, folded into the strip on a
          phone (the bar's width belongs to the thumb's verbs). */}
      <span className="bar-system">
        <SystemControls />
      </span>

      <button
        className={ledgerOpen ? 'bar-ledger on' : 'bar-ledger'}
        title="The book the officer reads — and the one you keep."
        onClick={() => setLedgerOpen(!ledgerOpen)}
      >
        ledger
      </button>
    </div>
  );
}
