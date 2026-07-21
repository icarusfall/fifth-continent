// Spec §6.14 (M5b) — the wight. The marsh notices being used; a sign appears
// near the most-used night crossing; trapping it with iron and staked sheep
// binds a wight at dawn, deterministically. Debt accrues with every use of
// marsh power, never decays, and is forgiven only in sheep and people. When
// Debt outruns the bindings, the wights collect — no muster, no Calls, no
// battle (§9: force is useless here). The person is simply gone at dawn.
//
// Pure functions of GameState, like revenue.ts: no dice, no clocks.

import {
  BINDING_CAPACITY,
  COLLECTION_GRACE_DAYS,
  DIFFICULTY,
  MARSH_TICKS_PER_TILE,
  MAX_LOG_EVENTS,
  NIGHT_MARSH_UNITS,
  PERSON_DEBT,
  SIGN_RECURRENCE_DAYS,
  TICKS_PER_DAY,
  TRIBUTE_RELIEF,
  WIGHT_TRAP_IRON,
} from './balance';
import { edgesFor, isPlaceable, nodeById } from './map';
import { collectLeiden } from './leiden';
import { dayPhaseOf } from './time';
import type { Cart, EdgeId, GameEvent, GameState, MapEdge } from './types';

function logEvent(state: GameState, text: string): void {
  state.log.push({ tick: state.tick, text } satisfies GameEvent);
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

/** The marsh's own roads: the tracks with no engineering under them. */
export function isMarshEdge(edge: MapEdge): boolean {
  return edge.id === 'marsh-track' || edge.id.startsWith('cut-');
}

/** Bindings: the Debt the bound wights will carry before they collect. */
export function bindingsOf(state: GameState): number {
  return state.boundWights * BINDING_CAPACITY;
}

/** The bait the next trap wants: it rises with each binding — the flock pays. */
export function nextBait(state: GameState): number {
  return state.boundWights + 1;
}

/**
 * §6.14 / §6.15 — every Debt accrual passes this funnel: the dial scales what
 * the marsh does to you, never what your own economy yields.
 */
export function addDebt(state: GameState, amount: number): void {
  if (amount <= 0) return;
  state.debt += amount * DIFFICULTY[state.difficulty].debtMult;
}

/**
 * One tick of a laden cart on a marsh edge at night: the marsh notices.
 * Unit-tiles ≈ units × tiles traversed this tick. Called from moveCarts.
 */
export function accrueNightMarsh(state: GameState, cart: Cart, edge: MapEdge): void {
  if (!isMarshEdge(edge) || dayPhaseOf(state.tick) !== 'night') return;
  const units = Object.values(cart.cargo).reduce((a, b) => a + (b ?? 0), 0);
  if (units <= 0) return;
  const tilesThisTick = 1 / MARSH_TICKS_PER_TILE;
  state.wights.nightUnits += units * tilesThisTick;
  state.wights.nightUnitsByEdge[edge.id] =
    (state.wights.nightUnitsByEdge[edge.id] ?? 0) + units * tilesThisTick;
}

/** A tile something already stands on: the stone, a building. A sign never
 *  rises there — co-located, its click target shadowed the stone's menu. */
function signSiteTaken(state: GameState, x: number, y: number): boolean {
  const standing = [state.wights.stone, state.cuttingHouse, state.farm];
  return standing.some((s) => s !== null && s.x === x && s.y === y);
}

/** The deep-marsh tile the sign stands on: just off the midpoint of the
 *  most-used night crossing, snapped to open marsh where possible. */
function signSite(state: GameState): { x: number; y: number } {
  let bestEdge: EdgeId = 'marsh-track';
  let bestUnits = 0;
  for (const [id, units] of Object.entries(state.wights.nightUnitsByEdge)) {
    if (units > bestUnits) {
      bestEdge = id;
      bestUnits = units;
    }
  }
  const edge = edgesFor(state.farm, state.cuttingHouse).find((e) => e.id === bestEdge);
  const path = edge?.path ?? [{ x: 20, y: 12 }];
  const mid = path[Math.floor(path.length / 2)];
  // Step off the track into the deep marsh; take the first footing that holds.
  for (const [dx, dy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [2, 0],
    [0, 2],
    [0, 0],
  ]) {
    const x = mid.x + dx;
    const y = mid.y + dy;
    if (isPlaceable(x, y) && !signSiteTaken(state, x, y)) return { x, y };
  }
  return { x: mid.x, y: mid.y };
}

/** Marsh powers "seeing use": any marsh tier learned, or a trap worth luring. */
function marshSeesUse(state: GameState): boolean {
  return state.research.completed.marsh > 0 || state.boundWights > 0;
}

/**
 * Dawn: the sign's lifecycle. First sign when the night trade crosses the
 * threshold; while a sign stands nothing else appears; once dealt with (or
 * ignored — it does not expire), signs recur while marsh powers see use.
 */
function signAtDawn(state: GameState): void {
  const w = state.wights;
  if (w.sign !== null) return;
  const day = Math.floor(state.tick / TICKS_PER_DAY);
  const thresholdMet = w.nightUnits >= NIGHT_MARSH_UNITS;
  const firstEver = w.lastSignDay < 0;
  if (!thresholdMet) return;
  if (!firstEver && !marshSeesUse(state)) return;
  if (!firstEver && day - w.lastSignDay < SIGN_RECURRENCE_DAYS) return;
  w.sign = signSite(state);
  w.lastSignDay = day;
  // Playtest: the recurrence must say it is *another* ring — the first-time
  // text re-read as the same ring, as if the player's staking had been undone.
  logEvent(
    state,
    firstEver
      ? 'Something has been at the sheep-walks in the night: a ring of white stones on the deep marsh, and the grass inside it drowned. A wight-sign.'
      : 'Another ring of white stones stands on the deep marsh by dawn. A new wight — the marsh does not send the same one twice — and it wants its own iron, salt, and bait.',
  );
}

/** Dawn: a staked trap binds its wight — deterministic, no roll (§6.14). */
function trapAtDawn(state: GameState): void {
  const w = state.wights;
  if (w.trap === null || w.sign === null) return;
  state.boundWights += 1;
  if (w.stone === null) {
    w.stone = { ...w.sign };
    logEvent(
      state,
      'At dawn the trap stands sprung and the sheep are gone. Where the sign was, a stone now leans that was not there — and the marsh is listening. The wight is bound.',
    );
  } else {
    logEvent(
      state,
      'The trap stands sprung, the bait is gone, and another voice joins the stone. The wight is bound.',
    );
  }
  w.sign = null;
  w.trap = null;
}

/**
 * Dawn: the account is read. Debt past the bindings starts (or continues) a
 * collection: COLLECTION_GRACE_DAYS of grace, then a person is taken —
 * permanent, forgiving PERSON_DEBT — repeating while the breach stands.
 * Nobody left to take → they take you (loss). Respects §6.15's crisis
 * spacing: the taking defers, it does not vanish.
 */
function collectionAtDawn(state: GameState): void {
  if (state.debt <= bindingsOf(state)) {
    if (state.collection !== null) {
      state.collection = null;
      logEvent(state, 'The account stands settled. The marsh is quiet about it.');
    }
    return;
  }
  if (state.collection === null) {
    state.collection = { graceDawnsLeft: COLLECTION_GRACE_DAYS };
    logEvent(
      state,
      `The stones have moved in the night. The Debt outruns what the bound will carry: ${COLLECTION_GRACE_DAYS} dawns to bring it down, or they collect.`,
    );
    return;
  }
  if (state.collection.graceDawnsLeft > 1) {
    state.collection.graceDawnsLeft -= 1;
    logEvent(
      state,
      `The grass lies drowned a little nearer the yard. ${state.collection.graceDawnsLeft} dawn${state.collection.graceDawnsLeft === 1 ? '' : 's'} remain.`,
    );
    return;
  }
  // The third dawn — but existential events keep their distance (§6.15).
  const spacing = DIFFICULTY[state.difficulty].crisisSpacingDays * TICKS_PER_DAY;
  if (state.tick - state.lastCrisisTick < spacing) return; // deferred, not forgiven
  collectPerson(state);
  state.lastCrisisTick = state.tick;
  if (state.debt > bindingsOf(state) && !state.lost) {
    state.collection = { graceDawnsLeft: COLLECTION_GRACE_DAYS };
  } else {
    state.collection = null;
  }
}

/** One person, taken — the §6.14 order: the posted men first, then the hired
 *  hands. No combat, no body, no discussion. */
function collectPerson(state: GameState): void {
  for (const nodeId of Object.keys(state.garrisons)) {
    const g = state.garrisons[nodeId];
    if (!g) continue;
    const name = nodeById(nodeId, state.farm, state.cuttingHouse).name;
    if (g.militia > 0) {
      g.militia -= 1;
      takeAs(state, `a militiaman from the wall at ${name}`);
      return;
    }
    if (g.crew > 0) {
      g.crew -= 1;
      takeAs(state, `one of the crew at ${name}`);
      return;
    }
  }
  const crewed = state.carts.find((c) => c.carter !== null);
  if (crewed) {
    crewed.carter = null;
    delete crewed.marketPatienceUntil;
    takeAs(state, `the carter of ${crewed.name} — the cart stands where he left it`);
    return;
  }
  if (state.shearer.hired) {
    state.shearer.hired = false;
    takeAs(state, 'the shearing lad');
    return;
  }
  if (state.refiner.hired) {
    state.refiner.hired = false;
    takeAs(state, 'the refiner');
    return;
  }
  // §6.14 (M5c) — the philosopher is a person in the collection sense.
  if (collectLeiden(state)) {
    takeAs(state, 'the philosopher — the workshop stands dark, and no letter says why');
    return;
  }
  // Nobody left on the payroll or the walls: they take you.
  state.lost = true;
  state.lastCollected = 'you';
  state.peopleCollected += 1;
  logEvent(state, 'There is nobody left to send out to them. At dawn the yard is empty, and the marsh has closed over the tenancy.');
}

function takeAs(state: GameState, who: string): void {
  state.debt = Math.max(0, state.debt - PERSON_DEBT);
  state.peopleCollected += 1;
  state.lastCollected = who;
  logEvent(
    state,
    `At dawn they have collected: ${who}. Nobody saw anything, and nobody will speak of it. The account is ${PERSON_DEBT} lighter.`,
  );
}

/** The wights' dawn, in order: the sign, the trap, the account. */
export function wightsAtDawn(state: GameState): void {
  signAtDawn(state);
  trapAtDawn(state);
  collectionAtDawn(state);
}

// ---- The player's verbs (called from tick.ts's applyAction) ----

/** §6.14 — stake the trap at the sign: iron & salt in coin, bait in sheep. */
export function applyTrapWight(state: GameState): void {
  const w = state.wights;
  if (w.sign === null) {
    logEvent(state, 'No sign stands on the marsh. There is nothing to trap.');
    return;
  }
  if (w.trap !== null) {
    logEvent(state, 'The trap is staked. Dawn will tell.');
    return;
  }
  const bait = nextBait(state);
  if (state.coin < WIGHT_TRAP_IRON) {
    logEvent(state, `Iron and salt run ${WIGHT_TRAP_IRON} coin, and the till is short.`);
    return;
  }
  if (state.flockSize < bait) {
    logEvent(state, `The trap wants ${bait} sheep staked as bait, and the flock cannot spare them.`);
    return;
  }
  state.coin -= WIGHT_TRAP_IRON;
  state.flockSize -= bait;
  state.fleeceReady = Math.min(state.fleeceReady, state.flockSize);
  state.ledger.declaredYield = Math.min(state.ledger.declaredYield, state.flockSize);
  w.trap = { bait };
  logEvent(
    state,
    `Iron, salt, and ${bait} sheep staked inside the ring. You do not stay to watch. ${WIGHT_TRAP_IRON} coin.`,
  );
}

/** §6.14 — tribute at the stone: one sheep forgives TRIBUTE_RELIEF debt.
 *  Sheep only. They do not take coin, and never will. */
export function applyPayTribute(state: GameState): void {
  if (state.wights.stone === null) {
    logEvent(state, 'No stone leans on your marsh. There is nowhere to leave it.');
    return;
  }
  if (state.flockSize < 1) {
    logEvent(state, 'The tribute is a sheep, and there are none to give.');
    return;
  }
  if (state.debt <= 0) {
    logEvent(state, 'The account stands at nothing. The marsh owes you no thanks for gifts.');
    return;
  }
  state.flockSize -= 1;
  state.fleeceReady = Math.min(state.fleeceReady, state.flockSize);
  state.ledger.declaredYield = Math.min(state.ledger.declaredYield, state.flockSize);
  state.debt = Math.max(0, state.debt - TRIBUTE_RELIEF);
  logEvent(
    state,
    `A sheep left hobbled at the stone is gone by morning — it is always gone by morning. The account is ${TRIBUTE_RELIEF} lighter.`,
  );
}
