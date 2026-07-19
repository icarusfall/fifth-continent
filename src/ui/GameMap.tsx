// The map is the interface (spec §20): a layered Canvas 2D renderer with an
// eased camera, click-the-asset popover menus, and the opening act — choose
// ground for your farm. React owns the DOM overlay (layer 3); the canvas
// loop owns layers 0–1 and reads the latest sim state from a ref.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CART_CAPACITY,
  CART_COST,
  CART_RESALE,
  CARTER_UNLOCK_FLEECE,
  CARTER_WAGE,
  CUTS,
  CUTTING_HOUSE_COST,
  CUTTING_HOUSE_STORE_CAPACITY,
  CUT_SUGAR_COST,
  DAILY_DEMAND,
  DUTCHMAN_PRICE,
  FARM_STORE_CAPACITY,
  FENCE_PRICE_MULT,
  FLOCK_CAP,
  SMOUCH_COST,
  SMOUCH_YIELD,
  FORT_COST,
  LEIDEN_PRICE_MULT,
  MAX_CARTS,
  MAX_FORT_TIER,
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
  TICKS_PER_DAY,
  WOOL_PRICE_DOMESTIC,
} from '../sim/balance';
import {
  SHINGLE,
  edgeById,
  edgesFor,
  horseLatency,
  isPlaceable,
  nodeById,
  officerEdgesFor,
} from '../sim/map';
import { dayPhaseOf, isFlooded, ticksUntilTideTurn } from '../sim/time';
import { CONTRABAND, fortVisibility } from '../sim/revenue';
import { GOOD_LABEL, spanOf, storeSummary } from './format';
import type { Action, Cart, CutDepth, EdgeId, GameState, Good, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';
import { CameraController } from './camera';
import { pathPoints, pointAlong, TILE, tileCenter } from './geometry';
import { getTerrainCanvas } from './paint';
import {
  drawCart,
  drawCustoms,
  drawCuttingHouse,
  drawFarm,
  drawFarmGlow,
  drawFortifications,
  drawGossipStain,
  drawLabel,
  drawLugger,
  drawOfficer,
  drawRoad,
  drawRyne,
  drawSheep,
  drawShingle,
  drawTileHighlight,
} from './sprites';

type Selection =
  | 'farm'
  | 'ryne'
  | 'customs'
  | 'shingle'
  | 'cutting-house'
  | 'officer'
  | `cart:${string}`
  | null;

function cargoCount(cargo: Partial<Record<Good, number>>): number {
  return Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
}

/** One cart's position in world coords; carts at a node fan out in the yard. */
function cartWorldPosOf(
  state: GameState,
  cart: Cart,
): { x: number; y: number; angle: number } | null {
  if (cart.location.kind === 'node') {
    const node = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
    const anchor = tileCenter(node);
    const slot = state.carts.filter((c) => c.location.kind === 'node').indexOf(cart);
    return { x: anchor.x + 14 + slot * 9, y: anchor.y + 8 + slot * 5, angle: 0 };
  }
  const edge = edgesFor(state.farm, state.cuttingHouse).find(
    (e) => e.id === (cart.location as { edgeId: string }).edgeId,
  );
  if (!edge) return null;
  const pts = pathPoints(edge, cart.location.from !== edge.a);
  return pointAlong(pts, cart.location.progress / edge.latency);
}

/** The officer's position: at a node, or riding one of his edges. */
function officerWorldPos(state: GameState): { x: number; y: number; angle: number } | null {
  const officer = state.revenue.officer;
  if (!officer.arrived) return null;
  if (officer.location.kind === 'node') {
    const node = nodeById(officer.location.nodeId, state.farm, state.cuttingHouse);
    const anchor = tileCenter(node);
    return { x: anchor.x - 12, y: anchor.y + 10, angle: 0 };
  }
  const edge = officerEdgesFor(state.farm, state.cuttingHouse).find(
    (e) => e.id === (officer.location as { edgeId: string }).edgeId,
  );
  if (!edge) return null;
  const pts = pathPoints(edge, officer.location.from !== edge.a);
  return pointAlong(pts, Math.min(1, officer.location.progress / horseLatency(edge)));
}

// §20 (M5a-4): the popover closes itself when a dispatch or a hire leaves no
// undirected cart standing at the node — sending the last cart off is how a
// visit ends. Every other action keeps the menu open.
const CloseCtx = createContext<() => void>(() => {});

function undirectedCartsAt(state: GameState, nodeId: NodeId, exceptId?: string): number {
  return state.carts.filter(
    (c) =>
      c.id !== exceptId && !c.carter && c.location.kind === 'node' && c.location.nodeId === nodeId,
  ).length;
}

/** Dispatch a cart and close the popover if that emptied the yard (§20). */
function useSendCart(state: GameState, nodeId: NodeId) {
  const enqueue = useEnqueue();
  const close = useContext(CloseCtx);
  return (cartId: string, edgeId: EdgeId) => {
    enqueue({ type: 'dispatchCart', cartId, edgeId });
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };
}

/** §6.11 (M5a-4) — what a carter can bring home from each destination. */
function backOptionsFor(to: NodeId): Good[] {
  switch (to) {
    case 'shingle':
      return ['jenever', 'tea', 'lace'];
    case 'cutting-house':
      return ['brandy-gent', 'brandy-fair', 'brandy-rough'];
    case 'farm':
      return ['fleece'];
    default:
      return [];
  }
}

/**
 * Spec §6.10: dispatch buttons carry the warning a marshman's eyes would.
 * True when the officer rides this edge or stands at its far end.
 */
function coatOn(state: GameState, edgeId: EdgeId, from: NodeId): boolean {
  const officer = state.revenue.officer;
  if (!officer.arrived) return false;
  if (officer.location.kind === 'edge') return officer.location.edgeId === edgeId;
  const edge = edgesFor(state.farm, state.cuttingHouse).find((e) => e.id === edgeId);
  if (!edge) return false;
  const far = edge.a === from ? edge.b : edge.a;
  return officer.location.nodeId === far;
}

/** '· the blue coat…' suffix for a dispatch button, or empty. */
function coatNote(state: GameState, edgeId: EdgeId, from: NodeId): string {
  return coatOn(state, edgeId, from) ? ' · the blue coat rides it' : '';
}

function routesVisible(state: GameState): boolean {
  const cart = state.carts[0];
  return (
    !!cart && ((cart.cargo.fleece ?? 0) > 0 || cart.location.kind === 'edge' || state.coin > 0)
  );
}

/** A brand-new tenancy: nothing earned, nothing moved — the farm glows. */
function isFreshGame(state: GameState): boolean {
  const cart = state.carts[0];
  return (
    state.coin === 0 &&
    state.rentPaid === 0 &&
    (state.stores.farm?.fleece ?? 0) === 0 &&
    (cart?.cargo.fleece ?? 0) === 0 &&
    cart?.location.kind === 'node'
  );
}

function anchorWorld(sel: Selection, state: GameState): { x: number; y: number } | null {
  if (sel?.startsWith('cart:')) {
    const cart = state.carts.find((c) => c.id === sel.slice(5));
    return cart ? cartWorldPosOf(state, cart) : null;
  }
  switch (sel) {
    case 'farm':
      return tileCenter(state.farm);
    case 'ryne':
      return tileCenter({ x: 28, y: 21 });
    case 'customs':
      return tileCenter({ x: 26, y: 19 });
    case 'shingle':
      return tileCenter(SHINGLE);
    case 'cutting-house':
      return state.cuttingHouse ? tileCenter(state.cuttingHouse) : null;
    case 'officer':
      return officerWorldPos(state);
    default:
      return null;
  }
}

export function GameMap({ state }: { state: GameState }) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const camRef = useRef<CameraController | null>(null);
  if (!camRef.current) camRef.current = new CameraController();

  const stateRef = useRef(state);
  stateRef.current = state;

  const [selected, setSelected] = useState<Selection>(null);
  const selectedRef = useRef<Selection>(null);
  selectedRef.current = selected;
  // The startup glow dies the first time the farm menu opens.
  const farmVisitedRef = useRef(false);
  // Placement mode: choosing ground for the cutting house (spec §6.9).
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  placingRef.current = placing;
  // The gossip overlay (spec §6.10): yesterday's Revenue mind, one toggle.
  const [showGossip, setShowGossip] = useState(false);
  const showGossipRef = useRef(false);
  showGossipRef.current = showGossip;
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  // Live touch points, for two-finger pinch. One pointer pans; two pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());

  const flooded = isFlooded(state.tick);
  const phase = dayPhaseOf(state.tick);
  const nightOpacity = phase === 'night' ? 0.34 : phase === 'dusk' ? 0.16 : 0;

  // ---- The render loop (layers 0–1) ----
  useEffect(() => {
    const shell = shellRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cam = camRef.current!;
    if (import.meta.env.DEV) (window as unknown as { __cam: unknown }).__cam = cam;
    const terrain = getTerrainCanvas();
    const RES_PER_TILE = terrain.width / 40 / TILE; // painted px per world px
    let raf = 0;

    const loop = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      cam.setViewport(w, h);
      cam.ease();

      const s = stateRef.current;
      const z = cam.zoom * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#241C18';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Layer 0: the land, painted once, scaled by the camera.
      ctx.drawImage(
        terrain,
        0,
        0,
        terrain.width,
        terrain.height,
        0,
        0,
        terrain.width / RES_PER_TILE,
        terrain.height / RES_PER_TILE,
      );

      // Layer 1: roads, flock, buildings, cart.
      const floodedNow = isFlooded(s.tick);
      for (const edge of edgesFor(s.farm, s.cuttingHouse)) {
        // Progressive disclosure: the roads once there is something to move;
        // the marsh track once the Dutchman is in the world; a sited cutting
        // house shows its own tracks always (the player paid for them).
        const visible =
          edge.id === 'marsh-track'
            ? s.dutchman.unlocked
            : edge.id.startsWith('cut-')
              ? true
              : routesVisible(s);
        if (visible) {
          drawRoad(ctx, pathPoints(edge, false), edge.condition === 'tideLocked' && floodedNow);
        }
      }
      drawSheep(ctx, s.farm, s.flockSize);
      drawFarm(ctx, s.farm);
      if ((s.fortifications.farm ?? 0) > 0) {
        drawFortifications(ctx, s.farm, s.fortifications.farm ?? 0, fortVisibility(s, 'farm'));
      }
      const fc = tileCenter(s.farm);
      drawLabel(ctx, 'Walland Farm', fc.x, fc.y - 16);
      if (isFreshGame(s) && !farmVisitedRef.current) {
        drawFarmGlow(ctx, s.farm, (performance.now() / 1800) % 1);
      }
      drawRyne(ctx);
      drawLabel(ctx, 'Ryne', 28.5 * TILE, 19.6 * TILE);
      drawCustoms(ctx);
      drawLabel(ctx, 'Customs House', 26.5 * TILE, 17.9 * TILE);

      if (s.dutchman.unlocked) {
        drawShingle(ctx, SHINGLE);
        const sc = tileCenter(SHINGLE);
        drawLabel(ctx, 'The Shingle', sc.x - 4, sc.y - 12);
        if (s.dutchman.present) drawLugger(ctx, SHINGLE);
      }
      if (s.cuttingHouse) {
        drawCuttingHouse(ctx, s.cuttingHouse);
        if ((s.fortifications['cutting-house'] ?? 0) > 0) {
          drawFortifications(
            ctx,
            s.cuttingHouse,
            s.fortifications['cutting-house'] ?? 0,
            fortVisibility(s, 'cutting-house'),
          );
        }
        const cc = tileCenter(s.cuttingHouse);
        drawLabel(ctx, 'Cutting House', cc.x, cc.y - 12);
      }

      // Gossip stains (spec §6.10): where the parish thinks the Revenue looks.
      if (showGossipRef.current) {
        for (const [nodeId, strength] of Object.entries(s.revenue.gossip)) {
          if (strength < 0.5) continue;
          if (nodeId === 'cutting-house' && !s.cuttingHouse) continue;
          try {
            const c = tileCenter(nodeById(nodeId, s.farm, s.cuttingHouse));
            drawGossipStain(ctx, c.x, c.y, strength);
          } catch {
            /* a stain on a node that no longer exists dries out */
          }
        }
      }

      for (const cart of s.carts) {
        const cp = cartWorldPosOf(s, cart);
        if (cp) {
          drawCart(
            ctx,
            cp.x,
            cp.y,
            cart.location.kind === 'edge' ? cp.angle : 0,
            cargoCount(cart.cargo) > 0,
          );
        }
      }

      const op = officerWorldPos(s);
      if (op) {
        drawOfficer(ctx, op.x, op.y, s.revenue.officer.location.kind === 'edge' ? op.angle : 0);
      }

      // Placement mode: the hovered tile answers before the coin is spent.
      if (placingRef.current && hoverTileRef.current) {
        const t = hoverTileRef.current;
        drawTileHighlight(ctx, t.x, t.y, isPlaceable(t.x, t.y) && s.coin >= CUTTING_HOUSE_COST);
      }

      // Layer 3 helper: keep the popover pinned to its anchor — and always
      // wholly on screen: clamp by its real measured size, not a guess.
      const pop = popRef.current;
      if (pop) {
        const a = anchorWorld(selectedRef.current, s);
        const card = pop.firstElementChild as HTMLElement | null;
        if (a && card) {
          card.style.maxHeight = `${h - 16}px`; // never taller than the map itself
          const p = cam.worldToScreen(a.x, a.y);
          const left = Math.max(8, Math.min(p.x + 16, w - card.offsetWidth - 8));
          const top = Math.max(8, Math.min(p.y - 30, h - card.offsetHeight - 8));
          pop.style.transform = `translate(${left}px, ${top}px)`;
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- Input ----
  useEffect(() => {
    const shell = shellRef.current!;
    const cam = camRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = shell.getBoundingClientRect();
      cam.wheel(e.deltaY, e.clientX - r.left, e.clientY - r.top, e.deltaMode);
    };
    shell.addEventListener('wheel', onWheel, { passive: false });
    return () => shell.removeEventListener('wheel', onWheel);
  }, []);

  function localPos(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } {
    const r = shellRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const enqueue = useGameStore((s) => s.enqueue);

  function onClick(e: React.MouseEvent) {
    const cam = camRef.current!;
    if (cam.wasDrag()) return;
    const s = stateRef.current;
    const p = localPos(e);
    const w = cam.screenToWorld(p.x, p.y);

    // Placement mode eats the click: build on marsh, or think better of it.
    if (placing) {
      const tx = Math.floor(w.x / TILE);
      const ty = Math.floor(w.y / TILE);
      if (isPlaceable(tx, ty) && s.coin >= CUTTING_HOUSE_COST) {
        enqueue({ type: 'placeCuttingHouse', x: tx, y: ty });
      }
      setPlacing(false);
      return;
    }

    // Hit-test the assets, nearest first.
    const targets: Array<{ sel: Selection; x: number; y: number; r: number }> = [];
    for (const cart of s.carts) {
      const cp = cartWorldPosOf(s, cart);
      if (cp) targets.push({ sel: `cart:${cart.id}`, x: cp.x, y: cp.y, r: 14 });
    }
    const op = officerWorldPos(s);
    if (op) targets.push({ sel: 'officer', x: op.x, y: op.y, r: 14 });
    const fc = tileCenter(s.farm);
    targets.push({ sel: 'farm', x: fc.x, y: fc.y, r: 26 });
    const rc = tileCenter({ x: 28, y: 21.8 });
    targets.push({ sel: 'ryne', x: rc.x, y: rc.y, r: 42 });
    const cc = tileCenter({ x: 26, y: 19 });
    targets.push({ sel: 'customs', x: cc.x, y: cc.y, r: 16 });
    if (s.dutchman.unlocked) {
      const sc = tileCenter(SHINGLE);
      targets.push({ sel: 'shingle', x: sc.x + 14, y: sc.y, r: 34 }); // lugger included
    }
    if (s.cuttingHouse) {
      const hc = tileCenter(s.cuttingHouse);
      targets.push({ sel: 'cutting-house', x: hc.x, y: hc.y, r: 18 });
    }

    let best: { sel: Selection; d: number } | null = null;
    for (const t of targets) {
      const d = Math.hypot(w.x - t.x, w.y - t.y);
      if (d <= t.r && (!best || d < best.d)) best = { sel: t.sel, d };
    }
    let sel = best?.sel ?? null;
    // Click the place, not the pixel (spec §20): a cart standing at a node
    // answers from the node's menu; only a cart on the road answers for itself.
    if (sel?.startsWith('cart:')) {
      const cart = s.carts.find((c) => c.id === sel!.slice(5));
      if (cart?.location.kind === 'node' && cart.location.nodeId !== 'customs') {
        sel = cart.location.nodeId as Selection;
      }
    }
    if (sel === 'farm') farmVisitedRef.current = true;
    setSelected(sel);
  }

  // §20 — the location dock: open a place's menu without hunting for its pixel
  // on the map (a real help on a phone), and glide the map to it. Only the
  // places the map itself shows are listed — the coast and the cutting house
  // join as they enter the world.
  function selectPlace(sel: Selection) {
    if (sel === 'farm') farmVisitedRef.current = true;
    const w = anchorWorld(sel, stateRef.current);
    if (w) camRef.current!.focusOn(w.x, w.y);
    setSelected(sel);
  }
  const places: Array<{ sel: Selection; label: string }> = [
    { sel: 'farm', label: 'Walland Farm' },
    { sel: 'ryne', label: 'Ryne' },
    { sel: 'customs', label: 'Customs House' },
  ];
  if (state.dutchman.unlocked) places.push({ sel: 'shingle', label: 'The Shingle' });
  if (state.cuttingHouse) places.push({ sel: 'cutting-house', label: 'Cutting House' });

  return (
    <div
      ref={shellRef}
      className={placing ? 'map-shell placing' : 'map-shell'}
      onPointerDown={(e) => {
        if (e.button === 0 || e.button === 1) {
          const p = localPos(e);
          const pts = pointersRef.current;
          pts.set(e.pointerId, p);
          if (pts.size === 1) {
            camRef.current!.pointerDown(p.x, p.y);
          } else if (pts.size === 2) {
            camRef.current!.pointerUp(); // one-finger pan yields to the pinch
          }
          try {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events have no real pointer */
          }
        }
      }}
      onPointerMove={(e) => {
        const p = localPos(e);
        const pts = pointersRef.current;
        if (pts.size === 2 && pts.has(e.pointerId)) {
          // Two fingers: zoom about their midpoint, pan by its travel.
          const [idA, idB] = [...pts.keys()];
          const oldA = pts.get(idA)!;
          const oldB = pts.get(idB)!;
          const newA = e.pointerId === idA ? p : oldA;
          const newB = e.pointerId === idB ? p : oldB;
          const oldDist = Math.hypot(oldB.x - oldA.x, oldB.y - oldA.y);
          const newDist = Math.hypot(newB.x - newA.x, newB.y - newA.y);
          const mid = { x: (newA.x + newB.x) / 2, y: (newA.y + newB.y) / 2 };
          const oldMid = { x: (oldA.x + oldB.x) / 2, y: (oldA.y + oldB.y) / 2 };
          camRef.current!.pinch(
            mid.x,
            mid.y,
            oldDist > 1 ? newDist / oldDist : 1,
            mid.x - oldMid.x,
            mid.y - oldMid.y,
          );
          pts.set(e.pointerId, p);
        } else {
          if (pts.has(e.pointerId)) pts.set(e.pointerId, p);
          camRef.current!.pointerMove(p.x, p.y);
        }
        if (placingRef.current) {
          const w = camRef.current!.screenToWorld(p.x, p.y);
          hoverTileRef.current = { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
        }
      }}
      onPointerUp={(e) => {
        const pts = pointersRef.current;
        pts.delete(e.pointerId);
        if (pts.size === 1) {
          // The surviving finger keeps panning; the click stays suppressed.
          const [rest] = pts.values();
          camRef.current!.reanchor(rest.x, rest.y);
        } else if (pts.size === 0) {
          camRef.current!.pointerUp();
        }
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
      onPointerCancel={(e) => {
        pointersRef.current.delete(e.pointerId);
        if (pointersRef.current.size === 0) camRef.current!.pointerUp();
      }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="map-canvas" />

      {nightOpacity > 0 && <div className="night-veil" style={{ opacity: nightOpacity }} />}

      {placing && (
        <div className="banner">
          Choose ground for the cutting house — open marsh, {CUTTING_HOUSE_COST} coin. Click
          elsewhere to think better of it.
        </div>
      )}

      {state.lost && <ForfeitOverlay />}

      {(state.heat.regional >= 0.5 || state.revenue.officer.arrived) && (
        <button
          className={showGossip ? 'gossip-toggle on' : 'gossip-toggle'}
          title="What the parish says the Revenue thinks. Yesterday's news, like all gossip."
          onClick={(e) => {
            e.stopPropagation();
            setShowGossip((v) => !v);
          }}
        >
          {showGossip ? 'gossip · on' : 'gossip'}
        </button>
      )}

      {!placing && !state.lost && (
        // Stop pointer events reaching the shell: otherwise its pointerdown
        // captures the pointer and steals the button's click (and would start
        // a camera pan). onClick stop keeps the map's hit-test from firing too.
        <nav
          className="location-dock"
          aria-label="Places"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {places.map((pl) => (
            <button
              key={pl.sel as string}
              className={selected === pl.sel ? 'on' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                selectPlace(pl.sel);
              }}
            >
              {pl.label}
            </button>
          ))}
        </nav>
      )}

      {selected && !placing && (
        <div ref={popRef} className="popover-anchor">
          <Popover wide={selected === 'farm'} onClose={() => setSelected(null)}>
            <CloseCtx.Provider value={() => setSelected(null)}>
            {selected === 'farm' && (
              <FarmMenu state={state} onPlace={() => setPlacing(true)} />
            )}
            {selected === 'ryne' && <RyneMenu state={state} />}
            {selected === 'customs' && (
              <>
                <h4>The Customs House</h4>
                <p className="flavour">
                  {state.revenue.officer.arrived
                    ? 'A Riding Officer lodges upstairs now. He keeps early hours and long lists.'
                    : 'Quiet today. It counts things. It is counting now.'}
                </p>
              </>
            )}
            {selected === 'shingle' && (
              <ShingleMenu state={state} onPlace={() => setPlacing(true)} />
            )}
            {selected === 'cutting-house' && <CuttingHouseMenu state={state} />}
            {selected === 'officer' && <OfficerMenu state={state} />}
            {selected?.startsWith('cart:') && (
              <CartMenu state={state} flooded={flooded} cartId={selected.slice(5)} />
            )}
            </CloseCtx.Provider>
          </Popover>
        </div>
      )}
    </div>
  );
}

function OfficerMenu({ state }: { state: GameState }) {
  const officer = state.revenue.officer;
  const riding = officer.location.kind === 'edge';
  const bound =
    officer.targetNodeId && officer.targetNodeId !== 'customs'
      ? nodeById(officer.targetNodeId, state.farm, state.cuttingHouse).name
      : null;
  return (
    <>
      <h4>The Riding Officer</h4>
      <p className="flavour">
        {riding
          ? `On the road, sitting his horse like a writ.${bound ? ` Bound, by the look of it, for ${bound}.` : ''}`
          : officer.location.kind === 'node' && officer.location.nodeId === 'customs'
            ? 'At his lodgings above the Customs House, writing. Always writing.'
            : 'Dismounted, and looking at things the way he looks at everything: twice.'}
      </p>
      <p className="flavour">He is paid to notice. The parish notices him back — that much is free.</p>
    </>
  );
}

function ForfeitOverlay() {
  const requestNewGame = useGameStore((s) => s.requestNewGame);
  return (
    <div className="forfeit">
      <div className="forfeit-card">
        <h2>The tenancy is forfeit.</h2>
        <p>
          The agent's men drove off the last of the flock at dawn. The Gault keeps no one who
          cannot pay.
        </p>
        <button onClick={requestNewGame}>Begin again</button>
      </div>
    </div>
  );
}

function Popover({
  onClose,
  wide,
  children,
}: {
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

function useEnqueue() {
  return useGameStore((s) => s.enqueue);
}

// The Trade fortification ladder, for the menu (spec §6.12 / §22). Index = tier.
const FORT_TIER_LABEL = ['open ground', 'dogs & hedge', 'blunderbuss men', 'gunported', 'a fortress'];

/**
 * Spec §6.12 — dig in one rung of the Trade line. The cost is coin now; the
 * cost the player learns to fear is being *seen* — the button says so.
 */
function FortifyRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const tier = state.fortifications[nodeId] ?? 0;
  const maxed = tier >= MAX_FORT_TIER;
  const cost = maxed ? 0 : FORT_COST[tier + 1];
  const canAfford = state.coin >= cost;

  return (
    <>
      <p className="flavour">
        Works: <strong>{FORT_TIER_LABEL[tier]}</strong> ({tier}/{MAX_FORT_TIER}).{' '}
        {tier > 0
          ? 'Harder to storm — and the Revenue sees the walls.'
          : 'Undug, and quiet as wool.'}
      </p>
      <div className="menu-buttons">
        <button
          disabled={maxed || !canAfford}
          title={
            maxed
              ? 'As hard as it gets.'
              : canAfford
                ? 'Every rung hardens the building — and shouts the louder to London.'
                : `${cost} coin, and the till is short.`
          }
          onClick={() => enqueue({ type: 'fortifyBuilding', nodeId })}
        >
          {maxed ? 'Fully fortified' : `Dig in · ${FORT_TIER_LABEL[tier + 1]} · ${cost} coin`}
        </button>
      </div>
    </>
  );
}

/**
 * Spec §6.16 — the shearing lad: offered once the chore is felt (six hand
 * shears, or a carter already on the reins). The last chore, sold.
 */
function ShearerRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const offered =
    state.shearer.hired ||
    state.shearer.handShears >= SHEARER_UNLOCK_SHEARS ||
    state.carts.some((c) => c.carter !== null);
  if (!offered) return null;
  return (
    <div className="menu-buttons">
      {state.shearer.hired ? (
        <button
          title="The dawn clip becomes your chore again."
          onClick={() => enqueue({ type: 'dismissShearer' })}
        >
          Dismiss the shearing lad
        </button>
      ) : (
        <button
          title="He shears the flock into the barn at dawn, and he does not count."
          onClick={() => enqueue({ type: 'hireShearer' })}
        >
          Hire the shearing lad · {SHEARER_WAGE} coin a day
        </button>
      )}
    </div>
  );
}

/** Spec §6.16 — the flock market: purchase and sale, never husbandry. */
function FlockMarketRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const room = FLOCK_CAP - state.flockSize - state.sheepArriving;
  return (
    <>
      <p className="flavour">
        The pasture holds {FLOCK_CAP}. More sheep, more wool, more alibi — and Ryne buys only so
        much honest fleece.
      </p>
      <div className="menu-buttons">
        <button
          disabled={room <= 0 || state.coin < SHEEP_PRICE_BUY}
          title={
            room <= 0
              ? 'No grass, no sheep. Walland holds what it holds.'
              : state.coin < SHEEP_PRICE_BUY
                ? `${SHEEP_PRICE_BUY} coin, and the till is short.`
                : 'The drover brings them up the drove road by dawn.'
          }
          onClick={() => enqueue({ type: 'buySheep', qty: 1 })}
        >
          Buy a sheep · {SHEEP_PRICE_BUY} coin
        </button>
        <button
          disabled={state.flockSize <= 1}
          title="The market pays cash, and pays worse than the agent values them."
          onClick={() => enqueue({ type: 'sellSheep', qty: 1 })}
        >
          Sell a sheep · {SHEEP_PRICE_SELL} coin
        </button>
      </div>
    </>
  );
}

/** Spec §6.14 — the bench: one project at a time; trade tier 1 in M5a. */
function BenchRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const r = state.research;
  if (r.completed.trade >= 1) {
    return (
      <p className="flavour">
        The carts ride on hollow floors — the road reads quieter, and the road-stops miss what
        is under the boards.
      </p>
    );
  }
  if (r.active) {
    const days = Math.max(1, Math.ceil((r.active.doneTick - state.tick) / (24 * 6)));
    return (
      <p className="flavour">
        The wheelwright has the carts in his yard. Done in about {days} day{days === 1 ? '' : 's'}.
      </p>
    );
  }
  return (
    <div className="menu-buttons">
      <button
        disabled={state.coin < RESEARCH_COST.trade[0]}
        title={
          state.coin < RESEARCH_COST.trade[0]
            ? `${RESEARCH_COST.trade[0]} coin up front, and the till is short.`
            : 'Hollow floors under every cart: quieter roads, and road-stops miss four tubs.'
        }
        onClick={() => enqueue({ type: 'startResearch', tree: 'trade' })}
      >
        Fit false bottoms · {RESEARCH_COST.trade[0]} coin · {RESEARCH_DAYS.trade[0]} days
      </button>
    </div>
  );
}

function FarmMenu({
  state,
  onPlace,
}: {
  state: GameState;
  onPlace: () => void;
}) {
  const enqueue = useEnqueue();
  const barn = state.stores.farm ?? {};
  const stored = cargoCount(barn);
  // §10 — the cutting house is offered only once the player holds overproof
  // jenever with no legal buyer: the building is caused by the problem it solves.
  const hasOverproofJenever =
    state.carts.some((c) => (c.cargo.jenever ?? 0) > 0) ||
    Object.values(state.stores).some((st) => (st.jenever ?? 0) > 0);

  return (
    <>
      <h4>Walland Farm</h4>
      <p className="flavour">
        {state.flockSize} sheep
        {state.sheepArriving > 0 ? ` (+${state.sheepArriving} on the drove road)` : ''} ·{' '}
        {state.fleeceReady} wool on their backs · barn {stored}/
        {FARM_STORE_CAPACITY}: {storeSummary(barn, 'empty')}
      </p>
      <StoreFill count={stored} cap={FARM_STORE_CAPACITY} />

      <div className="popover-cols">
        <div>
          <h5>the yard</h5>
          <div className="menu-buttons">
            <button
              disabled={state.fleeceReady <= 0}
              title={state.fleeceReady <= 0 ? 'The wool grows by dawn.' : undefined}
              onClick={() => enqueue({ type: 'shear' })}
            >
              Shear
            </button>
            {hasOverproofJenever && !state.cuttingHouse && (
              <button
                disabled={state.coin < CUTTING_HOUSE_COST}
                title={
                  state.coin < CUTTING_HOUSE_COST
                    ? `${CUTTING_HOUSE_COST} coin, paid up front. Nobody out here gives credit.`
                    : 'Overproof jenever has no legal buyer. Cut it here with water and burnt sugar and it sells in Ryne as brandy.'
                }
                onClick={onPlace}
              >
                Raise a cutting house · {CUTTING_HOUSE_COST} coin
              </button>
            )}
            {/* §6.11 — not offered until the first rent has fallen due: before
                the squeeze is felt, 50 coin looks like a toy and is the rent. */}
            {(state.rentPending || state.dutchman.unlocked) &&
              state.carts.length < MAX_CARTS && (
                <button
                  disabled={state.coin < CART_COST}
                  title="Cart, pony, and no questions from the wheelwright."
                  onClick={() => enqueue({ type: 'buyCart' })}
                >
                  Buy a cart · {CART_COST} coin
                </button>
              )}
          </div>
        </div>

        <div>
          <h5>works &amp; men</h5>
          {/* Fortification appears once you have something worth guarding (§10). */}
          {state.dutchman.unlocked && <FortifyRow state={state} nodeId="farm" />}

          {/* §6.16 — the hired dawn, and the flock as a stock you trade. */}
          <ShearerRow state={state} />
          {state.dutchman.unlocked && <FlockMarketRow state={state} />}
          {state.dutchman.unlocked && <BenchRow state={state} />}
        </div>
      </div>

      {/* The stable roster: every cart answers to the yard, wherever its wheels
          are — and a cart standing here is loaded, sent, and hired from its own
          row, so no cart is left undirected behind the first (§20). */}
      {state.carts.length > 0 && <h5>the stable</h5>}
      <CartsAtNode state={state} nodeId="farm" stable />
    </>
  );
}

function RyneMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  // §6.9 (M5a-4) — asking on the quay: why the round button is greyed, if it is.
  const quayHint = !state.dutchman.unlocked
    ? Math.floor(state.tick / TICKS_PER_DAY) <= state.lastRoundDay
      ? 'The alehouse has had your coin once today. Tomorrow is another thirst.'
      : state.coin < ROUND_COST
        ? `A round for the quay is ${ROUND_COST} coin, and the till is short.`
        : state.ledger.soldLawfully < RUMOUR_TRUST[state.rumoursHeard]
          ? 'The quay talks to farmers it knows. Sell more wool at Ryne first.'
          : null
    : null;

  return (
    <>
      <h4>Ryne</h4>
      <p className="flavour">
        Wool fetches {WOOL_PRICE_DOMESTIC} coin the fleece here, and every buyer on the quay knows
        it cannot lawfully leave the country.
      </p>
      <p className="flavour">
        The town will still take today —{' '}
        {(Object.keys(DAILY_DEMAND) as Good[])
          .filter((g) => DAILY_DEMAND[g] > 0)
          .map((g) => `${GOOD_LABEL[g]} ${state.demandRemaining[g] ?? 0}/${DAILY_DEMAND[g]}`)
          .join(' · ')}
        . Sell past the day's appetite and the rest waits exposed — unless a fence takes it.
      </p>
      {!state.dutchman.unlocked && (
        <p className="flavour">
          Across the water they pay {WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} the fleece. Not that
          anyone would know about that.
        </p>
      )}
      {!state.dutchman.unlocked && (
        <div className="menu-buttons">
          <button
            disabled={quayHint !== null}
            title={
              quayHint ??
              'Coin loosens tongues. Somebody on this quay knows where the wool really goes.'
            }
            onClick={() => enqueue({ type: 'buyRound' })}
          >
            Stand a round in the alehouse · {ROUND_COST} coin
          </button>
        </div>
      )}
      <CartsAtNode state={state} nodeId="ryne" />
    </>
  );
}

function ShingleMenu({ state, onPlace }: { state: GameState; onPlace: () => void }) {
  const d = state.dutchman;
  const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
  // The cutting house is offered when overproof jenever stands on the beach with
  // no legal buyer — any cart here holding tubs, whichever one it is.
  const jeneverBeached = state.carts.some(
    (c) =>
      c.location.kind === 'node' &&
      c.location.nodeId === 'shingle' &&
      (c.cargo.jenever ?? 0) > 0,
  );

  return (
    <>
      <h4>The Shingle</h4>
      {!d.present ? (
        <p className="flavour">
          Shingle and grey water. They say a lugger stands off here some nights — after dark, on a
          falling tide, while the Customs House is counting other things.
        </p>
      ) : (
        <>
          <p className="flavour">
            The Dutchman. {beachPrice} coin the fleece, and he&rsquo;ll take {d.fleeceAppetite}{' '}
            more tonight. Coin on the nail; no credit, no names, no questions in either direction.
          </p>
        </>
      )}
      {jeneverBeached && !state.cuttingHouse && (
        <>
          <p className="flavour">The tubs want cutting before any buyer in Ryne dares look at them.</p>
          <div className="menu-buttons">
            <button
              disabled={state.coin < CUTTING_HOUSE_COST}
              onClick={onPlace}
            >
              Raise a cutting house · {CUTTING_HOUSE_COST} coin
            </button>
          </div>
        </>
      )}

      <CartsAtNode state={state} nodeId="shingle" />
    </>
  );
}

/**
 * §6.17 / §20 — a store's fill against its walls, made visible: the bar reddens
 * as goods silt toward the cap, so the §18 squeeze is felt before it deadlocks.
 */
function StoreFill({ count, cap }: { count: number; cap: number }) {
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
        margin: '1px 0 7px',
      }}
    >
      <div style={{ width: `${pct * 100}%`, height: '100%', background: `hsl(${hue} 55% 45%)` }} />
    </div>
  );
}

function CuttingHouseMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const store = state.stores['cutting-house'] ?? {};
  const stored = cargoCount(store);
  const room = CUTTING_HOUSE_STORE_CAPACITY - stored;
  const tubs = store.jenever ?? 0;
  const cuttable = Math.min(tubs, Math.floor(state.coin / CUT_SUGAR_COST));
  const chests = store.tea ?? 0;
  // Smouching nets one unit a chest (two out, one in), so room caps it directly.
  const smouchable = Math.min(chests, Math.floor(state.coin / SMOUCH_COST), Math.max(0, room));

  return (
    <>
      <h4>The Cutting House</h4>
      <p className="flavour">
        In store {stored}/{CUTTING_HOUSE_STORE_CAPACITY}: {storeSummary(store, 'bare shelves')}.
      </p>
      <StoreFill count={stored} cap={CUTTING_HOUSE_STORE_CAPACITY} />

      <div className="menu-buttons">
        {tubs > 0 &&
          (['gentle', 'standard', 'deep'] as CutDepth[]).map((depth) => {
            const { yield: perTub, brandy } = CUTS[depth];
            return (
              <button
                key={depth}
                disabled={cuttable <= 0}
                title={
                  cuttable <= 0
                    ? room <= 0
                      ? 'The store is full — move the brandy on before cutting more.'
                      : 'Burnt sugar costs coin, and the till is empty.'
                    : `Sugar: ${cuttable * CUT_SUGAR_COST} coin.`
                }
                onClick={() => enqueue({ type: 'cut', depth, tubs: 99 })}
              >
                Cut {depth} · {cuttable} tubs → {cuttable * perTub} {GOOD_LABEL[brandy]} (
                {RYNE_PRICE[brandy]} coin ea)
              </button>
            );
          })}
        {chests > 0 && (
          <button
            disabled={smouchable <= 0}
            title={
              smouchable <= 0
                ? room <= 0
                  ? 'The store is full — move the leaf on before smouching more.'
                  : 'Ash and sloe cost coin, and the till is empty.'
                : `Ash & sloe: ${smouchable * SMOUCH_COST} coin. Bulk sells cheap, but sells.`
            }
            onClick={() => enqueue({ type: 'smouch', chests: 99 })}
          >
            Smouch · {smouchable} chests → {smouchable * SMOUCH_YIELD} {GOOD_LABEL['bulked-tea']} (
            {RYNE_PRICE['bulked-tea']} coin ea)
          </button>
        )}
      </div>

      <RefinerRow state={state} />

      <FortifyRow state={state} nodeId="cutting-house" />

      <CartsAtNode state={state} nodeId="cutting-house" />
    </>
  );
}

