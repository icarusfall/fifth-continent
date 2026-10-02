// The map is the interface (spec §20): a layered Canvas 2D renderer with an
// eased camera, click-the-asset popover menus, and the opening act — choose
// ground for your farm. React owns the DOM overlay (layer 3); the canvas
// loop owns layers 0–1 and reads the latest sim state from a ref.

import { CartMenu } from './menus/CartRows';
import { CuttingHouseMenu } from './menus/CuttingHouseMenu';
import { FarmMenu } from './menus/FarmMenu';
import { RyneMenu } from './menus/RyneMenu';
import { ShingleMenu } from './menus/ShingleMenu';
import { DykeMenu, ForfeitOverlay, OfficerMenu, SignMenu, StoneMenu } from './menus/marsh';
import { CloseCtx, GOOD_SHORT, Popover, cargoCount, heldAnywhere, stockRows } from './menus/shared';
import { useEffect, useRef, useState } from 'react';
import {
  CUTTING_HOUSE_COST,
  CUTTING_HOUSE_STORE_CAPACITY,
  FARM_STORE_CAPACITY } from '../sim/balance';
import {
  DYKE_SEGMENTS,
  SHINGLE,
  edgesFor,
  firstHop,
  horseLatency,
  isPlaceable,
  nodeById,
  officerEdgesFor,
  otherEnd } from '../sim/map';
import { dayPhaseOf, isFlooded } from '../sim/time';
import { woolOnTheBooks } from '../sim/tick';
import { DARK_WOOL_TEXT, REVENUE_BLUE } from '../shared/palette';
import { cutInvites, dykeWaterways } from '../sim/dykes';
import { CONTRABAND, coverOf, fortVisibility, illicitCount } from '../sim/revenue';
import type { Cart, EdgeId, GameState, Good, NodeId } from '../sim/types';
import { useGameStore } from '../state/store';
import { useUiStore } from '../state/ui';
import { Sheet, useIsPhone } from './Sheet';
import { firstMorningHint, isFreshGame } from '../shared/firstMorning';
import { CameraController } from '../shared/camera';
import { APRON_TILES, pathPoints, pointAlong, TILE, tileCenter, WORLD_H, WORLD_W } from '../shared/geometry';
import { getApronCanvas, getTerrainCanvas } from '../shared/paint';
import {
  drawCart,
  drawCarterRoute,
  drawCoinMote,
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
  drawStockChip,
  drawDyke,
  drawSurveyPost,
  drawTubBoat,
  drawTileHighlight,
  drawLighter,
  drawSeaLane,
  drawWightSign,
  drawWightStone,
  drawWoolMote,
  drawPlaceMark,
  drawWorkshopBadge } from '../shared/sprites';

