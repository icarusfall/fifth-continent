// The map is the interface (spec §20): a layered Canvas 2D renderer with an
// eased camera, click-the-asset popover menus, and the opening act — choose
// ground for your farm. React owns the DOM overlay (layer 3); the canvas
// loop owns layers 0–1 and reads the latest sim state from a ref.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CART_CAPACITY,
  CUTS,
  CUTTING_HOUSE_COST,
  CUT_SUGAR_COST,
  DUTCHMAN_PRICE,
  FARM_STORE_CAPACITY,
  LEIDEN_PRICE_MULT,
  RYNE_PRICE,
  WOOL_PRICE_DOMESTIC,
} from '../sim/balance';
import { SHINGLE, edgesFor, isPlaceable, nodeById } from '../sim/map';
import { clockOf, dayPhaseOf, isFlooded, ticksUntilTideTurn } from '../sim/time';
import { GOOD_LABEL, spanOf, storeSummary } from './format';
import type { CutDepth, GameState, Good } from '../sim/types';
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
  drawLabel,
  drawLugger,
  drawRoad,
  drawRyne,
  drawSheep,
  drawShingle,
  drawTileHighlight,
} from './sprites';

type Selection = 'farm' | 'ryne' | 'customs' | 'cart' | 'shingle' | 'cutting-house' | null;

function cargoCount(cargo: Partial<Record<Good, number>>): number {
  return Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
}

