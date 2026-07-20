// Drives the sim clock from real time. This is the only place wall-clock
// time exists — it decides *when* to call step(), never *what* happens.

import { useEffect } from 'react';
import { useGameStore } from '../state/store';

// §6.9 (playtest) — the vigil's pace: the hours run while waiting for the
// lugger, then the clock is handed back at the speed it was set to.
const WAIT_TICKS_PER_SECOND = 90;

export function useGameLoop(): void {
  const paused = useGameStore((s) => s.paused);
  const ticksPerSecond = useGameStore((s) => s.ticksPerSecond);
  const waiting = useGameStore((s) => s.waitingForLugger);
  // A pending event card or a battle in progress freezes the world (§6.13/§14).
  const cardUp = useGameStore((s) => s.activeCard !== null);
  const battleUp = useGameStore((s) => s.battle !== null);

  useEffect(() => {
    if (paused || cardUp || battleUp) return;
    const tps = waiting ? WAIT_TICKS_PER_SECOND : ticksPerSecond;
    const interval = window.setInterval(() => useGameStore.getState().step(), 1000 / tps);
    return () => window.clearInterval(interval);
  }, [paused, cardUp, battleUp, ticksPerSecond, waiting]);
}
