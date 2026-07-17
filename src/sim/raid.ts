// Spec §6.13 — the Hawksmere raid. Your market footprint draws the Company; it
// musters, and after a few days' warning falls on your fattest building. The
// fight itself runs through the deterministic engine (§14, simulateBattle) —
// this module raises the two sides, times the raid, and applies the §14.6
// consequences to the world. No new combat maths, and no clock or dice of its
// own: a pure function of GameState, like the officer (§6.10).

import {
  DIFFICULTY,
  FACTION_ALPHA,
  FACTION_BREAKPOINT,
  FIRST_RAID_SEIZE_FRAC,
  FORT_ALPHA_PER_TIER,
  HAWKSMERE_BASE,
  HAWKSMERE_FIRST_RAID,
  HAWKSMERE_FIRST_RAID_DELAY_DAYS,
  HAWKSMERE_GROWTH,
  HAWKSMERE_PROVOKE,
  HAWKSMERE_SCALE,
  DRAGOON_BASE,
  DRAGOON_HEAT,
  MAX_LOG_EVENTS,
  RAID_INTERVAL_DAYS,
  RAID_MUSTER_LEAD_DAYS,
  TICKS_PER_DAY,
  WATER_GUARD_BASE,
  WATER_GUARD_HEAT,
} from './balance';
import { simulateBattle } from './combat';
import type { BattleSetup, CombatLog, Faction, ForceSpec, ScheduledCall } from './combat';
import { nodeById } from './map';
import { CONTRABAND, illicitCount, loseStanding } from './revenue';
import type { GameState, NodeId, Store } from './types';

const RAID_MUSTER_LEAD = RAID_MUSTER_LEAD_DAYS * TICKS_PER_DAY;

function logEvent(state: GameState, text: string): void {
  state.log.push({ tick: state.tick, text });
  if (state.log.length > MAX_LOG_EVENTS) {
    state.log.splice(0, state.log.length - MAX_LOG_EVENTS);
  }
}

/** The buildings that are yours to lose, cutting house first (§6.13). */
function ownedNodes(state: GameState): NodeId[] {
  return state.cuttingHouse ? ['cutting-house', 'farm'] : ['farm'];
}

/** They come for the goods: the building holding the most, ties to the cutting house. */
function raidTarget(state: GameState): NodeId {
  const order = ownedNodes(state); // cutting house leads, so it wins ties
  let best = order[0];
  let bestGoods = illicitCount(state.stores[best] ?? {});
  for (const n of order.slice(1)) {
    const goods = illicitCount(state.stores[n] ?? {});
    if (goods > bestGoods) {
      best = n;
      bestGoods = goods;
    }
  }
  return best;
}

/** Who rides today (§6.13): the Crown's worst, once national Heat has earned it,
 *  else the Company. Dragoons do not rout — the doom spiral made flesh (§11). */
function raidFaction(state: GameState): Faction {
  const national = state.heat.national;
  if (national >= DRAGOON_HEAT) return 'dragoons';
  if (national >= WATER_GUARD_HEAT) return 'water-guard';
  return 'hawksmere';
}

/** Raid headcount (§6.13): the Crown reads its base off the faction; the
 *  Company opens gentle, then grows with each raid survived and your footprint.
 *  §6.15: the dial scales the muster — the world's hand, not your yields. */
function raidSize(state: GameState, faction: Faction): number {
  const grown = state.hawksmere.raidsSurvived * HAWKSMERE_GROWTH;
  let size: number;
  if (faction === 'dragoons') size = DRAGOON_BASE + grown;
  else if (faction === 'water-guard') size = WATER_GUARD_BASE + grown;
  else if (state.hawksmere.raidsSurvived === 0) size = HAWKSMERE_FIRST_RAID;
  else size = HAWKSMERE_BASE + grown + Math.floor(state.contrabandSold / HAWKSMERE_SCALE);
  return Math.max(1, Math.round(size * DIFFICULTY[state.difficulty].raidMult));
}

/** The building's defenders as one force: a headcount-blend of militia and crew,
 *  plus the works' alpha (dogs, tier 1, give intelligence not alpha — §22). */
export function garrisonForce(state: GameState, node: NodeId): ForceSpec {
  const g = state.garrisons[node] ?? { militia: 0, crew: 0 };
  const total = g.militia + g.crew;
  const alpha =
    total > 0
      ? (g.militia * FACTION_ALPHA['marsh-militia'] + g.crew * FACTION_ALPHA['smuggler-crew']) /
        total
      : FACTION_ALPHA['marsh-militia'];
  const breakPoint =
    total > 0
      ? (g.militia * FACTION_BREAKPOINT['marsh-militia'] +
          g.crew * FACTION_BREAKPOINT['smuggler-crew']) /
        total
      : FACTION_BREAKPOINT['marsh-militia'];
  const fortTier = state.fortifications[node] ?? 0;
  const fortAlpha = Math.max(0, fortTier - 1) * FORT_ALPHA_PER_TIER; // dogs give no alpha
  return {
    faction: g.crew >= g.militia ? 'smuggler-crew' : 'marsh-militia', // names it in the readout
    strength: total,
    alpha,
    breakPoint,
    techAlpha: fortAlpha, // the works, minus the dogs' tier
  };
}

/** The pre-battle setup, for the readout and the fight (§14). Square law: no
 *  dykes yet (§21 is mid-game), so numbers dominate and the readout says so. */
export function raidBattleSetup(state: GameState, calls?: ScheduledCall[]): BattleSetup | null {
  const raid = state.raid;
  if (!raid) return null;
  return {
    attacker: { faction: raid.faction, strength: raid.size },
    defender: garrisonForce(state, raid.target),
    law: 'square',
    playerSide: 'defender',
    calls,
  };
}