/**
 * Spec §6.17 — the refiner: offered once the chore is felt (six hand cuts and
 * smouches together, or a carter already on the reins — the §6.11 pattern).
 * Hired, he takes a standing instruction: a cut depth, and a smouch toggle.
 */
function RefinerRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const r = state.refiner;
  const offered =
    r.hired || r.handRefines >= REFINER_UNLOCK || state.carts.some((c) => c.carter !== null);
  if (!offered) return null;
  if (!r.hired) {
    return (
      <div className="menu-buttons">
        <button
          title="At dawn he cuts every tub at your standing depth, and smouches the leaf if told to. He does nothing else, and asks nothing."
          onClick={() => enqueue({ type: 'hireRefiner' })}
        >
          Hire a refiner · {REFINER_WAGE} coin a day
        </button>
      </div>
    );
  }
  return (
    <>
      <p className="flavour">
        The refiner works the house at dawn: cut {r.cutDepth},{' '}
        {r.smouch ? 'and smouch the leaf' : 'leaf left alone'} · {REFINER_WAGE} coin a day.
      </p>
      <div className="menu-buttons">
        {(['gentle', 'standard', 'deep'] as CutDepth[])
          .filter((depth) => depth !== r.cutDepth)
          .map((depth) => (
            <button
              key={depth}
              onClick={() => enqueue({ type: 'setRefinerOrders', cutDepth: depth, smouch: r.smouch })}
            >
              Have him cut {depth} · {CUTS[depth].yield} {GOOD_LABEL[CUTS[depth].brandy]} a tub
            </button>
          ))}
        <button
          title={
            r.smouch
              ? 'The bohea stays bohea: the fine market pays better a chest, and buys less.'
              : 'Ash and sloe at dawn: every chest becomes two of bulked tea for the cheap market.'
          }
          onClick={() => enqueue({ type: 'setRefinerOrders', cutDepth: r.cutDepth, smouch: !r.smouch })}
        >
          {r.smouch ? 'Have him leave the leaf alone' : 'Have him smouch the leaf too'}
        </button>
        <button
          title="The cutting and the smouching become your hands again."
          onClick={() => enqueue({ type: 'dismissRefiner' })}
        >
          Dismiss the refiner
        </button>
      </div>
    </>
  );
}

