// The places' sheets (spec §20.4): Walland Farm, Ryne, the Shingle, the
// Cutting House, the Customs House. Ported from the phone's menus — the same
// gates (§10: no verb is named before the world has caused it), the same
// charges, read on the face — but the carts are their own sheets now: a place
// lists the carts standing in it, and a click opens the cart.

import {
  CART_COST,
  CUTS,
  CUTTING_HOUSE_COST,
  CUTTING_HOUSE_STORE_CAPACITY,
  CUT_SUGAR_COST,
  DAILY_DEMAND,
  FARM_STORE_CAPACITY,
  LEIDEN_PRICE_MULT,
  MAX_CARTS,
  MAX_TUB_BOATS,
  REFINER_UNLOCK,
  REFINER_WAGE,
  RESEARCH_COST,
  RESEARCH_DAYS,
  ROUND_COST,
  RUMOUR_TRUST,
  RYNE_PRICE,
  SHEARER_UNLOCK_SHEARS,
  SHEARER_WAGE,
  SHEEP_PRICE_BUY,
  SHEEP_PRICE_SELL,
  SMOUCH_COST,
  SMOUCH_YIELD,
  TICKS_PER_DAY,
  TUB_BOAT_COST,
  WOOL_PRICE_DOMESTIC,
} from '../../sim/balance';
import { flockCapOf, waterwayTouches } from '../../sim/dykes';
import { CONTRABAND, illicitAnywhere } from '../../sim/revenue';
import type { CutDepth, GameState, Good, NodeId } from '../../sim/types';
import { GOOD_LABEL, storeSummary } from '../../shared/format';
import { cargoCount, heldAnywhere } from '../../shared/words';
import { act, compact, type Line, type Section, type Sheet, type Verb } from '../sheet';
import { benchLine, workshopSection, worksSection } from './works';

const short = (cost: number) => `${cost} coin, and the till is short.`;

function hasOverproofJenever(state: GameState): boolean {
  return (
    state.carts.some((c) => (c.cargo.jenever ?? 0) > 0) ||
    Object.values(state.stores).some((st) => (st.jenever ?? 0) > 0)
  );
}

function cuttingHouseVerb(state: GameState): Verb {
  return {
    key: 'raise-house',
    label: 'Raise a cutting house',
    charge: `${CUTTING_HOUSE_COST} coin`,
    why: 'Overproof jenever has no legal buyer. Cut it with water and burnt sugar and it sells in Ryne as brandy. Choose open marsh on the map.',
    blocked:
      state.coin < CUTTING_HOUSE_COST
        ? `${CUTTING_HOUSE_COST} coin, paid up front. Nobody out here gives credit.`
        : undefined,
    run: { ui: 'place-cutting-house' },
  };
}

/** The carts standing at a place, each a door to its own sheet. */
export function cartsHere(state: GameState, nodeId: NodeId): Section {
  const here = state.carts.filter((c) => c.location.kind === 'node' && c.location.nodeId === nodeId);
  return {
    key: `carts-${nodeId}`,
    title: 'carts here',
    lines: here.length === 0 ? [{ text: 'No cart stands here.', tone: 'quiet' }] : [],
    verbs: here.map((c) => ({
      key: `open-${c.id}`,
      label: c.name,
      charge: `${storeSummary(c.cargo, 'empty')}${c.carter ? ' · on a round' : ''}`,
      run: { ui: 'select', target: { kind: 'cart', id: c.id } },
    })),
  };
}

