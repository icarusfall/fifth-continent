// Spec §14 — combat as deterministic attrition. The battle is a sub-tick loop
// that runs the attrition *for real* and emits a frame log; the renderer plays
// the log back, so the player watches something that genuinely happened. There
// are no dice here: `simulateBattle` is a pure function of the setup and the
// player's Calls. It touches no GameState, no clock, no RNG — the caller (M4c
// raids) feeds it forces and applies `consequences` to the world afterwards.

import {
  BOUND_GUARDIAN_ALPHA,
  COMBAT_DT,
  COMBAT_LINEAR_REF,
  COMBAT_MAX_FRAMES,
  COMBAT_MIN_STRENGTH,
  ROUT_TOLL,
  WIGHT_FOG_ALPHA_MULT,
  WIGHT_FOG_DEBT,
  COMBAT_START_MORALE,
  DEBT_PER_GUARDIAN_FRAME,
  ENGINE_FIRE_HEAT,
  ENGINE_SPIKE_ALPHA,
  FACTION_ALPHA,
  FACTION_BREAKPOINT,
  FORT_ALPHA_PER_TIER,
  LEADER_DOWN_MORALE,
  LEADER_DOWN_THRESHOLD,
  MORALE_CASUALTY_COEFF,
  NATIONAL_HEAT_PER_DRAGOON_DEAD,
  NATIONAL_HEAT_PER_REVENUE_DEAD,
  PAY_OFFABLE,
  PAYOFF_BASE,
  PAYOFF_PER_ENEMY_HEAD,
  REVENUE_FACTIONS,
  STANDING_LOSS_PER_FRIENDLY_DEAD,
} from './balance';

// ---- The forces ----

export type Faction = keyof typeof FACTION_ALPHA;

/** Aimed fire on open ground squares numbers (§14.1); prepared ground makes it
 *  linear — the marsh's fog and hollow ways convert one to the other. */
export type CombatLaw = 'square' | 'linear';

/** One side of a battle. Headcount is fractional internally; the render rounds. */
export interface ForceSpec {
  faction: Faction;
  /** Front-line men committed at the first sub-tick. */
  strength: number;
  /** Men held back, fed in by the Commit-the-Reserve call (player side only). */
  reserve?: number;
  /** Ground works: each tier adds to *this* side's alpha only when defending. */
  fortTier?: number;
  /** Galvanic fence, steam-ram, and the like — additive alpha (§14.2). */
  techAlpha?: number;
  /** A Bound Guardian fights here — highest alpha, and Debt every frame (§14.2). */
  guardian?: boolean;
  /**
   * Override the faction's base alpha / break point. A mixed force — a garrison
   * of militia and crew (§6.13) — passes a headcount-blend here; `faction` then
   * only names it in the readout.
   */
  alpha?: number;
  breakPoint?: number;
}

// ---- The player's Calls (§14.4) — queued so determinism survives ----

export type Call =
  | 'commitReserve' // held-back men enter now; timing is everything
  | 'fireEngine' // one-shot Sluice-Cannon / Guardian: an alpha spike, at a price
  | 'wightFog' // §6.14 Marsh 2: the raiders fight half-blind, at 8 Debt
  | 'soundRetreat' // rout voluntarily, before morale collapses; your people live
  | 'payOff'; // coin to end it — works on the Company and Officers, no one else

export interface ScheduledCall {
  /** Sub-tick at which the player makes the Call. */
  frame: number;
  call: Call;
}

export interface BattleSetup {
  attacker: ForceSpec;
  defender: ForceSpec;
  /** A property of the terrain plus the defender's concealment tech (§14.1). */
  law: CombatLaw;
  /** Which side is the player's — it gets the reserve and the three Calls. */
  playerSide: 'attacker' | 'defender';
  /** Under wight-fog the enemy counter is hidden in the render (§14.5). */
  fog?: boolean;
  /** Up to three Calls; anything past the third is dropped (§14.4). */
  calls?: ScheduledCall[];
}

// ---- The log the renderer plays back (§14) ----

export type CombatEventKind =
  | 'volley'
  | 'engine_fired'
  | 'fog_called'
  | 'leader_down'
  | 'rout'
  | 'reserve_committed';

