// The Zustand store wraps the pure sim. All mutation happens by queueing
// Actions and calling step(), which funnels everything through tick().
// The store also owns the action log — a full game is (seed, actionLog),
// so the log is saved alongside the state and replays are always possible.

import { create } from 'zustand';
import {
  BINDING_CAPACITY,
  CART_CAPACITY,
  CART_COST,
  COLLECTION_GRACE_DAYS,
  FLOCK_CAP,
  PERSON_DEBT,
  FLOCK_SPOTLIGHT_DAY,
  MAX_CARTS,
  MILESTONE_CARD_SPACING_DAYS,
  REFINER_UNLOCK,
  REFINER_WAGE,
  RESEARCH_COST,
  RUMOUR_TRUST,
  SHEARER_UNLOCK_SHEARS,
  SHEARER_WAGE,
  SHEEP_PRICE_BUY,
  SHEEP_VALUE,
  TICKS_PER_DAY,
} from '../sim/balance';
import { CONTRABAND, illicitAnywhere } from '../sim/revenue';
import { simulateBattle } from '../sim/combat';
import type { BattleSetup, Call, CombatLog, ScheduledCall } from '../sim/combat';
import { nodeById } from '../sim/map';
import { raidBattleSetup } from '../sim/raid';
import { initialState, QUAY_RUMOURS, rentAmount, tick } from '../sim/tick';
import type { Action, ActionLog, Difficulty, GameState, NodeId } from '../sim/types';

// v11: M5a adds difficulty, mercy (dutchmanBook, vouches), the shearer, the
//      flock market, and the research bench to GameState (§6.14–6.16).
// v10: M4c-2 adds contrabandSold, the Hawksmere record, and the raid (§6.13).
// v9: rent is now player-settled (rentPending) for the event card (§6.8/§6.13).
// v8: M4c adds the garrison, Standing, and the informer to GameState (§6.13).
// v7: M4b adds per-building fortifications to GameState (spec §6.12).
// v6: M3 adds Heat, the Revenue, the ledger, and carters to GameState.
// Older saves are incompatible and are silently abandoned.
// v12: rumoursHeard/lastRoundDay joined GameState (§6.9 M5a-4).
// v13: the refiner joined GameState (§6.17 M5 hub-2); orders may carry backTo.
// v14: goodsSeized/lastSeizureNode/distraintSheep — tallies the seizure and
//      distraint cards watch (§6.10/§6.8, M5 hub polish).
// v15: ledger.soldToday — the wool-stapler's daily tally; lawful fleece
//      sales cap at declaredYield/day (§6.10's squeeze, finally enforced).
// v16: dutchman.met + dutchman.fleeceBought — the first meeting that waits,
//      and the trust ladder that opens his hold one good at a time (§6.9).
// v17: ledger.penTaken — the books follow the flock until the player takes
//      the pen; honest play needs no bookkeeping at all (§6.10).
// v18: M5b — debt, boundWights, the wights record (sign/trap/stone/hollow
//      way), collection, peopleCollected/lastCollected (§6.14).
const SAVE_KEY = 'fifth-continent-save-v18';
const AUTOSAVE_EVERY_TICKS = 30;
const AUTOPAY_KEY = 'fifth-continent-autopay-rent'; // a UI preference, not game state

/**
 * A centre-screen event card (spec §6.13). The sim stays pure and knows nothing
 * of this; the store watches for card-worthy state changes, pauses, and raises
 * one. 'rent' asks for an active click to pay; 'info' just says its piece.
 */
export interface EventCard {
  id: string;
  kind: 'rent' | 'info' | 'raid' | 'newGame';
  title: string;
  body: string;
  /** Optional scene-setting line shown above the body (e.g. the alehouse's
   *  local colour, §6.9). Pure decoration — never touches the sim or the save. */
  flavour?: string;
}

/** A battle being watched (spec §14). The store re-runs the deterministic sim
 *  each time a Call is sounded; the frame log plays back at COMBAT_FRAME_MS. */
export interface BattlePlayback {
  setup: BattleSetup;
  log: CombatLog;
  frame: number;
  calls: ScheduledCall[];
  callsLeft: number;
  target: NodeId;
  targetName: string;
}

/** How long each combat frame is shown — a battle runs ~5–7 seconds (§14). */
export const COMBAT_FRAME_MS = 150;
/** The three Calls per battle (§14.4). */
export const MAX_CALLS = 3;

