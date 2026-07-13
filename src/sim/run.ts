// Headless game runner. A full game is (seed, actionLog) and nothing else.

import { initialState, tick } from './tick';
import type { ActionLog, GameState } from './types';

/** Run `ticks` ticks from a fresh seed, applying actionLog[t] at tick t. */
export function runGame(seed: number, actionLog: ActionLog, ticks: number): GameState {
  let state = initialState(seed);
  for (let t = 0; t < ticks; t++) {
    state = tick(state, actionLog[state.tick] ?? []);
  }
  return state;
}

/** Canonical serialisation — used for saves and byte-identity checks. */
export function serialise(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialise(json: string): GameState {
  return JSON.parse(json) as GameState;
}
