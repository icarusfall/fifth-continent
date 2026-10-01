import { useEffect, useState } from 'react';
import { useGameStore } from '../state/store';

/** Save and start-over: rare verbs. They ride beside the speeds on a desktop
 *  and retreat into the strip's fold on a phone, where the bar's width is
 *  spent on the verbs a thumb actually reaches for. */
export function SystemControls() {
  const save = useGameStore((s) => s.save);
  const requestNewGame = useGameStore((s) => s.requestNewGame);
  // Two-click confirm for New Game — no blocking window.confirm.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <span className="system-controls">
      <button onClick={save} title="Save the game">
        ⬇
      </button>
      <button
        className={armed ? 'danger' : ''}
        title={armed ? 'Click again to abandon this game' : 'Start over'}
        onClick={() => {
          if (armed) {
            requestNewGame();
            setArmed(false);
          } else {
            setArmed(true);
          }
        }}
      >
        {armed ? 'Sure?' : '↺'}
      </button>
    </span>
  );
}

export function SpeedControls() {
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const speed = useGameStore((s) => s.ticksPerSecond);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const waiting = useGameStore((s) => s.waitingForLugger);
  const setWaiting = useGameStore((s) => s.setWaitingForLugger);

  return (
    <div className="speed-controls">
      <button onClick={() => setPaused(!paused)}>{paused ? '▶' : '⏸'}</button>
      {/* M5½ playtest — an amble below the old slowest: the marsh rewards
          being read, and the old floor still hurried the reader. */}
      {(
        [
          [1, '▷', 'An amble — a day in about two and a half minutes'],
          [3, '▶', 'A walk — a day in under a minute'],
          [10, '▶▶', 'A trot'],
          [30, '▶▶▶', 'A gallop'],
        ] as Array<[number, string, string]>
      ).map(([tps, glyph, title]) => (
        <button
          key={tps}
          className={speed === tps && !paused && !waiting ? 'active' : ''}
          title={title}
          onClick={() => {
            setSpeed(tps);
            setPaused(false);
          }}
        >
          {glyph}
        </button>
      ))}
      {waiting && (
        <button
          className="active"
          title="Waiting on the lugger — the hours run. Click to call it off."
          onClick={() => setWaiting(false)}
        >
          ☾…
        </button>
      )}
    </div>
  );
}