/**
 * Spec §20: click the place, not the pixel. Every cart standing at a node
 * shows its business here — cargo, carter, the hire flow, and the dyke.
 */
/** Where a cart is, in words — for the stable roster (a moving sprite is no
 *  place to hang a button, so the farm lists every cart, §20). */
function cartWhereabouts(state: GameState, cart: Cart): string {
  if (cart.location.kind === 'node') {
    return `at ${nodeById(cart.location.nodeId, state.farm, state.cuttingHouse).name}`;
  }
  return `on ${edgeById(cart.location.edgeId, state.farm, state.cuttingHouse).name.toLowerCase()}`;
}

/**
 * §20 — a present cart's cargo business at the node it stands on: loading and
 * unloading, selling in Ryne, trading with the Dutchman, cutting-house work.
 * Rendered per cart in its own row, so every cart is directed on its own terms
 * (not just the first one the old single-cart menu happened to pick).
 */
function cargoButtons(
  nodeId: NodeId,
  state: GameState,
  cart: Cart,
  enqueue: (a: Action) => void,
): ReactNode[] {
  const btns: ReactNode[] = [];
  const held = cargoCount(cart.cargo);
  const cargoEntries = Object.entries(cart.cargo) as Array<[Good, number]>;
  switch (nodeId) {
    case 'farm': {
      const barn = state.stores.farm ?? {};
      const barnRoom = FARM_STORE_CAPACITY - cargoCount(barn);
      if (held < CART_CAPACITY) {
        for (const [good, n] of Object.entries(barn) as Array<[Good, number]>) {
          if (n <= 0) continue;
          btns.push(
            <button
              key={`load-${good}`}
              onClick={() => enqueue({ type: 'loadCart', cartId: cart.id, good, qty: CART_CAPACITY })}
            >
              Load {cart.name.toLowerCase()} with {GOOD_LABEL[good]}
            </button>,
          );
        }
      }
      for (const [good, n] of cargoEntries) {
        if (n <= 0) continue;
        const can = Math.min(n, barnRoom);
        btns.push(
          <button
            key={`unload-${good}`}
            disabled={can <= 0}
            title={can <= 0 ? 'The barn is full to the rafters.' : undefined}
            onClick={() => enqueue({ type: 'unloadCart', cartId: cart.id, good, qty: 99 })}
          >
            {can > 0
              ? `Unload ${can} ${GOOD_LABEL[good]} into the barn`
              : `${GOOD_LABEL[good]} · the barn is full`}
          </button>,
        );
      }
      break;
    }
    case 'ryne': {
      for (const [good, n] of cargoEntries) {
        if (n <= 0 || good === 'jenever') continue;
        const appetite = state.demandRemaining[good] ?? 0;
        const q = Math.min(n, appetite);
        btns.push(
          <button
            key={`sell-${good}`}
            disabled={q <= 0}
            title={q <= 0 ? 'The town has had its fill today. Dawn brings appetite.' : undefined}
            onClick={() => enqueue({ type: 'sell', cartId: cart.id, good })}
          >
            {q > 0
              ? `Sell ${q} ${GOOD_LABEL[good]} · ${q * RYNE_PRICE[good]} coin` +
                (q < n ? ' · all the town will take' : '')
              : `${GOOD_LABEL[good]} · Ryne is sated until dawn`}
          </button>,
        );
        // §6.17 — the fence: dump the whole load at a haircut, uncapped, so a
        // laden cart need not sit in town waiting for the officer.
        if (CONTRABAND.includes(good) && RYNE_PRICE[good] > 0) {
          const fencePrice = Math.round(RYNE_PRICE[good] * FENCE_PRICE_MULT);
          btns.push(
            <button
              key={`fence-${good}`}
              title="The fence takes the whole load at once — no waiting, no appetite to fill — but pays a fraction of the stall price."
              onClick={() => enqueue({ type: 'sellToFence', cartId: cart.id, good })}
            >
              Fence {n} {GOOD_LABEL[good]} · {n * fencePrice} coin
            </button>,
          );
        }
      }
      break;
    }
    case 'shingle': {
      const d = state.dutchman;
      if (!d.present) break;
      const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;
      const fleeceSale = Math.min(cart.cargo.fleece ?? 0, d.fleeceAppetite);
      if (fleeceSale > 0) {
        btns.push(
          <button
            key="sell-dutchman"
            onClick={() => enqueue({ type: 'sellToDutchman', cartId: cart.id })}
          >
            Sell {fleeceSale} fleece · {fleeceSale * beachPrice} coin
          </button>,
        );
      }
      const room = cart.capacity - held;
      for (const good of ['jenever', 'tea', 'lace'] as Good[]) {
        const stock = d.hold[good] ?? 0;
        if (stock <= 0) continue;
        const price = DUTCHMAN_PRICE[good]!;
        const can = Math.min(stock, room, Math.floor(state.coin / price));
        btns.push(
          <button
            key={`buy-${good}`}
            disabled={can <= 0}
            title={can <= 0 ? 'No room in the cart, or no coin. He does not give credit.' : undefined}
            onClick={() => enqueue({ type: 'buyFromDutchman', cartId: cart.id, good, qty: 99 })}
          >
            {can > 0
              ? `Buy ${can} ${GOOD_LABEL[good]} · ${can * price} coin`
              : `${GOOD_LABEL[good]} · ${price} coin each`}{' '}
            · {stock} aboard
          </button>,
        );
      }
      break;
    }
    case 'cutting-house': {
      const store = state.stores['cutting-house'] ?? {};
      if ((cart.cargo.jenever ?? 0) > 0) {
        btns.push(
          <button
            key="unload-jenever"
            onClick={() => enqueue({ type: 'unloadCart', cartId: cart.id, good: 'jenever', qty: 99 })}
          >
            Unload {cart.cargo.jenever} tubs into the house
          </button>,
        );
      }
      for (const good of ['brandy-gent', 'brandy-fair', 'brandy-rough'] as Good[]) {
        if ((store[good] ?? 0) <= 0) continue;
        btns.push(
          <button
            key={`load-${good}`}
            onClick={() => enqueue({ type: 'loadCart', cartId: cart.id, good, qty: 99 })}
          >
            Load {GOOD_LABEL[good]} ({store[good]})
          </button>,
        );
      }
      break;
    }
  }
  return btns;
}

