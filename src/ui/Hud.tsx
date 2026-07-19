import { DIFFICULTY_ORDER, FLOCK_CAP, TICKS_PER_HOUR } from '../sim/balance';
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
import { DYKE, HEAT_RED, LIMEWASH, REVENUE_BLUE, ROOF, SEA } from './palette';

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
        <div className="hud-block">
          <span className="hud-label" style={{ color: REVENUE_BLUE }}>
            Heat
          </span>
          <span
            className="hud-coin"
            style={{ color: state.heat.regional >= 50 ? HEAT_RED : undefined }}
            title="The parish noticing. It cools a little each dawn."
          >
            {Math.round(state.heat.regional)}
          </span>
          <span className="hud-note" title="London noticing. London does not forget.">
            London {state.heat.national < 1 ? state.heat.national.toFixed(1) : Math.round(state.heat.national)}
            {state.revenue.officer.arrived ? ' · an officer rides the Gault' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