/** Seize a share of a store's contraband. `frac >= 1` takes it all. */
function seizeGoods(store: Store, frac: number): number {
  let taken = 0;
  for (const g of CONTRABAND) {
    const have = store[g] ?? 0;
    const take = frac >= 1 ? have : Math.floor(have * frac);
    if (take > 0) {
      store[g] = have - take;
      taken += take;
    }
  }
  return taken;
}

/** Reduce a building's garrison to the survivors — crew hold, militia fall first. */
function applyGarrisonLosses(state: GameState, node: NodeId, survivors: number): void {
  const g = state.garrisons[node];
  if (!g) return;
  const kept = Math.max(0, Math.round(survivors));
  const crew = Math.min(g.crew, kept);
  g.crew = crew;
  g.militia = Math.min(g.militia, kept - crew);
}

/** Land the §14.6 consequences of a resolved raid on the world. */
function applyRaidConsequences(state: GameState, target: NodeId, isFirst: boolean, log: CombatLog): void {
  const c = log.consequences;
  loseStanding(state, c.standingLoss);
  state.heat.national += c.nationalHeat; // 0 against the Company, unless the engine fired
  applyGarrisonLosses(state, target, log.survivors.defenders);
  const name = nodeById(target, state.farm, state.cuttingHouse).name;

  // Bought off (§14.4): coin changes hands, they ride away, the goods stay.
  if (log.outcome === 'paid_off') {
    state.coin = Math.max(0, state.coin - c.payOffCost);
    logEvent(state, `You buy the Company off at ${name} for ${c.payOffCost} coin. They ride away, this time.`);
    return;
  }

  if (log.playerWon) {
    logEvent(state, `They break on the wall at ${name} and fall back. ${c.friendlyDead} of yours lie still.`);
    return;
  }
  // They hold the field: the goods are theirs. The gentle first raid takes a share.
  const frac = isFirst ? FIRST_RAID_SEIZE_FRAC : 1;
  const store = state.stores[target] ?? {};
  const taken = seizeGoods(store, frac);
  state.stores[target] = store;
  logEvent(
    state,
    taken > 0
      ? `${name} is overrun. The Company carries off ${taken} goods, and ${c.friendlyDead} of yours are lost.`
      : `${name} is overrun, but there was nothing worth the carrying.`,
  );
}

/**
 * Settle the pending raid (spec §6.13): run the battle through the engine with
 * whatever Calls the player sounded, land the consequences, and schedule the
 * next. The store surfaces this behind the raid card; headless, the bots call it
 * the moment a battle is pending.
 */
export function resolveRaid(state: GameState, calls?: ScheduledCall[]): void {
  const raid = state.raid;
  if (!raid || !raid.pendingBattle) return;
  const setup = raidBattleSetup(state, calls);
  if (!setup) return;
  const log = simulateBattle(setup);
  const isFirst = state.hawksmere.raidsSurvived === 0;
  applyRaidConsequences(state, raid.target, isFirst, log);

  state.hawksmere.raidsSurvived += 1;
  state.hawksmere.nextRaidTick = state.tick + RAID_INTERVAL_DAYS * TICKS_PER_DAY;
  state.lastCrisisTick = state.tick; // §6.15 — crisis spacing anchors here
  state.raid = null;
}

/**
 * One tick of the Company's intent: take notice, muster, and bring the blow to
 * the wall. Resolution is a separate step (the player answers the raid card).
 */
export function raidTick(state: GameState): void {
  if (state.lost) return;
  const hw = state.hawksmere;

  if (!hw.provoked) {
    if (state.contrabandSold >= HAWKSMERE_PROVOKE) {
      hw.provoked = true;
      hw.nextRaidTick = state.tick + HAWKSMERE_FIRST_RAID_DELAY_DAYS * TICKS_PER_DAY;
      logEvent(
        state,
        'The Hawksmere Company has marked you — you are cutting into their trade, and they do not share.',
      );
    }
    return;
  }

  if (!state.raid) {
    if (state.tick >= hw.nextRaidTick - RAID_MUSTER_LEAD) {
      // §6.15 crisis spacing: a blow never falls hard on the heels of the last
      // existential event — the muster waits, it does not vanish.
      const spacing = DIFFICULTY[state.difficulty].crisisSpacingDays * TICKS_PER_DAY;
      const earliest = state.lastCrisisTick + spacing;
      if (state.tick < earliest - RAID_MUSTER_LEAD) return;
      const target = raidTarget(state);
      const faction = raidFaction(state);
      const battleTick = Math.max(hw.nextRaidTick, state.tick + 1, earliest);
      state.raid = { faction, size: raidSize(state, faction), target, battleTick, pendingBattle: false };
      const days = Math.max(1, Math.round((battleTick - state.tick) / TICKS_PER_DAY));
      const rider =
        faction === 'dragoons' ? 'Dragoons form up' : faction === 'water-guard' ? 'the Water Guard lands' : 'a muster gathers on the shingle';
      logEvent(
        state,
        `${rider} — they ride for ${nodeById(target, state.farm, state.cuttingHouse).name} in ${days} day${days === 1 ? '' : 's'}. Post men, or lose the goods.`,
      );
    }
    return;
  }

  if (!state.raid.pendingBattle && state.tick >= state.raid.battleTick) {
    state.raid.pendingBattle = true;
    logEvent(
      state,
      `The Company is at ${nodeById(state.raid.target, state.farm, state.cuttingHouse).name}.`,
    );
  }
}
