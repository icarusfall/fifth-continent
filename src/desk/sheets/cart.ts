// A cart's sheet (spec §20.4 — on the desk the cart is the actor, clicked
// directly). Its cargo verbs where it stands, the roads out of here, its
// carter. D1 ports the phone's verbs faithfully; D2 moves sending onto the
// map itself (destination tags, rounds by shift-click) and adds the hire.

import {
  CART_CAPACITY,
  CART_RESALE,
  DUTCHMAN_PRICE,
  FARM_STORE_CAPACITY,
  FENCE_PRICE_MULT,
  LEIDEN_PRICE_MULT,
  RYNE_PRICE,
  TUB_TIDE_MIN,
  WOOL_PRICE_DOMESTIC,
} from '../../sim/balance';
import { dykeWaterways } from '../../sim/dykes';
import { edgesFor, nodeById } from '../../sim/map';
import { CONTRABAND } from '../../sim/revenue';
import { carterWageOf } from '../../sim/tick';
import { isFlooded, ticksUntilTideTurn, tideLevel } from '../../sim/time';
import type { Cart, EdgeId, GameState, Good, NodeId } from '../../sim/types';
import { woolMismatches } from '../../sim/wool';
import { GOOD_LABEL, spanOf, storeSummary } from '../../shared/format';
import { GOOD_WHISPER, cargoCount, cartWhereabouts, coatOn, orderLabel } from '../../shared/words';
import { act, compact, type Line, type Section, type Sheet, type Verb } from '../sheet';

export function handOf(cart: Cart): string {
  return cart.vessel === 'dyke' ? 'dyke-pilot' : cart.vessel === 'sea' ? 'lighterman' : 'carter';
}

function cargoVerbs(state: GameState, cart: Cart, at: NodeId): Verb[] {
  const verbs: Verb[] = [];
  const held = cargoCount(cart.cargo);
  const aboard = (Object.entries(cart.cargo) as Array<[Good, number]>).filter(([, n]) => n > 0);
  switch (at) {
    case 'farm': {
      const barn = state.stores.farm ?? {};
      const barnRoom = FARM_STORE_CAPACITY - cargoCount(barn);
      if (held < CART_CAPACITY) {
        for (const [good, n] of Object.entries(barn) as Array<[Good, number]>) {
          if (n <= 0) continue;
          verbs.push({
            key: `load-${good}`,
            label: `Load ${GOOD_LABEL[good]}`,
            charge: `${Math.min(n, CART_CAPACITY - held)} of ${n}`,
            run: act({ type: 'loadCart', cartId: cart.id, good, qty: CART_CAPACITY }),
          });
        }
      }
      for (const [good, n] of aboard) {
        verbs.push({
          key: `unload-${good}`,
          label: `Unload ${GOOD_LABEL[good]} into the barn`,
          charge: `${Math.min(n, barnRoom)}`,
          blocked: barnRoom <= 0 ? 'The barn is full to the rafters.' : undefined,
          run: act({ type: 'unloadCart', cartId: cart.id, good, qty: 99 }),
        });
      }
      break;
    }
    case 'ryne': {
      for (const [good, n] of aboard) {
        if (good === 'jenever') continue;
        if (good === 'dark-fleece') {
          verbs.push({
            key: 'sell-dark',
            label: 'Sell dark wool',
            blocked: 'Dark wool was never on your books. The lugger takes it; nobody in Ryne will.',
            run: act({ type: 'sell', cartId: cart.id, good }),
          });
          continue;
        }
        const q = Math.min(n, state.demandRemaining[good] ?? 0);
        verbs.push({
          key: `sell-${good}`,
          label: `Sell ${GOOD_LABEL[good]}`,
          charge: q > 0 ? `${q} · ${q * RYNE_PRICE[good]} coin${q < n ? ' · all the town will take' : ''}` : undefined,
          blocked: q <= 0 ? 'The town has had its fill today. Dawn brings appetite.' : undefined,
          run: act({ type: 'sell', cartId: cart.id, good }),
        });
        if (CONTRABAND.includes(good) && RYNE_PRICE[good] > 0) {
          const fp = Math.round(RYNE_PRICE[good] * FENCE_PRICE_MULT);
          verbs.push({
            key: `fence-${good}`,
            label: `Fence ${GOOD_LABEL[good]}`,
            charge: `${n} · ${n * fp} coin`,
            why: 'The fence takes the whole load at once — no waiting, no appetite to fill — but pays a fraction of the stall price.',
            run: act({ type: 'sellToFence', cartId: cart.id, good }),
          });
        }
      }
      break;
    }
    case 'shingle': {
      const d = state.dutchman;
      if (!d.present) break;
      const dark = Math.min(cart.cargo['dark-fleece'] ?? 0, d.fleeceAppetite);
      const white = Math.min(cart.cargo.fleece ?? 0, d.fleeceAppetite - dark);
      if (dark + white > 0) {
        verbs.push({
          key: 'gunwale',
          label: 'Sell wool over the gunwale',
          charge: `${dark + white} · ${(dark + white) * WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} coin${
            white > 0 ? ` · ${white} white: +${white} Heat at the audit` : ''
          }`,
          why: white > 0
            ? 'White wool is on your books: what goes over the side must still show when the officer counts. Dark wool leaves no trace.'
            : 'Dark wool was never on your books. It leaves no trace.',
          danger: white > 0,
          run: act({ type: 'sellToDutchman', cartId: cart.id }),
        });
      }
      const room = cart.capacity - cargoCount(cart.cargo);
      for (const good of ['jenever', 'tea', 'lace'] as Good[]) {
        const stock = d.hold[good] ?? 0;
        if (stock <= 0) continue;
        const price = DUTCHMAN_PRICE[good]!;
        const can = Math.min(stock, room, Math.floor(state.coin / price));
        verbs.push({
          key: `buy-${good}`,
          label: `Buy ${GOOD_LABEL[good]}`,
          charge: can > 0 ? `${can} · ${can * price} coin · ${stock} aboard` : `${price} coin each · ${stock} aboard`,
          why: GOOD_WHISPER[good],
          blocked: can <= 0 ? 'No room in the cart, or no coin. He does not give credit.' : undefined,
          run: act({ type: 'buyFromDutchman', cartId: cart.id, good, qty: 99 }),
        });
      }
      break;
    }
    case 'cutting-house': {
      const store = state.stores['cutting-house'] ?? {};
      if ((cart.cargo.jenever ?? 0) > 0) {
        verbs.push({
          key: 'unload-jenever',
          label: 'Unload the tubs into the house',
          charge: `${cart.cargo.jenever}`,
          run: act({ type: 'unloadCart', cartId: cart.id, good: 'jenever', qty: 99 }),
        });
      }
      for (const good of ['brandy-gent', 'brandy-fair', 'brandy-rough', 'bulked-tea'] as Good[]) {
        if ((store[good] ?? 0) <= 0) continue;
        verbs.push({
          key: `load-${good}`,
          label: `Load ${GOOD_LABEL[good]}`,
          charge: `${store[good]} in store`,
          run: act({ type: 'loadCart', cartId: cart.id, good, qty: 99 }),
        });
      }
      break;
    }
  }
  return verbs;
}

