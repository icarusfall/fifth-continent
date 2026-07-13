// Seeded PRNG (mulberry32). All randomness in the sim flows through this,
// and the generator state is carried *in* GameState. No Math.random anywhere.

export type RngState = number; // uint32

/** Hash a seed (any int) into a well-mixed initial state. */
export function seedRng(seed: number): RngState {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // Avoid the all-zero state degenerating the first few draws.
  return h === 0 ? 0x9e3779b9 : h;
}

/** Advance the generator. Returns the new state and a float in [0, 1). */
export function nextRandom(state: RngState): { state: RngState; value: number } {
  let a = (state + 0x6d2b79f5) >>> 0;
  const newState = a;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: newState, value };
}

/** Integer in [0, n). */
export function nextInt(state: RngState, n: number): { state: RngState; value: number } {
  const r = nextRandom(state);
  return { state: r.state, value: Math.floor(r.value * n) };
}
