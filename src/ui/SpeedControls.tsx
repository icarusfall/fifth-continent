import { useEffect, useState } from 'react';
import { useGameStore } from '../state/store';

export function SpeedControls() {
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const speed = useGameStore((s) => s.ticksPerSecond);
  const setSpeed = useGameStore((s) => s.setSpeed);
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
    <div className="speed-controls">
      <button onClick={() => setPaused(!paused)}>{paused ? '▶' : '⏸'}</button>
      {[3, 10, 30].map((tps, i) => (
        <button
          key={tps}
          className={speed === tps && !paused ? 'active' : ''}
          onClick={() => {
            setSpeed(tps);
            setPaused(false);
          }}
        >
          {'▶'.repeat(i + 1)}
        </button>
      ))}
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
    </div>
  );
}
