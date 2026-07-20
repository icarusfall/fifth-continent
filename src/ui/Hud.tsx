import { useRef } from 'react';
import {
  BINDING_CAPACITY,
  DIFFICULTY_ORDER,
  DRAGOON_HEAT,
  FLOCK_CAP,
  LONDON_GAUGE_CEILING,
  OFFICER_ARRIVAL_HEAT,
  PROMOTION_THRESHOLD,
  TICKS_PER_HOUR,
  WATER_GUARD_HEAT,
} from '../sim/balance';
import { rentAmount } from '../sim/tick';
import {
  clockOf,
  dayPhaseOf,
  isFlooded,
  tideIsRising,
  tideLevel,
  ticksUntilTideTurn,
} from '../sim/time';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';
import { DYKE, HEAT_RED, ICHOR_GREEN, LIMEWASH, REVENUE_BLUE, ROOF, SEA } from './palette';

import { spanOf } from './format';

const PHASE_GLYPH = { day: '☀', dusk: '🌗', night: '☾' } as const;

/** §6.15 — the dial reads quietly and turns one way: down. */
function DifficultyNote({ state }: { state: GameState }) {
  const enqueue = useGameStore((s) => s.enqueue);
  const idx = DIFFICULTY_ORDER.indexOf(state.difficulty);
  return (
    <span className="hud-note">
      {state.difficulty}
      {idx > 0 && (
        <>
          {' · '}
          <button
            className="hud-inline"
            title="Ease the world's grip one notch. The marsh never gets harder by asking."
            onClick={() => enqueue({ type: 'setDifficulty', difficulty: DIFFICULTY_ORDER[idx - 1] })}
          >
            ease off
          </button>
        </>
      )}
    </span>
  );
}

/**
 * §6.10 / §20.2 — the two Heat gauges. No numbers on the face: the parish's
 * meter fills toward the promotion threshold (a notch where the officer
 * comes) and boils when pinned over the top; London's fills toward its
 * doom, with marks where the Crown escalates. Exact values ride in the
 * tooltips. The gauges appear only once there is heat to show (§10).
 */
function HeatGauges({ state, day }: { state: GameState; day: number }) {
  // Dawn-to-dawn trend, kept in the component: yesterday's reading against
  // the day before's. Decoration only — it never touches sim or save.
  const trend = useRef({ day, atDay: state.heat.regional, prev: null as number | null });
  if (day !== trend.current.day) {
    trend.current = { day, atDay: state.heat.regional, prev: trend.current.atDay };
  }
  const drift = trend.current.prev === null ? 0 : trend.current.atDay - trend.current.prev;

  const regional = state.heat.regional;
  const boiling = regional > PROMOTION_THRESHOLD;
  const parishPct = Math.min(1, regional / PROMOTION_THRESHOLD);
  // Cool green through amber to red as the parish warms — full is bad here,
  // the same visual sentence the store-fill bars speak.
  const hue = Math.round(120 * (1 - parishPct));
  const londonPct = Math.min(1, state.heat.national / LONDON_GAUGE_CEILING);

  return (
    <div className="hud-block">
      <span className="hud-label" style={{ color: REVENUE_BLUE }}>
        Heat
        {drift < -0.5 && (
          <span title="Cooler than yesterday. Lying low is working."> ▾</span>
        )}
        {drift > 0.5 && (
          <span style={{ color: HEAT_RED }} title="Hotter than yesterday. The parish is talking.">
            {' '}
            ▴
          </span>
        )}
      </span>
      <div
        className="heat-gauge"
        title={
          `The parish noticing (${Math.round(regional)}). It cools a little each dawn.` +
          (boiling
            ? ' Boiling over: the excess spills into London’s ear every morning.'
            : ' The notch is where a Riding Officer takes rooms.')
        }
      >
        <div
          className={boiling ? 'heat-fill heat-boil' : 'heat-fill'}
          style={{ width: `${parishPct * 100}%`, background: `hsl(${hue} 55% 45%)` }}
        />
        <div
          className="heat-notch"
          style={{ left: `${(OFFICER_ARRIVAL_HEAT / PROMOTION_THRESHOLD) * 100}%` }}
        />
      </div>
      <div
        className="heat-gauge london"
        title={`London noticing (${Math.round(state.heat.national)}). London does not forget. The marks are where the Crown sends worse men.`}
      >
        <div
          className="heat-fill"
          style={{ width: `${londonPct * 100}%`, background: REVENUE_BLUE }}
        />
        <div
          className="heat-notch"
          style={{ left: `${(WATER_GUARD_HEAT / LONDON_GAUGE_CEILING) * 100}%` }}
        />
        <div
          className="heat-notch"
          style={{ left: `${(DRAGOON_HEAT / LONDON_GAUGE_CEILING) * 100}%` }}
        />
      </div>
      <span className="hud-note">
        London{state.revenue.officer.arrived ? ' · an officer rides the Gault' : ''}
      </span>
    </div>
  );
}

