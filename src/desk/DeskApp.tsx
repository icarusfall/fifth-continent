import './desk.css';
import { useEffect } from 'react';
import { clockOf } from '../sim/time';
import { BattlePlayback } from '../shared/BattlePlayback';
import { useGameLoop } from '../shared/useGameLoop';
import { useGameStore } from '../state/store';
import { DeskMap } from './DeskMap';
import { Dispatches, PauseCard } from './Dispatches';
import { Inspector } from './Inspector';
import { Stable } from './Stable';
import { TopBar } from './TopBar';
import { useDeskUi } from './deskUi';

// THE SMUGGLER'S TABLE (spec §20.4). The map is the table; the panels sit at
// its edges and never cover the place being acted on: the stable on the left,
// the inspector on the right, dispatches pinned at the top. No popovers.
// D1: the table and every place's verbs. D2 brings cart command on the map.
export default function DeskApp() {
  useGameLoop();
  useDeskKeys();
  const lost = useGameStore((s) => s.state.lost);
  return (
    <div className="desk">
      <TopBar />
      <main className="table">
        <DeskMap />
        <Stable />
        <Inspector />
        <Dispatches />
        <DeskLog />
      </main>
      {lost && <Forfeit />}
      <PauseCard />
      <BattlePlayback />
    </div>
  );
}

/** The keys a desk player expects: carts by number, the ledger, the clock. */
function useDeskKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      const store = useGameStore.getState();
      const ui = useDeskUi.getState();
      if (e.key >= '1' && e.key <= '9') {
        const cart = store.state.carts[Number(e.key) - 1];
        if (cart) ui.select({ kind: 'cart', id: cart.id }, true);
      } else if (e.key === 'l' || e.key === 'L') {
        ui.select(ui.selection?.kind === 'ledger' ? null : { kind: 'ledger' });
      } else if (e.key === 'Escape') {
        if (ui.placing) ui.setPlacing(false);
        else ui.select(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        store.setPaused(!store.paused);
      } else {
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The last few lines of the day, faint, in the table's corner. */
function DeskLog() {
  const log = useGameStore((s) => s.state.log);
  const recent = log.slice(-5).reverse();
  return (
    <div className="desk-log" aria-label="Recent events">
      {recent.map((e, i) => {
        const c = clockOf(e.tick);
        return (
          <p key={`${e.tick}-${i}`} style={{ opacity: 1 - i * 0.16 }}>
            <span>
              d{c.day} {String(c.hour).padStart(2, '0')}:{String(c.minute).padStart(2, '0')}
            </span>{' '}
            {e.text}
          </p>
        );
      })}
    </div>
  );
}

function Forfeit() {
  const requestNewGame = useGameStore((s) => s.requestNewGame);
  return (
    <div className="pause-scrim">
      <div className="pause-card">
        <h2>The tenancy is forfeit.</h2>
        <p>The agent’s men drove off the last of the flock at dawn. The Gault keeps no one who cannot pay.</p>
        <div className="pause-acts">
          <button className="primary" onClick={requestNewGame}>
            Begin again
          </button>
        </div>
      </div>
    </div>
  );
}