/** The roads out of here, each with the tide's and the coat's warnings. */
function roadVerbs(state: GameState, cart: Cart, at: NodeId): Verb[] {
  const send = (edgeId: EdgeId) => act({ type: 'dispatchCart', cartId: cart.id, edgeId });
  const coat = (edgeId: EdgeId) => (coatOn(state, edgeId, at) ? 'the blue coat rides it' : undefined);
  const name = (id: NodeId) => nodeById(id, state.farm, state.cuttingHouse).name;

  if (cart.vessel === 'sea') {
    if (at !== 'shingle' && at !== 'ryne') return [];
    return [
      {
        key: 'sea',
        label: at === 'shingle' ? 'Steam for Ryne’s quay' : 'Steam for the shingle',
        charge: 'the sea lane',
        why: 'Steam minds neither tide nor night. Every ear on the coast minds the steam.',
        run: send('sea-lane'),
      },
    ];
  }
  if (cart.vessel === 'dyke') {
    const ways = dykeWaterways(state).filter((w) => w.a === at || w.b === at);
    const low = tideLevel(state.tick) < TUB_TIDE_MIN;
    return ways.map((w) => ({
      key: w.id,
      label: `Pole down ${w.name.toLowerCase()} to ${name(w.a === at ? w.b : w.a)}`,
      why: 'Quiet as weed, and nobody counts what moves under the banks.',
      blocked: low ? 'The channel wants more tide under the keel. It will come.' : undefined,
      run: send(w.id),
    }));
  }

  const flooded = isFlooded(state.tick);
  const tide = spanOf(ticksUntilTideTurn(state.tick));
  const verbs: Verb[] = [];
  for (const e of edgesFor(state.farm, state.cuttingHouse)) {
    if (e.id === 'sea-lane') continue;
    if (e.a !== at && e.b !== at) continue;
    if (e.id === 'marsh-track' && !state.dutchman.unlocked) continue;
    const to = e.a === at ? e.b : e.a;
    const drowned = e.condition === 'tideLocked' && flooded;
    const notes = [
      e.condition === 'tideLocked' ? (flooded ? `drowned — clears in ${tide}` : `floods in ${tide}`) : undefined,
      coat(e.id),
    ].filter(Boolean);
    verbs.push({
      key: e.id,
      label: `To ${name(to)} by ${e.name.toLowerCase()}`,
      charge: notes.join(' · ') || undefined,
      blocked: drowned ? `Under the tide. Clears in ${tide}.` : undefined,
      run: send(e.id),
    });
  }
  return verbs;
}