/**
 * §20 — where a present cart can be sent from the node it stands on, with the
 * same tide and blue-coat notes the old node menus carried. One row per cart.
 */
function roadButtons(
  nodeId: NodeId,
  state: GameState,
  cart: Cart,
  send: (cartId: string, edgeId: EdgeId) => void,
  flooded: boolean,
): ReactNode[] {
  const btns: ReactNode[] = [];
  const name = cart.name.toLowerCase();
  const held = cargoCount(cart.cargo);
  const tideSpan = spanOf(ticksUntilTideTurn(state.tick));
  switch (nodeId) {
    case 'farm': {
      if (held > 0) {
        btns.push(
          <button
            key="low"
            disabled={flooded}
            title={
              flooded
                ? `Under the tide. Clears in ${tideSpan}.`
                : `Short and flat. Floods in ${tideSpan}.`
            }
            onClick={() => send(cart.id, 'low-road')}
          >
            Send {name} by the low road{' '}
            {flooded ? `· clears in ${tideSpan}` : `· floods in ${tideSpan}`}
          </button>,
          <button
            key="high"
            title="Slow, dry, and past the Customs House."
            onClick={() => send(cart.id, 'high-road')}
          >
            Send {name} by the high road · slow{coatNote(state, 'high-road', 'farm')}
          </button>,
        );
      }
      if (state.dutchman.unlocked) {
        btns.push(
          <button
            key="marsh"
            title="Across the open marsh to the sea. Nobody counts what crosses it."
            onClick={() => send(cart.id, 'marsh-track')}
          >
            Send {name} over the marsh to the shingle{coatNote(state, 'marsh-track', 'farm')}
          </button>,
        );
      }
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-farm-track')}>
            Send {name} to the cutting house{coatNote(state, 'cut-farm-track', 'farm')}
          </button>,
        );
      }
      break;
    }
    case 'ryne': {
      btns.push(
        <button
          key="low"
          disabled={flooded}
          title={flooded ? 'Under the tide. It will fall.' : undefined}
          onClick={() => send(cart.id, 'low-road')}
        >
          Home by the low road {flooded ? '· drowned' : '· fast'}
        </button>,
        <button key="high" onClick={() => send(cart.id, 'high-road')}>
          Home by the high road · slow{coatNote(state, 'high-road', 'ryne')}
        </button>,
      );
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-ryne-track')}>
            Out to the cutting house{coatNote(state, 'cut-ryne-track', 'ryne')}
          </button>,
        );
      }
      break;
    }
    case 'shingle': {
      btns.push(
        <button key="marsh" onClick={() => send(cart.id, 'marsh-track')}>
          Home over the marsh{coatNote(state, 'marsh-track', 'shingle')}
        </button>,
      );
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-shingle-track')}>
            To the cutting house{coatNote(state, 'cut-shingle-track', 'shingle')}
          </button>,
        );
      }
      break;
    }
    case 'cutting-house': {
      btns.push(
        <button key="ryne" onClick={() => send(cart.id, 'cut-ryne-track')}>
          Send to Ryne{coatNote(state, 'cut-ryne-track', 'cutting-house')}
        </button>,
        <button key="farm" onClick={() => send(cart.id, 'cut-farm-track')}>
          Send home to the farm{coatNote(state, 'cut-farm-track', 'cutting-house')}
        </button>,
        <button key="shingle" onClick={() => send(cart.id, 'cut-shingle-track')}>
          Send to the shingle{coatNote(state, 'cut-shingle-track', 'cutting-house')}
        </button>,
      );
      break;
    }
  }
  return btns;
}