export interface CombatEvent {
  kind: CombatEventKind;
  /** Whose event: the player's side, or the enemy's. */
  side: 'attacker' | 'defender';
}

export interface CombatFrame {
  t: number;
  attackers: number;
  defenders: number;
  attackerMorale: number;
  defenderMorale: number;
  events: CombatEvent[];
}

export type CombatOutcome =
  | 'attacker_rout'
  | 'defender_rout'
  | 'mutual_collapse'
  | 'paid_off';

/** Everything the economy needs from a fight (spec §14.6). */
export interface CombatConsequences {
  friendlyDead: number;
  revenueDead: number;
  dragoonDead: number;
  guardianActiveFrames: number;
  standingLoss: number;
  nationalHeat: number;
  debt: number;
  /** Coin owed if the battle ended in a pay-off, else 0. */
  payOffCost: number;
}

export interface CombatLog {
  frames: CombatFrame[];
  outcome: CombatOutcome;
  survivors: { attackers: number; defenders: number };
  law: CombatLaw;
  /** The enemy's numbers are hidden from the player in this fight (§14.5). */
  fogged: boolean;
  playerWon: boolean;
  consequences: CombatConsequences;
}

// ---- Static readings (for the pre-battle screen, spec §14.3/§14.4) ----

/** A force's effective alpha. Fort works count only when the side defends. */
export function effectiveAlpha(force: ForceSpec, isDefender: boolean): number {
  let a = (force.alpha ?? FACTION_ALPHA[force.faction]) + (force.techAlpha ?? 0);
  if (force.guardian) a += BOUND_GUARDIAN_ALPHA;
  if (isDefender) a += (force.fortTier ?? 0) * FORT_ALPHA_PER_TIER;
  return a;
}

/** Coin never silences Dragoons or wights — and the button says so (§14.4). */
export function canPayOff(enemy: Faction): boolean {
  return PAY_OFFABLE.includes(enemy);
}

// ---- The sub-tick loop ----

interface SideRuntime {
  faction: Faction;
  strength: number;
  reserve: number; // held back; not yet on the field, so not yet at risk
  entered: number; // men who have actually taken the line — grows on commit
  alpha: number; // live: the engine call can raise it mid-battle
  morale: number;
  breakPoint: number;
  guardian: boolean;
  leaderDown: boolean;
  routed: boolean;
}

function makeSide(force: ForceSpec, isDefender: boolean): SideRuntime {
  return {
    faction: force.faction,
    strength: force.strength,
    reserve: Math.max(0, force.reserve ?? 0),
    entered: force.strength,
    alpha: effectiveAlpha(force, isDefender),
    morale: COMBAT_START_MORALE,
    breakPoint: force.breakPoint ?? FACTION_BREAKPOINT[force.faction],
    guardian: force.guardian ?? false,
    leaderDown: false,
    routed: false,
  };
}

/** Losses inflicted *on* a side this sub-tick (§14.1). Square: enemy headcount
 *  only, so numbers dominate superlinearly. Linear: scaled by how many of your
 *  own you can bring to bear against a reference cohort — outnumbered hurts less. */
function lossesOn(victim: SideRuntime, killer: SideRuntime, law: CombatLaw): number {
  const base = killer.alpha * killer.strength * COMBAT_DT;
  if (law === 'square') return base;
  return base * (victim.strength / COMBAT_LINEAR_REF);
}

