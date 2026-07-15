// The map is the interface (spec §20): a layered Canvas 2D renderer with an
// eased camera, click-the-asset popover menus, and the opening act — choose
// ground for your farm. React owns the DOM overlay (layer 3); the canvas
// loop owns layers 0–1 and reads the latest sim state from a ref.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CART_CAPACITY, LEIDEN_PRICE_MULT, WOOL_PRICE_DOMESTIC } from '../sim/balance';
import { edgesFor } from '../sim/map';
import { clockOf, dayPhaseOf, isFlooded, ticksUntilTideTurn } from '../sim/time';
import { spanOf } from './format';
import type { GameState } from '../sim/types';
import { useGameStore } from '../state/store';
import { CameraController } from './camera';
import { pathPoints, pointAlong, TILE, tileCenter } from './geometry';
import { getTerrainCanvas } from './paint';
import {
  drawCart,
  drawCustoms,
  drawFarm,
  drawFarmGlow,
  drawLabel,
  drawRoad,
  drawRyne,
  drawSheep,
} from './sprites';

type Selection = 'farm' | 'ryne' | 'customs' | 'cart' | null;

/** Cart position in world coords. */
function cartWorldPos(state: GameState): { x: number; y: number; angle: number } | null {
  const cart = state.carts[0];
  if (!cart) return null;
  if (cart.location.kind === 'node') {
    const anchor =
      cart.location.nodeId === 'farm' ? tileCenter(state.farm) : tileCenter({ x: 28, y: 22 });
    return { x: anchor.x + 14, y: anchor.y + 8, angle: 0 };
  }
  const edge = edgesFor(state.farm).find(
    (e) => e.id === (cart.location as { edgeId: string }).edgeId,
  );
  if (!edge) return null;
  const pts = pathPoints(edge, cart.location.from !== edge.a);
  return pointAlong(pts, cart.location.progress / edge.latency);
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
  switch (sel) {
    case 'farm':
      return tileCenter(state.farm);
    case 'ryne':
      return tileCenter({ x: 28, y: 21 });
    case 'customs':
      return tileCenter({ x: 26, y: 19 });
    case 'cart':
      return cartWorldPos(state);
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
  const [tending, setTending] = useState(false);
  // The startup glow dies the first time the farm menu opens.
  const farmVisitedRef = useRef(false);

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
      if (routesVisible(s)) {
        for (const edge of edgesFor(s.farm)) {
          drawRoad(ctx, pathPoints(edge, false), edge.condition === 'tideLocked' && floodedNow);
        }
      }
      drawSheep(ctx, s.farm, s.flockSize);
      drawFarm(ctx, s.farm);
      const fc = tileCenter(s.farm);
      drawLabel(ctx, 'Walland Farm', fc.x, fc.y - 16);
      if (isFreshGame(s) && !farmVisitedRef.current) {
        drawFarmGlow(ctx, s.farm, (performance.now() / 1800) % 1);
      }
      drawRyne(ctx);
      drawLabel(ctx, 'Ryne', 28.5 * TILE, 19.6 * TILE);
      drawCustoms(ctx);
      drawLabel(ctx, 'Customs House', 26.5 * TILE, 17.9 * TILE);

      const cart = s.carts[0];
      const cp = cartWorldPos(s);
      if (cart && cp) {
        drawCart(ctx, cp.x, cp.y, cart.location.kind === 'edge' ? cp.angle : 0, (cart.cargo.fleece ?? 0) > 0);
      }

      // Layer 3 helper: keep the popover pinned to its anchor.
      const pop = popRef.current;
      if (pop) {
        const a = anchorWorld(selectedRef.current, s);
        if (a) {
          const p = cam.worldToScreen(a.x, a.y);
          const left = Math.max(8, Math.min(p.x + 16, w - 268));
          const top = Math.max(8, Math.min(p.y - 30, h - 120));
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

  function onClick(e: React.MouseEvent) {
    const cam = camRef.current!;
    if (cam.wasDrag()) return;
    const s = stateRef.current;
    const p = localPos(e);
    const w = cam.screenToWorld(p.x, p.y);

    // Hit-test the assets, nearest first.
    const targets: Array<{ sel: Selection; x: number; y: number; r: number }> = [];
    const cp = cartWorldPos(s);
    if (cp) targets.push({ sel: 'cart', x: cp.x, y: cp.y, r: 14 });
    const fc = tileCenter(s.farm);
    targets.push({ sel: 'farm', x: fc.x, y: fc.y, r: 26 });
    const rc = tileCenter({ x: 28, y: 21.8 });
    targets.push({ sel: 'ryne', x: rc.x, y: rc.y, r: 42 });
    const cc = tileCenter({ x: 26, y: 19 });
    targets.push({ sel: 'customs', x: cc.x, y: cc.y, r: 16 });

    let best: { sel: Selection; d: number } | null = null;
    for (const t of targets) {
      const d = Math.hypot(w.x - t.x, w.y - t.y);
      if (d <= t.r && (!best || d < best.d)) best = { sel: t.sel, d };
    }
    if (best?.sel === 'farm') farmVisitedRef.current = true;
    setSelected(best?.sel ?? null);
    setTending(false);
  }

  return (
    <div
      ref={shellRef}
      className="map-shell"
      onPointerDown={(e) => {
        if (e.button === 0 || e.button === 1) {
          const p = localPos(e);
          camRef.current!.pointerDown(p.x, p.y);
          try {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events have no real pointer */
          }
        }
      }}
      onPointerMove={(e) => {
        const p = localPos(e);
        camRef.current!.pointerMove(p.x, p.y);
      }}
      onPointerUp={(e) => {
        camRef.current!.pointerUp();
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="map-canvas" />

      {nightOpacity > 0 && <div className="night-veil" style={{ opacity: nightOpacity }} />}

      {state.lost && <ForfeitOverlay />}

      {selected && (
        <div ref={popRef} className="popover-anchor">
          <Popover onClose={() => setSelected(null)}>
            {selected === 'farm' && (
              <FarmMenu state={state} tending={tending} setTending={setTending} flooded={flooded} />
            )}
            {selected === 'ryne' && <RyneMenu state={state} flooded={flooded} />}
            {selected === 'customs' && (
              <>
                <h4>The Customs House</h4>
                <p className="flavour">Quiet today. It counts things. It is counting now.</p>
              </>
            )}
            {selected === 'cart' && <CartMenu state={state} flooded={flooded} />}
          </Popover>
        </div>
      )}
    </div>
  );
}

function ForfeitOverlay() {
  const reset = useGameStore((s) => s.reset);
  return (
    <div className="forfeit">
      <div className="forfeit-card">
        <h2>The tenancy is forfeit.</h2>
        <p>
          The agent's men drove off the last of the flock at dawn. The Gault keeps no one who
          cannot pay.
        </p>
        <button onClick={reset}>Begin again</button>
      </div>
    </div>
  );
}

function Popover({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="popover"
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

function FarmMenu({
  state,
  tending,
  setTending,
  flooded,
}: {
  state: GameState;
  tending: boolean;
  setTending: (b: boolean) => void;
  flooded: boolean;
}) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  const cartHere = cart?.location.kind === 'node' && cart.location.nodeId === 'farm';
  const store = state.stores.farm?.fleece ?? 0;
  const held = cart?.cargo.fleece ?? 0;

  return (
    <>
      <h4>Walland Farm</h4>
      <p className="flavour">
        {state.flockSize} sheep · {state.fleeceReady} wool on their backs · {store} fleece in store
      </p>

      <div className="menu-buttons">
        <button onClick={() => setTending(!tending)}>Tend flock</button>
        <button
          disabled={state.fleeceReady <= 0}
          title={state.fleeceReady <= 0 ? 'The wool grows by dawn.' : undefined}
          onClick={() => enqueue({ type: 'shear' })}
        >
          Shear
        </button>
        {store > 0 && cartHere && held < CART_CAPACITY && (
          <button
            onClick={() =>
              enqueue({ type: 'loadCart', cartId: cart!.id, good: 'fleece', qty: CART_CAPACITY })
            }
          >
            Load cart with fleece
          </button>
        )}
      </div>

      {tending && (
        <p className="flavour tend">
          You walk the flock. {state.flockSize} ewes on the salt grass; they regard you without
          opinion.{' '}
          {state.fleeceReady > 0
            ? `Their coats are heavy — ${state.fleeceReady} fleece of wool, come dawn shears.`
            : 'Shorn bare. The wool grows by dawn.'}
        </p>
      )}

      {cartHere && held > 0 && (
        <>
          <p className="flavour">
            The cart stands laden ({held}/{CART_CAPACITY}). Ryne pays {WOOL_PRICE_DOMESTIC} coin a
            fleece.
          </p>
          <div className="menu-buttons">
            <button
              disabled={flooded}
              title={
                flooded
                  ? `Under the tide. Clears in ${spanOf(ticksUntilTideTurn(state.tick))}.`
                  : `Short and flat. Floods in ${spanOf(ticksUntilTideTurn(state.tick))}.`
              }
              onClick={() => enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'low-road' })}
            >
              Send by the low road{' '}
              {flooded
                ? `· clears in ${spanOf(ticksUntilTideTurn(state.tick))}`
                : `· floods in ${spanOf(ticksUntilTideTurn(state.tick))}`}
            </button>
            <button
              title="Slow, dry, and past the Customs House."
              onClick={() => enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'high-road' })}
            >
              Send by the high road · slow
            </button>
          </div>
        </>
      )}
    </>
  );
}

function RyneMenu({ state, flooded }: { state: GameState; flooded: boolean }) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  const cartHere = cart?.location.kind === 'node' && cart.location.nodeId === 'ryne';
  const held = cart?.cargo.fleece ?? 0;

  return (
    <>
      <h4>Ryne</h4>
      <p className="flavour">
        Wool fetches {WOOL_PRICE_DOMESTIC} coin the fleece here, and every buyer on the quay knows
        it cannot lawfully leave the country.
      </p>
      <p className="flavour">
        Across the water they pay {WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} the fleece. Not that
        anyone would know about that.
      </p>
      {cartHere && held > 0 && (
        <div className="menu-buttons">
          <button onClick={() => enqueue({ type: 'sell', cartId: cart!.id, good: 'fleece' })}>
            Sell {held} fleece · {held * WOOL_PRICE_DOMESTIC} coin
          </button>
        </div>
      )}
      {cartHere && (
        <div className="menu-buttons">
          <button
            disabled={flooded}
            title={flooded ? 'Under the tide. It will fall.' : undefined}
            onClick={() => enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'low-road' })}
          >
            Home by the low road {flooded ? '· drowned' : '· fast'}
          </button>
          <button onClick={() => enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'high-road' })}>
            Home by the high road · slow
          </button>
        </div>
      )}
    </>
  );
}

