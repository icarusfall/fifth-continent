import { RENT_AMOUNT, TICKS_PER_HOUR } from '../sim/balance';
import {
  clockOf,
  dayPhaseOf,
  isFlooded,
  tideIsRising,
  tideLevel,
  ticksUntilTideTurn,
} from '../sim/time';
import type { GameState } from '../sim/types';
import { DYKE, HEAT_RED, LIMEWASH, REVENUE_BLUE, ROOF, SEA } from './palette';

import { spanOf } from './format';

const PHASE_GLYPH = { day: '☀', dusk: '🌗', night: '☾' } as const;

export function Hud({ state }: { state: GameState }) {
  const clock = clockOf(state.tick);
  const phase = dayPhaseOf(state.tick);
  const tide = tideLevel(state.tick);
  const rising = tideIsRising(state.tick);
  const flooded = isFlooded(state.tick);
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');

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
              state.coin < RENT_AMOUNT && state.rentDueTick - state.tick < 24 * TICKS_PER_HOUR
                ? ROOF
                : undefined,
          }}
        >
          {RENT_AMOUNT}
        </span>
        <span className="hud-note">
          due day {clockOf(state.rentDueTick).day}, dawn
          {state.coin < RENT_AMOUNT ? ` · short ${RENT_AMOUNT - state.coin}` : ' · covered'}
        </span>
      </div>

      <div className="hud-block">
        <span className="hud-label">Fleece in store</span>
        <span className="hud-coin">{state.stores.farm?.fleece ?? 0}</span>
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