export function farmSheet(state: GameState): Sheet {
  const barn = state.stores.farm ?? {};
  const stored = cargoCount(barn);
  const onBacks = state.fleeceReady + state.darkReady;
  const lines: Line[] = [
    {
      text: `${state.flockSize} sheep of a pasture for ${flockCapOf(state)}${
        state.sheepArriving > 0 ? ` (+${state.sheepArriving} on the drove road)` : ''
      }.`,
    },
    {
      text:
        state.darkReady > 0
          ? `${state.fleeceReady} white and ${state.darkReady} dark wool on their backs.`
          : `${state.fleeceReady} wool on their backs.`,
    },
    {
      text: `Barn ${stored}/${FARM_STORE_CAPACITY}: ${storeSummary(barn, 'empty')}.`,
      tone: stored >= FARM_STORE_CAPACITY ? 'warn' : undefined,
    },
  ];

  const yard: Verb[] = [
    {
      key: 'shear',
      label: 'Shear',
      charge: onBacks > 0 ? `${onBacks} on the backs` : undefined,
      blocked:
        onBacks <= 0
          ? 'The wool grows by dawn.'
          : stored >= FARM_STORE_CAPACITY
            ? 'The barn is full to the rafters. Move wool out first.'
            : undefined,
      run: act({ type: 'shear' }),
    },
  ];
  if (hasOverproofJenever(state) && !state.cuttingHouse) yard.push(cuttingHouseVerb(state));
  // §6.11 — no cart is offered before the first rent is felt.
  if ((state.rentPending || state.dutchman.unlocked) && state.carts.filter((c) => !c.vessel).length < MAX_CARTS) {
    yard.push({
      key: 'buy-cart',
      label: 'Buy a cart',
      charge: `${CART_COST} coin`,
      why: 'Cart, pony, and no questions from the wheelwright.',
      blocked: state.coin < CART_COST ? short(CART_COST) : undefined,
      run: act({ type: 'buyCart' }),
    });
  }
  // §6.18 — a hull, offered once your water touches the farm.
  if (waterwayTouches(state, 'farm') && state.carts.filter((c) => c.vessel === 'dyke').length < MAX_TUB_BOATS) {
    yard.push({
      key: 'buy-tub',
      label: 'Buy a tub-boat',
      charge: `${TUB_BOAT_COST} coin`,
      why: 'Flat-bottomed, quiet as weed, and twelve tubs to the load. It rides the waterways you have dug, when the tide gives them depth.',
      blocked: state.coin < TUB_BOAT_COST ? short(TUB_BOAT_COST) : undefined,
      run: act({ type: 'buyTubBoat' }),
    });
  }

  // §6.16 — the hired dawn, and the flock as a stock you trade.
  const flock: Verb[] = [];
  const flockLines: Line[] = [];
  const shearerOffered =
    state.shearer.hired ||
    state.shearer.handShears >= SHEARER_UNLOCK_SHEARS ||
    state.carts.some((c) => c.carter !== null);
  if (shearerOffered) {
    flock.push(
      state.shearer.hired
        ? { key: 'shearer-off', label: 'Dismiss the shearing lad', why: 'The dawn clip becomes your chore again.', run: act({ type: 'dismissShearer' }) }
        : {
            key: 'shearer-on',
            label: 'Hire the shearing lad',
            charge: `${SHEARER_WAGE} coin a day`,
            why: 'He shears the flock into the barn at dawn, and he does not count.',
            run: act({ type: 'hireShearer' }),
          },
    );
  }
  if (state.dutchman.unlocked) {
    const room = flockCapOf(state) - state.flockSize - state.sheepArriving;
    flockLines.push({
      text: `The pasture holds ${flockCapOf(state)}${
        state.dykesDug.length > 0 ? ' (the drained land grazes more)' : ''
      }. More sheep, more wool, more alibi — and Ryne buys only so much honest fleece.`,
    });
    flock.push(
      {
        key: 'buy-sheep',
        label: 'Buy a sheep',
        charge: `${SHEEP_PRICE_BUY} coin`,
        why: 'The drover brings them up the drove road by dawn.',
        blocked: room <= 0 ? 'No grass, no sheep. Walland holds what it holds.' : state.coin < SHEEP_PRICE_BUY ? short(SHEEP_PRICE_BUY) : undefined,
        run: act({ type: 'buySheep', qty: 1 }),
      },
      {
        key: 'sell-sheep',
        label: 'Sell a sheep',
        charge: `${SHEEP_PRICE_SELL} coin`,
        why: 'The market pays cash, and pays worse than the agent values them.',
        blocked: state.flockSize <= 1 ? 'One sheep is not a flock to sell from.' : undefined,
        run: act({ type: 'sellSheep', qty: 1 }),
      },
    );
    // §6.14 — the bench's trade tier, once contraband has touched your hands.
    const r = state.research;
    if (r.completed.trade >= 1) {
      flockLines.push({ text: 'The carts ride on hollow floors — quieter roads, and road-stops miss what is under the boards.' });
    } else if (r.active) {
      const b = benchLine(state);
      if (b) flockLines.push(b);
    } else if (state.contrabandSold > 0 || illicitAnywhere(state) > 0) {
      const cost = RESEARCH_COST.trade[0];
      flock.push({
        key: 'false-bottoms',
        label: 'Fit false bottoms',
        charge: `${cost} coin · ${RESEARCH_DAYS.trade[0]} days`,
        why: 'Hollow floors under every cart: quieter roads, and road-stops miss four tubs.',
        blocked: state.coin < cost ? short(cost) : undefined,
        run: act({ type: 'startResearch', tree: 'trade' }),
      });
    }
  }

  const sections: Section[] = [
    { key: 'yard', title: 'the yard', lines: [], verbs: yard },
    { key: 'flock', title: 'the flock', lines: flockLines, verbs: flock },
  ];
  if (state.dutchman.unlocked) sections.push(worksSection(state, 'farm'));
  const ws = workshopSection(state, 'farm');
  if (ws) sections.push(ws);
  sections.push(cartsHere(state, 'farm'));
  return {
    kicker: 'your farm',
    title: 'Walland Farm',
    lines,
    fill: { count: stored, cap: FARM_STORE_CAPACITY },
    sections: compact(sections),
  };
}

