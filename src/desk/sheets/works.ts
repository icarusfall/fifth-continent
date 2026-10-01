// Works & men (spec §6.12–§6.14), shared by the farm and the cutting house:
// the walls, the hides, the men, the charge read aloud, and the workshop.
// Ported from the phone's works rows; the words are the same, the layout is
// the desk's (facts, then verbs with their charge on the face).

import {
  CELLAR_COST,
  CELLAR_COVER_PER_TIER,
  CREW_MUSTER,
  CREW_WAGE,
  FORT_COST,
  MAX_CELLAR_TIER,
  MAX_FORT_TIER,
  MILITIA_MUSTER,
  MILITIA_WAGE,
  RESEARCH_COST,
  RESEARCH_DAYS,
} from '../../sim/balance';
import { moatedAt } from '../../sim/dykes';
import { fenceActiveAt } from '../../sim/leiden';
import { defenceCeiling, expectedRaid } from '../../sim/raid';
import { coverOf } from '../../sim/revenue';
import { garrisonCap } from '../../sim/tick';
import type { GameState, NodeId } from '../../sim/types';
import { FORT_TIER_LABEL, LEIDEN_TIERS, benchReport } from '../../shared/words';
import { act, type Line, type Section, type Verb } from '../sheet';

const short = (cost: number) => `${cost} coin, and the till is short.`;

export function benchLine(state: GameState): Line | null {
  const bench = benchReport(state);
  return bench ? { text: `On the bench: ${bench.name} — done in ${bench.left}.` } : null;
}

export function worksSection(state: GameState, nodeId: NodeId): Section {
  const lines: Line[] = [];
  const verbs: Verb[] = [];

  // The walls (§6.12): the cost the player learns to fear is being seen.
  const tier = state.fortifications[nodeId] ?? 0;
  const fortMax = tier >= MAX_FORT_TIER;
  lines.push({
    text: `Works: ${FORT_TIER_LABEL[tier]} (${tier}/${MAX_FORT_TIER}). ${
      tier > 0 ? 'Harder to storm — and the Revenue sees the walls.' : 'Undug, and quiet as wool.'
    }`,
  });
  if (!fortMax) {
    const cost = FORT_COST[tier + 1];
    verbs.push({
      key: 'fortify',
      label: `Dig in · ${FORT_TIER_LABEL[tier + 1]}`,
      charge: `${cost} coin`,
      why: 'Every rung hardens the building — and shouts the louder to London. More rungs also quarter more men.',
      blocked: state.coin < cost ? short(cost) : undefined,
      run: act({ type: 'fortifyBuilding', nodeId }),
    });
  }

  // The hides (§6.12): the quiet twin — cover, bought.
  const cellar = state.cellars[nodeId] ?? 0;
  lines.push({
    text: `Hides: ${coverOf(state, nodeId)} of anything rest unseen here${
      cellar > 0 ? ` (a cellar${cellar > 1 ? ' with a false wall' : ''} under the boards)` : ''
    }.`,
  });
  if (cellar < MAX_CELLAR_TIER) {
    const cost = CELLAR_COST[cellar + 1];
    verbs.push({
      key: 'cellar',
      label: 'Dig a cellar hide',
      charge: `+${CELLAR_COVER_PER_TIER} cover · ${cost} coin`,
      why: 'Dry, dark, on no plan anywhere — and the Revenue never notices, which is the point.',
      blocked: state.coin < cost ? short(cost) : undefined,
      run: act({ type: 'digCellar', nodeId }),
    });
  }

  // The men (§6.13): militia are cheap and break; crew hold.
  const g = state.garrisons[nodeId] ?? { militia: 0, crew: 0 };
  const men = g.militia + g.crew;
  const cap = garrisonCap(state, nodeId);
  const full = men >= cap;
  const held =
    men === 0
      ? 'nobody'
      : [g.militia > 0 ? `${g.militia} militia` : '', g.crew > 0 ? `${g.crew} crew` : '']
          .filter(Boolean)
          .join(', ');
  lines.push({
    text: `The wall: ${held} (${men}/${cap} quartered). ${
      men === 0
        ? 'Works without men stop nothing — a raid walks in over empty steps.'
        : `Wages at dawn: ${g.militia * MILITIA_WAGE + g.crew * CREW_WAGE} coin. A wall that cannot be paid deserts.`
    }`,
    tone: men === 0 && state.hawksmere.provoked ? 'warn' : undefined,
  });
  const charge = chargeReading(state, nodeId);
  if (charge) lines.push(...charge);
  const fullReason = 'No more quarters. Dig in deeper to hold a larger garrison.';
  verbs.push(
    {
      key: 'militia',
      label: 'Post a militiaman',
      charge: `${MILITIA_MUSTER} coin · ${MILITIA_WAGE}/day`,
      why: 'A marsh farmer with a fowling piece: he shoots at half a smuggler’s rate and runs at twice the losses — he has a family to get back to. Cheap walls waver.',
      blocked: full ? fullReason : state.coin < MILITIA_MUSTER ? short(MILITIA_MUSTER) : undefined,
      run: act({ type: 'raiseGarrison', nodeId, kind: 'militia' }),
    },
    {
      key: 'crew',
      label: 'Post a smuggler',
      charge: `${CREW_MUSTER} coin · ${CREW_WAGE}/day`,
      why: 'Armed, willing, and stays for the worst of it. Dear walls hold.',
      blocked: full ? fullReason : state.coin < CREW_MUSTER ? short(CREW_MUSTER) : undefined,
      run: act({ type: 'raiseGarrison', nodeId, kind: 'crew' }),
    },
  );
  if (g.militia > 0) {
    verbs.push({ key: 'militia-down', label: 'Stand a militiaman down', run: act({ type: 'dismissGarrison', nodeId, kind: 'militia' }) });
  }
  if (g.crew > 0) {
    verbs.push({ key: 'crew-down', label: 'Stand a smuggler down', run: act({ type: 'dismissGarrison', nodeId, kind: 'crew' }) });
  }

  return { key: `works-${nodeId}`, title: 'works & men', lines, verbs };
}

