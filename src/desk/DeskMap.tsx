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
import { isFlooded, tideLevel } from '../sim/time';
import type { Cart, GameState } from '../sim/types';
import { CameraController } from '../shared/camera';
import { TILE, pathPoints, pointAlong, tileCenter } from '../shared/geometry';
import * as art from './look/art';
import { Compositor } from './look/compositor';
import { darknessAt, duskAt, lampsOf } from './look/light';
import { deskApron, deskWorld, drawPainted, waterMask } from './look/terrain';
import {
  drawDyke,
  drawFortifications,
  drawLighter,
  drawRoad,
  drawSeaLane,
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
import { Tags } from './Tags';
import { firstMorningHint } from '../shared/firstMorning';
import { hintTarget } from './FirstMorning';
import { draftStops } from './command';
import { routeRisk, routesBetween, type Route } from './routes';

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

/** Every cart under the pointer, nearest first — a second click on a pile
 *  takes the next one (§20.4's catching). */
function cartsAt(state: GameState, x: number, y: number): string[] {
  return state.carts
    .map((c) => {
      const p = cartPos(state, c);
      return p ? { id: c.id, d: Math.hypot(x - p.x, y - p.y) } : null;
    })
    .filter((o): o is { id: string; d: number } => !!o && o.d <= 16)
    .sort((a, b) => a.d - b.d)
    .map((o) => o.id);
}

/** A route's points in world px, leg by leg, each leg the way it is ridden. */
function routePoints(route: Route): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  for (const leg of route.legs) {
    const p = pathPoints(leg.edge, leg.from !== leg.edge.a);
    pts.push(...(pts.length ? p.slice(1) : p));
  }
  return pts;
}

const TONE_STROKE: Record<string, string> = {
  quiet: '#9fbf7a',
  seen: '#e0c27a',
  watched: '#e0837a',
  water: '#8fb2b5',
};

function strokeRoute(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  color: string,
  width: number,
  zoom: number,
  dash: number[] | null,
): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = 'rgba(36, 28, 24, 0.7)';
  ctx.lineWidth = (width + 2.4) / zoom;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width / zoom;
  if (dash) {
    ctx.setLineDash(dash.map((d) => d / zoom));
    ctx.lineDashOffset = -performance.now() / 50 / zoom;
  }
  ctx.stroke();
  ctx.restore();
}

function routeToneOf(state: GameState, route: Route): string {
  return routeRisk(state, route).tone;
}

function routesVisible(state: GameState): boolean {
  const cart = state.carts[0];
  return !!cart && (cargoCount(cart.cargo) > 0 || cart.location.kind === 'edge' || state.coin > 0);
}

