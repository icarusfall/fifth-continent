// Spec §14 — the battle, watched. The store holds a CombatLog (re-run
// deterministically whenever a Call is sounded); this overlay plays it back a
// frame at a time, and offers the three Calls. The player watches something
// that genuinely happened.

import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { canPayOff } from '../sim/combat';
import { useGameStore } from '../state/store';

// Every battle should take a watchable ~8–10s regardless of how many frames
// the sim produced (playtest: fights ended before they could be felt): a
// short rout plays slowly — the bars glide — and a long grind compresses.
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
};

interface RowProps {
  label: string;
  count: number;
  morale: number;
  color: string;
  max: number;
  fog?: boolean;
}

function BattleRow({ label, count, morale, color, max, fog }: RowProps) {
  return (
    <div className="battle-row">
      <div className="battle-row-head">
        <span>{label}</span>
        <span className="battle-count">{fog ? '?' : count}</span>
      </div>
      <div className="battle-bar">
        <div style={{ width: `${Math.max(0, (count / max) * 100)}%`, background: color }} />
      </div>
      <div className="battle-morale">
        <div style={{ width: `${Math.max(0, Math.min(100, morale))}%` }} />
      </div>
    </div>
  );
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
  const max = Math.max(attStart, defStart, 1);

  const events = f.events.map((e) => EVENT_TEXT[e.kind]).filter(Boolean);
  const dragoons = attFaction === 'dragoons';
  const canRetreat = callsLeft > 0;
  const canPay = callsLeft > 0 && canPayOff(attFaction);

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
        <p className="battle-law">
          Open ground · square law · numbers tell{dragoons ? ' · they do not rout' : ''}
        </p>

        <div className="battle-field" key={frame}>
          {Array.from({ length: flashes }, (_, i) => (
            <span
              key={i}
              className="battle-flash"
              style={{
                left: `${(frame * 37 + i * 53) % 96}%`,
                top: `${(frame * 19 + i * 29) % 80}%`,
                animationDelay: `${((frame * 13 + i * 41) % 60) * 2}ms`,
              }}
            />
          ))}
        </div>

        <BattleRow
          label={FACTION_NAME[attFaction] ?? attFaction}
          count={Math.round(f.attackers)}
          morale={f.attackerMorale}
          color={FACTION_COLOR[attFaction] ?? '#7A3B32'}
          max={max}
          fog={setup.fog}
        />
        <BattleRow
          label="Your men"
          count={Math.round(f.defenders)}
          morale={f.defenderMorale}
          color="#E8E1D2"
          max={max}
        />

        <div
          className={events.length > 0 ? 'battle-events flash' : 'battle-events'}
          key={`ev-${frame}`}
        >{events.join(' · ') || ' '}</div>

        <div className="battle-calls">
          <span className="calls-left">
            {callsLeft} call{callsLeft === 1 ? '' : 's'} left
          </span>
          <button disabled title="No reserve is posted here">
            Commit the reserve
          </button>
          <button disabled title="No engine — that is Leiden's work">
            Fire the engine
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
