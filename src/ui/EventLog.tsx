// The log (§20, stage 6): a floating recent-history card on a desktop; on a
// phone it folds to a one-line ticker — the map must never sit under a text
// box — and the ticker opens the full history as a sheet.

import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';
import { useUiStore } from '../state/ui';
import { Sheet, useIsPhone } from './Sheet';

function stamp(tick: number): string {
  const c = clockOf(tick);
  return `d${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

export function EventLog({ state }: { state: GameState }) {
  const isPhone = useIsPhone();
  const logOpen = useUiStore((s) => s.logOpen);
  const setLogOpen = useUiStore((s) => s.setLogOpen);

  if (isPhone) {
    const last = state.log[state.log.length - 1];
    return (
      <>
        {last && !logOpen && (
          <button
            className="log-ticker"
            title="The day's talk — tap for the whole history."
            onClick={() => setLogOpen(true)}
          >
            <span className="event-time">{stamp(last.tick)}</span> {last.text}
          </button>
        )}
        {logOpen && (
          <Sheet onClose={() => setLogOpen(false)}>
            <h4>The day&rsquo;s talk</h4>
            <div className="event-log in-sheet">
              {state.log
                .slice(-40)
                .reverse()
                .map((e, i) => (
                  <div key={`${e.tick}-${i}`} className="event">
                    <span className="event-time">{stamp(e.tick)}</span> {e.text}
                  </div>
                ))}
            </div>
          </Sheet>
        )}
      </>
    );
  }

  const recent = state.log.slice(-9).reverse();
  return (
    <div className="event-log">
      {recent.map((e, i) => (
        <div key={`${e.tick}-${i}`} className="event" style={{ opacity: 1 - i * 0.09 }}>
          <span className="event-time">{stamp(e.tick)}</span> {e.text}
        </div>
      ))}
    </div>
  );
}
