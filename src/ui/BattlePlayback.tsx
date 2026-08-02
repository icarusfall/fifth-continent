// Spec §14 — the battle, watched. The store holds a CombatLog (re-run
// deterministically whenever a Call is sounded); this overlay plays it back a
// frame at a time, and offers the three Calls. The player watches something
// that genuinely happened.
//
// §6.13 (M5c playtest) — the playback is men, not meters: one dot per whole
// man, defenders ringed at the building, attackers pressing in, dots winking
// out as strength falls and streaming off the field on a rout. The count IS
// the battle. All per-dot randomness is deterministic off the dot index and
// frame (§15.1 owns it; the sim's dice are never touched).

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { canPayOff } from '../sim/combat';
import type { CombatLog } from '../sim/combat';
import { useGameStore } from '../state/store';

// Every battle should take a watchable ~8–10s regardless of how many frames
// the sim produced (playtest: fights ended before they could be felt): a
// short rout plays slowly — the field glides — and a long grind compresses.
const BATTLE_TARGET_MS = 9000;
const FRAME_MS_MIN = 60;
const FRAME_MS_MAX = 800;

const FACTION_COLOR: Record<string, string> = {
  hawksmere: '#7A3B32', // oxblood
  'water-guard': '#2E4A6B', // Revenue blue — the Crown's men
  dragoons: '#2E4A6B',
  'riding-officer': '#2E4A6B',
  wights: '#6FBF8F',
};

const FACTION_NAME: Record<string, string> = {
  hawksmere: 'The Hawksmere Company',
  'water-guard': 'The Water Guard',
  dragoons: 'Dragoons',
  'riding-officer': 'Riding Officers',
  wights: 'Wights',
};

const EVENT_TEXT: Record<string, string> = {
  leader_down: 'A leader falls',
  rout: 'They break',
  reserve_committed: 'The reserve is in',
  engine_fired: 'The engine roars',
  fog_called: 'The fog comes up off the dykes',
  // §6.18 (M5½c) — the two moments the ground decides the fight.
  crossing_forced: 'THE CROSSING IS FORCED — they are over',
  crossing_cut: 'The bank goes out under them',
};

const GOLDEN = 2.399963; // the golden angle spreads any headcount evenly

/** Deterministic 0..1 from an integer — stable across replays of a frame. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The first frame at which a side broke, if it has (§14.3). */
function routFrameOf(log: CombatLog, upTo: number, side: 'attacker' | 'defender'): number | null {
  for (let i = 0; i <= upTo && i < log.frames.length; i++) {
    if (log.frames[i].events.some((e) => e.kind === 'rout' && e.side === side)) return i;
  }
  return null;
}

interface DotSpec {
  left: number; // percent
  top: number; // percent
  state: 'fighting' | 'fallen' | 'fleeing';
}

/**
 * Every man of one side, placed: the living ringed and skirmishing, the
 * fallen lying where they stood, the broken streaming off the field. The
 * field is wider than tall, so x-radii stretch by the aspect.
 */
function sideDots(opts: {
  side: 'attacker' | 'defender';
  start: number;
  count: number;
  frame: number;
  totalFrames: number;
  routFrame: number | null;
}): DotSpec[] {
  const { side, start, count, frame, totalFrames, routFrame } = opts;
  const dots: DotSpec[] = [];
  const salt = side === 'attacker' ? 900 : 100;
  // Attackers press from a wide ring to musket range over the opening frames.
  const approach = side === 'attacker' ? Math.min(1, frame / Math.max(3, totalFrames * 0.2)) : 1;

  for (let i = 0; i < start; i++) {
    const angle = i * GOLDEN + (side === 'attacker' ? 0.4 : 0) + hash01(i + salt) * 0.5;
    const baseR =
      side === 'defender'
        ? 13 + hash01(i + salt + 1) * 7
        : 44 - 22 * approach + hash01(i + salt + 1) * 6;
    const fallen = i >= count;
    const fleeing = !fallen && routFrame !== null && frame > routFrame;
    // The living skirmish in place; the fallen lie still; the broken run.
    const wiggleX = fallen ? 0 : Math.sin(frame * 0.7 + i * 2.4) * 1.8;
    const wiggleY = fallen ? 0 : Math.cos(frame * 0.6 + i * 1.7) * 1.4;
    const flee = fleeing ? (frame - (routFrame ?? 0)) * 4.5 : 0;
    const r = baseR + flee;
    dots.push({
      left: 50 + Math.cos(angle) * r * 1.35 + wiggleX,
      top: 55 + Math.sin(angle) * r + wiggleY,
      state: fallen ? 'fallen' : fleeing ? 'fleeing' : 'fighting',
    });
  }
  return dots;
}