export function ryneSheet(state: GameState): Sheet {
  const appetite = (Object.keys(DAILY_DEMAND) as Good[])
    .filter((g) => DAILY_DEMAND[g] > 0 && (!CONTRABAND.includes(g) || heldAnywhere(state, g) > 0))
    .map((g) => `${GOOD_LABEL[g]} ${state.demandRemaining[g] ?? 0}/${DAILY_DEMAND[g]}`)
    .join(' · ');
  const lines: Line[] = [
    { text: `White wool fetches ${WOOL_PRICE_DOMESTIC} coin the fleece; the stapler will not weigh dark.` },
    { text: `The town will still take today — ${appetite}.` },
    {
      text:
        state.contrabandSold > 0 || illicitAnywhere(state) > 0
          ? 'Sell past the day’s appetite and the rest waits exposed — unless a fence takes it.'
          : 'Sell past the day’s appetite and the rest waits for dawn.',
      tone: 'quiet',
    },
  ];
  const verbs: Verb[] = [];
  if (!state.dutchman.unlocked) {
    lines.push({
      text: `Across the water they pay ${WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} the fleece. Not that anyone would know about that.`,
      tone: 'quiet',
    });
    const blocked =
      Math.floor(state.tick / TICKS_PER_DAY) <= state.lastRoundDay
        ? 'The alehouse has had your coin once today. Tomorrow is another thirst.'
        : state.coin < ROUND_COST
          ? `A round for the quay is ${ROUND_COST} coin, and the till is short.`
          : state.ledger.soldLawfully < RUMOUR_TRUST[state.rumoursHeard]
            ? 'The quay talks to farmers it knows. Sell more wool at Ryne first.'
            : undefined;
    verbs.push({
      key: 'round',
      label: 'Stand a round in the alehouse',
      charge: `${ROUND_COST} coin`,
      why: 'Coin loosens tongues. Somebody on this quay knows where the wool really goes.',
      blocked,
      run: act({ type: 'buyRound' }),
    });
  }
  return {
    kicker: 'the market town',
    title: 'Ryne',
    lines,
    sections: compact([{ key: 'quay', title: 'the quay', lines: [], verbs }, cartsHere(state, 'ryne')]),
  };
}

