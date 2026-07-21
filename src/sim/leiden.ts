// Spec §6.14 (M5c) — Leiden. The philosopher arrives as smuggled cargo, at
// random and uninvited: from the fourth landing where goods cross the gunwale,
// each departure rolls the seeded PRNG, and one night a tub holds a man. House
// him and his building becomes the workshop; every tier he completes wants a
// letter sent to the learned societies — Publication — and the letters raise
// the floor under national Heat for good. Suppressing a letter costs Standing;
// he is well liked, and he did not come here to be quiet.
//
// Pure functions of GameState, like wights.ts: no dice but the state's own,
// no clocks.

import {
  DIFFICULTY,
  LEIDEN_ARRIVAL_CHANCE,
  LEIDEN_ARRIVAL_MIN_RUN,
  LEIDEN_COVER,
  LIGHTER_CAPACITY,
  MAX_LOG_EVENTS,
  MAX_SUPPRESSIONS,
  PUBLICATION_HEAT,
  SUPPRESS_STANDING,
} from './balance';
import { nodeById } from './map';
import { illicitCount, loseStanding } from './revenue';
import { nextRandom } from './rng';
import type { GameState, NodeId } from './types';

function logEvent(state: GameState, text: string): void {
  state.log.push({ tick: state.tick, text });
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

/** The workshop stands and its tenant is in it. */
export function leidenHoused(state: GameState): boolean {
  return state.leiden.state === 'housed';
}

/** §6.14 — the galvanic fence is live at this building. */
export function fenceActiveAt(state: GameState, nodeId: NodeId): boolean {
  return (
    leidenHoused(state) && state.leiden.node === nodeId && state.research.completed.leiden >= 1
  );
}

/**
 * Called as the lugger slips out (tick.ts): a landing where goods were bought
 * counts toward the arrival, and from LEIDEN_ARRIVAL_MIN_RUN on, each such
 * departure rolls the state's own dice. You did not choose him.
 */
export function leidenAtDeparture(state: GameState): void {
  const l = state.leiden;
  if (!l.boughtThisVisit) return;
  l.boughtThisVisit = false;
  l.landingsBought += 1;
  if (l.state !== 'unmet') return;
  if (l.landingsBought < LEIDEN_ARRIVAL_MIN_RUN) return;
  const r = nextRandom(state.rngState);
  state.rngState = r.state;
  if (r.value >= LEIDEN_ARRIVAL_CHANCE) return;
  l.state = 'offered';
  logEvent(
    state,
    'One tub is heavier than the rest, and it is knocking. Inside: a philosopher, wet to the collar, with a crate of glass and a letter of introduction nobody sent for.',
  );
}

/** Cover a building can still spare (§6.14): its hides minus what sits in them. */
export function spareCoverAt(state: GameState, nodeId: NodeId, cover: number): number {
  return Math.max(0, cover - illicitCount(state.stores[nodeId] ?? {}));
}

/** §6.14 — house the philosopher: the building becomes the workshop. The
 *  caller (tick.ts) supplies the building's cover so this module does not
 *  import revenue's cover model. */
export function applyHouseLeiden(state: GameState, nodeId: NodeId, cover: number): void {
  const l = state.leiden;
  if (l.state !== 'offered') {
    logEvent(state, 'No philosopher waits on your word.');
    return;
  }
  const isYours = nodeId === 'farm' || (nodeId === 'cutting-house' && state.cuttingHouse !== null);
  if (!isYours) {
    logEvent(state, 'He must be housed under your own roof — nobody else keeps such secrets.');
    return;
  }
  if (spareCoverAt(state, nodeId, cover) < LEIDEN_COVER) {
    logEvent(
      state,
      `He needs ${LEIDEN_COVER} cover to spare — him, the glass, and the smell of burning air. The hides there are full.`,
    );
    return;
  }
  l.state = 'housed';
  l.node = nodeId;
  const name = nodeById(nodeId, state.farm, state.cuttingHouse).name;
  logEvent(
    state,
    `The philosopher is installed at ${name}, behind the same boards as the brandy. The room smells of storms now. The workshop is open.`,
  );
}

/** §6.14 — turn him away: he is rowed back out on the next tide. Twice, and
 *  no boat brings him again. */
export function applyRefuseLeiden(state: GameState): void {
  const l = state.leiden;
  if (l.state !== 'offered') return;
  l.refusals += 1;
  l.state = l.refusals >= 2 ? 'gone' : 'unmet';
  logEvent(
    state,
    l.state === 'gone'
      ? 'He is rowed back out, and this time he does not look back. No tub will knock again.'
      : 'He is rowed back out on the next tide, protesting in Latin. The sea keeps its own counsel on whether he returns.',
  );
}

/** A leiden tier has completed (tick.ts researchProgress): the work is done,
 *  and a letter to the societies wants sending. He will not take the bench
 *  again while it waits. */
export function leidenTierCompleted(state: GameState): void {
  const tier = state.research.completed.leiden; // already incremented
  state.leiden.letterPending = tier - 1;
  const done = [
    'The fence is wired and the frogs on the dyke have opinions. His letter on galvanic defence sits sealed on the bench.',
    'The lighter is launched — a hull, a boiler, and no bedtime. His letter on marine steam sits sealed on the bench.',
    'The telegraph hums. The map knows what the Revenue knows, as it knows it. His letter on aetheric signalling sits sealed on the bench.',
  ];
  logEvent(state, done[tier - 1] ?? 'The bench clears, and a letter sits sealed on it.');
  // §6.14 Leiden 2 — the research was the purchase: one hull, at the shingle.
  if (tier === 2 && !state.carts.some((c) => c.vessel)) {
    state.carts.push({
      id: 'lighter-1',
      name: 'The Steam-Lighter',
      capacity: LIGHTER_CAPACITY,
      cargo: {},
      location: { kind: 'node', nodeId: 'shingle' },
      carter: null,
      vessel: true,
    });
  }
}

/** §6.14 — the letter goes out: the floor under national Heat rises for good.
 *  The §6.15 dial scales it like any heat the world deals. */
export function applyPublishLetter(state: GameState): void {
  const l = state.leiden;
  if (l.letterPending === null) {
    logEvent(state, 'No letter waits on the bench.');
    return;
  }
  const rise = (PUBLICATION_HEAT[l.letterPending] ?? 0) * DIFFICULTY[state.difficulty].heatMult;
  state.nationalHeatFloor += rise;
  l.letterPending = null;
  logEvent(
    state,
    'The letter goes out with the post-boy, and in time the societies read it aloud. London will never entirely forget this parish again.',
  );
}

/** §6.14 — hold the letter back: Standing paid, the floor unrisen — and at
 *  MAX_SUPPRESSIONS held he refuses the bench until one goes out. */
export function applySuppressLetter(state: GameState): void {
  const l = state.leiden;
  if (l.letterPending === null) {
    logEvent(state, 'No letter waits on the bench.');
    return;
  }
  if (l.heldLetters.length >= MAX_SUPPRESSIONS) {
    logEvent(state, 'He will not hold a fourth letter. This one goes out or none of it goes on.');
    return;
  }
  l.heldLetters.push(PUBLICATION_HEAT[l.letterPending] ?? 0);
  l.letterPending = null;
  loseStanding(state, SUPPRESS_STANDING);
  logEvent(
    state,
    'You put the letter in the strongbox and he watches you do it. The parish hears he is slighted; they like him, and they mind.',
  );
}

/** §6.14 — release the oldest held letter: the floor rises late, and the
 *  bench is his again. */
export function applyReleaseLetter(state: GameState): void {
  const l = state.leiden;
  const held = l.heldLetters.shift();
  if (held === undefined) {
    logEvent(state, 'The strongbox holds no letters.');
    return;
  }
  state.nationalHeatFloor += held * DIFFICULTY[state.difficulty].heatMult;
  logEvent(
    state,
    'An old letter leaves the strongbox at last. The societies read it hungrily — late news from this parish is still news.',
  );
}

/** The wights' claim on him (wights.ts): the workshop goes dark, permanently. */
export function collectLeiden(state: GameState): boolean {
  if (!leidenHoused(state)) return false;
  state.leiden.state = 'gone';
  return true;
}
