// Shared menu machinery (clean-sheet pass, stage 2): the popover shell,

// the close context, the enqueue hook, and the small helpers every place

// menu leans on. Moved verbatim out of GameMap.tsx; behaviour unchanged.



import { GOOD_LABEL, spanOf } from '../format';
import {
  DUTCHMAN_TRUST_JENEVER,
  DUTCHMAN_TRUST_TEA,
  MARSH_VEIL_DEBT,
  TICKS_PER_DAY } from '../../sim/balance';
import { edgeById, edgesFor, nodeById } from '../../sim/map';
import { CONTRABAND } from '../../sim/revenue';
import { dayPhaseOf } from '../../sim/time';
import type { Cart, CarterOrder, EdgeId, GameState, Good, NodeId, ResearchTree } from '../../sim/types';
import { useGameStore } from '../../state/store';
import { useUiStore } from '../../state/ui';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function cargoCount(cargo: Partial<Record<Good, number>>): number {
  return Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
}


/** §6.19 — a standing order read aloud: the stops in order, each naming what
 *  he picks up there. This is the sentence the picker builds, spoken back. */
export function orderLabel(state: GameState, order: CarterOrder): string {
  return order.stops
    .map((s) => {
      const where = nodeById(s.at, state.farm, state.cuttingHouse).name;
      if (s.take === undefined) return where;
      return `${GOOD_LABEL[s.take]} from ${where}${s.max !== undefined ? ` (up to ${s.max})` : ''}${
        s.fenceRest ? ' — fence the rest' : ''
      }`;
    })
    .join(', then ');
}


// §20 (M5a-4): the popover closes itself when a dispatch or a hire leaves no
// undirected cart standing at the node — sending the last cart off is how a
// visit ends. Every other action keeps the menu open.
export const CloseCtx = createContext<() => void>(() => {});


export function undirectedCartsAt(state: GameState, nodeId: NodeId, exceptId?: string): number {
  return state.carts.filter(
    (c) =>
      c.id !== exceptId && !c.carter && c.location.kind === 'node' && c.location.nodeId === nodeId,
  ).length;
}


/** Dispatch a cart and close the popover if that emptied the yard (§20). */
export function useSendCart(state: GameState, nodeId: NodeId) {
  const enqueue = useEnqueue();
  const close = useContext(CloseCtx);
  return (cartId: string, edgeId: EdgeId) => {
    enqueue({ type: 'dispatchCart', cartId, edgeId });
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };
}


/** §6.11 (M5a-4) — what a carter can bring home from each destination. The
 *  shingle's list follows the Dutchman's trust ladder (§6.9): no menu names
 *  a good he has not yet shown you. */
export function backOptionsFor(state: GameState, to: NodeId): Good[] {
  switch (to) {
    case 'shingle': {
      const goods: Good[] = ['lace'];
      if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_TEA) goods.unshift('tea');
      if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_JENEVER) goods.unshift('jenever');
      return goods;
    }
    case 'cutting-house':
      return ['brandy-gent', 'brandy-fair', 'brandy-rough'];
    case 'farm':
      return ['fleece'];
    default:
      return [];
  }
}


/** §6.11 / §10 (M5 tutorial pass) — the Dutchman tutorial, done by hand:
 *  met at the gunwale, and the trade itself made once — wool over the
 *  gunwale, or contraband sold in town (the fence counts). Until then no
 *  standing order names the shingle and no backhaul exists — no carter
 *  automates a trade his master has never made. (M5½ playtest: the old
 *  gate demanded a TOWN contraband sale even for the wool run, which read
 *  as the shingle arriving broken.) */
export function shingleRoutesOpen(state: GameState): boolean {
  return state.dutchman.met && (state.dutchman.fleeceBought > 0 || state.contrabandSold > 0);
}


/** §10 — one-line whispers for the smuggled goods, so nothing arrives unnamed. */
export const GOOD_WHISPER: Partial<Record<Good, string>> = {
  lace: 'Flanders lace — Ryne pays 24 the parcel, quietly, for about 2 a day. The Crown calls it smuggling.',
  tea: 'Bohea tea — Ryne drinks 8 chests a day at 7 the chest. The Crown calls it smuggling.',
  jenever: 'Overproof jenever — no buyer in Ryne will touch it raw. It wants cutting, and cutting wants a house.' };