export function shingleSheet(state: GameState, waiting: boolean): Sheet {
  const d = state.dutchman;
  const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
  const lines: Line[] = [];
  const verbs: Verb[] = [];
  if (!d.present) {
    lines.push({
      text: 'Shingle and grey water. They say a lugger stands off here some nights — after dark, on a falling tide, while the Customs House is counting other things.',
    });
    verbs.push({
      key: 'vigil',
      label: waiting ? 'Waiting on the water… call it off' : 'Wait for the lugger',
      charge: waiting ? undefined : 'let the hours run',
      why: 'The clock runs fast until the lugger stands off — or dawn, if he never comes. Nothing is skipped: cards still interrupt.',
      run: { ui: 'wait-lugger', on: !waiting },
    });
  } else {
    lines.push({
      text: `The Dutchman. ${beachPrice} coin the fleece, and he’ll take ${d.fleeceAppetite} more tonight. Coin on the nail; no credit, no names.${
        !d.met ? ' He came to meet you, and he will wait the night out.' : ' Gone when the tide turns.'
      }`,
      tone: 'good',
    });
  }
  const beached = state.carts.some(
    (c) => c.location.kind === 'node' && c.location.nodeId === 'shingle' && (c.cargo.jenever ?? 0) > 0,
  );
  if (beached && !state.cuttingHouse) {
    lines.push({ text: 'The tubs want cutting before any buyer in Ryne dares look at them.', tone: 'warn' });
    verbs.push(cuttingHouseVerb(state));
  }
  const open = state.stores.shingle ?? {};
  if (cargoCount(open) > 0) {
    lines.push({ text: `On the open shingle, no cover at all: ${storeSummary(open, '')}.`, tone: 'warn' });
  }
  return {
    kicker: 'the coast',
    title: 'The Shingle',
    lines,
    sections: compact([{ key: 'water', title: 'the water', lines: [], verbs }, cartsHere(state, 'shingle')]),
  };
}