type Selection =
  | 'farm'
  | 'ryne'
  | 'customs'
  | 'shingle'
  | 'cutting-house'
  | 'wight-sign'
  | 'wight-stone'
  | 'officer'
  | `cart:${string}`
  | `dyke:${string}`
  | null;


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
  // §6.18 — the world's ways include the dug waterways (the tub rides them).
  const edge = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)].find(
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


/**
 * §20 — the edges a carter's round rides: from → to (→ backTo) → from,
 * walked hop by hop with tide-blind latencies so the drawn ribbon is stable
 * (he may detour with the tide; the round itself is what the glow names).
 */
function carterRouteEdges(state: GameState): Set<EdgeId> {
  const edges = edgesFor(state.farm, state.cuttingHouse);
  const served = new Set<EdgeId>();
  for (const cart of state.carts) {
    const order = cart.carter;
    if (!order) continue;
    // §6.19 — the round is a loop: every leg, and the wrap back to the first.
    if (order.stops.length === 0) continue;
    const stops: NodeId[] = [...order.stops.map((x) => x.at), order.stops[0].at];
    for (let i = 0; i < stops.length - 1; i++) {
      let at = stops[i];
      let guard = 0;
      while (at !== stops[i + 1] && guard++ < 6) {
        const hop = firstHop(at, stops[i + 1], edges, (e) => e.latency);
        if (!hop) break;
        served.add(hop.id);
        at = otherEnd(hop, at);
      }
    }
  }
  return served;
}

/**
 * §20 (M5 hub polish, playtest) — feedback motes: wool blossoms when the
 * clip lands in the barn, a guinea turns in the light where a sale is
 * struck. UI decoration only: the sim knows nothing of them, they are
 * never saved, and Math.random() here breaks no replay.
 */
interface Mote {
  kind: 'wool' | 'coin';
  x: number;
  y: number;
  /** performance.now() at which this mote begins (staggered for a flurry). */
  born: number;
  /** Phase offset for the wool mote's petal sway. */
  sway: number;
}

const WOOL_MOTE_MS = 1700;
const COIN_MOTE_MS = 1300;
const RYNE_CENTRE = { x: 28, y: 21 };

function moteLife(m: Mote): number {
  return m.kind === 'wool' ? WOOL_MOTE_MS : COIN_MOTE_MS;
}

/**
 * §15.2 (stage 5) — the three semantic-zoom bands, with hysteresis so the
 * boundary never flickers under an easing camera. County is the strategic
 * view (the route graph, flow as thickness, places as marks — the same map
 * the Revenue keeps); Parish is the working view; Yard is close detail,
 * where the labels yield to the art.
 */
type Lod = 'county' | 'parish' | 'yard';

function lodBand(ratio: number, prev: Lod): Lod {
  if (prev === 'county') return ratio > 1.42 ? (ratio > 3.55 ? 'yard' : 'parish') : 'county';
  if (prev === 'yard') return ratio < 3.25 ? (ratio < 1.28 ? 'county' : 'parish') : 'yard';
  if (ratio < 1.28) return 'county';
  if (ratio > 3.55) return 'yard';
  return 'parish';
}

function routesVisible(state: GameState): boolean {
  const cart = state.carts[0];
  return (
    !!cart && ((cart.cargo.fleece ?? 0) > 0 || cart.location.kind === 'edge' || state.coin > 0)
  );
}

function anchorWorld(sel: Selection, state: GameState): { x: number; y: number } | null {
  if (sel?.startsWith('cart:')) {
    const cart = state.carts.find((c) => c.id === sel.slice(5));
    return cart ? cartWorldPosOf(state, cart) : null;
  }
  if (sel?.startsWith('dyke:')) {
    const seg = DYKE_SEGMENTS.find((d) => d.id === sel.slice(5));
    return seg ? pointAlong(seg.path.map(tileCenter), 0.5) : null;
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
    case 'wight-sign':
      return state.wights.sign ? tileCenter(state.wights.sign) : null;
    case 'wight-stone':
      return state.wights.stone ? tileCenter(state.wights.stone) : null;
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
  const isPhone = useIsPhone();

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
  // §20.2 — the overlay mode lives in the UI store now (the bottom bar's
  // cycle button and Tab both drive it); the loop still reads refs.
  const overlay = useUiStore((s) => s.overlay);
  const showGossip = overlay === 'b' || overlay === 'c';
  const showGossipRef = useRef(false);
  showGossipRef.current = showGossip;
  // The goods overlay (spec §20.2): stock chips at every place, on by default
  // — once the hub splits the stores, "what is where" must be read at a glance.
  const showGoods = overlay === 'a' || overlay === 'c';
  const showGoodsRef = useRef(true);
  showGoodsRef.current = showGoods;
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  // §15.2 (stage 5) — the zoom band, held across frames for hysteresis.
  const lodRef = useRef<Lod>('parish');
  // Feedback motes (§20): spawned by state deltas below, drawn by the loop.
  const motesRef = useRef<Mote[]>([]);
  const prevFxRef = useRef<GameState | null>(null);
  // Live touch points, for two-finger pinch. One pointer pans; two pinch.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // §6.18 (M5½e) — the survey posts that breathe, cached on the dug-set.
  const invitingCutsRef = useRef<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() });

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
    const apron = getApronCanvas();
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

      // Layer 0: the world continuing past its own edge (§15.2) — the coarse
      // apron underneath, then the land itself, painted once, camera-scaled.
      ctx.drawImage(
        apron,
        0,
        0,
        apron.width,
        apron.height,
        -APRON_TILES * TILE,
        -APRON_TILES * TILE,
        WORLD_W + 2 * APRON_TILES * TILE,
        WORLD_H + 2 * APRON_TILES * TILE,
      );
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
      // §15.2 — which band this frame draws in.
      const lod = (lodRef.current = lodBand(cam.zoom / cam.fit, lodRef.current));
      const county = lod === 'county';
      const yard = lod === 'yard';
      const floodedNow = isFlooded(s.tick);
      for (const edge of edgesFor(s.farm, s.cuttingHouse)) {
        // Progressive disclosure: the roads once there is something to move;
        // the marsh track once the Dutchman is in the world; a sited cutting
        // house shows its own tracks always (the player paid for them).
        const visible =
          edge.id === 'marsh-track'
            ? s.dutchman.unlocked
            : edge.id === 'sea-lane'
              ? s.carts.some((c) => c.vessel) // §6.14 M5c: shown once a hull exists
              : edge.id.startsWith('cut-')
                ? true
                : routesVisible(s);
        if (!visible) continue;
        if (edge.id === 'sea-lane') {
          drawSeaLane(ctx, pathPoints(edge, false));
        } else {
          drawRoad(ctx, pathPoints(edge, false), edge.condition === 'tideLocked' && floodedNow);
        }
      }
      // §20 — the carter's rounds, named in light: a soft white ribbon over
      // every edge a standing order rides (playtest: "which roads are his?").
      // Stage 4: the ribbons belong to overlay A — YOUR map. Under B alone
      // they stand down, so "theirs" is purely the Revenue's reading.
      if (showGoodsRef.current) {
        const served = carterRouteEdges(s);
        for (const edge of edgesFor(s.farm, s.cuttingHouse)) {
          // County (§15.2): traffic is thickness — the flow-volume line.
          if (served.has(edge.id)) drawCarterRoute(ctx, pathPoints(edge, false), county ? 2.4 : 1);
        }
      }
      // §6.14 — one shared slow pulse: the wights' marks, and the survey's
      // inviting posts (M5½e). Defined before both users of it.
      const wightPhase = (performance.now() / 2600) % 1;
      const fc = tileCenter(s.farm);
      if (county) {
        drawPlaceMark(ctx, fc.x, fc.y);
      } else {
        drawSheep(ctx, s.farm, s.flockSize);
        drawFarm(ctx, s.farm);
        if ((s.fortifications.farm ?? 0) > 0) {
          drawFortifications(ctx, s.farm, s.fortifications.farm ?? 0, fortVisibility(s, 'farm'));
        }
      }
      if (!yard) drawLabel(ctx, 'Walland Farm', fc.x, fc.y - 16, cam.zoom);
      if (isFreshGame(s) && !farmVisitedRef.current) {
        drawFarmGlow(ctx, s.farm, (performance.now() / 1800) % 1, cam.zoom);
      }
      // §6.18 (M5½a) — the survey and the water: under the buildings, over
      // the roads. The lines appear with the improver's eye (cutting house).
      if (s.cuttingHouse) {
        // §6.18 (M5½e) — which posts breathe: the cuts that DO something
        // today. The probe walks hypothetical dug-sets, so it is cached on
        // everything it reads and recomputed only when the water changes.
        const cutsKey = `${s.dykesDug.join(',')}|${s.cuttingHouse.x},${s.cuttingHouse.y}|${s.farm.x},${s.farm.y}`;
        if (invitingCutsRef.current.key !== cutsKey) {
          const ids = new Set<string>();
          for (const seg of DYKE_SEGMENTS) if (cutInvites(s, seg.id)) ids.add(seg.id);
          invitingCutsRef.current = { key: cutsKey, ids };
        }
        for (const seg of DYKE_SEGMENTS) {
          const status = s.dykesDug.includes(seg.id)
            ? 'dug'
            : s.digging?.id === seg.id
              ? 'digging'
              : 'survey';
          drawDyke(ctx, seg.path, status);
          if (status !== 'dug' && !county) {
            drawSurveyPost(
              ctx,
              pointAlong(seg.path.map(tileCenter), 0.5),
              status === 'survey' && invitingCutsRef.current.ids.has(seg.id),
              wightPhase,
            );
          }
        }
      }

      if (county) {
        drawPlaceMark(ctx, 28.5 * TILE, 20.6 * TILE);
        drawPlaceMark(ctx, 26.5 * TILE, 18.9 * TILE);
      } else {
        drawRyne(ctx);
        drawCustoms(ctx);
      }
      if (!yard) {
        drawLabel(ctx, 'Ryne', 28.5 * TILE, 19.6 * TILE, cam.zoom);
        drawLabel(ctx, 'Customs House', 26.5 * TILE, 17.9 * TILE, cam.zoom);
      }

      if (s.dutchman.unlocked) {
        const sc = tileCenter(SHINGLE);
        if (county) {
          drawPlaceMark(ctx, sc.x, sc.y);
        } else {
          drawShingle(ctx, SHINGLE);
        }
        if (!yard) drawLabel(ctx, 'The Shingle', sc.x - 4, sc.y - 12, cam.zoom);
        // The lugger is an event, not scenery: it shows in every band.
        if (s.dutchman.present) drawLugger(ctx, SHINGLE);
      }
      if (s.cuttingHouse) {
        const cc = tileCenter(s.cuttingHouse);
        if (county) {
          drawPlaceMark(ctx, cc.x, cc.y);
        } else {
          drawCuttingHouse(ctx, s.cuttingHouse);
          if ((s.fortifications['cutting-house'] ?? 0) > 0) {
            drawFortifications(
              ctx,
              s.cuttingHouse,
              s.fortifications['cutting-house'] ?? 0,
              fortVisibility(s, 'cutting-house'),
            );
          }
        }
        if (!yard) drawLabel(ctx, 'Cutting House', cc.x, cc.y - 12, cam.zoom);
      }

      // §6.14 — the marsh's own marks: the sign, and the stone once bound.
      if (!county && s.wights.sign) drawWightSign(ctx, s.wights.sign, wightPhase);
      if (s.wights.stone) {
        if (!county) drawWightStone(ctx, s.wights.stone, wightPhase);
        const wc = tileCenter(s.wights.stone);
        if (!yard) drawLabel(ctx, 'The Wight-Stone', wc.x, wc.y - 16, cam.zoom);
      }

      // §6.14 (M5c) — the workshop's mark on its host, in the owner's orange.
      if (s.leiden.state === 'housed' && s.leiden.node) {
        const host = s.leiden.node === 'farm' ? s.farm : s.cuttingHouse;
        if (host && !county) {
          drawWorkshopBadge(ctx, host, wightPhase);
          const hc = tileCenter(host);
          if (!yard) drawLabel(ctx, 'The Workshop', hc.x, hc.y + 22, cam.zoom);
        }
      }

      // Gossip stains (spec §6.10): where the parish thinks the Revenue looks.
      // §6.14 (M5c) — with the Aetheric Telegraph, the overlay defogs: live
      // suspicion as it accrues, not yesterday's breakfast talk, and the
      // officer's chosen target marked in the Revenue's own blue.
      if (showGossipRef.current) {
        const telegraph = s.research.completed.leiden >= 3;
        const mind = telegraph ? s.revenue.suspicion : s.revenue.gossip;
        for (const [nodeId, strength] of Object.entries(mind)) {
          if (strength < 0.5) continue;
          if (nodeId === 'cutting-house' && !s.cuttingHouse) continue;
          try {
            const c = tileCenter(nodeById(nodeId, s.farm, s.cuttingHouse));
            drawGossipStain(ctx, c.x, c.y, strength);
          } catch {
            /* a stain on a node that no longer exists dries out */
          }
        }
        if (telegraph && s.revenue.officer.targetNodeId) {
          try {
            const t = tileCenter(nodeById(s.revenue.officer.targetNodeId, s.farm, s.cuttingHouse));
            ctx.strokeStyle = REVENUE_BLUE;
            ctx.lineWidth = 1.6;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(t.x - 12, t.y - 12, 24, 24);
            ctx.setLineDash([]);
            drawLabel(ctx, 'his next call', t.x, t.y - 18, cam.zoom);
          } catch {
            /* a target that no longer exists is no target */
          }
        }
      }

      // County shows flow, not vehicles: the ribbons carry the story.
      for (const cart of county ? [] : s.carts) {
        const cp = cartWorldPosOf(s, cart);
        if (!cp) continue;
        if (cart.vessel === 'sea') {
          drawLighter(ctx, cp.x, cp.y, cart.location.kind === 'edge' ? cp.angle : 0, wightPhase);
        } else if (cart.vessel === 'dyke') {
          drawTubBoat(
            ctx,
            cp.x,
            cp.y,
            cart.location.kind === 'edge' ? cp.angle : 0,
            cargoCount(cart.cargo) > 0,
          );
        } else {
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

      // The goods overlay (§20.2): a stock chip at every place that holds
      // anything, and the town's remaining appetite — bottlenecks read red.
      if (showGoodsRef.current && !county) {
        const farmStore = s.stores.farm ?? {};
        const farmCount = cargoCount(farmStore);
        const farmRows = stockRows(farmStore);
        // Playtest: the wool on the flock's backs shows WHENEVER it exists —
        // it is the first goods-fact the game has, and without it overlay A
        // draws nothing early on and its button reads as dead.
        if (s.fleeceReady > 0) {
          farmRows.push({
            text: `${s.fleeceReady} ${s.darkReady > 0 ? 'white ' : ''}wool on the sheep`,
            color: farmCount >= FARM_STORE_CAPACITY ? '#E0837A' : undefined });
        }
        if (s.darkReady > 0) {
          farmRows.push({
            text: `${s.darkReady} dark wool on the sheep`,
            color: farmCount >= FARM_STORE_CAPACITY ? '#E0837A' : DARK_WOOL_TEXT });
        }
        // §18 made visible (M5 tutorial pass): what the clutter hides, and
        // what stands showing past it — the storage-heat rule, on the map.
        const coverLine = (nodeId: NodeId): { text: string; color?: string } | null => {
          const illicit = illicitCount(s.stores[nodeId] ?? {});
          if (illicit <= 0) return null;
          const showing = Math.max(0, illicit - coverOf(s, nodeId));
          return showing > 0
            ? { text: `${showing} showing past the clutter`, color: '#E0837A' }
            : { text: `hidden in the clutter (hides ${coverOf(s, nodeId)})` };
        };
        const farmCover = coverLine('farm');
        if (farmCover) farmRows.push(farmCover);
        if (farmCount > 0 || farmRows.length > 0) {
          const fcc = tileCenter(s.farm);
          drawStockChip(
            ctx,
            fcc.x + 16,
            fcc.y - 4,
            {
              text: `barn ${farmCount}/${FARM_STORE_CAPACITY}`,
              color: FARM_STORE_CAPACITY - farmCount <= 4 ? '#E0837A' : '#CBBFA8' },
            farmRows,
          );
        }
        if (s.cuttingHouse) {
          const chStore = s.stores['cutting-house'] ?? {};
          const chCount = cargoCount(chStore);
          if (chCount > 0) {
            const chc = tileCenter(s.cuttingHouse);
            const chRows = stockRows(chStore);
            const chCover = coverLine('cutting-house');
            if (chCover) chRows.push(chCover);
            drawStockChip(
              ctx,
              chc.x + 16,
              chc.y - 4,
              {
                text: `store ${chCount}/${CUTTING_HOUSE_STORE_CAPACITY}`,
                color: CUTTING_HOUSE_STORE_CAPACITY - chCount <= 4 ? '#E0837A' : '#CBBFA8' },
              chRows,
            );
          }
        }
        const shingleStore = s.stores.shingle ?? {};
        if (cargoCount(shingleStore) > 0) {
          const shc = tileCenter(SHINGLE);
          drawStockChip(ctx, shc.x - 46, shc.y + 4, { text: 'open shingle — no cover', color: '#E0837A' }, stockRows(shingleStore));
        }
        // Ryne: what the town still buys today — wool through the book's
        // unsold balance (§6.10), contraband channels only for goods held.
        const rr: Array<{ text: string; color?: string }> = [];
        const woolLeft = Math.min(s.demandRemaining.fleece ?? 0, woolOnTheBooks(s));
        rr.push({ text: `${woolLeft} wool (the book)`, color: woolLeft === 0 ? '#E0837A' : undefined });
        for (const g of CONTRABAND) {
          if (g === 'jenever' || heldAnywhere(s, g) <= 0) continue;
          const left = s.demandRemaining[g] ?? 0;
          rr.push({ text: `${left} ${GOOD_SHORT[g]}`, color: left === 0 ? '#E0837A' : undefined });
        }
        if (
          s.carts.some(
            (c) => c.marketPatienceUntil !== undefined && c.location.kind === 'node' && c.location.nodeId === 'ryne',
          )
        ) {
          rr.push({ text: 'a cart waits, exposed', color: '#E0837A' });
        }
        const ryc = tileCenter(RYNE_CENTRE);
        drawStockChip(ctx, ryc.x + 14, ryc.y + 6, { text: 'Ryne buys today', color: '#CBBFA8' }, rr);
      }

      // Feedback motes (§20), on top of the world they comment on.
      const nowMs = performance.now();
      motesRef.current = motesRef.current.filter((m) => nowMs - m.born < moteLife(m));
      for (const m of motesRef.current) {
        if (nowMs < m.born) continue; // staggered: not yet loosed
        const mt = (nowMs - m.born) / moteLife(m);
        if (m.kind === 'wool') drawWoolMote(ctx, m.x, m.y, mt, m.sway);
        else drawCoinMote(ctx, m.x, m.y, mt);
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

  // ---- Feedback motes (§20): watch the tick-to-tick deltas and spawn ----
  useEffect(() => {
    const prev = prevFxRef.current;
    prevFxRef.current = state;
    if (!prev || state.tick < prev.tick) {
      motesRef.current = []; // fresh mount or a new tenancy: no stale petals
      return;
    }
    if (state.tick === prev.tick) return; // same-moment churn: nothing happened
    const now = performance.now();
    const spawn = (kind: Mote['kind'], at: { x: number; y: number }, n: number) => {
      for (let i = 0; i < n; i++) {
        motesRef.current.push({
          kind,
          x: at.x + Math.random() * 26 - 13,
          y: at.y - 6 + Math.random() * 10,
          born: now + i * 110,
          sway: Math.random() * Math.PI * 2 });
      }
    };

    // Wool landing in the barn — the shear, the shearer, any hand at all.
    const woolIn = (state.stores.farm?.fleece ?? 0) - (prev.stores.farm?.fleece ?? 0);
    if (woolIn > 0) spawn('wool', tileCenter(state.farm), Math.min(woolIn, 8));

    // A sale into the town's appetite (§6.9) — any good, any seller…
    let sold = 0;
    let contrabandByDemand = 0;
    for (const [g, before] of Object.entries(prev.demandRemaining) as Array<[Good, number]>) {
      const drop = (before ?? 0) - (state.demandRemaining[g] ?? 0);
      if (drop > 0) {
        sold += drop;
        if (CONTRABAND.includes(g)) contrabandByDemand += drop;
      }
    }
    // …plus the fence's back door (§6.17): contraband moved past what the
    // day's appetite explains is his doing.
    const fenced = state.contrabandSold - prev.contrabandSold - contrabandByDemand;
    const atRyne = sold + Math.max(0, fenced);
    if (atRyne > 0) spawn('coin', tileCenter(RYNE_CENTRE), Math.min(atRyne, 6));

    // The gunwale (§6.9): wool the lugger swallowed while he stood off.
    if (prev.dutchman.present && state.dutchman.present) {
      const owled = prev.dutchman.fleeceAppetite - state.dutchman.fleeceAppetite;
      if (owled > 0) spawn('coin', tileCenter(SHINGLE), Math.min(owled, 6));
    }
  }, [state]);

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
    // The stone before the sign: ties in the hit-test go to the first pushed,
    // so a ring that stands too near can never shadow the stone's menu.
    if (s.wights.stone) {
      const wc = tileCenter(s.wights.stone);
      targets.push({ sel: 'wight-stone', x: wc.x, y: wc.y, r: 16 });
    }
    if (s.wights.sign) {
      const wc = tileCenter(s.wights.sign);
      targets.push({ sel: 'wight-sign', x: wc.x, y: wc.y, r: 16 });
    }
    // §6.18 — the survey's posts, once the improver's eye has opened. Pushed
    // last, so a building or the stone always wins a crowded pixel.
    if (s.cuttingHouse) {
      for (const seg of DYKE_SEGMENTS) {
        const mid = pointAlong(seg.path.map(tileCenter), 0.5);
        targets.push({ sel: `dyke:${seg.id}`, x: mid.x, y: mid.y, r: 14 });
      }
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
  // §10 (the first morning) — the ticker's pointing sentence lives outside
  // the map; it asks, the map answers. Consumed once, then cleared.
  const focusRequest = useUiStore((sx) => sx.focusRequest);
  const clearFocus = useUiStore((sx) => sx.clearFocus);
  useEffect(() => {
    if (!focusRequest) return;
    selectPlace(focusRequest as Selection);
    clearFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // A brand-new tenancy opens LOOKING AT THE FARM — sheep, glow and all —
  // not at the county's strategic view. What is yours fills the screen; the
  // wider marsh is discovered by zooming out. Two frames in, so the render
  // loop's first setViewport has initialised the camera before we aim it
  // (focusOn before init would be clobbered by the fit).
  useEffect(() => {
    if (!isFreshGame(stateRef.current)) return;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const w = tileCenter(stateRef.current.farm);
        camRef.current!.focusOn(w.x, w.y, isPhone ? 0.3 : 0.5);
      }),
    );
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Starting over runs the clock backwards: re-aim at the new farm and open
  // the door again, exactly as a first mount would.
  const prevTickRef = useRef(state.tick);
  useEffect(() => {
    const restarted = state.tick < prevTickRef.current;
    prevTickRef.current = state.tick;
    if (!restarted || !isFreshGame(state)) return;
    const w = tileCenter(state.farm);
    camRef.current!.focusOn(w.x, w.y, isPhone ? 0.3 : 0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tick]);

  function selectPlace(sel: Selection) {
    if (sel === 'farm') farmVisitedRef.current = true;
    const w = anchorWorld(sel, stateRef.current);
    // Phone (stage 3): the menu is a bottom sheet, so the place eases into
    // the upper third and stays visible above its own card.
    if (w) camRef.current!.focusOn(w.x, w.y, isPhone ? 0.3 : 0.5);
    setSelected(sel);
  }
  // Playtest: only places you can ACT at earn a dock seat. The Customs
  // House stays on the map with its popover — the day bribes arrive, it
  // earns its seat back — but a button that does nothing teaches nothing.
  const places: Array<{ sel: Selection; label: string }> = [
    { sel: 'farm', label: 'Walland Farm' },
    { sel: 'ryne', label: 'Ryne' },
  ];
  if (state.dutchman.unlocked) places.push({ sel: 'shingle', label: 'The Shingle' });
  if (state.cuttingHouse) places.push({ sel: 'cutting-house', label: 'Cutting House' });
  if (state.wights.sign) places.push({ sel: 'wight-sign', label: 'A Ring of Stones' });
  if (state.wights.stone) places.push({ sel: 'wight-stone', label: 'The Wight-Stone' });

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

      {!placing && !state.lost && (
        // Stop pointer events reaching the shell: otherwise its pointerdown
        // captures the pointer and steals the button's click (and would start
        // a camera pan). onClick stop keeps the map's hit-test from firing too.
        // Playtest: the dock shows ALWAYS, on every width — the places are
        // the interface's fixed points, and the sell step was unfindable
        // with the door shut. Only places with verbs are listed.
        <nav
          className="location-dock"
          aria-label="Places"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {places.map((pl) => (
            <button
              key={pl.sel as string}
              className={
                selected === pl.sel
                  ? 'on'
                  : firstMorningHint(state)?.sel === pl.sel
                    ? 'breathe'
                    : undefined
              }
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

      {selected &&
        !placing &&
        (() => {
          const content = (
            <CloseCtx.Provider value={() => setSelected(null)}>
              {selected === 'farm' && <FarmMenu state={state} onPlace={() => setPlacing(true)} />}
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
              {selected === 'wight-sign' && <SignMenu state={state} />}
              {selected === 'wight-stone' && <StoneMenu state={state} />}
              {selected === 'officer' && <OfficerMenu state={state} />}
              {selected?.startsWith('dyke:') && <DykeMenu state={state} dykeId={selected.slice(5)} />}
              {selected?.startsWith('cart:') && (
                <CartMenu state={state} flooded={flooded} cartId={selected.slice(5)} />
              )}
            </CloseCtx.Provider>
          );
          // Stage 3 — one content, two presentations: the thumb's sheet on a
          // phone, the world-anchored popover on a desktop (§20).
          return isPhone ? (
            <Sheet onClose={() => setSelected(null)}>{content}</Sheet>
          ) : (
            <div ref={popRef} className="popover-anchor">
              <Popover wide={selected === 'farm'} onClose={() => setSelected(null)}>
                {content}
              </Popover>
            </div>
          );
        })()}
    </div>
  );
}