/**
 * Spec §6.10: dispatch buttons carry the warning a marshman's eyes would.
 * True when the officer rides this edge or stands at its far end.
 */
export function coatOn(state: GameState, edgeId: EdgeId, from: NodeId): boolean {
  const officer = state.revenue.officer;
  if (!officer.arrived) return false;
  if (officer.location.kind === 'edge') return officer.location.edgeId === edgeId;
  const edge = edgesFor(state.farm, state.cuttingHouse).find((e) => e.id === edgeId);
  if (!edge) return false;
  const far = edge.a === from ? edge.b : edge.a;
  return officer.location.nodeId === far;
}


// §6.14 (M5c) — the leiden ladder, for the workshop's menu. Coin is nominal;
// the price column is the letter each tier wants sent. (M5½e: moved here from
// FarmMenu so the bench read-out can name any tree's project without cycles.)
export const LEIDEN_TIERS: ReadonlyArray<{ name: string; effect: string; price: string }> = [
  {
    name: 'Galvanic fence',
    effect: 'the workshop’s men kill the better',
    price: 'the wired wall reads for miles' },
  {
    name: 'Steam-lighter',
    effect: 'a hull, sixteen tubs, no bedtime — the sea lane opens',
    price: 'the engine is loud over water' },
  {
    name: 'Aetheric Telegraph',
    effect: 'the overlay defogs — the Revenue’s mind, live',
    price: 'the largest letter of all' },
];

/** §6.14 — marsh research, named for the stone's menu. */
export const MARSH_TIERS: ReadonlyArray<{ name: string; effect: string; price: string }> = [
  {
    name: 'Marsh-lantern haulers',
    effect: 'night moves read a tenth as loud',
    price: '+1 Debt each laden night run' },
  {
    name: 'Wight-fog',
    effect: 'a Call in battle: the raiders fight half-blind',
    price: '+8 Debt each fog' },
  {
    name: 'The Hollow Way',
    effect: 'one marsh track leaves the world’s knowing',
    price: '+1 Debt each crossing, laden or empty' },
  {
    name: 'The Reed-Veil',
    effect: 'the reeds swallow three parts in four of every work’s showing',
    price: `+${MARSH_VEIL_DEBT} Debt per hidden building, each dawn it stands` },
];

/** Every project the one bench can hold, named — index = tier (§6.14). */
const RESEARCH_NAME: Record<ResearchTree, readonly string[]> = {
  trade: ['False bottoms'],
  marsh: MARSH_TIERS.map((t) => t.name),
  leiden: LEIDEN_TIERS.map((t) => t.name) };

/**
 * §6.14 (M5½e) — the bench's read-out: the active project, named, with its
 * time left to run. Null when the bench is idle. The state was always in
 * `research.active`; this gives it a mouth (the HUD chip, the menus' line).
 */
export function benchReport(state: GameState): { name: string; left: string } | null {
  const a = state.research.active;
  if (!a) return null;
  const name = RESEARCH_NAME[a.tree][state.research.completed[a.tree]] ?? 'the work';
  const ticks = Math.max(0, a.doneTick - state.tick);
  const days = ticks / TICKS_PER_DAY;
  const left = days >= 1 ? `about ${Math.ceil(days)} day${Math.ceil(days) === 1 ? '' : 's'}` : spanOf(ticks);
  return { name, left };
}

/** The bench's line for any menu that offers research: what it holds now. */
export function BenchNote({ state }: { state: GameState }) {
  const bench = benchReport(state);
  if (!bench) return null;
  return (
    <p className="flavour">
      On the bench: <strong>{bench.name}</strong> — done in {bench.left}.
    </p>
  );
}

/** '· the blue coat…' suffix for a dispatch button, or empty. */
export function coatNote(state: GameState, edgeId: EdgeId, from: NodeId): string {
  return coatOn(state, edgeId, from) ? ' · the blue coat rides it' : '';
}


/** '· lanterns lit' suffix (§6.14 Marsh 1 — M5c playtest): the word is
 *  passive and the game must say when it is working. Night moves over marsh
 *  read a tenth as loud, one Debt the laden run; the button says so at the
 *  moment the choice is made. */
export function lanternNote(state: GameState, edgeId: EdgeId): string {
  if (state.research.completed.marsh < 1) return '';
  if (!(edgeId === 'marsh-track' || edgeId.startsWith('cut-'))) return '';
  return dayPhaseOf(state.tick) === 'night' ? ' · lanterns lit — a tenth as loud' : '';
}



