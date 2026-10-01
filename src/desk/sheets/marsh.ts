// The marsh's own sheets (spec §6.14 / §6.18): a survey post, the wight-sign,
// the wight-stone, and the Riding Officer. Ported from the phone's marsh
// menus: what a cut JOINS is still said before its price (M5½b playtest).

import {
  BINDING_CAPACITY,
  CROSSING_FRONTAGE,
  DYKE_DEBT,
  DYKE_PASTURE_HEAD,
  MARSH_VEIL_DEBT,
  MARSH_VEIL_DIV,
  RESEARCH_COST,
  RESEARCH_DAYS,
  TICKS_PER_DAY,
  TRIBUTE_RELIEF,
  TUB_BOAT_CAPACITY,
  WIGHT_TRAP_IRON,
} from '../../sim/balance';
import { cutWouldMoat, dykeCost, dykeDays, dykePreview, dykeWaterways, stoneRefuses } from '../../sim/dykes';
import type { WaterwayPair } from '../../sim/dykes';
import { dykeById, dykeTiles, edgesFor, nodeById } from '../../sim/map';
import type { GameState } from '../../sim/types';
import { MARSH_TIERS } from '../../shared/words';
import { act, compact, type Line, type Section, type Sheet, type Verb } from '../sheet';
import { benchLine } from './works';

const days = (ticks: number) => {
  const d = Math.max(1, Math.ceil(ticks / TICKS_PER_DAY));
  return `${d} day${d === 1 ? '' : 's'}`;
};

export function dykeSheet(state: GameState, dykeId: string): Sheet | null {
  const seg = dykeById(dykeId);
  if (!seg) return null;
  const dug = state.dykesDug.includes(seg.id);
  const inHand = state.digging?.id === seg.id;
  const name = (id: string) => nodeById(id, state.farm, state.cuttingHouse).name;
  const pairs = (ps: WaterwayPair[]) => ps.map((p) => `${name(p.a)} to ${name(p.b)}`).join(', and ');
  const lines: Line[] = [];
  const verbs: Verb[] = [];

  if (dug) {
    const standing = dykeWaterways(state);
    lines.push(
      { text: 'Clean water, cut banks, and drained grazing either side. A dyke is never filled in.' },
      {
        text:
          standing.length > 0
            ? `Water you can carry on, as it stands: ${standing.map((e) => e.name).join(', ')}.`
            : 'No landing yet stands at both ends of your water. Until one does, this is drainage and pasture, and no road at all.',
      },
    );
  } else if (inHand) {
    lines.push({ text: `The crew is in it now — mud to the knees, done in about ${days(state.digging!.doneTick - state.tick)}.` });
  } else {
    // The road first, the price second.
    const preview = dykePreview(state, seg.id);
    if (preview.opens.length > 0) {
      lines.push({
        text: `Dug, this opens the water from ${pairs(preview.opens)} — ${TUB_BOAT_CAPACITY} to the load, quiet as weed, and no blue coat rides a channel.`,
        tone: 'good',
      });
    } else if (preview.nextStep) {
      lines.push({
        text: `Alone, this joins no landing. Cut it and ${preview.nextStep.name} and the two together open ${pairs(preview.nextStep.opens)}.`,
      });
    } else {
      lines.push({ text: 'This line reaches no landing at either end. Some cuts are only pasture, and the marsh does not mind which you dig.', tone: 'quiet' });
    }
    const moat = cutWouldMoat(state, seg.id);
    if (moat) {
      lines.push({
        text: `And it lays water at the foot of ${name(moat)} — a moat. Raiders come at a moated wall ${CROSSING_FRONTAGE} abreast and no more.`,
        tone: 'good',
      });
    }
    const refused = stoneRefuses(state, seg);
    const cost = dykeCost(seg);
    verbs.push({
      key: 'dig',
      label: 'Cut the channel',
      charge: `${cost} coin · ${dykeDays(seg)} days`,
      why: `${dykeTiles(seg)} chains of silted channel. The water runs for ever — the marsh smaller by that much (${DYKE_DEBT} to the account), the parish colder for the enclosure, and the drained margin grazing ${DYKE_PASTURE_HEAD} more head.`,
      blocked: refused
        ? 'The wight-stone stands too near this line. The men will not dig by it.'
        : state.digging !== null
          ? 'The crew is one crew: one dig at a time.'
          : state.coin < cost
            ? `The diggers want ${cost} coin up front, and the till is short.`
            : undefined,
      run: act({ type: 'digDyke', id: seg.id }),
    });
  }
  return { kicker: 'the survey', title: seg.name, lines, sections: compact([{ key: 'spade', lines: [], verbs }]) };
}

