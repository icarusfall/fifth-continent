// The instrument strip (clean-sheet UI pass): one thin row floating over the
// map — the clock, the tide, the purse, the rent, and the meters that only
// appear once the world gives them something to say. Everything else lives
// behind the fold (▾): the map is the truth, and the chrome yields to it (§20).

import { useRef } from 'react';
import {
  BINDING_CAPACITY,
  DIFFICULTY_ORDER,
  DRAGOON_HEAT,
  LONDON_GAUGE_CEILING,
  OFFICER_ARRIVAL_HEAT,
  PAUPER_FLOOR,
  PROMOTION_THRESHOLD,
  REGIONAL_HEAT_DECAY,
  TICKS_PER_HOUR,
  WATER_GUARD_HEAT,
} from '../sim/balance';
import { flockCapOf } from '../sim/dykes';
import { standingDawnHeat, underTheCandle } from '../sim/revenue';
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
import { useUiStore } from '../state/ui';
import { DYKE, HEAT_RED, ICHOR_GREEN, LIMEWASH, REVENUE_BLUE, ROOF, SEA } from './palette';

import { spanOf } from './format';
import { benchReport } from './menus/shared';
import { SystemControls } from './SpeedControls';

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

  // §20.2 — the standing charge, read aloud: heat the works and stock will
  // bring at dawn with no further crime, and where the parish settles if
  // nothing more is committed. A pinned meter must name what pins it.
  const standing = standingDawnHeat(state);
  const settles = standing / (1 - REGIONAL_HEAT_DECAY);
  const worksPinIt = standing > 0.1 && settles >= PROMOTION_THRESHOLD;

  return (
    <div className="chip" title="The parish noticing, and London above it.">
      <span className="chip-label" style={{ color: REVENUE_BLUE }}>
        heat
        {drift < -0.5 && <span title="Cooler than yesterday. Lying low is working."> ▾</span>}
        {drift > 0.5 && (
          <span style={{ color: HEAT_RED }} title="Hotter than yesterday. The parish is talking.">
            {' '}
            ▴
          </span>
        )}
        {worksPinIt && (
          <span
            style={{ color: HEAT_RED }}
            title="The dawn tell of your visible works outruns the parish's forgetting: no amount of lying low unpins this meter. Hide the works (the wight-stone's reed-veil) or accept the boil."
          >
            {' '}
            ●
          </span>
        )}
      </span>
      <div className="chip-gauges">
        <div
          className="heat-gauge"
          title={
            `The parish noticing (${Math.round(regional)}). It cools a little each dawn.` +
            (boiling
              ? ' Boiling over: the excess spills into London’s ear every morning.'
              : ' The notch is where a Riding Officer takes rooms.') +
            (standing > 0.1
              ? ` The works and over-full hides feed it ~${standing.toFixed(1)} a day of their own; left alone the parish settles near ${Math.round(settles)}${
                  worksPinIt
                    ? ' — lying low will not cool this. Quiet the works themselves (the reed-veil hides them; emptied hides stop leaking).'
                    : '.'
                }`
              : ' Nothing standing feeds it now: lying low cools it.')
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
          <div className="heat-fill" style={{ width: `${londonPct * 100}%`, background: REVENUE_BLUE }} />
          <div
            className="heat-notch"
            style={{ left: `${(WATER_GUARD_HEAT / LONDON_GAUGE_CEILING) * 100}%` }}
          />
          <div
            className="heat-notch"
            style={{ left: `${(DRAGOON_HEAT / LONDON_GAUGE_CEILING) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** §6.14 (M5½e) — the bench's read-out: what is being learned, and how long
 *  is left. The chip exists only while a project runs — a mouth, not chrome. */
function BenchChip({ state }: { state: GameState }) {
  const bench = benchReport(state);
  if (!bench) return null;
  return (
    <div
      className="chip"
      title={`On the bench: ${bench.name} — done in ${bench.left}. One project at a time.`}
    >
      <span className="chip-label">bench</span>
      <span className="chip-value">{bench.name.toLowerCase()}</span>
      <span className="chip-note">{bench.left}</span>
    </div>
  );
}

/** The marsh's account, when it has one (§6.14). */
function DebtChip({ state }: { state: GameState }) {
  const capacity = state.boundWights * BINDING_CAPACITY;
  return (
    <div
      className="chip"
      title={`The marsh's account: ${Math.ceil(state.debt)} owed against ${capacity} the bound will carry. It never decays. Let it outrun the bound and they collect — in people.`}
    >
      <span className="chip-label" style={{ color: ICHOR_GREEN }}>
        debt
      </span>
      <div className="chip-gauges">
        <div className="heat-gauge">
          <div
            className={state.debt > capacity ? 'heat-fill heat-boil' : 'heat-fill'}
            style={{
              width: `${Math.min(1, state.debt / Math.max(capacity, 1)) * 100}%`,
              background: ICHOR_GREEN,
            }}
          />
        </div>
      </div>
      {state.collection !== null && (
        <span className="chip-note" style={{ color: ICHOR_GREEN }}>
          {state.collection.graceDawnsLeft} dawn{state.collection.graceDawnsLeft === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

export function Hud({ state }: { state: GameState }) {
  const hudOpen = useUiStore((s) => s.hudOpen);
  const setHudOpen = useUiStore((s) => s.setHudOpen);
  const clock = clockOf(state.tick);
  const phase = dayPhaseOf(state.tick);
  const tide = tideLevel(state.tick);
  const rising = tideIsRising(state.tick);
  const flooded = isFlooded(state.tick);
  const hh = String(clock.hour).padStart(2, '0');
  const mm = String(clock.minute).padStart(2, '0');
  const rent = rentAmount(state);
  const rentUrgent = state.coin < rent && state.rentDueTick - state.tick < 48 * TICKS_PER_HOUR;

  return (
    <div className="instrument-strip" onPointerDown={(e) => e.stopPropagation()}>
      <div className="strip-row">
        <div className="chip" title={`Day ${clock.day}, ${hh}:${mm} — ${phase}.`}>
          <span className="chip-value">
            d{clock.day} {PHASE_GLYPH[phase]} {hh}:{mm}
          </span>
        </div>

        <div
          className="chip"
          title={`Tide ${(tide * 100).toFixed(0)}%, ${rising ? 'rising' : 'falling'}. ${
            flooded
              ? `The low road is drowned — clears in ${spanOf(ticksUntilTideTurn(state.tick))}.`
              : `The low road is open — floods in ${spanOf(ticksUntilTideTurn(state.tick))}.`
          }`}
        >
          <span className="chip-label">tide {rising ? '▲' : '▼'}</span>
          <div className="chip-gauges">
            <div className="tide-gauge">
              <div
                className="tide-fill"
                style={{ width: `${tide * 100}%`, background: flooded ? SEA : DYKE }}
              />
            </div>
          </div>
          {flooded && (
            <span className="chip-note" style={{ color: LIMEWASH }}>
              road {spanOf(ticksUntilTideTurn(state.tick))}
            </span>
          )}
        </div>

        <div
          className="chip"
          title={
            underTheCandle(state)
              ? `Coin and contraband together are worth under ${PAUPER_FLOOR}. The Board does not spend ink, and the Company does not spend men, on a pauper: no seizures, no audit charges, no raids — until you are worth the candle again. The world still keeps score.`
              : 'The purse.'
          }
        >
          <span className="chip-value">{state.coin}</span>
          <span className="chip-label">coin</span>
          {/* §6.15 — the Floor must be visible while it holds. */}
          {underTheCandle(state) && <span className="chip-note">not worth the candle</span>}
        </div>

        <div
          className="chip"
          title={`Rent ${rent}, due day ${clockOf(state.rentDueTick).day} at dawn — ${
            state.coin >= rent ? 'covered.' : `short ${rent - state.coin}.`
          }${rentUrgent ? ' The agent is nearly at the door: sell, fence (the ledger has an alarm for it), or count on the Dutchman’s book. Distraint takes sheep.' : ''}${
            state.dutchmanBook > 0
              ? ` The Dutchman's book stands at ${state.dutchmanBook}: he takes half of every sale until it clears.`
              : ''
          }`}
        >
          <span className="chip-value" style={rentUrgent ? { color: HEAT_RED } : undefined}>
            {rent}
          </span>
          <span className="chip-label" style={rentUrgent ? { color: HEAT_RED } : undefined}>
            rent · d{clockOf(state.rentDueTick).day}
          </span>
          {state.coin < rent && (
            <span className="chip-note" style={rentUrgent ? { color: HEAT_RED } : undefined}>
              short {rent - state.coin}
            </span>
          )}
          {state.dutchmanBook > 0 && (
            <span className="chip-note" style={{ color: ROOF }}>
              book {state.dutchmanBook}
            </span>
          )}
        </div>

        {(state.heat.regional >= 0.5 || state.revenue.officer.arrived) && (
          <HeatGauges state={state} day={clock.day} />
        )}

        {(state.boundWights > 0 || state.debt > 0) && <DebtChip state={state} />}

        {state.research.active !== null && <BenchChip state={state} />}

        <button
          className="strip-fold"
          title="The rest of the reckoning: the flock, the wool, the barn, the dial."
          onClick={() => setHudOpen(!hudOpen)}
        >
          {hudOpen ? '▴' : '▾'}
        </button>
      </div>

      {hudOpen && (
        <div className="strip-details">
          <div className="hud-block">
            <span className="hud-label">Fleece in store</span>
            <span className="hud-coin">{state.stores.farm?.fleece ?? 0}</span>
          </div>
          <div className="hud-block">
            <span className="hud-label">Flock</span>
            <span className="hud-coin" title={`Your sheep. The pasture holds ${flockCapOf(state)}.`}>
              {state.flockSize}
              <span className="hud-note"> of {flockCapOf(state)}</span>
            </span>
            {state.sheepArriving > 0 && (
              <span className="hud-note">+{state.sheepArriving} on the drove road</span>
            )}
          </div>
          <div className="hud-block">
            <span className="hud-label">Wool on flock</span>
            <span className="hud-coin">{state.fleeceReady}</span>
          </div>
          <div className="hud-block">
            <span className="hud-label">The world&rsquo;s grip</span>
            <DifficultyNote state={state} />
          </div>
          <div className="hud-block fold-system">
            <span className="hud-label">The game</span>
            <SystemControls />
          </div>
          {state.revenue.officer.arrived && (
            <div className="hud-block">
              <span className="hud-label" style={{ color: REVENUE_BLUE }}>
                The Revenue
              </span>
              <span className="hud-note">an officer rides the Gault</span>
            </div>
          )}
          {state.boundWights > 0 && (
            <div className="hud-block">
              <span className="hud-label" style={{ color: ICHOR_GREEN }}>
                The bound
              </span>
              <span className="hud-note">
                {state.boundWights} bound · {Math.ceil(state.debt)} owed
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
