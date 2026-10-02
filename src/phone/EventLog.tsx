// The log (§20, stage 6): a floating recent-history card on a desktop; on a
// phone it folds to a one-line ticker — the map must never sit under a text
// box — and the ticker opens the full history as a sheet.

import { clockOf } from '../sim/time';
import type { GameState } from '../sim/types';
import { useUiStore } from '../state/ui';
import { Sheet, useIsPhone } from './Sheet';
import { firstMorningHint } from '../shared/firstMorning';

function stamp(tick: number): string {
  const c = clockOf(tick);
  return `d${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

/** §10 (the first morning) — the pointing sentence: one line that names the
 *  next thing the marsh expects, and eases the camera there when tapped.
 *  Rendered wherever the log lives; gone for good at the first sale. */
function HintLine({ state }: { state: GameState }) {
  const requestFocus = useUiStore((s) => s.requestFocus);
  const hint = firstMorningHint(state);
  if (!hint) return null;
  return (
    // The manicule: the period's own pointing hand, doing its period job.
    <button className="hint-line" onClick={() => requestFocus(hint.sel)}>
      <span className="hint-hand">☞</span> {hint.text}
    </button>
  );
}

export function EventLog({ state }: { state: GameState }) {
  const isPhone = useIsPhone();
  const logOpen = useUiStore((s) => s.logOpen);
  const setLogOpen = useUiStore((s) => s.setLogOpen);
  const hint = firstMorningHint(state);

  if (isPhone) {
    const last = state.log[state.log.length - 1];
    return (
      <>
        {/* The first morning owns the ticker's spot: the thread points, the
            history waits. Both never show at once. */}
        {hint && !logOpen && <HintLine state={state} />}
        {last && !logOpen && !hint && (
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
    <>
      <HintLine state={state} />
      <div className="event-log">
        {recent.map((e, i) => (
          <div key={`${e.tick}-${i}`} className="event" style={{ opacity: 1 - i * 0.09 }}>
            <span className="event-time">{stamp(e.tick)}</span> {e.text}
          </div>
        ))}
      </div>
    </>
  );
}
