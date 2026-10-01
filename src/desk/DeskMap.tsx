// The desk's map (spec §20.4, D1). The table's middle: the same painted marsh
// and the same sprites as the phone (src/shared), drawn by the desk's own loop
// so the desk can own what a click means — the cart is clicked directly (the
// phone's "click the place" is the phone's rule), and the selection is ringed
// on the map while the inspector speaks for it. D4 re-skins this with the
// field-and-ditch marsh, the lit night and the shader pass.

import { useEffect, useRef } from 'react';
import { CUTTING_HOUSE_COST } from '../sim/balance';
import { cutInvites, dykeWaterways } from '../sim/dykes';
import { fortVisibility } from '../sim/revenue';
import {
  DYKE_SEGMENTS,
  SHINGLE,
  edgesFor,
  horseLatency,
  isPlaceable,
  nodeById,
  officerEdgesFor,
} from '../sim/map';
import { dayPhaseOf, isFlooded } from '../sim/time';
import type { Cart, GameState } from '../sim/types';
import { CameraController } from '../shared/camera';
import { APRON_TILES, TILE, WORLD_H, WORLD_W, pathPoints, pointAlong, tileCenter } from '../shared/geometry';
import { getApronCanvas, getTerrainCanvas } from '../shared/paint';
import {
  drawCart,
  drawCuttingHouse,
  drawCustoms,
  drawDyke,
  drawFarm,
  drawFortifications,
  drawLabel,
  drawLighter,
  drawLugger,
  drawOfficer,
  drawRoad,
  drawRyne,
  drawSeaLane,
  drawSheep,
  drawShingle,
  drawSurveyPost,
  drawTileHighlight,
  drawTubBoat,
  drawWightSign,
  drawWightStone,
  drawWorkshopBadge,
} from '../shared/sprites';
import { cargoCount } from '../shared/words';
import { useGameStore } from '../state/store';
import { useDeskUi } from './deskUi';
import type { DeskSelection } from './sheet';

const LAMP = '#F0CF8A';

/** A cart's position in world px. Carts at a place park in fanned slots
 *  around it (never stacked, §20.4's "catching"); on the road, along it. */
export function cartPos(state: GameState, cart: Cart): { x: number; y: number; angle: number } | null {
  if (cart.location.kind === 'node') {
    const nodeId = cart.location.nodeId;
    const here = state.carts.filter((c) => c.location.kind === 'node' && c.location.nodeId === nodeId);
    const slot = here.indexOf(cart);
    const a = tileCenter(nodeById(nodeId, state.farm, state.cuttingHouse));
    const ang = -0.6 + slot * 0.85;
    return { x: a.x + Math.cos(ang) * 30, y: a.y + 14 + Math.sin(ang) * 14, angle: 0 };
  }
  const loc = cart.location;
  const edge = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)].find((e) => e.id === loc.edgeId);
  if (!edge) return null;
  return pointAlong(pathPoints(edge, loc.from !== edge.a), loc.progress / edge.latency);
}

function officerPos(state: GameState): { x: number; y: number; angle: number } | null {
  const o = state.revenue.officer;
  if (!o.arrived) return null;
  if (o.location.kind === 'node') {
    const a = tileCenter(nodeById(o.location.nodeId, state.farm, state.cuttingHouse));
    return { x: a.x - 14, y: a.y + 12, angle: 0 };
  }
  const loc = o.location;
  const edge = officerEdgesFor(state.farm, state.cuttingHouse).find((e) => e.id === loc.edgeId);
  if (!edge) return null;
  return pointAlong(pathPoints(edge, loc.from !== edge.a), Math.min(1, loc.progress / horseLatency(edge)));
}

const RYNE_AT = { x: 28, y: 21.8 };
const CUSTOMS_AT = { x: 26, y: 19 };

function placeAt(state: GameState, id: string): { x: number; y: number } | null {
  switch (id) {
    case 'farm':
      return tileCenter(state.farm);
    case 'ryne':
      return tileCenter(RYNE_AT);
    case 'customs':
      return tileCenter(CUSTOMS_AT);
    case 'shingle':
      return tileCenter(SHINGLE);
    case 'cutting-house':
      return state.cuttingHouse ? tileCenter(state.cuttingHouse) : null;
    default:
      return null;
  }
}

