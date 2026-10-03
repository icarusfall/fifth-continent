// The desk's verbs as data (spec §20.4). A place's menu on the phone is JSX
// with prose between the buttons; on the desk it is a SHEET — facts, then
// verbs, each verb carrying its charge on its face and its explanation folded
// beneath it. The inspector renders any sheet the same way, so a place's
// knowledge lives in one function and its layout in one component.

import type { Action, NodeId } from '../sim/types';

export type Tone = 'warn' | 'good' | 'quiet' | 'dark';

/** One line of fact: what is true here, read aloud. */
export interface Line {
  text: string;
  tone?: Tone;
}

/** Things a verb can do that are not a sim Action: UI-side moves. */
export type UiCommand =
  | { ui: 'place-cutting-house' }
  | { ui: 'wait-lugger'; on: boolean }
  | { ui: 'sound-alarm' }
  | { ui: 'select'; target: DeskSelection };

export type Run = { action: Action } | UiCommand;

export interface Verb {
  key: string;
  /** The forward verb, short: "Shear", "Post a smuggler". */
  label: string;
  /** Its price, read on its face: "40 coin · 3/day". */
  charge?: string;
  /** What it is FOR — folded beneath the button, opened on demand. */
  why?: string;
  /** Why it cannot be done now. Present = disabled, and the reason is SHOWN
   *  (phone lesson: a reason that lives only in a tooltip does not exist). */
  blocked?: string;
  /** The one that costs something you will feel. */
  danger?: boolean;
  /** The NEXT STEP (desk playtest, 2026-10-03): lit, so a beginner reads the
   *  order shear, load, send off the sheet itself. One per sheet at most. */
  primary?: boolean;
  run: Run;
}

export interface Section {
  key: string;
  title?: string;
  lines: Line[];
  verbs: Verb[];
  fill?: { count: number; cap: number };
}

export interface Sheet {
  /** Small caps above the title: "a place", "a cart", "the books". */
  kicker: string;
  title: string;
  lines: Line[];
  fill?: { count: number; cap: number };
  sections: Section[];
}

export type DeskSelection =
  | { kind: 'place'; id: NodeId }
  | { kind: 'cart'; id: string }
  | { kind: 'dyke'; id: string }
  | { kind: 'sign' }
  | { kind: 'stone' }
  | { kind: 'officer' }
  | { kind: 'ledger' };

export const act = (action: Action): Run => ({ action });

/** Drop empty sections so a sheet never shows a heading over nothing. */
export function compact(sections: Section[]): Section[] {
  return sections.filter((s) => s.lines.length > 0 || s.verbs.length > 0 || s.fill);
}

export function sameSelection(a: DeskSelection | null, b: DeskSelection | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