function CartMenu({ state, flooded }: { state: GameState; flooded: boolean }) {
  const cart = state.carts[0];
  if (!cart) return null;
  const held = cart.cargo.fleece ?? 0;

  if (cart.location.kind === 'edge') {
    const edge = edgesFor(state.farm).find(
      (e) => e.id === (cart.location as { edgeId: string }).edgeId,
    );
    const pct = edge ? Math.round((cart.location.progress / edge.latency) * 100) : 0;
    const halted = edge?.condition === 'tideLocked' && flooded;
    return (
      <>
        <h4>The Cart</h4>
        <p className="flavour">
          {held > 0 ? `${held} fleece aboard.` : 'Empty.'} {edge?.name}, {pct}% along.
          {halted ? ' The tide has the road — waiting on high ground.' : ''}
        </p>
      </>
    );
  }

  const whereabouts = cart.location.nodeId === 'farm' ? 'in the farmyard' : 'on the quay at Ryne';
  return (
    <>
      <h4>The Cart</h4>
      <p className="flavour">
        Standing {whereabouts}. {held > 0 ? `${held} fleece aboard.` : 'Empty.'}{' '}
        {clockOf(state.tick).hour >= 20 ? 'The pony would rather not.' : ''}
      </p>
      <p className="flavour">Use the farm or town for orders.</p>
    </>
  );
}