export function simulateBattle(setup: BattleSetup): CombatLog {
  const att = makeSide(setup.attacker, setup.playerSide === 'defender');
  const def = makeSide(setup.defender, setup.playerSide === 'attacker');
  const player = setup.playerSide === 'attacker' ? att : def;
  const enemy = player === att ? def : att;

  // At most three Calls, taken in the order the player queued them (§14.4).
  const calls = [...(setup.calls ?? [])].sort((a, b) => a.frame - b.frame).slice(0, 3);

  const frames: CombatFrame[] = [];
  let guardianActiveFrames = 0;
  let engineFired = false;
  let fogCalled = false;
  let payOffCost = 0;
  let outcome: CombatOutcome | null = null;

  for (let t = 0; t < COMBAT_MAX_FRAMES; t++) {
    const events: CombatEvent[] = [];
    const sideOf = (s: SideRuntime): 'attacker' | 'defender' => (s === att ? 'attacker' : 'defender');

    // 1. The player's Calls for this sub-tick, queued into the loop.
    for (const c of calls) {
      if (c.frame !== t) continue;
      if (c.call === 'commitReserve' && player.reserve > 0) {
        player.strength += player.reserve;
        player.entered += player.reserve; // fresh men on the line
        player.reserve = 0;
        events.push({ kind: 'reserve_committed', side: sideOf(player) });
      } else if (c.call === 'fireEngine' && !engineFired) {
        player.alpha += ENGINE_SPIKE_ALPHA;
        engineFired = true;
        events.push({ kind: 'engine_fired', side: sideOf(player) });
      } else if (c.call === 'wightFog' && !fogCalled) {
        // §6.14 Marsh 2 — the fog comes up off the dykes: the raiders swing
        // at shapes for the rest of the battle. Priced in Debt, not coin.
        enemy.alpha *= WIGHT_FOG_ALPHA_MULT;
        fogCalled = true;
        events.push({ kind: 'fog_called', side: sideOf(player) });
      } else if (c.call === 'soundRetreat') {
        player.routed = true; // walk off the field with your people alive
        events.push({ kind: 'rout', side: sideOf(player) });
      } else if (c.call === 'payOff' && canPayOff(enemy.faction)) {
        payOffCost = payOffCostNow(player, enemy);
        outcome = 'paid_off';
      }
    }
    if (outcome === 'paid_off') {
      frames.push(snapshot(t, att, def, events));
      break;
    }

    // 2. A voluntary retreat ends the fight before the volley lands.
    if (player.routed) {
      outcome = player === att ? 'attacker_rout' : 'defender_rout';
      frames.push(snapshot(t, att, def, events));
      break;
    }

    // 3. The volley: simultaneous attrition under the tile's law (§14.1).
    const attLoss = lossesOn(att, def, setup.law);
    const defLoss = lossesOn(def, att, setup.law);
    const attRate = att.strength > 0 ? attLoss / att.strength : 0;
    const defRate = def.strength > 0 ? defLoss / def.strength : 0;
    att.strength = Math.max(0, att.strength - attLoss);
    def.strength = Math.max(0, def.strength - defLoss);
    if (attLoss > 0 || defLoss > 0) {
      events.push({ kind: 'volley', side: defRate >= attRate ? 'attacker' : 'defender' });
    }
    if (player.guardian && player.strength >= COMBAT_MIN_STRENGTH) guardianActiveFrames++;

    // 4. A leader falls once a side is half gone — a one-time morale shock (§14.3).
    const attLeader = leaderFalls(att, 'attacker', events);
    const defLeader = leaderFalls(def, 'defender', events);

    // 5. Morale erodes with blood; break below the floor and the side runs (§14.3).
    //    The rate enters as a percentage: a frame that costs 5% of a side is a
    //    30-point morale blow — one hard volley routs the fainthearted.
    erodeMorale(att, attRate * 100, attLeader);
    erodeMorale(def, defRate * 100, defLeader);

    const attSpent = att.strength < COMBAT_MIN_STRENGTH;
    const defSpent = def.strength < COMBAT_MIN_STRENGTH;
    const attBroke = !attSpent && breaks(att);
    const defBroke = !defSpent && breaks(def);
    if (attBroke) events.push({ kind: 'rout', side: 'attacker' });
    if (defBroke) events.push({ kind: 'rout', side: 'defender' });
    // §14.3 — the rout's toll: broken men are cut down as they run. A
    // voluntary retreat (handled above, before the volley) pays no toll.
    if (attBroke) att.strength = Math.max(0, att.strength * (1 - ROUT_TOLL));
    if (defBroke) def.strength = Math.max(0, def.strength * (1 - ROUT_TOLL));

    frames.push(snapshot(t, att, def, events));

    const attGone = attSpent || attBroke;
    const defGone = defSpent || defBroke;
    if (attGone && defGone) {
      outcome = 'mutual_collapse';
      break;
    }
    if (attGone) {
      outcome = 'attacker_rout';
      break;
    }
    if (defGone) {
      outcome = 'defender_rout';
      break;
    }
  }

  // A battle that never resolves (it should not) is a mutual exhaustion.
  if (outcome === null) outcome = 'mutual_collapse';

  const survivors = {
    attackers: Math.max(0, Math.round(att.strength)),
    defenders: Math.max(0, Math.round(def.strength)),
  };
  const playerSurvivors = player === att ? survivors.attackers : survivors.defenders;
  const enemySurvivors = player === att ? survivors.defenders : survivors.attackers;
  // The player prevails only if he holds the field: the enemy ran or was
  // destroyed, and he did not. A pay-off is a survival, not a victory (§14.4).
  const enemyGone = enemySurvivors < COMBAT_MIN_STRENGTH || enemyBroke(outcome, player === att);
  const playerWon =
    outcome !== 'paid_off' && !player.routed && playerSurvivors >= COMBAT_MIN_STRENGTH && enemyGone;

  return {
    frames,
    outcome,
    survivors,
    law: setup.law,
    fogged: setup.fog ?? false,
    playerWon,
    consequences: tally(att, def, player, guardianActiveFrames, engineFired, fogCalled, payOffCost),
  };
}

