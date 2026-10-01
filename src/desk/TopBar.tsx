// The desk's instrument bar (spec §20.4): one row across the top of the
// table, at a size read at a glance — the clock, the tide, the purse, the
// rent, the parish's and London's heat, the marsh's account, the parish's
// regard, the bench, and the speeds. Meters appear when the world gives them
// something to say (§10).

import {
  BINDING_CAPACITY,
  LONDON_GAUGE_CEILING,
  OFFICER_ARRIVAL_HEAT,
  PROMOTION_THRESHOLD,
  TICKS_PER_DAY,
} from '../sim/balance';
import { rentAmount } from '../sim/tick';
import { clockOf, dayPhaseOf, isFlooded, tideIsRising, tideLevel, ticksUntilTideTurn } from '../sim/time';
import { spanOf } from '../shared/format';
import { benchReport } from '../shared/words';
import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';

const PHASE_GLYPH: Record<string, string> = { dawn: '◒', day: '☀', dusk: '◓', night: '☾' };

const SPEEDS: Array<[number, string, string]> = [
  [1, '▷', 'An amble — a day in about two and a half minutes'],
  [3, '▶', 'A walk — a day in under a minute'],
  [10, '▶▶', 'A trot'],
  [30, '▶▶▶', 'A gallop'],
];

function Meter({ pct, hue, notch, title }: { pct: number; hue: string; notch?: number; title: string }) {
  return (
    <span className="meter" title={title}>
      <i style={{ width: `${Math.min(1, pct) * 100}%`, background: hue }} />
      {notch !== undefined && <b style={{ left: `${notch * 100}%` }} />}
    </span>
  );
}

export function TopBar() {
  const state = useGameStore((s) => s.state);
  const paused = useGameStore((s) => s.paused);
  const setPaused = useGameStore((s) => s.setPaused);
  const speed = useGameStore((s) => s.ticksPerSecond);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const waiting = useGameStore((s) => s.waitingForLugger);
  const setWaiting = useGameStore((s) => s.setWaitingForLugger);
  const requestNewGame = useGameStore((s) => s.requestNewGame);
  const select = useDeskUi((s) => s.select);

  const clock = clockOf(state.tick);
  const phase = dayPhaseOf(state.tick);
  const tide = tideLevel(state.tick);
  const flooded = isFlooded(state.tick);
  const rent = rentAmount(state);
  const rentUrgent = state.coin < rent && state.rentDueTick - state.tick < 2 * TICKS_PER_DAY;
  const daysToRent = Math.max(0, Math.ceil((state.rentDueTick - state.tick) / TICKS_PER_DAY));
  const regional = state.heat.regional;
  const parishPct = Math.min(1, regional / PROMOTION_THRESHOLD);
  const showHeat = regional > 0.5 || state.heat.national > 0.5 || state.revenue.officer.arrived;
  const bench = benchReport(state);
  const capacity = state.boundWights * BINDING_CAPACITY;
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');

  return (
    <header className="topbar">
      <span className="tb clock" title={`Day ${clock.day} — ${phase}`}>
        <b>Day {clock.day}</b> {PHASE_GLYPH[phase]} {hh}:{mm}
      </span>
      <span
        className="tb"
        title={`${flooded ? 'The low road is drowned' : 'The low road is open'} — the tide turns in ${spanOf(ticksUntilTideTurn(state.tick))}.`}
      >
        <em>tide</em> {tideIsRising(state.tick) ? '▲' : '▼'}
        <Meter pct={tide} hue={flooded ? '#4A6670' : '#5E7A7D'} title={`Tide ${Math.round(tide * 100)}%`} />
        {flooded && <span className="tb-note">low road drowned</span>}
      </span>
      <span className="tb">
        <em>coin</em> <b>{state.coin}</b>
      </span>
      <span className={rentUrgent ? 'tb urgent' : 'tb'}>
        <em>rent</em> {rent} in {daysToRent} day{daysToRent === 1 ? '' : 's'}
        {state.coin < rent ? ` · short ${rent - state.coin}` : ''}
      </span>
      {showHeat && (
        <span className="tb" title={`The parish ${regional.toFixed(1)} / ${PROMOTION_THRESHOLD}; London ${state.heat.national.toFixed(1)}`}>
          <em>heat</em>
          <Meter
            pct={parishPct}
            hue={`hsl(${Math.round(120 * (1 - parishPct))} 55% 45%)`}
            notch={OFFICER_ARRIVAL_HEAT / PROMOTION_THRESHOLD}
            title="The parish: the notch is where the officer comes"
          />
          <em>London</em>
          <Meter pct={state.heat.national / LONDON_GAUGE_CEILING} hue="#4b6d97" title="London: the meter the Crown reads" />
        </span>
      )}
      {state.boundWights > 0 && (
        <span className={state.debt > capacity ? 'tb urgent' : 'tb'} title="The marsh's account. It never decays.">
          <em>debt</em> {Math.ceil(state.debt)}/{capacity}
        </span>
      )}
      <span className={state.standing < 30 ? 'tb urgent' : 'tb'}>
        <em>standing</em> {Math.round(state.standing)}
      </span>
      {bench && (
        <span className="tb" title="The bench: one project at a time">
          <em>bench</em> {bench.name}, {bench.left}
        </span>
      )}
      <span className="tb-spacer" />
      <button className="tb-btn" onClick={() => select({ kind: 'ledger' })} title="The books (L)">
        Ledger
      </button>
      <span className="speeds">
        <button className={paused ? 'on' : undefined} onClick={() => setPaused(!paused)} title="Pause (Space)">
          ⏸
        </button>
        {SPEEDS.map(([tps, glyph, title]) => (
          <button
            key={tps}
            className={speed === tps && !paused && !waiting ? 'on' : undefined}
            title={title}
            onClick={() => {
              setSpeed(tps);
              setPaused(false);
            }}
          >
            {glyph}
          </button>
        ))}
        {waiting && (
          <button className="on" title="Waiting on the lugger — click to call it off" onClick={() => setWaiting(false)}>
            ☾…
          </button>
        )}
      </span>
      <button className="tb-btn quiet" onClick={requestNewGame} title="Start a new tenancy">
        New game
      </button>
    </header>
  );
}
