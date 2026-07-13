import { clockOf, dayPhaseOf, isFlooded, tideIsRising, tideLevel } from '../sim/time';
import type { GameState } from '../sim/types';
import { DYKE, LIMEWASH, SEA } from './palette';

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
          {flooded ? 'the low road is under water' : 'the low road is passable'}
        </span>
      </div>

      <div className="hud-block">
        <span className="hud-label">Coin</span>
        <span className="hud-coin">{state.coin}</span>
      </div>

      {state.farm && (
        <>
          <div className="hud-block">
            <span className="hud-label">Fleece in store</span>
            <span className="hud-coin">{state.stores.farm?.fleece ?? 0}</span>
          </div>
          <div className="hud-block">
            <span className="hud-label">Wool on flock</span>
            <span className="hud-coin">{state.fleeceReady}</span>
          </div>
        </>
      )}
    </div>
  );
}