function selectionAt(state: GameState, sel: DeskSelection): { x: number; y: number } | null {
  switch (sel.kind) {
    case 'place':
      return placeAt(state, sel.id);
    case 'cart': {
      const c = state.carts.find((x) => x.id === sel.id);
      return c ? cartPos(state, c) : null;
    }
    case 'dyke': {
      const seg = DYKE_SEGMENTS.find((d) => d.id === sel.id);
      return seg ? pointAlong(seg.path.map(tileCenter), 0.5) : null;
    }
    case 'sign':
      return state.wights.sign ? tileCenter(state.wights.sign) : null;
    case 'stone':
      return state.wights.stone ? tileCenter(state.wights.stone) : null;
    case 'officer':
      return officerPos(state);
    case 'ledger':
      return null;
  }
}

interface Target {
  sel: DeskSelection;
  x: number;
  y: number;
  r: number;
}

/** Everything clickable, nearest-first order decided by the caller. Carts
 *  come first and carry a generous radius: a moving cart must be catchable. */
function targetsOf(state: GameState): Target[] {
  const t: Target[] = [];
  for (const cart of state.carts) {
    const p = cartPos(state, cart);
    if (p) t.push({ sel: { kind: 'cart', id: cart.id }, x: p.x, y: p.y, r: 16 });
  }
  const op = officerPos(state);
  if (op) t.push({ sel: { kind: 'officer' }, x: op.x, y: op.y, r: 14 });
  const place = (id: string, r: number) => {
    const p = placeAt(state, id);
    if (p) t.push({ sel: { kind: 'place', id }, x: p.x, y: p.y, r });
  };
  place('farm', 26);
  place('ryne', 40);
  place('customs', 16);
  if (state.dutchman.unlocked) place('shingle', 30);
  if (state.cuttingHouse) place('cutting-house', 20);
  if (state.wights.stone) t.push({ sel: { kind: 'stone' }, ...tileCenter(state.wights.stone), r: 16 });
  if (state.wights.sign) t.push({ sel: { kind: 'sign' }, ...tileCenter(state.wights.sign), r: 16 });
  if (state.cuttingHouse) {
    for (const seg of DYKE_SEGMENTS) {
      const m = pointAlong(seg.path.map(tileCenter), 0.5);
      t.push({ sel: { kind: 'dyke', id: seg.id }, x: m.x, y: m.y, r: 13 });
    }
  }
  return t;
}

function hitTest(state: GameState, x: number, y: number): DeskSelection | null {
  let best: { sel: DeskSelection; d: number } | null = null;
  for (const t of targetsOf(state)) {
    const d = Math.hypot(x - t.x, y - t.y);
    // Carts win ties: the actor before the scenery it stands in front of.
    const score = t.sel.kind === 'cart' ? d - 6 : d;
    if (d <= t.r && (!best || score < best.d)) best = { sel: t.sel, d: score };
  }
  return best?.sel ?? null;
}

function routesVisible(state: GameState): boolean {
  const cart = state.carts[0];
  return !!cart && (cargoCount(cart.cargo) > 0 || cart.location.kind === 'edge' || state.coin > 0);
}

