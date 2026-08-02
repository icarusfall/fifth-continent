// Spec §20.1 (M5½ playtest) — the day ahead: the book's guess at the standing
// orders' takings against the wage bill. A guess, but a deterministic one —
// so it gets the unit test every formula gets (§13).

import { describe, expect, it } from 'vitest';
import {
  DAILY_DEMAND,
  DUTCHMAN_FLEECE_DEMAND,
  FENCE_PRICE_MULT,
  LEIDEN_PRICE_MULT,
  RYNE_PRICE,
  SHEARER_WAGE,
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../balance';
import { forecastDay } from '../forecast';
import { edgesFor } from '../map';
import { carterWageOf, stopsFromLegacy } from '../tick';
import { initialState } from '../tick';

function tripsFor(fromToLatency: number): number {
  return Math.max(1, Math.floor(TICKS_PER_DAY / (2 * fromToLatency + 2)));
}

describe('the day ahead (§20.1): orders priced, hands ignored', () => {
  it('prices a wool round into the appetite, and the wages against it', () => {
    const s = initialState(1);
    s.carts[0].carter = stopsFromLegacy({ from: 'farm', to: 'ryne', good: 'fleece' });
    s.shearer.hired = true;
    const { takings, wages } = forecastDay(s);

    const lowRoad = Math.min(
      ...edgesFor(s.farm, s.cuttingHouse)
        .filter((e) => (e.a === 'farm' && e.b === 'ryne') || (e.a === 'ryne' && e.b === 'farm'))
        .map((e) => e.latency),
    );
    const hauled = tripsFor(lowRoad) * s.carts[0].capacity;
    const sold = Math.min(hauled, DAILY_DEMAND.fleece);
    expect(takings).toBe(sold * WOOL_PRICE_DOMESTIC);
    expect(wages).toBe(carterWageOf(s.carts[0].carter!) + SHEARER_WAGE);
  });

  it('the gunwale order prices at the Dutchman’s rate, capped by his appetite', () => {
    const s = initialState(1);
    s.carts[0].carter = stopsFromLegacy({ from: 'farm', to: 'shingle', good: 'fleece' });
    const { takings } = forecastDay(s);
    const marsh = Math.min(
      ...edgesFor(s.farm, s.cuttingHouse)
        .filter(
          (e) => (e.a === 'farm' && e.b === 'shingle') || (e.a === 'shingle' && e.b === 'farm'),
        )
        .map((e) => e.latency),
    );
    const hauled = tripsFor(marsh) * s.carts[0].capacity;
    const sold = Math.min(hauled, DUTCHMAN_FLEECE_DEMAND);
    expect(takings).toBe(sold * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT);
  });

  it('a fenced remainder prices the surplus at the haircut', () => {
    const s = initialState(1);
    s.cuttingHouse = { x: 24, y: 12 };
    s.carts[0].carter = stopsFromLegacy({
      from: 'cutting-house',
      to: 'ryne',
      good: 'brandy-fair',
      fenceRest: true,
    });
    const { takings } = forecastDay(s);
    const track = Math.min(
      ...edgesFor(s.farm, s.cuttingHouse)
        .filter(
          (e) =>
            (e.a === 'cutting-house' && e.b === 'ryne') ||
            (e.a === 'ryne' && e.b === 'cutting-house'),
        )
        .map((e) => e.latency),
    );
    const hauled = tripsFor(track) * s.carts[0].capacity;
    const sold = Math.min(hauled, DAILY_DEMAND['brandy-fair']);
    const fenced = Math.max(0, hauled - sold);
    expect(takings).toBe(
      sold * RYNE_PRICE['brandy-fair'] +
        fenced * Math.round(RYNE_PRICE['brandy-fair'] * FENCE_PRICE_MULT),
    );
  });

  it('idle hands price at nothing: no orders, no takings', () => {
    const s = initialState(1);
    expect(forecastDay(s)).toEqual({ takings: 0, wages: 0 });
  });
});