export function cuttingHouseSheet(state: GameState): Sheet {
  const store = state.stores['cutting-house'] ?? {};
  const stored = cargoCount(store);
  const room = CUTTING_HOUSE_STORE_CAPACITY - stored;
  const tubs = store.jenever ?? 0;
  const cuttable = Math.min(tubs, Math.floor(state.coin / CUT_SUGAR_COST));
  const chests = store.tea ?? 0;
  const smouchable = Math.min(chests, Math.floor(state.coin / SMOUCH_COST), Math.max(0, room));

  const work: Verb[] = [];
  if (tubs > 0) {
    for (const depth of ['gentle', 'standard', 'deep'] as CutDepth[]) {
      const { yield: perTub, brandy } = CUTS[depth];
      work.push({
        key: `cut-${depth}`,
        label: `Cut ${depth}`,
        charge: `${cuttable} tubs → ${cuttable * perTub} ${GOOD_LABEL[brandy]} at ${RYNE_PRICE[brandy]}`,
        why: `Sugar: ${cuttable * CUT_SUGAR_COST} coin. Deeper cuts make more brandy of a worse sort.`,
        blocked:
          cuttable <= 0
            ? room <= 0
              ? 'The store is full — move the brandy on before cutting more.'
              : 'Burnt sugar costs coin, and the till is empty.'
            : undefined,
        run: act({ type: 'cut', depth, tubs: 99 }),
      });
    }
  }
  if (chests > 0) {
    work.push({
      key: 'smouch',
      label: 'Smouch the leaf',
      charge: `${smouchable} chests → ${smouchable * SMOUCH_YIELD} ${GOOD_LABEL['bulked-tea']} at ${RYNE_PRICE['bulked-tea']}`,
      why: `Ash & sloe: ${smouchable * SMOUCH_COST} coin. Bulk sells cheap, but sells — the town drinks more of it.`,
      blocked:
        smouchable <= 0
          ? room <= 0
            ? 'The store is full — move the leaf on before smouching more.'
            : 'Ash and sloe cost coin, and the till is empty.'
          : undefined,
      run: act({ type: 'smouch', chests: 99 }),
    });
  }

  // §6.17 — the refiner, offered once the chore is felt.
  const r = state.refiner;
  const refinerLines: Line[] = [];
  const refiner: Verb[] = [];
  const offered = r.hired || r.handRefines >= REFINER_UNLOCK || state.carts.some((c) => c.carter !== null);
  if (offered && !r.hired) {
    refiner.push({
      key: 'refiner-on',
      label: 'Hire a refiner',
      charge: `${REFINER_WAGE} coin a day`,
      why: 'At dawn he cuts every tub at your standing depth, and smouches the leaf if told to. He does nothing else, and asks nothing.',
      run: act({ type: 'hireRefiner' }),
    });
  } else if (r.hired) {
    refinerLines.push({
      text: `The refiner works the house at dawn: cut ${r.cutDepth}, ${r.smouch ? 'and smouch the leaf' : 'leaf left alone'} · ${REFINER_WAGE} coin a day.`,
    });
    for (const depth of ['gentle', 'standard', 'deep'] as CutDepth[]) {
      if (depth === r.cutDepth) continue;
      refiner.push({
        key: `refiner-${depth}`,
        label: `Have him cut ${depth}`,
        charge: `${CUTS[depth].yield} ${GOOD_LABEL[CUTS[depth].brandy]} a tub`,
        run: act({ type: 'setRefinerOrders', cutDepth: depth, smouch: r.smouch }),
      });
    }
    refiner.push(
      {
        key: 'refiner-smouch',
        label: r.smouch ? 'Have him leave the leaf alone' : 'Have him smouch the leaf too',
        why: r.smouch
          ? 'The bohea stays bohea: the fine market pays better a chest, and buys less.'
          : 'Ash and sloe at dawn: every chest becomes two of bulked tea for the cheap market.',
        run: act({ type: 'setRefinerOrders', cutDepth: r.cutDepth, smouch: !r.smouch }),
      },
      { key: 'refiner-off', label: 'Dismiss the refiner', why: 'The cutting and the smouching become your hands again.', run: act({ type: 'dismissRefiner' }) },
    );
  }

  const sections: Section[] = [
    { key: 'work', title: 'the work', lines: tubs + chests === 0 ? [{ text: 'Nothing here wants cutting or smouching.', tone: 'quiet' }] : [], verbs: work },
    { key: 'refiner', title: 'the refiner', lines: refinerLines, verbs: refiner },
    worksSection(state, 'cutting-house'),
  ];
  const ws = workshopSection(state, 'cutting-house');
  if (ws) sections.push(ws);
  sections.push(cartsHere(state, 'cutting-house'));
  return {
    kicker: 'your works',
    title: 'The Cutting House',
    lines: [
      {
        text: `In store ${stored}/${CUTTING_HOUSE_STORE_CAPACITY}: ${storeSummary(store, 'bare shelves')}.`,
        tone: room <= 0 ? 'warn' : undefined,
      },
    ],
    fill: { count: stored, cap: CUTTING_HOUSE_STORE_CAPACITY },
    sections: compact(sections),
  };
}

export function customsSheet(state: GameState): Sheet {
  return {
    kicker: 'the Crown',
    title: 'The Customs House',
    lines: [
      {
        text: state.revenue.officer.arrived
          ? 'A Riding Officer lodges upstairs now. He keeps early hours and long lists.'
          : 'Quiet today. It counts things. It is counting now.',
      },
    ],
    sections: [],
  };
}