const RAIDER: Record<string, string> = {
  hawksmere: 'the Hawksmere Company',
  'water-guard': 'the Water Guard',
  dragoons: 'Dragoons',
};

// The bisection runs ~10 battles: memoised on everything the engine reads,
// so a re-render every tick pays nothing while nothing has changed.
const chargeCache = new Map<string, { hold: number; behindWater: number }>();

/**
 * §6.13 (M5½e) — the charge, read where the men are posted and while there is
 * still time to act on it: who would come, what these men turn back (asked of
 * the engine itself), and what the same men would hold behind a cut channel.
 */
function chargeReading(state: GameState, nodeId: NodeId): Line[] | null {
  const g = state.garrisons[nodeId] ?? { militia: 0, crew: 0 };
  const men = g.militia + g.crew;
  if (!state.hawksmere.provoked || men === 0) return null;
  const tier = state.fortifications[nodeId] ?? 0;
  const moated = moatedAt(state, nodeId);
  const fence = fenceActiveAt(state, nodeId);
  const { faction, size } = expectedRaid(state);
  const key = JSON.stringify([nodeId, g.militia, g.crew, tier, moated, fence, faction]);
  let reading = chargeCache.get(key);
  if (!reading) {
    reading = {
      hold: defenceCeiling(state, nodeId, faction),
      behindWater: moated ? 0 : defenceCeiling(state, nodeId, faction, 'moated'),
    };
    chargeCache.set(key, reading);
  }
  const holds = reading.hold >= size;
  const out: Line[] = [
    {
      text: `The charge: ${RAIDER[faction] ?? 'raiders'} would bring ${size}; these men and works turn back about ${reading.hold}${
        moated ? ' behind the water' : ''
      }. ${holds ? 'As it stands, the wall holds.' : 'As it stands, they carry it.'}`,
      tone: holds ? 'good' : 'warn',
    },
  ];
  if (!moated && reading.behindWater > reading.hold) {
    out.push({
      text: `Behind a cut channel at this foot the same ${men} would hold ${reading.behindWater} — the water is a wall the works cannot be.`,
    });
  }
  return out;
}

/** §6.14 (M5c) — Leiden's bench, in the building that houses him. */
export function workshopSection(state: GameState, nodeId: NodeId): Section | null {
  if (state.leiden.state !== 'housed' || state.leiden.node !== nodeId) return null;
  const r = state.research;
  const tier = r.completed.leiden;
  const held = state.leiden.heldLetters.length;
  const lines: Line[] = [
    {
      text:
        'The philosopher keeps his bench behind the hides, and the room smells of storms.' +
        (tier > 0 ? ` Learned: ${LEIDEN_TIERS.slice(0, tier).map((t) => t.name).join(' · ')}.` : ''),
    },
  ];
  if (state.leiden.letterPending !== null) {
    lines.push({ text: 'A letter sits sealed on the bench. He will not work past it.', tone: 'warn' });
  }
  const bench = benchLine(state);
  if (bench) lines.push(bench);
  const verbs: Verb[] = [];
  if (tier < LEIDEN_TIERS.length && state.leiden.letterPending === null) {
    const cost = RESEARCH_COST.leiden[tier];
    verbs.push({
      key: 'leiden-learn',
      label: `Learn: ${LEIDEN_TIERS[tier].name}`,
      charge: `${cost} coin · ${RESEARCH_DAYS.leiden[tier]} days`,
      why: `${LEIDEN_TIERS[tier].effect} — ${LEIDEN_TIERS[tier].price}. And a letter will want sending.`,
      blocked:
        r.active !== null
          ? 'The bench holds one project at a time.'
          : held >= 3
            ? 'Three letters sit in your strongbox. He has downed tools until one goes out.'
            : state.coin < cost
              ? `The work wants ${cost} coin up front, and the till is short.`
              : undefined,
      run: act({ type: 'startResearch', tree: 'leiden' }),
    });
  }
  if (held > 0) {
    verbs.push({
      key: 'letter-out',
      label: 'Let an old letter out of the strongbox',
      charge: `${held} held`,
      why: 'The floor rises late — late news from this parish is still news.',
      run: act({ type: 'releaseLetter' }),
    });
  }
  return { key: `workshop-${nodeId}`, title: 'the workshop', lines, verbs };
}