function battleResultCard(b: BattlePlayback): EventCard {
  const c = b.log.consequences;
  const retreated = b.calls.some((q) => q.call === 'soundRetreat');
  let title: string;
  let body: string;
  if (b.log.outcome === 'paid_off') {
    title = 'Bought off';
    body = `You pay the Company off at ${b.targetName} for ${c.payOffCost} coin. They ride away — this time. The goods stay.`;
  } else if (b.log.playerWon) {
    title = 'The wall holds';
    body = `They break at ${b.targetName} and fall back. ${c.friendlyDead} of your men lie still; the goods are safe.`;
  } else if (retreated) {
    title = 'You pull them out';
    body = `You sound the retreat at ${b.targetName}. The goods are lost, but your people live — only ${c.friendlyDead} did not come home.`;
  } else {
    title = 'Overrun';
    body = `${b.targetName} is taken and the goods carried off. ${c.friendlyDead} of your men are lost, and the parish grieves.`;
  }
  return { id: `result-${b.setup.attacker.strength}-${b.frame}`, kind: 'info', title, body };
}

/** The muster warning (spec §6.13): a Company force is riding for a building. */
function musterCard(next: GameState): EventCard {
  const r = next.raid!;
  const name = nodeById(r.target, next.farm, next.cuttingHouse).name;
  const days = Math.max(1, Math.round((r.battleTick - next.tick) / TICKS_PER_DAY));
  return {
    id: `muster-${r.battleTick}`,
    kind: 'info',
    title: 'A muster gathers',
    body: `The Hawksmere Company is riding for ${name} — the blow falls in about ${days} day${days === 1 ? '' : 's'}. Post men and dig in, or lose the goods.`,
  };
}

/** The blow itself (spec §6.13): the raiders are at the wall, and it must be answered. */
function raidCard(next: GameState): EventCard {
  const r = next.raid!;
  const name = nodeById(r.target, next.farm, next.cuttingHouse).name;
  const g = next.garrisons[r.target];
  const men = (g?.militia ?? 0) + (g?.crew ?? 0);
  const defence = men > 0 ? `${men} of your men hold the wall` : 'and no one holds the wall';
  return {
    id: `raid-${r.battleTick}`,
    kind: 'raid',
    title: 'The Company is at the gate',
    body: `${r.size} of the Hawksmere Company fall on ${name}, ${defence}.`,
  };
}

/** The rent-day card, its warning shaped by what the purse can meet (§6.8).
 *  §6.15: when the purse is short and the Dutchman is known, the card also
 *  offers his coin — the loan is a button, so mercy is a choice, not a gift. */
function rentCard(next: GameState): EventCard {
  const due = rentAmount(next);
  const held = Math.min(next.coin, due);
  const short = due - held;
  const body =
    short <= 0
      ? `The agent is at the door for his ${due} coin, and the purse holds it.`
      : `The agent wants ${due} coin; the purse holds ${next.coin}. Short by ${short} — his men will drive off ${Math.ceil(short / SHEEP_VALUE)} sheep for the rest.`;
  return { id: `rent-${next.rentDueTick}`, kind: 'rent', title: 'Rent day', body };
}

/** §6.14 — a wight-sign stands on the marsh: pause, and point at it. */
function signCard(next: GameState): EventCard {
  return {
    id: `sign-${next.tick}`,
    kind: 'info',
    title: 'A ring of white stones',
    body: 'Something has been at the sheep-walks in the night: a ring of white stones on the deep marsh, the grass inside it drowned. The old people call it a wight-sign, and they do not walk past it after dark. Iron, salt, and staked sheep would trap what made it — if you want what it can do.',
  };
}

/** §6.14 — the breach: the account outruns the bound, and the grace begins. */
function breachCard(next: GameState): EventCard {
  return {
    id: `breach-${next.tick}`,
    kind: 'info',
    title: 'The stones have moved',
    body: `The Debt outruns what the bound will carry, and the drowned grass lies nearer the yard each morning. ${COLLECTION_GRACE_DAYS} dawns: tribute sheep down at the stone, or bind another wight — or they will collect, and what they take is people.`,
  };
}

/** §6.14 — collected: a person is gone at dawn. No combat, no body, no argument. */
function collectedCard(next: GameState): EventCard {
  return {
    id: `collected-${next.tick}`,
    kind: 'info',
    title: 'Collected',
    body: `At dawn they have taken ${next.lastCollected ?? 'someone'}. Nobody saw anything, and nobody will speak of it — the parish knows what a drowned path means. The account is ${PERSON_DEBT} lighter, and it was not worth it.`,
  };
}

