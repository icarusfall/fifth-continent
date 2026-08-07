// Test-harness pacing only — never imported by the sim. The 200-seeded-game
// suites (house rule 5) run tens of seconds of fully synchronous tick() work
// inside a single it(), which starves the worker's event loop: vitest's RPC
// heartbeat ("Timeout calling onTaskUpdate") times out and fails the run at
// exit even though every assertion passed. Yielding to the event loop once
// every few games lets the heartbeat answer. Nothing about the games changes
// — the sim stays pure and the seeds land exactly where they always did.

const EVERY = 10;

/** Await this at the top of a seeded-game loop body. */
export async function breathe(seed: number): Promise<void> {
  if (seed % EVERY === 0) await new Promise<void>((resolve) => setImmediate(resolve));
}