export function DeskMap() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<CameraController | null>(null);
  if (!camRef.current) camRef.current = new CameraController();
  const hoverRef = useRef<DeskSelection | null>(null);
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);

  const focusNonce = useDeskUi((s) => s.focusNonce);
  const placing = useDeskUi((s) => s.placing);
  const enqueue = useGameStore((s) => s.enqueue);

  // ---- The render loop (layers 0–1, and the selection's ring) ----
  useEffect(() => {
    const shell = shellRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const cam = camRef.current!;
    const terrain = getTerrainCanvas();
    const apron = getApronCanvas();
    const RES = terrain.width / 40 / TILE;
    let raf = 0;
    const invite = { key: '', ids: new Set<string>() };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = window.devicePixelRatio || 1;
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      cam.setViewport(w, h);
      cam.ease();

      const s = useGameStore.getState().state;
      const ui = useDeskUi.getState();
      const z = cam.zoom * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#241C18';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(apron, 0, 0, apron.width, apron.height, -APRON_TILES * TILE, -APRON_TILES * TILE, WORLD_W + 2 * APRON_TILES * TILE, WORLD_H + 2 * APRON_TILES * TILE);
      ctx.drawImage(terrain, 0, 0, terrain.width, terrain.height, 0, 0, terrain.width / RES, terrain.height / RES);

      const flooded = isFlooded(s.tick);
      for (const edge of edgesFor(s.farm, s.cuttingHouse)) {
        const visible =
          edge.id === 'marsh-track'
            ? s.dutchman.unlocked
            : edge.id === 'sea-lane'
              ? s.carts.some((c) => c.vessel)
              : edge.id.startsWith('cut-')
                ? true
                : routesVisible(s);
        if (!visible) continue;
        if (edge.id === 'sea-lane') drawSeaLane(ctx, pathPoints(edge, false));
        else drawRoad(ctx, pathPoints(edge, false), edge.condition === 'tideLocked' && flooded);
      }

      const pulse = (performance.now() / 2600) % 1;
      if (s.cuttingHouse) {
        const key = `${s.dykesDug.join(',')}|${s.cuttingHouse.x},${s.cuttingHouse.y}|${s.farm.x},${s.farm.y}`;
        if (invite.key !== key) {
          invite.key = key;
          invite.ids = new Set(DYKE_SEGMENTS.filter((seg) => cutInvites(s, seg.id)).map((seg) => seg.id));
        }
        for (const seg of DYKE_SEGMENTS) {
          const status = s.dykesDug.includes(seg.id) ? 'dug' : s.digging?.id === seg.id ? 'digging' : 'survey';
          drawDyke(ctx, seg.path, status);
          if (status !== 'dug') {
            drawSurveyPost(ctx, pointAlong(seg.path.map(tileCenter), 0.5), status === 'survey' && invite.ids.has(seg.id), pulse);
          }
        }
      }

      const fc = tileCenter(s.farm);
      drawSheep(ctx, s.farm, s.flockSize);
      drawFarm(ctx, s.farm);
      if ((s.fortifications.farm ?? 0) > 0) drawFortifications(ctx, s.farm, s.fortifications.farm ?? 0, fortVisibility(s, 'farm'));
      drawRyne(ctx);
      drawCustoms(ctx);
      if (s.dutchman.unlocked) {
        drawShingle(ctx, SHINGLE);
        if (s.dutchman.present) drawLugger(ctx, SHINGLE);
      }
      if (s.cuttingHouse) {
        drawCuttingHouse(ctx, s.cuttingHouse);
        const t = s.fortifications['cutting-house'] ?? 0;
        if (t > 0) drawFortifications(ctx, s.cuttingHouse, t, fortVisibility(s, 'cutting-house'));
      }
      if (s.wights.sign) drawWightSign(ctx, s.wights.sign, pulse);
      if (s.wights.stone) drawWightStone(ctx, s.wights.stone, pulse);
      if (s.leiden.state === 'housed' && s.leiden.node) {
        const host = s.leiden.node === 'farm' ? s.farm : s.cuttingHouse;
        if (host) drawWorkshopBadge(ctx, host, pulse);
      }

      for (const cart of s.carts) {
        const p = cartPos(s, cart);
        if (!p) continue;
        const ang = cart.location.kind === 'edge' ? p.angle : 0;
        if (cart.vessel === 'sea') drawLighter(ctx, p.x, p.y, ang, pulse);
        else if (cart.vessel === 'dyke') drawTubBoat(ctx, p.x, p.y, ang, cargoCount(cart.cargo) > 0);
        else drawCart(ctx, p.x, p.y, ang, cargoCount(cart.cargo) > 0);
      }
      const op = officerPos(s);
      if (op) drawOfficer(ctx, op.x, op.y, s.revenue.officer.location.kind === 'edge' ? op.angle : 0);

      // Labels: always, at a readable screen size (the desk has room).
      drawLabel(ctx, 'Walland Farm', fc.x, fc.y - 18, cam.zoom);
      drawLabel(ctx, 'Ryne', 28.5 * TILE, 19.6 * TILE, cam.zoom);
      drawLabel(ctx, 'Customs House', 26.5 * TILE, 17.9 * TILE, cam.zoom);
      if (s.dutchman.unlocked) {
        const sc = tileCenter(SHINGLE);
        drawLabel(ctx, 'The Shingle', sc.x - 4, sc.y - 14, cam.zoom);
      }
      if (s.cuttingHouse) {
        const cc = tileCenter(s.cuttingHouse);
        drawLabel(ctx, 'Cutting House', cc.x, cc.y - 14, cam.zoom);
      }
      if (s.wights.stone) {
        const wc = tileCenter(s.wights.stone);
        drawLabel(ctx, 'The Wight-Stone', wc.x, wc.y - 16, cam.zoom);
      }

      // The hover, and the selection: rings in lamp light, sized for the screen.
      const ring = (sel: DeskSelection | null, alpha: number, dashed: boolean) => {
        if (!sel) return;
        const at = selectionAt(s, sel);
        if (!at) return;
        const r = (sel.kind === 'place' ? 30 : 18) / Math.max(0.6, cam.zoom / cam.fit);
        ctx.save();
        ctx.strokeStyle = `rgba(240, 207, 138, ${alpha})`;
        ctx.lineWidth = 2.2 / cam.zoom;
        if (dashed) {
          ctx.setLineDash([5 / cam.zoom, 4 / cam.zoom]);
          ctx.lineDashOffset = -performance.now() / 60 / cam.zoom;
        }
        ctx.beginPath();
        ctx.arc(at.x, at.y, Math.max(r, 14), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };
      ring(hoverRef.current, 0.55, false);
      ring(ui.selection, 1, true);

      // Cart numbers: a badge per cart, the same number the stable and the
      // keys use, in screen space so it reads at any zoom.
      s.carts.forEach((cart, i) => {
        const p = cartPos(s, cart);
        if (!p) return;
        const sel = ui.selection?.kind === 'cart' && ui.selection.id === cart.id;
        const sp = cam.worldToScreen(p.x, p.y);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(sp.x - 14, sp.y - 14, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = sel ? LAMP : 'rgba(36, 28, 24, 0.9)';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = sel ? '#241C18' : '#E8E1D2';
        ctx.stroke();
        ctx.fillStyle = sel ? '#241C18' : '#E8E1D2';
        ctx.font = 'bold 11px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), sp.x - 14, sp.y - 13.5);
        ctx.restore();
      });

      if (ui.placing && hoverTileRef.current) {
        const t = hoverTileRef.current;
        drawTileHighlight(ctx, t.x, t.y, isPlaceable(t.x, t.y) && s.coin >= CUTTING_HOUSE_COST);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Ease onto the selection when something asks (the stable, a key, a link).
  useEffect(() => {
    if (focusNonce === 0) return;
    const sel = useDeskUi.getState().selection;
    if (!sel) return;
    const at = selectionAt(useGameStore.getState().state, sel);
    if (at) camRef.current!.focusOn(at.x, at.y, 0.45);
  }, [focusNonce]);

  // Wheel zooms about the cursor (§15.2).
  useEffect(() => {
    const shell = shellRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = shell.getBoundingClientRect();
      camRef.current!.wheel(e.deltaY, e.clientX - r.left, e.clientY - r.top, e.deltaMode);
    };
    shell.addEventListener('wheel', onWheel, { passive: false });
    return () => shell.removeEventListener('wheel', onWheel);
  }, []);

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const r = shellRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onClick = (e: React.MouseEvent) => {
    const cam = camRef.current!;
    if (cam.wasDrag()) return;
    const p = local(e);
    const w = cam.screenToWorld(p.x, p.y);
    const s = useGameStore.getState().state;
    const ui = useDeskUi.getState();
    if (ui.placing) {
      const tx = Math.floor(w.x / TILE);
      const ty = Math.floor(w.y / TILE);
      if (isPlaceable(tx, ty) && s.coin >= CUTTING_HOUSE_COST) enqueue({ type: 'placeCuttingHouse', x: tx, y: ty });
      ui.setPlacing(false);
      return;
    }
    ui.select(hitTest(s, w.x, w.y));
  };

  return (
    <div
      ref={shellRef}
      className={placing ? 'desk-map placing' : 'desk-map'}
      onPointerDown={(e) => {
        if (e.button === 0 || e.button === 1) {
          const p = local(e);
          camRef.current!.pointerDown(p.x, p.y);
          try {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events have no real pointer */
          }
        }
      }}
      onPointerMove={(e) => {
        const p = local(e);
        const cam = camRef.current!;
        cam.pointerMove(p.x, p.y);
        const w = cam.screenToWorld(p.x, p.y);
        const s = useGameStore.getState().state;
        hoverRef.current = hitTest(s, w.x, w.y);
        hoverTileRef.current = { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
        shellRef.current!.style.cursor = useDeskUi.getState().placing ? 'crosshair' : hoverRef.current ? 'pointer' : 'grab';
      }}
      onPointerUp={(e) => {
        camRef.current!.pointerUp();
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
      }}
      onPointerLeave={() => {
        hoverRef.current = null;
      }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="desk-canvas" />
      <NightVeil />
      {placing && (
        <div className="placing-banner">
          Choose open marsh for the cutting house — {CUTTING_HOUSE_COST} coin. Click elsewhere to think better of it.
        </div>
      )}
    </div>
  );
}

function NightVeil() {
  const tick = useGameStore((s) => s.state.tick);
  const phase = dayPhaseOf(tick);
  const o = phase === 'night' ? 0.34 : phase === 'dusk' ? 0.16 : 0;
  return o > 0 ? <div className="night-veil" style={{ opacity: o }} /> : null;
}