export function cartSheet(state: GameState, cartId: string): Sheet | null {
  const cart = state.carts.find((c) => c.id === cartId);
  if (!cart) return null;
  const at = cart.location.kind === 'node' ? cart.location.nodeId : null;
  const laden = cargoCount(cart.cargo) > 0;
  const lines: Line[] = [
    { text: `${cartWhereabouts(state, cart)[0].toUpperCase()}${cartWhereabouts(state, cart).slice(1)}.` },
    { text: `Aboard: ${storeSummary(cart.cargo, 'nothing')} (${cargoCount(cart.cargo)}/${cart.capacity}).` },
  ];
  const sections: Section[] = [];

  if (cart.carter) {
    const mismatches = woolMismatches(cart.carter.stops);
    sections.push({
      key: 'hand',
      title: `the ${handOf(cart)}`,
      lines: [
        { text: `Standing order: ${orderLabel(state, cart.carter)}, and round again — ${carterWageOf(cart.carter)} coin a day.` },
        ...mismatches.map((m) => ({ text: m, tone: 'warn' as const })),
      ],
      verbs: [
        {
          key: 'dismiss',
          label: `Dismiss the ${handOf(cart)}`,
          why: at ? undefined : 'Word reaches him on the road: the order ends where he stands.',
          run: act({ type: 'dismissCarter', cartId: cart.id }),
        },
      ],
    });
  }

  if (at && !cart.carter) {
    sections.push({ key: 'cargo', title: `at ${nodeById(at, state.farm, state.cuttingHouse).name}`, lines: [], verbs: cargoVerbs(state, cart, at) });
    sections.push({ key: 'roads', title: 'the roads from here', lines: [], verbs: roadVerbs(state, cart, at) });
  } else if (at && cart.carter && at === 'ryne') {
    // §6.17 — the fence over the carter's shoulder, for a cart stuck on the appetite.
    const fence: Verb[] = CONTRABAND.filter((g) => (cart.cargo[g] ?? 0) > 0 && RYNE_PRICE[g] > 0).map((g) => ({
      key: `fence-${g}`,
      label: `Fence the remaining ${GOOD_LABEL[g]}`,
      charge: `${cart.cargo[g]} · ${(cart.cargo[g] ?? 0) * Math.round(RYNE_PRICE[g] * FENCE_PRICE_MULT)} coin`,
      why: `The whole remainder, round the back, at once — the ${handOf(cart)} looks away, then turns for home.`,
      run: act({ type: 'sellToFence', cartId: cart.id, good: g }),
    }));
    sections.push({ key: 'fence', title: 'at Ryne', lines: [], verbs: fence });
  }

  const last: Verb[] = [];
  if (laden && !cart.carter) {
    last.push({
      key: 'ditch',
      label: 'Tip the load into a dyke',
      charge: 'nothing comes back',
      why: 'The panic button: see the blue coat on your road, and tip the lot.',
      danger: true,
      run: act({ type: 'ditchCargo', cartId: cart.id }),
    });
  }
  if (at === 'farm' && !cart.carter && !laden && state.carts.length > 1) {
    last.push({
      key: 'sell-cart',
      label: `Sell ${cart.name.toLowerCase()} back`,
      charge: `${CART_RESALE} coin`,
      why: 'He buys cheaper than he sells. Nobody out here forgets a price.',
      run: act({ type: 'sellCart', cartId: cart.id }),
    });
  }
  sections.push({ key: 'last', title: 'and', lines: [], verbs: last });
  sections.push({
    key: 'command',
    lines: [
      {
        text: cart.carter
          ? `Click places on the map to write the ${handOf(cart)} a new round.`
          : 'Click a route on the map to send it. Shift-click places to write a round, and hire a hand to ride it.',
        tone: 'quiet',
      },
    ],
    verbs: [],
  });

  return {
    kicker: cart.carter ? `a cart · ${handOf(cart)} on the reins` : 'a cart · yours to drive',
    title: cart.name,
    lines,
    fill: { count: cargoCount(cart.cargo), cap: cart.capacity },
    sections: compact(sections),
  };
}
