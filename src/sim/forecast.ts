// Spec §20.1 (M5½ playtest) — the day ahead: what the standing orders should
// take in over the next 24 hours, set against the wage bill. Explicitly the
// book's guess: it prices the ORDERS, never the player's own hands, and the
// UI says so. Pure of the tick, like standingDawnHeat (§20.2).

import {
  CREW_WAGE,
  DAILY_DEMAND,
  DUTCHMAN_FLEECE_DEMAND,
  FENCE_PRICE_MULT,
  LEIDEN_PRICE_MULT,
  MILITIA_WAGE,
  REFINER_WAGE,
  RYNE_PRICE,
  SHEARER_WAGE,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from './balance';
import { edgesFor } from './map';
import { CONTRABAND } from './revenue';
import { carterWageOf } from './tick';
import type { GameState, Good } from './types';

export interface DayForecast {
  /** Coin the standing orders should take in over ~24h — the book's guess. */
  takings: number;
  /** The dawn wage bill: carters, shearer, refiner, and every posted man. */
  wages: number;
}

/** Ticks for one out-and-back on the cheapest direct edge, or a day if the
 *  route is not a single hop — a guess is allowed to be a guess. */
function roundTripTicks(state: GameState, from: string, to: string): number {
  const direct = edgesFor(state.farm, state.cuttingHouse).filter(
    (e) => (e.a === from && e.b === to) || (e.a === to && e.b === from),
  );
  if (direct.length === 0) return TICKS_PER_DAY;
  const fastest = Math.min(...direct.map((e) => e.latency));
  return Math.max(1, 2 * fastest + 2); // both legs and a little handling
}

/** §20.1 — the day ahead, priced order by order. */
export function forecastDay(state: GameState): DayForecast {
  // Appetite is shared: orders draw down the same town per good.
  const appetite: Partial<Record<Good, number>> = { ...DAILY_DEMAND };
  let gunwale = DUTCHMAN_FLEECE_DEMAND; // the lugger's wool appetite, per visit
  let takings = 0;

  for (const cart of state.carts) {
    const order = cart.carter;
    if (!order || order.stops.length === 0) continue;
    // §6.19 — the round is walked stop by stop: a lap is every leg of the
    // loop, and what he picks up at one stop is what he can sell at the next.
    // The clock prices the round, not a there-and-back.
    const stops = order.stops;
    const lap = stops.reduce(
      (t, s, i) => t + roundTripTicks(state, s.at, stops[(i + 1) % stops.length].at) / 2,
      0,
    );
    const trips = Math.max(1, Math.floor(TICKS_PER_DAY / Math.max(1, lap)));

    for (let i = 0; i < stops.length; i++) {
      const picked = stops[i].take;
      if (picked === undefined) continue;
      const perTrip = Math.min(stops[i].max ?? cart.capacity, cart.capacity);
      const hauled = trips * perTrip;
      // Where does this load get sold? The next stop that is a market — or the
      // gunwale, if the wool reaches the shingle before any town.
      for (let step = 1; step <= stops.length; step++) {
        const there = stops[(i + step) % stops.length].at;
        if (there === 'shingle' && (picked === 'fleece' || picked === 'dark-fleece')) {
          const sold = Math.min(hauled, gunwale);
          gunwale -= sold;
          takings += sold * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
          break;
        }
        if (there === 'ryne') {
          const room = appetite[picked] ?? 0;
          const sold = Math.min(hauled, room);
          appetite[picked] = room - sold;
          takings += sold * RYNE_PRICE[picked];
          // §6.17 — "…and fence the remainder", at the haircut, same visit.
          const at = stops[(i + step) % stops.length];
          if (at.fenceRest && CONTRABAND.includes(picked) && hauled > sold) {
            takings += (hauled - sold) * Math.round(RYNE_PRICE[picked] * FENCE_PRICE_MULT);
          }
          break;
        }
        // Any other stop is a store: it lands there, and earns nothing today.
        if (there !== 'shingle') break;
      }
    }
  }

  const carters = state.carts.reduce((sum, c) => sum + (c.carter ? carterWageOf(c.carter) : 0), 0);
  const garrisons = Object.values(state.garrisons).reduce(
    (sum, g) => sum + (g ? g.militia * MILITIA_WAGE + g.crew * CREW_WAGE : 0),
    0,
  );
  const wages =
    carters +
    (state.shearer.hired ? SHEARER_WAGE : 0) +
    (state.refiner.hired ? REFINER_WAGE : 0) +
    garrisons;

  return { takings: Math.round(takings), wages };
}