/** The count is the battle; the word under it is the stomach for it. */
function moraleWord(morale: number, broke: boolean, unbreaking: boolean): string {
  if (broke) return 'broken — running';
  if (unbreaking) return 'they do not rout';
  if (morale > 66) return 'steady';
  if (morale > 33) return 'wavering';
  return 'breaking';
}

export function BattlePlayback() {
  const battle = useGameStore((s) => s.battle);
  const soundCall = useGameStore((s) => s.soundCall);
  const marshTier = useGameStore((s) => s.state.research.completed.marsh);
  const active = battle !== null;
  const frameCount = battle?.log.frames.length ?? 1;
  const frameMs = Math.max(FRAME_MS_MIN, Math.min(FRAME_MS_MAX, BATTLE_TARGET_MS / frameCount));

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => useGameStore.getState().advanceBattleFrame(), frameMs);
    return () => window.clearInterval(id);
  }, [active, frameMs]);

  if (!battle) return null;
  const { setup, log, frame, callsLeft } = battle;
  const f = log.frames[frame];
  const prev = log.frames[Math.max(0, frame - 1)];
  const attFaction = setup.attacker.faction;
  const attStart = setup.attacker.strength + (setup.attacker.reserve ?? 0);
  const defStart = setup.defender.strength + (setup.defender.reserve ?? 0);

  const events = f.events.map((e) => EVENT_TEXT[e.kind]).filter(Boolean);
  const dragoons = attFaction === 'dragoons';
  const canRetreat = callsLeft > 0;
  const canPay = callsLeft > 0 && canPayOff(attFaction);

  const attRout = routFrameOf(log, frame, 'attacker');
  const defRout = routFrameOf(log, frame, 'defender');

  // §6.18/§14.1 (M5½c) — the ground, read aloud and kept honest as it changes:
  // the crossing holds only while there are men enough to man it.
  const frontage = setup.frontage ?? 0;
  const forced =
    frontage > 0 &&
    log.frames
      .slice(0, frame + 1)
      .some((fr) => fr.events.some((e) => e.kind === 'crossing_forced'));
  const alreadyCut = battle.calls.some((c) => c.call === 'cutCrossing');
  const groundLine =
    frontage <= 0
      ? `Open ground · square law · numbers tell${dragoons ? ' · they do not rout' : ''}`
      : forced
        ? `The crossing is forced · open ground now · numbers tell${dragoons ? ' · they do not rout' : ''}`
        : `Behind the water · ${frontage} abreast at the crossing · held while ${frontage} of yours stand${
            dragoons ? ' · they do not rout' : ''
          }`;
  const attackers = sideDots({
    side: 'attacker',
    start: Math.round(attStart),
    count: Math.max(0, Math.round(f.attackers)),
    frame,
    totalFrames: frameCount,
    routFrame: attRout,
  });
  const defenders = sideDots({
    side: 'defender',
    start: Math.round(defStart),
    count: Math.max(0, Math.round(f.defenders)),
    frame,
    totalFrames: frameCount,
    routFrame: defRout,
  });
  const attColor = FACTION_COLOR[attFaction] ?? '#7A3B32';

  // The volley: musket flashes each frame, as many as the moment is bloody —
  // positions pseudo-random from the frame index, so playback stays steady.
  const lossRate = Math.max(0, prev.attackers - f.attackers) + Math.max(0, prev.defenders - f.defenders);
  const flashes = Math.min(7, Math.ceil(lossRate * 6));

  return (
    <div className="event-scrim">
      <div
        className="battle-card"
        style={{ '--frame-ms': `${Math.round(frameMs)}ms` } as CSSProperties}
      >
        <h2>{battle.targetName} — the wall</h2>
        <p className="battle-law">{groundLine}</p>

        <div className="battle-line">
          <span style={{ color: attColor }}>{FACTION_NAME[attFaction] ?? attFaction}</span>
          <span className="battle-count">
            {setup.fog ? '?' : Math.round(f.attackers)} men ·{' '}
            {setup.fog && attRout === null
              ? 'shapes in the fog'
              : moraleWord(f.attackerMorale, attRout !== null, dragoons)}
          </span>
        </div>

        <div className="battle-field dots">
          {/* The building they came for — the fight has an address. */}
          <div className="battle-building" title={battle.targetName} />
          {attackers.map((d, i) => (
            <span
              key={`a${i}`}
              className={`battle-dot ${d.state}${setup.fog ? ' fogged' : ''}`}
              style={{ left: `${d.left}%`, top: `${d.top}%`, background: attColor }}
            />
          ))}
          {defenders.map((d, i) => (
            <span
              key={`d${i}`}
              className={`battle-dot ${d.state}`}
              style={{ left: `${d.left}%`, top: `${d.top}%`, background: '#E8E1D2' }}
            />
          ))}
          {Array.from({ length: flashes }, (_, i) => (
            <span
              key={`f${frame}-${i}`}
              className="battle-flash"
              style={{
                left: `${20 + ((frame * 37 + i * 53) % 60)}%`,
                top: `${25 + ((frame * 19 + i * 29) % 55)}%`,
                animationDelay: `${((frame * 13 + i * 41) % 60) * 2}ms`,
              }}
            />
          ))}
        </div>

        <div className="battle-line">
          <span>Your men</span>
          <span className="battle-count">
            {Math.round(f.defenders)} men · {moraleWord(f.defenderMorale, defRout !== null, false)}
          </span>
        </div>

        <div
          className={events.length > 0 ? 'battle-events flash' : 'battle-events'}
          key={`ev-${frame}`}
        >{events.join(' · ') || ' '}</div>

        <div className="battle-calls">
          <span className="calls-left">
            {callsLeft} call{callsLeft === 1 ? '' : 's'} left
          </span>
          <button disabled title="No reserve is posted here — the garrison stands as one.">
            Commit the reserve
          </button>
          <button disabled title="No engine — that is Leiden's last work, and it is not built.">
            Fire the engine
          </button>
          {/* §6.18 (M5½c) — the strongest verb in the milestone, and it eats
              the milestone: the channel goes with the men on the far bank. */}
          <button
            disabled={!(frontage > 0 && !forced && callsLeft > 0 && !alreadyCut)}
            title={
              frontage <= 0
                ? 'There is no bank here to break.'
                : forced
                  ? 'Too late — they are over.'
                  : 'Everyone not yet across stays across. The water takes the channel back, the grazing with it, and the parish knows whose spade did it.'
            }
            onClick={() => soundCall('cutCrossing')}
          >
            Cut the crossing
          </button>
          <button
            disabled={!(marshTier >= 2 && callsLeft > 0 && !battle.calls.some((c) => c.call === 'wightFog'))}
            title={
              marshTier >= 2
                ? 'The raiders fight half-blind for the rest of it — 8 Debt, owed to the stone.'
                : 'The stone has not taught the fog.'
            }
            onClick={() => soundCall('wightFog')}
          >
            Call the wight-fog
          </button>
          <button disabled={!canRetreat} onClick={() => soundCall('soundRetreat')}>
            Sound the retreat
          </button>
          <button
            disabled={!canPay}
            title={canPayOff(attFaction) ? undefined : 'Coin does not move them'}
            onClick={() => soundCall('payOff')}
          >
            Pay them off
          </button>
        </div>
      </div>
    </div>
  );
}