/** §6.10 — the officer took goods: pause, and say what the cover could not hide. */
function seizureCard(next: GameState, units: number): EventCard {
  const where = next.lastSeizureNode
    ? nodeById(next.lastSeizureNode, next.farm, next.cuttingHouse).name
    : 'the road';
  return {
    id: `seizure-${next.tick}`,
    kind: 'info',
    title: 'Seized for the Crown',
    body: `The Riding Officer takes ${units} good${units === 1 ? '' : 's'} at ${where} — everything the cover could not hide. What the Crown takes, it keeps, and the parish talks the louder for it. Split your stock, mind his road, and keep the stains moving.`,
  };
}

/** §6.8 — the rent came short and the agent took sheep: pause, and count them. */
function distraintCard(next: GameState, sheep: number): EventCard {
  return {
    id: `distraint-${next.tick}`,
    kind: 'info',
    title: 'Distraint',
    body: `The rent came short, and the agent's men drove off ${sheep} sheep — distraint, he calls it, and the law agrees. The flock stands at ${next.flockSize}: fewer fleece every dawn from here, so the next rent starts harder than this one. The Dutchman's coin or the parish's patience may not always be there.`,
  };
}

/** Spec §6.15 — the parish vouched: say so, plainly, and what it cost. */
function vouchCard(next: GameState): EventCard {
  return {
    id: `vouch-${next.vouches}`,
    kind: 'info',
    title: 'The parish vouches',
    body: 'The rent could not be met, and the agent came for the whole flock — but the neighbours made it up before he reached the fold. No book records it. The marsh keeps accounts, and thinks a little less of your luck.',
  };
}

// §6.9 (M5a-4) — the alehouse's local colour: a random vignette per round,
// pure decoration above the rumour. It never touches the sim or the save, so
// Math.random() here breaks no replay (activeCard is UI-only, house rule 1).
const QUAY_COLOUR: readonly string[] = [
  'Woodsmoke and wet wool, and the low churn of the taproom. You set coin on the bar and the landlord fills the room’s cups without being asked twice.',
  'A fiddle scrapes in the corner, badly, and nobody minds. The round goes round, and the talk loosens with it.',
  'Rain ticks on the shutters. Half the parish is in here drying out, and coin buys you a seat among them.',
  'The tallow smokes and the low beams sweat. Faces you half-know nod as the drink comes round on your purse.',
  'Someone’s dog sleeps under the settle. The pots are refilled, the bar warms to you, and a man leans in closer than he did an hour ago.',
  'A revenue man’s empty chair sits by the fire — he drinks here too, they say, when he isn’t counting. Tonight the coin is yours and the talk is easy.',
  'The tide-clock over the bar creeps toward the ebb. You buy the round, and the room decides you are the sort of farmer worth talking to.',
  'Salt marsh on every boot, and the fug of a dozen pipes. Your coin crosses the bar and a chair is drawn out for you.',
  'The landlord’s girl carries the pots two-handed. The round empties fast, and a low voice finds your ear over the noise.',
  'A gale worries the sign outside. In here it is warm, and a stood round is the oldest key on this coast to a man’s tongue.',
];

/** §6.9 (M5a-4) — the round you stood: the rumour you paid for, dressed in a
 *  little random alehouse colour. The rumour is already in the notebook; this
 *  is the moment. Not shown for the last rumour — the shingle card takes it. */
function roundCard(next: GameState): EventCard {
  const colour = QUAY_COLOUR[Math.floor(Math.random() * QUAY_COLOUR.length)];
  return {
    id: `round-${next.rumoursHeard}`,
    kind: 'info',
    title: 'A round in the alehouse',
    flavour: colour,
    body: QUAY_RUMOURS[next.rumoursHeard - 1] ?? '',
  };
}

/** Spec §6.15 — the new-tenancy card: choose how hard the world leans. */
function newGameCard(): EventCard {
  return {
    id: 'new-game',
    kind: 'newGame',
    title: 'A new tenancy',
    body: 'How hard should the marsh press? Gentle eases the rent, the Heat, and the raiders; fair is the game as designed; hard is for those who have smuggled before. You can ease off later — the marsh never gets harder by asking.',
  };
}

function loadAutoPay(): boolean {
  try {
    return localStorage.getItem(AUTOPAY_KEY) === '1';
  } catch {
    return false;
  }
}

// ---- Milestone cards (spec §6.13 / §10) --------------------------------------
// Punchy one-shot notices when something new opens up. Each fires the first
// time its condition holds; a persisted "seen" latch keeps it from repeating.

const SHOWN_KEY = 'fifth-continent-shown-cards';
type Shown = Record<string, true>;

function loadShown(): Shown {
  try {
    return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '{}') as Shown;
  } catch {
    return {};
  }
}

function saveShown(shown: Shown): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // a lost latch only risks showing a card twice — no catastrophe
  }
}

