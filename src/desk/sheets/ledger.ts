// THE LEDGER (spec §20.1) as a desk sheet: the purse, the day ahead, the books
// switch with its trade read aloud (§6.10 M5½f), the societies, the parish.
// On the desk it opens in the inspector — never over the map.

import {
  CREW_WAGE,
  FLEECE_PER_HEAD_PER_DAY,
  MILITIA_WAGE,
  REFINER_WAGE,
  SHEARER_WAGE,
  TICKS_PER_DAY,
} from '../../sim/balance';
import { forecastDay } from '../../sim/forecast';
import { auditGapNow, CONTRABAND, darkOnHand } from '../../sim/revenue';
import { carterWageOf, rentAmount } from '../../sim/tick';
import { clockOf } from '../../sim/time';
import type { GameState } from '../../sim/types';
import { whiteShare } from '../../sim/wool';
import { act, compact, type Line, type Section, type Sheet } from '../sheet';

export function wageBill(state: GameState): number {
  const carters = state.carts.reduce((sum, c) => sum + (c.carter ? carterWageOf(c.carter) : 0), 0);
  const garrisons = Object.values(state.garrisons).reduce(
    (sum, g) => sum + (g ? g.militia * MILITIA_WAGE + g.crew * CREW_WAGE : 0),
    0,
  );
  return carters + (state.shearer.hired ? SHEARER_WAGE : 0) + (state.refiner.hired ? REFINER_WAGE : 0) + garrisons;
}

export function ledgerSheet(state: GameState): Sheet {
  const l = state.ledger;
  const rent = rentAmount(state);
  const forecast = forecastDay(state);
  const rentUrgent = state.coin < rent && state.rentDueTick - state.tick < 2 * TICKS_PER_DAY;
  const anyLaden = state.carts.some((c) => CONTRABAND.some((g) => (c.cargo[g] ?? 0) > 0));
  const sections: Section[] = [];

  sections.push({
    key: 'purse',
    title: 'the purse',
    lines: [
      { text: `${state.coin} coin · wages ${wageBill(state)} a day.` },
      {
        text: `Rent ${rent}, due day ${clockOf(state.rentDueTick).day} at dawn — ${
          state.coin >= rent ? 'covered' : `short ${rent - state.coin}`
        }${rentUrgent ? ', and the agent is nearly at the door' : ''}.`,
        tone: rentUrgent ? 'warn' : undefined,
      },
      {
        text: `The day ahead (the book’s guess, pricing the standing orders, never your own hands): takings ~${forecast.takings} · wages ${forecast.wages} · net ${
          forecast.takings - forecast.wages >= 0 ? '+' : ''
        }${forecast.takings - forecast.wages}.`,
        tone: forecast.takings >= forecast.wages ? 'quiet' : 'warn',
      },
      ...(state.dutchmanBook > 0
        ? [{ text: `The Dutchman’s book: ${state.dutchmanBook} — half of every sale is his until it clears.`, tone: 'warn' as const }]
        : []),
    ],
    verbs:
      rentUrgent || anyLaden
        ? [
            {
              key: 'alarm',
              label: 'Sound the alarm',
              charge: 'every laden cart to the fence',
              why: 'Every cart holding contraband turns for Ryne with the fence taking the remainder; carts already in town fence their load at once. Raise cash first; apologise to the routes later.',
              danger: true,
              run: { ui: 'sound-alarm' },
            },
          ]
        : [],
  });

  if (state.dutchman.unlocked) {
    const clip = state.flockSize * FLEECE_PER_HEAD_PER_DAY;
    const white = whiteShare(l.books, clip);
    const darkHere = darkOnHand(state);
    const gap = auditGapNow(state);
    const lines: Line[] = [
      l.books === 'square'
        ? { text: `Square: every fleece grows white — Ryne buys all ${clip} a day. Any fleece the lugger takes shows at the audit.` }
        : { text: `Short: ${clip - white} a day grow dark, free for the lugger. Ryne buys only the ${white} white.`, tone: 'dark' },
      {
        text:
          l.books === 'square'
            ? 'Switch to Short and, from the next dawn, half of every clip grows dark.'
            : 'Send the dark to the shingle and the white to town, and the arithmetic keeps itself.',
        tone: 'quiet',
      },
    ];
    if (darkHere > 0) {
      lines.push({
        text: `${darkHere} dark fleece at the farm. If the officer comes, he counts them and writes them onto the page: Heat once, and they turn white.`,
        tone: 'warn',
      });
    }
    lines.push({
      text: `This page: ${Math.round(l.declaredToDate)} declared · ${l.soldLawfully} sold at Ryne · ${l.grownToDate} grown · ${l.soldToday} weighed today.`,
      tone: 'quiet',
    });
    if (gap > 0.5) {
      lines.push({ text: `If he read this page now: ~${Math.round(gap)} fleece adrift — the audit prices every one in Heat.`, tone: 'warn' });
    }
    sections.push({
      key: 'books',
      title: 'the books',
      lines,
      verbs: [
        {
          key: 'books-square',
          label: l.books === 'square' ? 'Square books (kept)' : 'Keep the books square',
          blocked: l.books === 'square' ? 'The page already swears to every fleece.' : undefined,
          run: act({ type: 'setBooks', books: 'square' }),
        },
        {
          key: 'books-short',
          label: l.books === 'short' ? 'Short books (kept)' : 'Keep the books short',
          blocked: l.books === 'short' ? 'The page already swears to half.' : undefined,
          run: act({ type: 'setBooks', books: 'short' }),
        },
      ],
    });
  }

  const societies: Line[] = [];
  if (state.nationalHeatFloor > 0) {
    societies.push({
      text: `London’s memory of this parish never falls below ${Math.round(state.nationalHeatFloor)} now. It is the meter the Crown reads when it decides who rides.`,
    });
  }
  if (state.leiden.heldLetters.length > 0) {
    societies.push({ text: `${state.leiden.heldLetters.length} letter(s) held in the strongbox — he minds, and the parish minds with him.`, tone: 'quiet' });
  }
  sections.push({ key: 'societies', title: 'the societies', lines: societies, verbs: [] });

  sections.push({
    key: 'parish',
    title: 'the parish',
    lines: [
      {
        text: `Standing ${Math.round(state.standing)}${state.informer ? ' · someone talks — the free hides are closed' : ''}.`,
        tone: state.standing < 30 ? 'warn' : undefined,
      },
      ...(state.vouches > 0
        ? [{ text: `The neighbours have vouched for the rent ${state.vouches === 1 ? 'once' : `${state.vouches} times`}.`, tone: 'quiet' as const }]
        : []),
    ],
    verbs: [],
  });

  return { kicker: 'the books you keep', title: 'The Ledger', lines: [], sections: compact(sections) };
}