export function DeskMap() {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
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
    const canvas = canvasRef.current!; // the overlay: text and lines, crisp, never rippled
    const ctx = canvas.getContext('2d')!;
    const scene = sceneRef.current!; // the world, lit
    const sctx = scene.getContext('2d')!;
    const glCanvas = glRef.current!;
    const comp = new Compositor(glCanvas);
    glCanvas.hidden = !comp.ok; // without WebGL2 the scene itself is the picture
    const light = document.createElement('canvas');
    const lctx = light.getContext('2d')!;
    const cam = camRef.current!;
    if (import.meta.env.DEV) (window as unknown as { __deskCam: unknown }).__deskCam = cam;
    const world = deskWorld();
    const apron = deskApron();
    let raf = 0;
    const invite = { key: '', ids: new Set<string>() };
    let maskKey: string | null = null;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dpr = window.devicePixelRatio || 1;
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      // The scene renders a little under full density: it is painted and then
      // shaded, and every texture upload is paid for each frame.
      const sdpr = Math.min(dpr, 1.5);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      for (const c of [scene, glCanvas, light]) {
        if (c.width !== Math.round(w * sdpr) || c.height !== Math.round(h * sdpr)) {
          c.width = Math.round(w * sdpr);
          c.height = Math.round(h * sdpr);
        }
      }
      cam.setViewport(w, h);
      cam.ease();

      const s = useGameStore.getState().state;
      const ui = useDeskUi.getState();
      const z = cam.zoom * dpr;
      const sz = cam.zoom * sdpr;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.fillStyle = '#241C18';
      sctx.fillRect(0, 0, scene.width, scene.height);
      sctx.setTransform(sz, 0, 0, sz, -cam.x * sz, -cam.y * sz);
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      drawPainted(sctx, apron);
      drawPainted(sctx, world);
      const lit = darknessAt(s.tick);
      const tnow = performance.now() / 1000;

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
        if (edge.id === 'sea-lane') drawSeaLane(sctx, pathPoints(edge, false));
        else drawRoad(sctx, pathPoints(edge, false), edge.condition === 'tideLocked' && flooded);
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
          drawDyke(sctx, seg.path, status);
          if (status !== 'dug') {
            drawSurveyPost(sctx, pointAlong(seg.path.map(tileCenter), 0.5), status === 'survey' && invite.ids.has(seg.id), pulse);
          }
        }
      }

      const fc = tileCenter(s.farm);
      art.sheep(sctx, s.farm, s.flockSize, performance.now() / 1000);
      art.farm(sctx, s.farm, lit, tnow);
      if ((s.fortifications.farm ?? 0) > 0) drawFortifications(sctx, s.farm, s.fortifications.farm ?? 0, fortVisibility(s, 'farm'));
      art.ryne(sctx, lit);
      art.customs(sctx, lit, s.revenue.officer.arrived, tnow);
      if (s.dutchman.unlocked) {
        art.shingle(sctx, lit);
        if (s.dutchman.present) art.lugger(sctx, tnow);
      }
      if (s.cuttingHouse) {
        art.cuttingHouse(sctx, s.cuttingHouse, lit, tnow);
        const t = s.fortifications['cutting-house'] ?? 0;
        if (t > 0) drawFortifications(sctx, s.cuttingHouse, t, fortVisibility(s, 'cutting-house'));
      }
      if (s.wights.sign) drawWightSign(sctx, s.wights.sign, pulse);
      if (s.wights.stone) drawWightStone(sctx, s.wights.stone, pulse);
      if (s.leiden.state === 'housed' && s.leiden.node) {
        const host = s.leiden.node === 'farm' ? s.farm : s.cuttingHouse;
        if (host) drawWorkshopBadge(sctx, host, pulse);
      }

      for (const cart of s.carts) {
        const p = cartPos(s, cart);
        if (!p) continue;
        const ang = cart.location.kind === 'edge' ? p.angle : 0;
        if (cart.vessel === 'sea') drawLighter(sctx, p.x, p.y, ang, pulse);
        else if (cart.vessel === 'dyke') drawTubBoat(sctx, p.x, p.y, ang, cargoCount(cart.cargo) > 0);
        else art.cart(sctx, p.x, p.y, ang, cart.cargo, cart.location.kind === 'edge', tnow, s.carts.indexOf(cart));
      }
      const op = officerPos(s);
      if (op) art.officer(sctx, op.x, op.y, s.revenue.officer.location.kind === 'edge' ? op.angle : 0, s.revenue.officer.location.kind === 'edge', tnow);

      // The night (spec §20.4 D4): darkness laid over the scene and cut away
      // where the lamps are — windows, carts, the lugger, the officer — then
      // the dusk's warmth. Done in 2D so the fallback keeps its night.
      const now = performance.now() / 1000;
      const dark = darknessAt(s.tick);
      const dusk = duskAt(s.tick);
      const lamps = lampsOf(s, now, cartPos, officerPos);
      if (dusk > 0.01) {
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.globalCompositeOperation = 'multiply';
        sctx.fillStyle = `rgba(236, 178, 146, ${0.4 * dusk})`;
        sctx.fillRect(0, 0, scene.width, scene.height);
        sctx.globalCompositeOperation = 'source-over';
      }
      if (dark > 0.01) {
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.globalCompositeOperation = 'source-over';
        lctx.clearRect(0, 0, light.width, light.height);
        lctx.fillStyle = `rgba(10, 14, 30, ${0.62 * dark})`;
        lctx.fillRect(0, 0, light.width, light.height);
        lctx.globalCompositeOperation = 'destination-out';
        lctx.setTransform(sz, 0, 0, sz, -cam.x * sz, -cam.y * sz);
        for (const lp of lamps) {
          const g = lctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lp.r);
          g.addColorStop(0, `rgba(0,0,0,${0.92 * lp.i})`);
          g.addColorStop(0.5, `rgba(0,0,0,${0.45 * lp.i})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          lctx.fillStyle = g;
          lctx.beginPath();
          lctx.arc(lp.x, lp.y, lp.r, 0, Math.PI * 2);
          lctx.fill();
        }
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.drawImage(light, 0, 0);
        // a warm breath at each lamp, for the fallback's sake as much as the shader's
        sctx.setTransform(sz, 0, 0, sz, -cam.x * sz, -cam.y * sz);
        sctx.globalCompositeOperation = 'lighter';
        for (const lp of lamps) {
          const g = sctx.createRadialGradient(lp.x, lp.y, 0, lp.x, lp.y, lp.r * 0.6);
          const [r, gg, b] = lp.rgb.map((v) => Math.round(v * 255));
          g.addColorStop(0, `rgba(${r},${gg},${b},${0.22 * dark * lp.i})`);
          g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
          sctx.fillStyle = g;
          sctx.beginPath();
          sctx.arc(lp.x, lp.y, lp.r * 0.6, 0, Math.PI * 2);
          sctx.fill();
        }
        sctx.globalCompositeOperation = 'source-over';
      }
      if (comp.ok) {
        const dugKey = s.dykesDug.join(',');
        if (dugKey !== maskKey) {
          maskKey = dugKey;
          comp.setMask(waterMask(DYKE_SEGMENTS.filter((seg) => s.dykesDug.includes(seg.id)).map((seg) => seg.path)));
        }
        comp.render(scene, glCanvas, {
          camX: cam.x,
          camY: cam.y,
          scale: sz,
          time: now,
          dark,
          dusk,
          tide: tideLevel(s.tick),
          lamps,
        });
      }

      // The overlay: everything that must read, above the shader.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);

      // Labels: a fixed screen size at every zoom — read at a glance, never shouting.
      const label = (text: string, wx: number, wy: number) => {
        const sp = cam.worldToScreen(wx, wy);
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = "15px 'IM Fell English SC', 'IM Fell English', Georgia, serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(36, 28, 24, 0.85)';
        ctx.strokeText(text, sp.x, sp.y);
        ctx.fillStyle = '#E8E1D2';
        ctx.fillText(text, sp.x, sp.y);
        ctx.restore();
      };
      label('Walland Farm', fc.x, fc.y - 18);
      label('Ryne', 28.5 * TILE, 19.6 * TILE);
      label('Customs House', 26.5 * TILE, 17.9 * TILE);
      if (s.dutchman.unlocked) {
        const sc = tileCenter(SHINGLE);
        label('The Shingle', sc.x - 4, sc.y - 14);
      }
      if (s.cuttingHouse) {
        const cc = tileCenter(s.cuttingHouse);
        label('Cutting House', cc.x, cc.y - 14);
      }
      if (s.wights.stone) {
        const wc = tileCenter(s.wights.stone);
        label('The Wight-Stone', wc.x, wc.y - 16);
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
      // Cart command's lines (D2): the selected cart's standing round, faint;
      // its journey still to ride; the round being drafted, numbered; and,
      // brightest, the route under the pointer, in its risk's colour.
      const selCart = ui.selection?.kind === 'cart' ? s.carts.find((c) => c.id === (ui.selection as { id: string }).id) : null;
      if (selCart?.carter && !(ui.draft && ui.draft.cartId === selCart.id)) {
        const st = selCart.carter.stops;
        for (let i = 0; i < st.length; i++) {
          const r = routesBetween(s, selCart, st[i].at, st[(i + 1) % st.length].at, 1)[0];
          if (r) strokeRoute(ctx, routePoints(r), 'rgba(232, 225, 210, 0.6)', 2.2, cam.zoom, [6, 6]);
        }
      }
      for (const [cartId, j] of Object.entries(ui.journeys)) {
        const rest = { legs: j.route.legs.slice(Math.max(0, j.next - 1)), ticks: 0 };
        strokeRoute(ctx, routePoints(rest), cartId === selCart?.id ? LAMP : 'rgba(240, 207, 138, 0.45)', 2.6, cam.zoom, [8, 5]);
      }
      if (ui.draft && selCart && ui.draft.cartId === selCart.id) {
        const stops = draftStops(s, ui.draft);
        for (let i = 0; i < stops.length; i++) {
          const closing = i === stops.length - 1;
          if (closing && stops.length < 3) continue; // a two-stop round reads as one line
          const r = routesBetween(s, selCart, stops[i].at, stops[(i + 1) % stops.length].at, 1)[0];
          if (r) strokeRoute(ctx, routePoints(r), closing ? 'rgba(240, 207, 138, 0.55)' : LAMP, closing ? 2.2 : 3.4, cam.zoom, closing ? [3, 6] : [10, 5]);
        }
      }
      const hr = ui.hoverRoute;
      if (hr) {
        const tone = routeToneOf(s, hr.route);
        strokeRoute(ctx, routePoints(hr.route), TONE_STROKE[tone], 4.4, cam.zoom, [12, 6]);
      }
      ring(hoverRef.current, 0.55, false);
      // §10 — the first morning's pointer, rung on the map where it points.
      const hint = firstMorningHint(s);
      if (hint) ring(hintTarget(hint), 0.45 + 0.45 * Math.sin(performance.now() / 420), false);
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

      if (ui.draft && selCart && ui.draft.cartId === selCart.id) {
        draftStops(s, ui.draft).forEach((stop, i) => {
          const at = placeAt(s, stop.at);
          if (!at) return;
          const sp = cam.worldToScreen(at.x, at.y);
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const x = sp.x + 22 + i * 4;
          const y = sp.y - 24 - i * 4;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.fillStyle = LAMP;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#241C18';
          ctx.stroke();
          ctx.fillStyle = '#241C18';
          ctx.font = 'bold 12px Georgia, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), x, y + 0.5);
          ctx.restore();
        });
      }

      // Pin each destination tag beside its place, inside the free table
      // between the panels, and never off the screen.
      const tags = shell.querySelectorAll<HTMLElement>('[data-anchor]');
      const leftBound = Math.min(296, w * 0.25);
      const rightBound = w - Math.min(404, w * 0.3);
      // Place each tag, then let them stack: a tag that would land on another
      // slides down below it, so no route is ever hidden under a neighbour.
      const placed: Array<{ el: HTMLElement; left: number; top: number; w: number; h: number }> = [];
      tags.forEach((el) => {
        const at = placeAt(s, el.dataset.anchor!);
        if (!at) return;
        const sp = cam.worldToScreen(at.x, at.y);
        const tw = el.offsetWidth;
        const th = el.offsetHeight;
        placed.push({
          el,
          left: Math.max(leftBound, Math.min(sp.x + 26, rightBound - tw - 8)),
          top: Math.max(8, Math.min(sp.y + 18, h - th - 8)),
          w: tw,
          h: th,
        });
      });
      placed.sort((a, b) => a.top - b.top);
      for (let i = 0; i < placed.length; i++) {
        const t = placed[i];
        for (let k = 0; k < i; k++) {
          const o = placed[k];
          const overlapX = t.left < o.left + o.w && o.left < t.left + t.w;
          if (overlapX && t.top < o.top + o.h + 6 && o.top < t.top + t.h) t.top = o.top + o.h + 6;
        }
        t.el.style.transform = `translate(${Math.round(t.left)}px, ${Math.round(t.top)}px)`;
      }

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
    // A second click on a pile of carts takes the next one in it.
    const pile = cartsAt(s, w.x, w.y);
    if (pile.length > 1 && ui.selection?.kind === 'cart' && pile.includes(ui.selection.id)) {
      const next = pile[(pile.indexOf(ui.selection.id) + 1) % pile.length];
      ui.select({ kind: 'cart', id: next });
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
        const hc = hoverRef.current?.kind === 'cart' ? s.carts.find((c) => c.id === (hoverRef.current as { id: string }).id) : null;
        useDeskUi.getState().setLeaning(!!hc && hc.location.kind === 'edge');
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
        useDeskUi.getState().setLeaning(false);
      }}
      onClick={onClick}
    >
      <canvas ref={sceneRef} className="desk-canvas" />
      <canvas ref={glRef} className="desk-canvas" />
      <canvas ref={canvasRef} className="desk-canvas" />
      <Tags />
      {placing && (
        <div className="placing-banner">
          Choose open marsh for the cutting house — {CUTTING_HOUSE_COST} coin. Click elsewhere to think better of it.
        </div>
      )}
    </div>
  );
}
