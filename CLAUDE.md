# The Fifth Continent — working rules

Read [the-fifth-continent-spec.md](./the-fifth-continent-spec.md) before
changing anything. It is the source of truth. Current milestone status lives
in README.md.

## House rules (from spec §13 — enforced, not aspirational)

1. **Sim purity is sacred.** `/src/sim` never imports React, the DOM, or audio.
   `tick(state, actions)` is pure: no `Date.now()`, no `Math.random()` — use
   the seeded PRNG in `state.rngState` via `src/sim/rng.ts`.
2. **GameState stays JSON-plain** (no Map/Set/Date/class instances). Saves and
   the replay test depend on byte-identical `JSON.stringify` round-trips.
3. **Balance numbers only in `src/sim/balance.ts`.** Never inline.
4. No feature without a formula in the spec — update the spec first.
5. Every formula gets a Vitest unit test; every new mechanic ships with a
   headless test playing 200 seeded games (`src/sim/__tests__/distribution.test.ts`
   is the pattern).
6. Nothing in the game states a date.
7. Reserved palette colours (Revenue blue `#2E4A6B`, Ichor green `#6FBF8F`,
   Phlogiston orange `#E09B3D`) must not appear until their owners enter the
   game — declared in `src/ui/palette.ts`.

## Commands

- `npm test` — full suite; must be green before any commit.
- `npm run headless [seed] [days]` — scripted-policy game in Node.
- `npm run dev` / `npm run build` — Vite.

## Milestones

Build strictly in spec §12 order (M1 cart → M2 crime → M3 revenue → M4 force →
M5 trees → M6 endings). **Stop at each milestone for review.** Do not build
ahead, even when the spec makes the next step obvious.