export function signSheet(state: GameState): Sheet {
  const bait = state.boundWights + 1;
  const lines: Line[] = [
    { text: 'The grass inside lies drowned, and the sheep will not graze within a chain of it. The old people call it a wight-sign.' },
  ];
  if (state.boundWights > 0) {
    lines.push({
      text: `This ring is a new one. Your stone stands where it stood — each ring is its own wight, and each wants its own iron.`,
    });
  }
  const verbs: Verb[] = [];
  if (state.wights.trap) {
    lines.push({ text: `The trap is staked: iron, salt, and ${state.wights.trap.bait} sheep hobbled in the ring. Dawn will tell.` });
  } else {
    verbs.push({
      key: 'trap',
      label: 'Stake the trap',
      charge: `${WIGHT_TRAP_IRON} coin · ${bait} sheep as bait`,
      why: 'At dawn the wight is bound. No roll, no maybe. A bound wight teaches marsh magic and carries Debt — but the marsh keeps accounts.',
      blocked:
        state.coin < WIGHT_TRAP_IRON
          ? `Iron and salt run ${WIGHT_TRAP_IRON} coin, and the till is short.`
          : state.flockSize < bait
            ? `The trap wants ${bait} sheep staked, and the flock cannot spare them.`
            : undefined,
      danger: true,
      run: act({ type: 'trapWight' }),
    });
    lines.push({ text: 'Or leave it be. The ring does not fade.', tone: 'quiet' });
  }
  return { kicker: 'the marsh', title: 'A Ring of White Stones', lines, sections: compact([{ key: 'trap', lines: [], verbs }]) };
}