function clearShown(): void {
  try {
    localStorage.removeItem(SHOWN_KEY);
  } catch {
    /* ignore */
  }
}

function hasOverproofJenever(s: GameState): boolean {
  return (
    s.carts.some((c) => (c.cargo.jenever ?? 0) > 0) ||
    Object.values(s.stores).some((st) => (st.jenever ?? 0) > 0)
  );
}

interface Milestone {
  key: string;
  when: (s: GameState) => boolean;
  title: string;
  body: string;
  /**
   * §10 (playtest) — an *offer* card: something new for sale, not something
   * happening. Offers keep MILESTONE_CARD_SPACING_DAYS of daylight between
   * them so the day-6 pile reads as a week of discoveries; world events
   * (the officer arriving, the lugger offshore) are never held back.
   */
  paced?: boolean;
}

// Order is priority when several come true at once — the pause sequences them.
const MILESTONES: Milestone[] = [
  {
    // §6.9 (M5a-4) — the unlock was earned on the quay: the rumour chain
    // ran its length before the first rent forced the matter.
    key: 'shingle-open-asked',
    when: (s) => s.dutchman.unlocked && s.rumoursHeard >= RUMOUR_TRUST.length,
    title: 'The landlord names the hour',
    body: 'You stood the rounds and the quay repaid you: a Dutch lugger stands off the shingle north-east of your farm — after dark, on a falling tide, no lights — and pays four times for wool. The beach is on your map now. And the rent is still coming.',
  },
  {
    // §6.9 — the way out opens the moment the first rent is collected; a
    // silent unlock reads as a bug. This card makes the argument; the
    // "light on the water" card below still marks his first actual visit.
    key: 'shingle-open',
    when: (s) => s.dutchman.unlocked && s.rumoursHeard < RUMOUR_TRUST.length,
    title: 'Word on the marsh',
    body: 'The agent has been and gone, and the whole parish felt it. Word follows you home from Ryne: across the water they pay four times for wool, and on the shingle north-east of your farm — after dark, on a falling tide — nobody counts what crosses the marsh. The beach is on your map now.',
  },
  {
    key: 'dutchman-offshore',
    when: (s) => s.dutchman.present,
    title: 'A light on the water',
    body: 'A lugger stands off the shingle — no lights, no flag. He pays four times Ryne’s price for wool, and asks nothing. He has come to meet you, and he will wait the whole night: load a cart with fleece and take the marsh track down to the beach.',
  },
  {
    // §6.9 (M5 tutorial pass) — the ladder's rungs: each new tarpaulin is
    // its own moment, fired the first visit the good is actually aboard.
    key: 'dutchman-tea',
    when: (s) => s.dutchman.present && (s.dutchman.hold.tea ?? 0) > 0,
    title: 'A second tarpaulin',
    body: 'The wool has bought his trust. He lifts a second tarpaulin: bohea tea, four the chest — Ryne drinks eight chests a day at seven, and asks no more questions than he does. The volume trade, if you can move it.',
  },
  {
    key: 'dutchman-jenever',
    when: (s) => s.dutchman.present && (s.dutchman.hold.jenever ?? 0) > 0,
    title: 'The third tarpaulin',
    body: 'Tonight he shows you the tubs: overproof jenever, ten the tub — and no buyer in Ryne will touch a drop of it raw. He grins like a man selling you a problem. It wants cutting, and cutting wants a house.',
  },
  {
    // §6.10 (M5 tutorial pass) — heat named the moment it first exists: the
    // first contraband act warms the parish, and the meter appears with it.
    key: 'town-talks',
    when: (s) => s.heat.regional >= 0.5,
    title: 'The town talks',
    body: 'Contraband sold, moved, or left lying past what your barn’s clutter can hide — it all makes talk, and the parish meter now on the HUD is the talk rising. Live quiet and it cools. Let it climb, and London sends a man to lodge at the Customs House.',
  },
  {
    // §6.10 / §6.17 — the surplus fork, stated plainly at the moment the
    // player is actually holding it: heat against money, fence against wait.
    key: 'sold-out-not-sold',
    when: (s) =>
      s.carts.some(
        (c) =>
          !c.carter &&
          c.location.kind === 'node' &&
          c.location.nodeId === 'ryne' &&
          CONTRABAND.some((g) => (c.cargo[g] ?? 0) > 0 && (s.demandRemaining[g] ?? 0) <= 0),
      ),
    title: 'Sold out, not sold',
    body: 'The town has had its fill of that today, and a laden cart in the open is remembered. The fence will take the rest now — coin in hand, cheap, and the talk dies with it. Or hold the goods for tomorrow’s full price, and know that goods hanging about draw nosy parkers from the Customs House.',
  },
  {
    // §6.10 — the books become a decision at first owling, and not before:
    // until then the agent keeps them square with the flock, unasked.
    key: 'take-up-the-pen',
    when: (s) => s.dutchman.fleeceBought > 0 && !s.ledger.penTaken,
    title: 'Take up the pen',
    body: 'That wool crossed the gunwale and left no trace — but the book still swears the flock’s whole clip, and sworn wool must show when the Revenue counts. In THE LEDGER you may teach the book to swear less — scrapie, if anyone asks — and owl the difference free. Mind: the wool-stapler buys in town only what the book admits each day.',
  },
  {
    key: 'cutting-house',
    paced: true,
    when: (s) => !s.cuttingHouse && hasOverproofJenever(s),
    title: 'Spirit no one will buy',
    body: 'You are holding overproof jenever, and no honest buyer will touch a drop. Raise a cutting house on the marsh: cut it with water and burnt sugar and it sells in Ryne as brandy.',
  },
  {
    // §6.14 (M5b) — the first binding: the stone, the account, and the rules
    // of both, taught once at the moment they begin to exist.
    key: 'first-binding',
    when: (s) => s.boundWights >= 1,
    title: 'The wight is bound',
    body: `Where the sign was, a stone now leans — and the marsh will work for you, at a price kept in an account that never closes. Each bound wight carries ${BINDING_CAPACITY} of Debt; let the Debt outrun the bound and they collect, and what they take is people. Sheep left at the stone lighten it. Iron, salt, and the stone's own teaching wait there too.`,
  },
  {
    // §6.9 (M5 tutorial pass) — the fast lane, made findable: the six slow
    // days hold a thread to pull, but only if the player knows the room.
    key: 'alehouse-talks',
    paced: true,
    when: (s) =>
      !s.dutchman.unlocked &&
      s.rumoursHeard === 0 &&
      s.ledger.soldLawfully >= RUMOUR_TRUST[0],
    title: 'The quay might talk',
    body: 'Your wool is known on the quay now, and the alehouse is where the parish talks. Stand a round at Ryne — 2 coin buys a loosened tongue, once a day — and you may hear where the wool really goes before the rent teaches you.',
  },
  {
    key: 'carter-for-hire',
    paced: true,
    when: (s) => s.dutchman.unlocked || s.ledger.soldLawfully >= 2 * CART_CAPACITY,
    title: 'Hands for hire',
    body: 'You have walked the wool round enough to feel it. A carter will take the reins for 3 coin a day — hire one at a cart and free your own hands for other work.',
  },
  {
    // §6.16 (M5 hub-2) — the flock as an early choice: one card, the first
    // dawn on or after day FLOCK_SPOTLIGHT_DAY, naming the fork against the
    // carter's wage. It changes no rule; it makes an existing lever legible
    // at the moment it first matters — before the first rent.
    key: 'flock-spotlight',
    paced: true,
    when: (s) =>
      s.tick >= FLOCK_SPOTLIGHT_DAY * TICKS_PER_DAY &&
      s.flockSize + s.sheepArriving < FLOCK_CAP,
    title: 'More sheep, or more hands',
    body: `The first coin is in the purse, and it pulls two ways. A sheep at Ryne is ${SHEEP_PRICE_BUY} coin — one more fleece every dawn, for good. A carter is 3 a day — the round runs without you. The pasture holds ${FLOCK_CAP}; the rent does not wait for either.`,
  },
  {
    // §10 (playtest) — a second cart is an answer to a felt limit: offered
    // once a carter already runs a round (your own hands are spoken for),
    // not the moment the purse can cover it.
    key: 'second-cart',
    paced: true,
    when: (s) =>
      s.carts.length < MAX_CARTS &&
      s.coin >= CART_COST &&
      s.dutchman.unlocked &&
      s.carts.some((c) => c.carter !== null),
    title: 'Room in the yard',
    body: 'There is coin enough for a second cart and pony now, and the yard holds three. More wheels move more at once — buy one at the farm.',
  },
  {
    key: 'officer-arrived',
    when: (s) => s.revenue.officer.arrived,
    title: 'The blue coat',
    body: 'A Riding Officer has taken rooms above the Customs House. He counts your sheep against the books and seizes what your cover cannot hide. Keep the stains moving, and mind the coat on the road.',
  },
  {
    key: 'shearer-for-hire',
    paced: true,
    when: (s) =>
      !s.shearer.hired &&
      (s.shearer.handShears >= SHEARER_UNLOCK_SHEARS || s.carts.some((c) => c.carter !== null)),
    title: 'The dawn clip, sold',
    body: `You have felt the shears enough. A neighbour's lad will clip the flock into the barn at dawn for ${SHEARER_WAGE} coin a day — hire him at the farm, and the wool round runs without you.`,
  },
  {
    // §6.17 — the refiner's offer, announced like the shearer's: once the
    // cutting-house chore is felt, or a carter already runs the roads.
    key: 'refiner-for-hire',
    paced: true,
    when: (s) =>
      !!s.cuttingHouse &&
      !s.refiner.hired &&
      (s.refiner.handRefines >= REFINER_UNLOCK || s.carts.some((c) => c.carter !== null)),
    title: 'A hand for the house',
    body: `You have worked the cutting house enough to be known for it. A quiet man will run the whole house at dawn — every tub cut at your standing depth, the leaf smouched if you say so — for ${REFINER_WAGE} coin a day. Hire him at the cutting house. He knows what the work is, and what it is.`,
  },
  {
    // §10 / §6.14 (playtest) — hollow floors matter only once there is
    // something to hide: offered when contraband has touched your hands,
    // not the moment the coast opens.
    key: 'wheelwright-bench',
    paced: true,
    when: (s) =>
      s.dutchman.unlocked &&
      s.coin >= RESEARCH_COST.trade[0] &&
      (s.contrabandSold > 0 || illicitAnywhere(s) > 0),
    title: 'The wheelwright asks no questions',
    body: `There is coin enough for quiet improvements now. The wheelwright will fit your carts with hollow floors — ${RESEARCH_COST.trade[0]} coin, a couple of days, and the road-stops miss what rides under the boards. Start the work at the farm.`,
  },
];