// §20.2 — the goods overlay's short names: one small chip per place, so
// "which goods are where" is read off the map, not hunted through popovers.
export const GOOD_SHORT: Record<Good, string> = {
  fleece: 'wool',
  jenever: 'jenever',
  tea: 'tea',
  'bulked-tea': 'bulked tea',
  lace: 'lace',
  'brandy-rough': 'rough brandy',
  'brandy-fair': 'brandy',
  'brandy-gent': 'gent’s brandy' };


export function stockRows(store: Partial<Record<Good, number>>): Array<{ text: string; color?: string }> {
  return (Object.entries(store) as Array<[Good, number]>)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => ({
      text: `${n} ${GOOD_SHORT[g]}`,
      color: CONTRABAND.includes(g) ? '#D9A6A0' : undefined, // contraband reads warm
    }));
}


/** Units of a good held anywhere the player controls — stores and carts. */
export function heldAnywhere(state: GameState, good: Good): number {
  let n = 0;
  for (const k of Object.keys(state.stores)) n += state.stores[k]?.[good] ?? 0;
  for (const c of state.carts) n += c.cargo[good] ?? 0;
  return n;
}


/**
 * §20 (stage 3) — a collapsible run of a long menu. The heading is the
 * toggle; what you fold away stays folded for the session (UI store, never
 * the save). Default open: a menu must never HIDE a verb, only shelve it.
 */
export function Group({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  const open = useUiStore((s) => s.groupOpen[id] ?? true);
  const toggle = useUiStore((s) => s.toggleGroup);
  return (
    <section className="menu-group">
      <button className="group-head" onClick={() => toggle(id)}>
        <h5>{title}</h5>
        <span className="group-fold">{open ? '▾' : '▸'}</span>
      </button>
      {open && children}
    </section>
  );
}

export function Popover({
  onClose,
  wide,
  children }: {
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  // The map shell zooms on wheel (native listener, §15.2); a wheel over the
  // popover must scroll the menu instead, so it never reaches the shell.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stop, { passive: true });
    return () => el.removeEventListener('wheel', stop);
  }, []);
  return (
    <div
      ref={ref}
      className={wide ? 'popover wide' : 'popover'}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="popover-close" onClick={onClose}>
        ×
      </button>
      {children}
    </div>
  );
}

// ---- Menus (layer 3) ----


export function useEnqueue() {
  return useGameStore((s) => s.enqueue);
}

// The Trade fortification ladder, for the menu (spec §6.12 / §22). Index = tier.
// Tier 2 says "firing steps", not men (spec §6.12, playtest): the works are a
// wall for §6.13's garrison to shoot from — the men are posted separately.
export const FORT_TIER_LABEL = ['open ground', 'dogs & hedge', 'bolted doors & firing steps', 'gunported', 'a fortress'];


/**
 * §6.17 / §20 — a store's fill against its walls, made visible: the bar reddens
 * as goods silt toward the cap, so the §18 squeeze is felt before it deadlocks.
 */
export function StoreFill({ count, cap }: { count: number; cap: number }) {
  const pct = Math.min(1, cap > 0 ? count / cap : 0);
  const hue = Math.round(120 * (1 - pct)); // green (roomy) → red (full)
  return (
    <div
      title={`${count} of ${cap} — ${cap - count} units of room`}
      style={{
        height: 6,
        background: 'rgba(0,0,0,0.35)',
        borderRadius: 3,
        overflow: 'hidden',
        margin: '1px 0 7px' }}
    >
      <div style={{ width: `${pct * 100}%`, height: '100%', background: `hsl(${hue} 55% 45%)` }} />
    </div>
  );
}


/**
 * Spec §20: click the place, not the pixel. Every cart standing at a node
 * shows its business here — cargo, carter, the hire flow, and the dyke.
 */
/** Where a cart is, in words — for the stable roster (a moving sprite is no
 *  place to hang a button, so the farm lists every cart, §20). */
export function cartWhereabouts(state: GameState, cart: Cart): string {
  if (cart.location.kind === 'node') {
    return `at ${nodeById(cart.location.nodeId, state.farm, state.cuttingHouse).name}`;
  }
  return `on ${edgeById(cart.location.edgeId, state.farm, state.cuttingHouse).name.toLowerCase()}`;
}