// ---- Helpers ----

function snapshot(
  t: number,
  att: SideRuntime,
  def: SideRuntime,
  events: CombatEvent[],
): CombatFrame {
  return {
    t,
    attackers: att.strength,
    defenders: def.strength,
    attackerMorale: att.morale,
    defenderMorale: def.morale,
    events,
  };
}

/** The one-time leader-down check: crossing half-strength drops a leader. */
function leaderFalls(
  side: SideRuntime,
  tag: 'attacker' | 'defender',
  events: CombatEvent[],
): boolean {
  if (side.leaderDown) return false;
  if (side.strength >= side.entered * LEADER_DOWN_THRESHOLD) return false;
  side.leaderDown = true;
  events.push({ kind: 'leader_down', side: tag });
  return true;
}

/** @param casualtyPercent this frame's losses as a percentage of the side (§14.3). */
function erodeMorale(side: SideRuntime, casualtyPercent: number, leaderDown: boolean): void {
  side.morale -= casualtyPercent * MORALE_CASUALTY_COEFF + (leaderDown ? LEADER_DOWN_MORALE : 0);
  if (side.morale < 0) side.morale = 0;
}

/** Rout when morale falls below the floor. Dragoons and wights sit at 0 and,
 *  since morale never goes negative, they never break — they fight to the last. */
function breaks(side: SideRuntime): boolean {
  return side.morale < side.breakPoint;
}

function payOffCostNow(player: SideRuntime, enemy: SideRuntime): number {
  const lost = Math.max(0, player.entered - player.strength);
  const lossRatio = player.entered > 0 ? lost / player.entered : 0;
  return Math.round((PAYOFF_BASE + enemy.strength * PAYOFF_PER_ENEMY_HEAD) * (1 + lossRatio));
}

function enemyBroke(outcome: CombatOutcome, playerIsAttacker: boolean): boolean {
  return playerIsAttacker ? outcome === 'defender_rout' : outcome === 'attacker_rout';
}

function tally(
  att: SideRuntime,
  def: SideRuntime,
  player: SideRuntime,
  guardianActiveFrames: number,
  engineFired: boolean,
  fogCalled: boolean,
  payOffCost: number,
): CombatConsequences {
  const enemy = player === att ? def : att;
  const friendlyDead = Math.max(0, Math.round(player.entered - player.strength));
  const enemyDead = Math.max(0, Math.round(enemy.entered - enemy.strength));
  const revenueDead = REVENUE_FACTIONS.includes(enemy.faction) ? enemyDead : 0;
  const dragoonDead = enemy.faction === 'dragoons' ? enemyDead : 0;

  const standingLoss = friendlyDead * STANDING_LOSS_PER_FRIENDLY_DEAD;
  const nationalHeat =
    revenueDead * NATIONAL_HEAT_PER_REVENUE_DEAD +
    dragoonDead * NATIONAL_HEAT_PER_DRAGOON_DEAD +
    (engineFired ? ENGINE_FIRE_HEAT : 0);
  const debt = guardianActiveFrames * DEBT_PER_GUARDIAN_FRAME + (fogCalled ? WIGHT_FOG_DEBT : 0);

  return {
    friendlyDead,
    revenueDead,
    dragoonDead,
    guardianActiveFrames,
    standingLoss,
    nationalHeat,
    debt,
    payOffCost,
  };
}