function CartsAtNode({
  state,
  nodeId,
  stable = false,
}: {
  state: GameState;
  nodeId: NodeId;
  /** The farm is the yard: list every cart, wherever its wheels are. */
  stable?: boolean;
}) {
  const enqueue = useEnqueue();
  const send = useSendCart(state, nodeId);
  const close = useContext(CloseCtx);
  const flooded = isFlooded(state.tick);
  // The order picker walks a sentence (§6.11): origin → good → destination →
  // back leg → its drop node (§6.17). `from` is the node the order loads at —
  // the menu's node for a fresh hire (switchable: the origin pick), or the
  // carter's existing base when re-ordering a man already on the reins.
  const [hiring, setHiring] = useState<{
    cartId: string;
    from: NodeId;
    good?: Good;
    to?: NodeId;
    back?: Good;
  } | null>(null);
  const carts = stable
    ? state.carts
    : state.carts.filter((c) => c.location.kind === 'node' && c.location.nodeId === nodeId);
  if (carts.length === 0) return null;

  const hire = (
    cartId: string,
    from: NodeId,
    to: NodeId,
    good: Good,
    back?: Good,
    backTo?: NodeId,
  ) => {
    enqueue({
      type: 'hireCarter',
      cartId,
      order: { from, to, good, ...(back ? { back } : {}), ...(backTo ? { backTo } : {}) },
    });
    setHiring(null);
    // A directed cart is dealt with: if that was the last undirected one, the
    // visit is over (§20). Re-orders never empty the yard (the cart was
    // already crewed), so they leave the menu open.
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };

  // §6.11 / §10 — a carter is offered only once the manual round is a felt
  // chore: two cart-loads sold by hand, or crime already begun (by which point
  // you have hauled plenty). Before that, automation would only overwhelm.
  const carterAvailable =
    state.dutchman.unlocked || (state.ledger.soldLawfully >= CARTER_UNLOCK_FLEECE);

  // A standing order loads from a node: what it can haul, and where to. The
  // shingle is named only once the Dutchman is (§6.11) — no menu speaks of
  // the trade before the coast has.
  const haulablesFrom = (from: NodeId): Good[] =>
    Array.from(
      new Set([
        ...(Object.entries(state.stores[from] ?? {}) as Array<[Good, number]>)
          .filter(([, n]) => n > 0)
          .map(([g]) => g),
        ...(from === 'farm' ? (['fleece'] as Good[]) : []),
        // §6.17 — name a product not yet made: the house always offers what it
        // produces, exactly as the farm always offers fleece. Without this,
        // "run brandy to Ryne" could not be written until brandy existed.
        ...(from === 'cutting-house'
          ? (['brandy-gent', 'brandy-fair', 'brandy-rough', 'bulked-tea'] as Good[])
          : []),
      ]),
    );
  const destinationsFrom = (from: NodeId): NodeId[] =>
    (['farm', 'ryne', 'shingle', 'cutting-house'] as NodeId[]).filter(
      (n) =>
        n !== from &&
        (n !== 'cutting-house' || state.cuttingHouse) &&
        (n !== 'shingle' || state.dutchman.unlocked),
    );
  // §6.17 — where a backhaul may be dropped on the way home: a covered store
  // that is neither end of the run. Home (`from`) is always the default.
  const dropNodesFor = (from: NodeId, to: NodeId): NodeId[] =>
    (['farm', 'cutting-house'] as NodeId[]).filter(
      (n) => n !== from && n !== to && (n !== 'cutting-house' || state.cuttingHouse),
    );

  return (
    <>
      {carts.map((cart) => {
        const laden = cargoCount(cart.cargo) > 0;
        const present = cart.location.kind === 'node' && cart.location.nodeId === nodeId;
        // A cart at this node with no carter is the player's to drive: it gets
        // its own load/sell/send controls, in its own row. Mid-hire, the picker
        // takes the row over (§6.11), so the manual buttons stand aside.
        const choosing = hiring?.cartId === cart.id;
        const drivable = present && !cart.carter && !choosing;
        return (
          <div key={cart.id}>
            <p className="flavour">
              <strong>{cart.name}</strong>: {storeSummary(cart.cargo, 'empty')}
              {!present ? ` · ${cartWhereabouts(state, cart)}` : ''}
              {cart.carter
                ? ` · standing order: ${GOOD_LABEL[cart.carter.good]} → ${
                    nodeById(cart.carter.to, state.farm, state.cuttingHouse).name
                  }${
                    cart.carter.back
                      ? `, home with ${GOOD_LABEL[cart.carter.back]}${
                          cart.carter.backTo
                            ? ` dropped at ${nodeById(cart.carter.backTo, state.farm, state.cuttingHouse).name}`
                            : ''
                        }`
                      : ''
                  }, ${CARTER_WAGE} coin a day. ` +
                  (cart.carter.to === 'shingle' && cart.carter.good === 'fleece'
                    ? 'He sells over the gunwale when the lugger stands off, and waits when it does not.'
                    : 'He minds the tide and nothing else.')
                : ' · no carter — yours to drive'}
            </p>
            <div className="menu-buttons">
              {drivable && cargoButtons(nodeId, state, cart, enqueue)}
              {drivable && roadButtons(nodeId, state, cart, send, flooded)}
              {hiring?.cartId === cart.id ? (
                hiring.good === undefined ? (
                  // The load, at the chosen origin (§6.11 / §6.17): the current
                  // load is always offered, so the picker never dead-ends, and
                  // the origin itself is switchable — any loop among the known
                  // nodes is a standing order, not just farm-and-back.
                  <>
                    {Array.from(
                      new Set([
                        ...haulablesFrom(hiring.from),
                        ...(cart.carter ? [cart.carter.good] : []),
                      ]),
                    ).map((good) => (
                      <button key={good} onClick={() => setHiring({ ...hiring, good })}>
                        Have him load {GOOD_LABEL[good]} at{' '}
                        {nodeById(hiring.from, state.farm, state.cuttingHouse).name}
                      </button>
                    ))}
                    {destinationsFrom(hiring.from).map((n) => (
                      <button key={`load-${n}`} onClick={() => setHiring({ ...hiring, from: n })}>
                        …or have him load at{' '}
                        {nodeById(n, state.farm, state.cuttingHouse).name} instead
                      </button>
                    ))}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                ) : hiring.to === undefined ? (
                  <>
                    {destinationsFrom(hiring.from).map((to) => (
                      <button
                        key={to}
                        title={
                          to === 'shingle' && hiring.good === 'fleece'
                            ? 'He sells over the gunwale whenever the lugger stands off — and the books will not record it (§6.10).'
                            : undefined
                        }
                        onClick={() => {
                          // Destinations with something worth fetching ask one
                          // more question (§6.11: the back leg); the rest hire.
                          if (backOptionsFor(to).length > 0) setHiring({ ...hiring, to });
                          else hire(cart.id, hiring.from, to, hiring.good!);
                        }}
                      >
                        {to === 'shingle' && hiring.good === 'fleece'
                          ? `${GOOD_LABEL[hiring.good]} to the shingle — over the gunwale when the lugger comes`
                          : `${GOOD_LABEL[hiring.good!]} to ${
                              nodeById(to, state.farm, state.cuttingHouse).name
                            }`}
                      </button>
                    ))}
                  </>
                ) : hiring.back === undefined ? (
                  <>
                    <button onClick={() => hire(cart.id, hiring.from, hiring.to!, hiring.good!)}>
                      …and home empty-handed, until told otherwise
                    </button>
                    {backOptionsFor(hiring.to).map((g) => (
                      <button
                        key={g}
                        title={
                          hiring.to === 'shingle'
                            ? 'He buys with the coin in the till, to the cart’s room. No credit, and no keeping back the rent.'
                            : undefined
                        }
                        onClick={() => {
                          // A drop node worth naming asks one more question
                          // (§6.17: the backhaul's destination); else hire.
                          if (dropNodesFor(hiring.from, hiring.to!).length > 0) {
                            setHiring({ ...hiring, back: g });
                          } else {
                            hire(cart.id, hiring.from, hiring.to!, hiring.good!, g);
                          }
                        }}
                      >
                        {hiring.to === 'shingle'
                          ? `…and home with ${GOOD_LABEL[g]}, bought off the lugger with the till’s coin`
                          : `…and home with ${GOOD_LABEL[g]}, when the store holds any`}
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        hire(cart.id, hiring.from, hiring.to!, hiring.good!, hiring.back)
                      }
                    >
                      …dropped at home —{' '}
                      {nodeById(hiring.from, state.farm, state.cuttingHouse).name}
                    </button>
                    {dropNodesFor(hiring.from, hiring.to!).map((n) => (
                      <button
                        key={n}
                        title="Delivered on the way home, so the backhaul never touches the wool barn."
                        onClick={() =>
                          hire(cart.id, hiring.from, hiring.to!, hiring.good!, hiring.back, n)
                        }
                      >
                        …dropped at {nodeById(n, state.farm, state.cuttingHouse).name} on the way
                        home
                      </button>
                    ))}
                  </>
                )
              ) : cart.carter ? (
                <>
                  <button
                    onClick={() => setHiring({ cartId: cart.id, from: cart.carter!.from })}
                  >
                    Change standing order
                  </button>
                  <button
                    title={
                      present
                        ? undefined
                        : 'Word reaches him on the road: the order ends where he stands.'
                    }
                    onClick={() => enqueue({ type: 'dismissCarter', cartId: cart.id })}
                  >
                    Dismiss the carter
                  </button>
                </>
              ) : !present ? null : carterAvailable ? (
                <>
                  {haulablesFrom(nodeId).map((good) => (
                    <button
                      key={good}
                      onClick={() => setHiring({ cartId: cart.id, from: nodeId, good })}
                    >
                      Hire a carter to haul {GOOD_LABEL[good]} · {CARTER_WAGE} coin a day
                    </button>
                  ))}
                  {destinationsFrom(nodeId).length > 0 && (
                    <button
                      title="Any loop among the known places is a standing order — the round need not start here."
                      onClick={() => setHiring({ cartId: cart.id, from: nodeId })}
                    >
                      Hire a carter for a round starting elsewhere…
                    </button>
                  )}
                </>
              ) : null}
              {laden && drivable && (
                <button onClick={() => enqueue({ type: 'ditchCargo', cartId: cart.id })}>
                  Tip {cart.name.toLowerCase()}&rsquo;s load into a dyke · nothing comes back
                </button>
              )}
              {/* §6.11 — the wheelwright buys back: empty, carterless, in the
                  yard, never the last. The undo for a cart bought in optimism. */}
              {stable && drivable && !laden && state.carts.length > 1 && (
                <button
                  title="He buys cheaper than he sells. Nobody out here forgets a price."
                  onClick={() => enqueue({ type: 'sellCart', cartId: cart.id })}
                >
                  Sell {cart.name.toLowerCase()} back · {CART_RESALE} coin
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function CartMenu({
  state,
  flooded,
  cartId,
}: {
  state: GameState;
  flooded: boolean;
  cartId: string;
}) {
  const enqueue = useEnqueue();
  const cart = state.carts.find((c) => c.id === cartId);
  if (!cart) return null;
  const cargo = storeSummary(cart.cargo, 'Empty');
  const laden = cargoCount(cart.cargo) > 0;

  // A cart popover only opens on the road (spec §20) — but the road ends,
  // and a stale selection lands here: point at the place and step aside.
  if (cart.location.kind === 'node') {
    const here = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
    return (
      <>
        <h4>{cart.name}</h4>
        <p className="flavour">
          Standing at {here.name}. {cargo} aboard. Its business is the place&rsquo;s business —
          click {here.name}.
        </p>
      </>
    );
  }

  const edge = edgesFor(state.farm, state.cuttingHouse).find(
    (e) => e.id === (cart.location as { edgeId: string }).edgeId,
  );
  const pct = edge ? Math.round((cart.location.progress / edge.latency) * 100) : 0;
  const halted = edge?.condition === 'tideLocked' && flooded;
  return (
    <>
      <h4>{cart.name}</h4>
      <p className="flavour">
        {cargo} aboard. {edge?.name}, {pct}% along.
        {halted ? ' The tide has the road — waiting on high ground.' : ''}
      </p>
      {cart.carter && (
        <>
          <p className="flavour">
            A carter holds the reins: {GOOD_LABEL[cart.carter.good]},{' '}
            {nodeById(cart.carter.from, state.farm, state.cuttingHouse).name} to{' '}
            {nodeById(cart.carter.to, state.farm, state.cuttingHouse).name}, {CARTER_WAGE} coin a
            day. He minds the tide and nothing else — not even the blue coat.
          </p>
          <div className="menu-buttons">
            <button onClick={() => enqueue({ type: 'dismissCarter', cartId: cart.id })}>
              Dismiss the carter
            </button>
          </div>
        </>
      )}
      {laden && !cart.carter && (
        <div className="menu-buttons">
          <button onClick={() => enqueue({ type: 'ditchCargo', cartId: cart.id })}>
            Tip the lot into a dyke · nothing comes back
          </button>
        </div>
      )}
    </>
  );
}