/** Cart position in world coords. */
function cartWorldPos(state: GameState): { x: number; y: number; angle: number } | null {
  const cart = state.carts[0];
  if (!cart) return null;
  if (cart.location.kind === 'node') {
    const node = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
    const anchor = tileCenter(node);
    return { x: anchor.x + 14, y: anchor.y + 8, angle: 0 };
  }
  const edge = edgesFor(state.farm, state.cuttingHouse).find(
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
    case 'shingle':
      return tileCenter(SHINGLE);
    case 'cutting-house':
      return state.cuttingHouse ? tileCenter(state.cuttingHouse) : null;
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
  // The startup glow dies the first time the farm menu opens.
  const farmVisitedRef = useRef(false);
  // Placement mode: choosing ground for the cutting house (spec §6.9).
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  placingRef.current = placing;
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
        const cc = tileCenter(s.cuttingHouse);
        drawLabel(ctx, 'Cutting House', cc.x, cc.y - 12);
      }

      const cart = s.carts[0];
      const cp = cartWorldPos(s);
      if (cart && cp) {
        drawCart(ctx, cp.x, cp.y, cart.location.kind === 'edge' ? cp.angle : 0, cargoCount(cart.cargo) > 0);
      }

      // Placement mode: the hovered tile answers before the coin is spent.
      if (placingRef.current && hoverTileRef.current) {
        const t = hoverTileRef.current;
        drawTileHighlight(ctx, t.x, t.y, isPlaceable(t.x, t.y) && s.coin >= CUTTING_HOUSE_COST);
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
    const cp = cartWorldPos(s);
    if (cp) targets.push({ sel: 'cart', x: cp.x, y: cp.y, r: 14 });
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
    if (best?.sel === 'farm') farmVisitedRef.current = true;
    setSelected(best?.sel ?? null);
  }

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

      {selected && !placing && (
        <div ref={popRef} className="popover-anchor">
          <Popover onClose={() => setSelected(null)}>
            {selected === 'farm' && (
              <FarmMenu state={state} flooded={flooded} onPlace={() => setPlacing(true)} />
            )}
            {selected === 'ryne' && <RyneMenu state={state} flooded={flooded} />}
            {selected === 'customs' && (
              <>
                <h4>The Customs House</h4>
                <p className="flavour">Quiet today. It counts things. It is counting now.</p>
              </>
            )}
            {selected === 'shingle' && (
              <ShingleMenu state={state} onPlace={() => setPlacing(true)} />
            )}
            {selected === 'cutting-house' && <CuttingHouseMenu state={state} />}
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
  flooded,
  onPlace,
}: {
  state: GameState;
  flooded: boolean;
  onPlace: () => void;
}) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  const cartHere = cart?.location.kind === 'node' && cart.location.nodeId === 'farm';
  const barn = state.stores.farm ?? {};
  const stored = cargoCount(barn);
  const barnRoom = FARM_STORE_CAPACITY - stored;
  const held = cart ? cargoCount(cart.cargo) : 0;

  return (
    <>
      <h4>Walland Farm</h4>
      <p className="flavour">
        {state.flockSize} sheep · {state.fleeceReady} wool on their backs · barn {stored}/
        {FARM_STORE_CAPACITY}: {storeSummary(barn, 'empty')}
      </p>

      <div className="menu-buttons">
        <button
          disabled={state.fleeceReady <= 0}
          title={state.fleeceReady <= 0 ? 'The wool grows by dawn.' : undefined}
          onClick={() => enqueue({ type: 'shear' })}
        >
          Shear
        </button>
        {cartHere &&
          held < CART_CAPACITY &&
          (Object.entries(barn) as Array<[Good, number]>)
            .filter(([, n]) => n > 0)
            .map(([good]) => (
              <button
                key={good}
                onClick={() =>
                  enqueue({ type: 'loadCart', cartId: cart!.id, good, qty: CART_CAPACITY })
                }
              >
                Load cart with {GOOD_LABEL[good]}
              </button>
            ))}
        {cartHere &&
          (Object.entries(cart!.cargo) as Array<[Good, number]>)
            .filter(([, n]) => n > 0)
            .map(([good, n]) => {
              const can = Math.min(n, barnRoom);
              return (
                <button
                  key={`unload-${good}`}
                  disabled={can <= 0}
                  title={can <= 0 ? 'The barn is full to the rafters.' : undefined}
                  onClick={() => enqueue({ type: 'unloadCart', cartId: cart!.id, good, qty: 99 })}
                >
                  {can > 0
                    ? `Unload ${can} ${GOOD_LABEL[good]} into the barn`
                    : `${GOOD_LABEL[good]} · the barn is full`}
                </button>
              );
            })}
        {state.dutchman.unlocked && !state.cuttingHouse && (
          <button
            disabled={state.coin < CUTTING_HOUSE_COST}
            title={
              state.coin < CUTTING_HOUSE_COST
                ? `${CUTTING_HOUSE_COST} coin, paid up front. Nobody out here gives credit.`
                : 'Water, burnt sugar, and no sign over the door.'
            }
            onClick={onPlace}
          >
            Raise a cutting house · {CUTTING_HOUSE_COST} coin
          </button>
        )}
      </div>

      {cartHere && (
        <>
          {held > 0 && (
            <p className="flavour">
              The cart stands laden ({held}/{CART_CAPACITY}): {storeSummary(cart!.cargo)}. Ryne
              pays {WOOL_PRICE_DOMESTIC} coin a fleece.
            </p>
          )}
          <div className="menu-buttons">
            {held > 0 && (
              <>
                <button
                  disabled={flooded}
                  title={
                    flooded
                      ? `Under the tide. Clears in ${spanOf(ticksUntilTideTurn(state.tick))}.`
                      : `Short and flat. Floods in ${spanOf(ticksUntilTideTurn(state.tick))}.`
                  }
                  onClick={() =>
                    enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'low-road' })
                  }
                >
                  Send by the low road{' '}
                  {flooded
                    ? `· clears in ${spanOf(ticksUntilTideTurn(state.tick))}`
                    : `· floods in ${spanOf(ticksUntilTideTurn(state.tick))}`}
                </button>
                <button
                  title="Slow, dry, and past the Customs House."
                  onClick={() =>
                    enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'high-road' })
                  }
                >
                  Send by the high road · slow
                </button>
              </>
            )}
            {state.dutchman.unlocked && (
              <button
                title="Across the open marsh to the sea. Nobody counts what crosses it."
                onClick={() =>
                  enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'marsh-track' })
                }
              >
                Send over the marsh to the shingle
              </button>
            )}
            {state.cuttingHouse && (
              <button
                onClick={() =>
                  enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-farm-track' })
                }
              >
                Send to the cutting house
              </button>
            )}
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
  const sellables = (Object.entries(cart?.cargo ?? {}) as Array<[Good, number]>).filter(
    ([g, n]) => n > 0 && g !== 'jenever',
  );
  const tubsAboard = cart?.cargo.jenever ?? 0;

  return (
    <>
      <h4>Ryne</h4>
      <p className="flavour">
        Wool fetches {WOOL_PRICE_DOMESTIC} coin the fleece here, and every buyer on the quay knows
        it cannot lawfully leave the country.
      </p>
      {!state.dutchman.unlocked && (
        <p className="flavour">
          Across the water they pay {WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT} the fleece. Not that
          anyone would know about that.
        </p>
      )}
      {cartHere && sellables.length > 0 && (
        <div className="menu-buttons">
          {sellables.map(([good, n]) => {
            const appetite = state.demandRemaining[good] ?? 0;
            const q = Math.min(n, appetite);
            return (
              <button
                key={good}
                disabled={q <= 0}
                title={q <= 0 ? 'The town has had its fill today. Dawn brings appetite.' : undefined}
                onClick={() => enqueue({ type: 'sell', cartId: cart!.id, good })}
              >
                {q > 0
                  ? `Sell ${q} ${GOOD_LABEL[good]} · ${q * RYNE_PRICE[good]} coin` +
                    (q < n ? ' · all the town will take' : '')
                  : `${GOOD_LABEL[good]} · Ryne is sated until dawn`}
              </button>
            );
          })}
        </div>
      )}
      {cartHere && tubsAboard > 0 && (
        <p className="flavour">
          No buyer on the quay will touch overproof jenever. It wants cutting first.
        </p>
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
          {state.cuttingHouse && (
            <button
              onClick={() =>
                enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-ryne-track' })
              }
            >
              Out to the cutting house
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ShingleMenu({ state, onPlace }: { state: GameState; onPlace: () => void }) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  const cartHere = cart?.location.kind === 'node' && cart.location.nodeId === 'shingle';
  const d = state.dutchman;
  const fleeceHeld = cart?.cargo.fleece ?? 0;
  const fleeceSale = Math.min(fleeceHeld, d.fleeceAppetite);
  const room = cart ? cart.capacity - cargoCount(cart.cargo) : 0;
  const beachPrice = WOOL_PRICE_DOMESTIC * LEIDEN_PRICE_MULT;

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
          {cartHere && (
            <div className="menu-buttons">
              {fleeceSale > 0 && (
                <button onClick={() => enqueue({ type: 'sellToDutchman', cartId: cart!.id })}>
                  Sell {fleeceSale} fleece · {fleeceSale * beachPrice} coin
                </button>
              )}
              {(['jenever', 'tea', 'lace'] as Good[]).map((good) => {
                const stock = d.hold[good] ?? 0;
                const price = DUTCHMAN_PRICE[good]!;
                const can = Math.min(stock, room, Math.floor(state.coin / price));
                if (stock <= 0) return null;
                return (
                  <button
                    key={good}
                    disabled={can <= 0}
                    title={can <= 0 ? 'No room in the cart, or no coin. He does not give credit.' : undefined}
                    onClick={() =>
                      enqueue({ type: 'buyFromDutchman', cartId: cart!.id, good, qty: 99 })
                    }
                  >
                    {can > 0
                      ? `Buy ${can} ${GOOD_LABEL[good]} · ${can * price} coin`
                      : `${GOOD_LABEL[good]} · ${price} coin each`}{' '}
                    · {stock} aboard
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {cartHere && (cart?.cargo.jenever ?? 0) > 0 && !state.cuttingHouse && (
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
      {cartHere && (
        <div className="menu-buttons">
          <button
            onClick={() => enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'marsh-track' })}
          >
            Home over the marsh
          </button>
          {state.cuttingHouse && (
            <button
              onClick={() =>
                enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-shingle-track' })
              }
            >
              To the cutting house
            </button>
          )}
        </div>
      )}
    </>
  );
}

function CuttingHouseMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  const cartHere = cart?.location.kind === 'node' && cart.location.nodeId === 'cutting-house';
  const store = state.stores['cutting-house'] ?? {};
  const tubs = store.jenever ?? 0;
  const cuttable = Math.min(tubs, Math.floor(state.coin / CUT_SUGAR_COST));
  const brandies = (['brandy-gent', 'brandy-fair', 'brandy-rough'] as Good[]).filter(
    (g) => (store[g] ?? 0) > 0,
  );

  return (
    <>
      <h4>The Cutting House</h4>
      <p className="flavour">
        In store: {storeSummary(store, 'bare shelves')}.
        {cartHere ? ` The cart stands by: ${storeSummary(cart!.cargo, 'empty')}.` : ''}
      </p>

      <div className="menu-buttons">
        {cartHere && (cart!.cargo.jenever ?? 0) > 0 && (
          <button
            onClick={() => enqueue({ type: 'unloadCart', cartId: cart!.id, good: 'jenever', qty: 99 })}
          >
            Unload {cart!.cargo.jenever} tubs into the house
          </button>
        )}
        {tubs > 0 &&
          (['gentle', 'standard', 'deep'] as CutDepth[]).map((depth) => {
            const { yield: perTub, brandy } = CUTS[depth];
            return (
              <button
                key={depth}
                disabled={cuttable <= 0}
                title={
                  cuttable <= 0
                    ? 'Burnt sugar costs coin, and the till is empty.'
                    : `Sugar: ${cuttable * CUT_SUGAR_COST} coin.`
                }
                onClick={() => enqueue({ type: 'cut', depth, tubs: 99 })}
              >
                Cut {depth} · {cuttable} tubs → {cuttable * perTub} {GOOD_LABEL[brandy]} (
                {RYNE_PRICE[brandy]} coin ea)
              </button>
            );
          })}
        {cartHere &&
          brandies.map((good) => (
            <button
              key={good}
              onClick={() => enqueue({ type: 'loadCart', cartId: cart!.id, good, qty: 99 })}
            >
              Load {GOOD_LABEL[good]} ({store[good]})
            </button>
          ))}
      </div>

      {cartHere && (
        <div className="menu-buttons">
          <button
            onClick={() =>
              enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-ryne-track' })
            }
          >
            Send to Ryne
          </button>
          <button
            onClick={() =>
              enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-farm-track' })
            }
          >
            Send home to the farm
          </button>
          <button
            onClick={() =>
              enqueue({ type: 'dispatchCart', cartId: cart!.id, edgeId: 'cut-shingle-track' })
            }
          >
            Send to the shingle
          </button>
        </div>
      )}
    </>
  );
}

function CartMenu({ state, flooded }: { state: GameState; flooded: boolean }) {
  const enqueue = useEnqueue();
  const cart = state.carts[0];
  if (!cart) return null;
  const cargo = storeSummary(cart.cargo, 'Empty');
  const laden = cargoCount(cart.cargo) > 0;

  // The one order the cart takes anywhere: tip the lot into a dyke (spec §6.9).
  const ditchButton = laden && (
    <div className="menu-buttons">
      <button onClick={() => enqueue({ type: 'ditchCargo', cartId: cart.id })}>
        Tip the lot into a dyke · nothing comes back
      </button>
    </div>
  );

  if (cart.location.kind === 'edge') {
    const edge = edgesFor(state.farm, state.cuttingHouse).find(
      (e) => e.id === (cart.location as { edgeId: string }).edgeId,
    );
    const pct = edge ? Math.round((cart.location.progress / edge.latency) * 100) : 0;
    const halted = edge?.condition === 'tideLocked' && flooded;
    return (
      <>
        <h4>The Cart</h4>
        <p className="flavour">
          {cargo} aboard. {edge?.name}, {pct}% along.
          {halted ? ' The tide has the road — waiting on high ground.' : ''}
        </p>
        {ditchButton}
      </>
    );
  }

  const here = nodeById(cart.location.nodeId, state.farm, state.cuttingHouse);
  return (
    <>
      <h4>The Cart</h4>
      <p className="flavour">
        Standing at {here.name}. {cargo} aboard.{' '}
        {clockOf(state.tick).hour >= 20 ? 'The pony would rather not.' : ''}
      </p>
      <p className="flavour">Orders are given where the cart stands.</p>
      {ditchButton}
    </>
  );
}
