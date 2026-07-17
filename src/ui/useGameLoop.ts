// Drives the sim clock from real time. This is the only place wall-clock
// time exists — it decides *when* to call step(), never *what* happens.

import { useEffect } from 'react';
import { useGameStore } from '../state/store';

export function useGameLoop(): void {
  const paused = useGameStore((s) => s.paused);
  const ticksPerSecond = useGameStore((s) => s.ticksPerSecond);
  // A pending event card or a battle in progress freezes the world (§6.13/§14).
  const cardUp = useGameStore((s) => s.activeCard !== null);
  const battleUp = useGameStore((s) => s.battle !== null);

  useEffect(() => {
    if (paused || cardUp || battleUp) return;
    const interval = window.setInterval(
      () => useGameStore.getState().step(),
      1000 / ticksPerSecond,
    );
    return () => window.clearInterval(interval);
  }, [paused, cardUp, ticksPerSecond]);
}