export function stoneSheet(state: GameState): Sheet {
  const bindings = state.boundWights * BINDING_CAPACITY;
  const over = state.debt > bindings;
  const r = state.research;
  const tier = r.completed.marsh;
  const sections: Section[] = [];

  sections.push({
    key: 'tribute',
    title: 'the account',
    lines: [],
    fill: { count: Math.min(Math.ceil(state.debt), Math.max(bindings, 1)), cap: Math.max(bindings, 1) },
    verbs: [
      {
        key: 'tribute',
        label: 'Leave a sheep in tribute',
        charge: `forgives ${TRIBUTE_RELIEF}`,
        why: 'Hobbled at the stone tonight; gone by morning. They take sheep, never coin.',
        blocked:
          state.debt <= 0 ? 'The account stands at nothing.' : state.flockSize < 1 ? 'There are no sheep to give.' : undefined,
        run: act({ type: 'payTribute' }),
      },
    ],
  });

  const teach: Verb[] = [];
  const teachLines: Line[] = [];
  if (r.active?.tree === 'marsh') {
    teachLines.push({ text: `The teaching is under way. Done in about ${days(r.active.doneTick - state.tick)}.` });
  } else if (tier >= MARSH_TIERS.length) {
    teachLines.push({ text: 'The stone has taught all it will — for now.' });
  } else {
    const b = r.active ? benchLine(state) : null;
    if (b) teachLines.push(b);
    const cost = RESEARCH_COST.marsh[tier];
    teach.push({
      key: 'marsh-learn',
      label: `Learn: ${MARSH_TIERS[tier].name}`,
      charge: `${cost} coin · ${RESEARCH_DAYS.marsh[tier]} days`,
      why: `${MARSH_TIERS[tier].effect} — ${MARSH_TIERS[tier].price}. Coin is the least of what this costs.`,
      blocked:
        r.active !== null
          ? 'The bench holds one project at a time.'
          : state.coin < cost
            ? `The work wants ${cost} coin up front, and the till is short.`
            : undefined,
      run: act({ type: 'startResearch', tree: 'marsh' }),
    });
  }
  if (tier >= 1) teachLines.push({ text: `Learned: ${MARSH_TIERS.slice(0, tier).map((t) => t.name).join(' · ')}.` });
  sections.push({ key: 'teach', title: 'what the stone teaches', lines: teachLines, verbs: teach });

  if (tier >= 4) {
    sections.push({
      key: 'veil',
      title: 'the reed-veil',
      lines: [
        {
          text: state.wights.veil
            ? 'The reeds stand around your works. Every hidden building owes the marsh one, each dawn, while they hold.'
            : 'The reeds lie ready. Raised, they swallow three parts in four of every work’s showing.',
        },
      ],
      verbs: [
        {
          key: 'veil',
          label: state.wights.veil ? 'Let the reeds fall' : 'Raise the veil',
          charge: state.wights.veil ? undefined : `+${MARSH_VEIL_DEBT} Debt per hidden building a dawn`,
          why: state.wights.veil
            ? 'The works stand showing again, and the account stops running.'
            : `Every work’s showing ÷ ${MARSH_VEIL_DIV}. Free to raise, free to lower.`,
          run: act({ type: 'setVeil', up: !state.wights.veil }),
        },
      ],
    });
  }
  if (tier >= 3) {
    if (state.wights.hollowWay === null) {
      sections.push({
        key: 'hollow',
        title: 'the way that is not there',
        lines: [],
        verbs: edgesFor(state.farm, state.cuttingHouse)
          .filter((e) => e.id === 'marsh-track' || e.id.startsWith('cut-'))
          .map((e) => ({
            key: `hollow-${e.id}`,
            label: `Open the hollow way through ${e.name.toLowerCase()}`,
            why: 'Exposure nothing; the blue coat never sees it; every laden crossing owes a favour.',
            run: act({ type: 'designateHollowWay', edgeId: e.id }),
          })),
      });
    } else {
      const e = edgesFor(state.farm, state.cuttingHouse).find((x) => x.id === state.wights.hollowWay);
      sections.push({
        key: 'hollow',
        title: 'the way that is not there',
        lines: [{ text: `The hollow way runs where ${e?.name.toLowerCase() ?? 'a track'} used to. Nobody watches it, and it is never free.` }],
        verbs: [],
      });
    }
  }

  return {
    kicker: 'the marsh',
    title: 'The Wight-Stone',
    lines: [
      {
        text: `The account: ${Math.ceil(state.debt)} owed against ${bindings} the bound will carry (${state.boundWights} wight${
          state.boundWights === 1 ? '' : 's'
        } bound). ${over ? 'The Debt outruns the bound. They are patient for three dawns, and then they are not.' : 'It never decays.'}`,
        tone: over ? 'warn' : undefined,
      },
    ],
    sections: compact(sections),
  };
}

export function officerSheet(state: GameState): Sheet {
  const o = state.revenue.officer;
  const bound =
    o.targetNodeId && o.targetNodeId !== 'customs' ? nodeById(o.targetNodeId, state.farm, state.cuttingHouse).name : null;
  return {
    kicker: 'the Revenue',
    title: 'The Riding Officer',
    lines: [
      {
        text:
          o.location.kind === 'edge'
            ? `On the road, sitting his horse like a writ.${bound ? ` Bound, by the look of it, for ${bound}.` : ''}`
            : o.location.nodeId === 'customs'
              ? 'At his lodgings above the Customs House, writing. Always writing.'
              : 'Dismounted, and looking at things the way he looks at everything: twice.',
      },
      { text: 'He is paid to notice. The parish notices him back — that much is free.', tone: 'quiet' },
    ],
    sections: [],
  };
}