export function Hud({ state }: { state: GameState }) {
  const clock = clockOf(state.tick);
  const phase = dayPhaseOf(state.tick);
  const tide = tideLevel(state.tick);
  const rising = tideIsRising(state.tick);
  const flooded = isFlooded(state.tick);
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  const rent = rentAmount(state);

  return (
    <div className="hud">
      <div className="hud-block">
        <span className="hud-label">Day {clock.day}</span>
        <span className="hud-clock">
          {PHASE_GLYPH[phase]} {hh}:{mm}
        </span>
      </div>

      <div className="hud-block">
        <span className="hud-label">Tide {rising ? '▲' : '▼'}</span>
        <div className="tide-gauge" title={`tide ${(tide * 100).toFixed(0)}%`}>
          <div
            className="tide-fill"
            style={{ width: `${tide * 100}%`, background: flooded ? SEA : DYKE }}
          />
        </div>
        <span className="hud-note" style={{ color: flooded ? LIMEWASH : undefined }}>
          {flooded
            ? `low road drowned · clears in ${spanOf(ticksUntilTideTurn(state.tick))}`
            : `low road open · floods in ${spanOf(ticksUntilTideTurn(state.tick))}`}
        </span>
      </div>

      <div className="hud-block">
        <span className="hud-label">Coin</span>
        <span className="hud-coin">{state.coin}</span>
      </div>

      <div className="hud-block">
        <span className="hud-label">Rent</span>
        <span
          className="hud-coin"
          style={{
            color:
              state.coin < rent && state.rentDueTick - state.tick < 24 * TICKS_PER_HOUR
                ? ROOF
                : undefined,
          }}
        >
          {rent}
        </span>
        <span className="hud-note">
          due day {clockOf(state.rentDueTick).day}, dawn
          {state.coin < rent ? ` · short ${rent - state.coin}` : ' · covered'}
        </span>
        {state.dutchmanBook > 0 && (
          <span
            className="hud-note"
            style={{ color: ROOF }}
            title="The Dutchman's book: he takes half of every sale until it clears."
          >
            his book: {state.dutchmanBook}
          </span>
        )}
        <DifficultyNote state={state} />
      </div>

      <div className="hud-block">
        <span className="hud-label">Fleece in store</span>
        <span className="hud-coin">{state.stores.farm?.fleece ?? 0}</span>
      </div>
      <div className="hud-block">
        <span className="hud-label">Flock</span>
        <span
          className="hud-coin"
          title={`Your sheep. The pasture holds ${FLOCK_CAP}.`}
        >
          {state.flockSize}
        </span>
        {state.sheepArriving > 0 && (
          <span className="hud-note">+{state.sheepArriving} on the drove road</span>
        )}
      </div>
      <div className="hud-block">
        <span className="hud-label">Wool on flock</span>
        <span className="hud-coin">{state.fleeceReady}</span>
      </div>

      {(state.heat.regional >= 0.5 || state.revenue.officer.arrived) && (
        <HeatGauges state={state} day={clock.day} />
      )}

      {(state.boundWights > 0 || state.debt > 0) && (
        <div className="hud-block">
          <span className="hud-label" style={{ color: ICHOR_GREEN }}>
            Debt
          </span>
          <div
            className="heat-gauge"
            title={`The marsh's account: ${Math.ceil(state.debt)} owed against ${
              state.boundWights * BINDING_CAPACITY
            } the bound will carry. It never decays. Let it outrun the bound and they collect — in people.`}
          >
            <div
              className={
                state.debt > state.boundWights * BINDING_CAPACITY
                  ? 'heat-fill heat-boil'
                  : 'heat-fill'
              }
              style={{
                width: `${Math.min(1, state.debt / Math.max(state.boundWights * BINDING_CAPACITY, 1)) * 100}%`,
                background: ICHOR_GREEN,
              }}
            />
          </div>
          <span className="hud-note">
            {state.boundWights} bound
            {state.collection !== null
              ? ` · they collect in ${state.collection.graceDawnsLeft} dawn${state.collection.graceDawnsLeft === 1 ? '' : 's'}`
              : ''}
          </span>
        </div>
      )}
    </div>
  );
}
