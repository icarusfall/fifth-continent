// Shared menu machinery (clean-sheet pass, stage 2): the popover shell,
// the close context, the enqueue hook, and the small JSX helpers every place
// menu leans on. The pure read-aloud helpers now live in src/shared/words.ts
// (spec §20.3) and are re-exported here, so the frozen menus read unchanged.

import { useGameStore } from '../../state/store';
import { useUiStore } from '../../state/ui';
import type { EdgeId, GameState, NodeId } from '../../sim/types';
import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export {
  cargoCount,
  orderLabel,
  undirectedCartsAt,
  backOptionsFor,
  shingleRoutesOpen,
  GOOD_WHISPER,
  coatOn,
  LEIDEN_TIERS,
  MARSH_TIERS,
  benchReport,
  coatNote,
  lanternNote,
  GOOD_SHORT,
  stockRows,
  heldAnywhere,
  FORT_TIER_LABEL,
  cartWhereabouts,
} from '../../shared/words';
import { benchReport, undirectedCartsAt } from '../../shared/words';





// §20 (M5a-4): the popover closes itself when a dispatch or a hire leaves no
// undirected cart standing at the node — sending the last cart off is how a
// visit ends. Every other action keeps the menu open.
export const CloseCtx = createContext<() => void>(() => {});




/** Dispatch a cart and close the popover if that emptied the yard (§20). */
export function useSendCart(state: GameState, nodeId: NodeId) {
  const enqueue = useEnqueue();
  const close = useContext(CloseCtx);
  return (cartId: string, edgeId: EdgeId) => {
    enqueue({ type: 'dispatchCart', cartId, edgeId });
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };
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