/** The first milestone whose moment has come and has not yet been shown.
 *  Paced (offer) cards keep their spacing from the last paced card; a world
 *  event further down the list may still speak in the meantime (§10). */
function detectMilestone(s: GameState, shown: Shown, lastPacedTick: number): Milestone | null {
  const spacing = MILESTONE_CARD_SPACING_DAYS * TICKS_PER_DAY;
  for (const m of MILESTONES) {
    if (shown[m.key] || !m.when(s)) continue;
    if (m.paced && lastPacedTick > 0 && s.tick - lastPacedTick < spacing) continue;
    return m;
  }
  return null;
}

// The pacing latch persists beside the seen-cards latch: losing it only
// risks two offers landing close together after a reload.
const PACED_KEY = 'fifth-continent-last-paced-tick';

function loadPacedTick(): number {
  try {
    return Number(localStorage.getItem(PACED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function savePacedTick(tick: number): void {
  try {
    localStorage.setItem(PACED_KEY, String(tick));
  } catch {
    /* ignore */
  }
}

interface SaveFile {
  version: 1;
  state: GameState;
  actionLog: ActionLog;
}

export interface GameStore {
  state: GameState;
  actionLog: ActionLog;
  pending: Action[];
  paused: boolean;
  /** Ticks per real second while unpaused. */
  ticksPerSecond: number;
  /** A pending event card freezes the world until the player answers it (§6.13). */
  activeCard: EventCard | null;
  /** The player has chosen to pay future rents without being asked (§6.8). */
  autoPayRent: boolean;
  /** Milestone cards already shown, so each punchy notice fires only once. */
  shownCards: Shown;
  /** Tick of the last paced (offer) milestone card — the §10 spacing latch. */
  lastPacedTick: number;
  /** A raid being watched frame by frame (spec §14). Freezes the world too. */
  battle: BattlePlayback | null;

  enqueue: (action: Action) => void;
  step: () => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (ticksPerSecond: number) => void;
  /** Settle the rent from the card and dismiss it. */
  payRent: () => void;
  /** Take the Dutchman's coin against the rent (§6.15) and dismiss the card. */
  takeLoan: () => void;
  /** Ask for a new tenancy: raises the difficulty-choice card (§6.15). */
  requestNewGame: () => void;
  /** Begin the new tenancy at the chosen difficulty. */
  startNewGame: (difficulty: Difficulty) => void;
  /** Begin watching the pending raid (§14) — the card gives way to the battle. */
  startBattle: () => void;
  /** Advance the playback one frame; ends the battle at the last frame. */
  advanceBattleFrame: () => void;
  /** Sound one of the three Calls (§14.4) — re-runs the sim from this frame on. */
  soundCall: (call: Call) => void;
  /** Remember to pay future rents automatically (dismisses the ask thereafter). */
  setAutoPayRent: (on: boolean) => void;
  /** Dismiss an informational card and let the world run on. */
  dismissCard: () => void;
  save: () => void;
}

function loadSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed.version !== 1 || typeof parsed.state?.tick !== 'number') return null;
    if (typeof parsed.state.farm?.x !== 'number' || typeof parsed.state.fleeceReady !== 'number')
      return null;
    if (typeof parsed.state.rentDueTick !== 'number' || typeof parsed.state.lost !== 'boolean')
      return null;
    if (typeof parsed.state.dutchman?.present !== 'boolean' || !parsed.state.demandRemaining)
      return null;
    if (
      typeof parsed.state.heat?.regional !== 'number' ||
      typeof parsed.state.revenue?.officer?.arrived !== 'boolean' ||
      typeof parsed.state.ledger?.declaredYield !== 'number'
    )
      return null;
    if (!parsed.state.fortifications || typeof parsed.state.fortifications !== 'object') return null;
    if (!parsed.state.garrisons || typeof parsed.state.standing !== 'number') return null;
    if (typeof parsed.state.rentPending !== 'boolean') return null;
    if (!parsed.state.hawksmere || typeof parsed.state.contrabandSold !== 'number') return null;
    if (
      typeof parsed.state.difficulty !== 'string' ||
      typeof parsed.state.dutchmanBook !== 'number' ||
      typeof parsed.state.shearer?.hired !== 'boolean' ||
      !parsed.state.research?.completed
    )
      return null;
    if (typeof parsed.state.refiner?.hired !== 'boolean') return null;
    if (
      typeof parsed.state.goodsSeized !== 'number' ||
      typeof parsed.state.distraintSheep !== 'number'
    )
      return null;
    if (typeof parsed.state.ledger?.soldToday !== 'number') return null;
    if (
      typeof parsed.state.dutchman?.met !== 'boolean' ||
      typeof parsed.state.dutchman?.fleeceBought !== 'number'
    )
      return null;
    if (typeof parsed.state.ledger?.penTaken !== 'boolean') return null;
    if (
      typeof parsed.state.debt !== 'number' ||
      typeof parsed.state.boundWights !== 'number' ||
      typeof parsed.state.wights?.nightUnits !== 'number' ||
      typeof parsed.state.peopleCollected !== 'number'
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSave(state: GameState, actionLog: ActionLog): void {
  try {
    const file: SaveFile = { version: 1, state, actionLog };
    localStorage.setItem(SAVE_KEY, JSON.stringify(file));
  } catch {
    // Storage full or unavailable: the game plays on, unsaved.
  }
}

const DEFAULT_SEED = 1740;

export const useGameStore = create<GameStore>()((set, get) => {
  const saved = loadSave();
  if (!saved) clearShown(); // a fresh game meets its milestones anew
  return {
    state: saved?.state ?? initialState(DEFAULT_SEED),
    actionLog: saved?.actionLog ?? {},
    pending: [],
    paused: false,
    ticksPerSecond: 3,
    activeCard: null,
    autoPayRent: loadAutoPay(),
    shownCards: saved ? loadShown() : {},
    lastPacedTick: saved ? loadPacedTick() : 0,
    battle: null,

    enqueue: (action) => set((s) => ({ pending: [...s.pending, action] })),

    step: () => {
      const { state, pending, actionLog, autoPayRent, activeCard, shownCards, lastPacedTick, battle } = get();
      if (activeCard || battle) return; // the world is frozen behind a card or a battle
      const nextLog =
        pending.length > 0 ? { ...actionLog, [state.tick]: pending } : actionLog;
      const next = tick(state, pending);

      // Event cards (§6.13). Rent is the one that asks for a click; a milestone
      // is a punchy notice when something new opens up (§10). Rent takes the
      // slot when it and a milestone come at once — the pause sequences the rest.
      const rentJustDue = next.rentPending && !state.rentPending;
      let nextPending: Action[] = [];
      let card: EventCard | null = null;
      let shown = shownCards;
      let paced = lastPacedTick;

      // Raid beats (§6.13): the muster gathering, then the blow at the wall.
      const musterGathered = !!next.raid && !state.raid;
      const battlePending = !!next.raid?.pendingBattle && !state.raid?.pendingBattle;
      // Mercy (§6.15): the parish vouched — pause and say so.
      const justVouched = next.vouches > state.vouches;
      // Consequences pause too (§6.8/§6.10, playtest): sheep driven off in
      // distraint, and goods taken by the officer's hand.
      const justDistrained = next.distraintSheep > state.distraintSheep;
      const justSeized = next.goodsSeized > state.goodsSeized;
      // §6.14 — the wights' beats: a sign standing, a breach opening, a
      // person taken. (Loss itself is the forfeit overlay's business.)
      const signAppeared = next.wights.sign !== null && state.wights.sign === null;
      const breachStarted = next.collection !== null && state.collection === null;
      const justCollected = next.peopleCollected > state.peopleCollected && !next.lost;
      // §6.9 (M5a-4): a round was stood and a rumour heard. The last rumour
      // unlocks the Dutchman, and its own milestone card owns that moment —
      // so the round card yields to it (the !unlocked guard below).
      const roundStood = next.lastRoundDay > state.lastRoundDay;

      if (rentJustDue && !autoPayRent) {
        card = rentCard(next);
      } else if (rentJustDue) {
        nextPending = [{ type: 'payRent' }];
      } else if (justVouched) {
        card = vouchCard(next);
      } else if (justDistrained) {
        card = distraintCard(next, next.distraintSheep - state.distraintSheep);
      } else if (justCollected) {
        card = collectedCard(next);
      } else if (breachStarted) {
        card = breachCard(next);
      } else if (battlePending) {
        card = raidCard(next);
      } else if (musterGathered) {
        card = musterCard(next);
      } else if (signAppeared) {
        card = signCard(next);
      } else if (justSeized) {
        card = seizureCard(next, next.goodsSeized - state.goodsSeized);
      } else if (roundStood && !next.dutchman.unlocked) {
        card = roundCard(next);
      } else {
        const m = detectMilestone(next, shownCards, lastPacedTick);
        if (m) {
          card = { id: m.key, kind: 'info', title: m.title, body: m.body };
          shown = { ...shownCards, [m.key]: true };
          saveShown(shown);
          if (m.paced) {
            paced = next.tick;
            savePacedTick(paced);
          }
        }
      }

      set({ state: next, pending: nextPending, actionLog: nextLog, activeCard: card, shownCards: shown, lastPacedTick: paced });
      if (next.tick % AUTOSAVE_EVERY_TICKS === 0) writeSave(next, nextLog);
    },

    setPaused: (paused) => set({ paused }),
    setSpeed: (ticksPerSecond) => set({ ticksPerSecond }),

    payRent: () => set((s) => ({ pending: [...s.pending, { type: 'payRent' }], activeCard: null })),

    takeLoan: () =>
      set((s) => ({ pending: [...s.pending, { type: 'takeDutchmanLoan' }], activeCard: null })),

    requestNewGame: () => set({ activeCard: newGameCard(), paused: false }),

    startNewGame: (difficulty) => {
      localStorage.removeItem(SAVE_KEY);
      clearShown(); // a new tenancy meets its milestones fresh
      savePacedTick(0);
      set({
        state: initialState(DEFAULT_SEED, difficulty),
        actionLog: {},
        pending: [],
        paused: false,
        activeCard: null,
        shownCards: {},
        lastPacedTick: 0,
        battle: null,
      });
    },

    startBattle: () => {
      const s = get().state;
      const setup = raidBattleSetup(s);
      if (!setup || !s.raid) {
        set({ activeCard: null });
        return;
      }
      set({
        activeCard: null,
        battle: {
          setup,
          log: simulateBattle(setup),
          frame: 0,
          calls: [],
          callsLeft: MAX_CALLS,
          target: s.raid.target,
          targetName: nodeById(s.raid.target, s.farm, s.cuttingHouse).name,
        },
      });
    },

    advanceBattleFrame: () => {
      const b = get().battle;
      if (!b) return;
      if (b.frame >= b.log.frames.length - 1) {
        // The battle is watched out; settle it (the sim re-runs the same Calls,
        // so the world agrees with what the player just saw) and show the result.
        set((state) => ({
          pending: [...state.pending, { type: 'resolveRaid', calls: b.calls }],
          battle: null,
          activeCard: battleResultCard(b),
        }));
        return;
      }
      set({ battle: { ...b, frame: b.frame + 1 } });
    },

    soundCall: (call) => {
      const b = get().battle;
      if (!b || b.callsLeft <= 0) return;
      const calls = [...b.calls, { frame: b.frame, call }];
      const log = simulateBattle({ ...b.setup, calls });
      set({
        battle: { ...b, log, calls, callsLeft: b.callsLeft - 1, frame: Math.min(b.frame, log.frames.length - 1) },
      });
    },

    setAutoPayRent: (on) => {
      try {
        localStorage.setItem(AUTOPAY_KEY, on ? '1' : '0');
      } catch {
        // a lost preference is no catastrophe; the ask simply returns
      }
      set({ autoPayRent: on });
    },

    dismissCard: () => set({ activeCard: null }),

    save: () => {
      const { state, actionLog } = get();
      writeSave(state, actionLog);
    },
  };
});

if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = useGameStore;
}

