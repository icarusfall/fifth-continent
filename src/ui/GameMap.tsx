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
  CARTER_DANGER_WAGE,
  CARTER_UNLOCK_FLEECE,
  CARTER_MAX_STOPS,
  CARTER_WAGE,
  CREW_MUSTER,
  CREW_WAGE,
  MILITIA_MUSTER,
  MILITIA_WAGE,
  DUTCHMAN_TRUST_JENEVER,
  DUTCHMAN_TRUST_TEA,
  CUTS,
  CUTTING_HOUSE_COST,
  CUTTING_HOUSE_STORE_CAPACITY,
  CUT_SUGAR_COST,
  DAILY_DEMAND,
  DUTCHMAN_PRICE,
  FARM_STORE_CAPACITY,
  FENCE_PRICE_MULT,
  SMOUCH_COST,
  SMOUCH_YIELD,
  FORT_COST,
  CELLAR_COST,
  CELLAR_COVER_PER_TIER,
  DYKE_DEBT,
  DYKE_PASTURE_HEAD,
  MAX_CELLAR_TIER,
  LEIDEN_PRICE_MULT,
  MARSH_VEIL_DEBT,
  MARSH_VEIL_DIV,
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
  TRIBUTE_RELIEF,
  TUB_BOAT_COST,
  TUB_BOAT_CAPACITY,
  MAX_TUB_BOATS,
  TUB_TIDE_MIN,
  WIGHT_TRAP_IRON,
  BINDING_CAPACITY,
  WOOL_PRICE_DOMESTIC,
} from '../sim/balance';
import {
  DYKE_SEGMENTS,
  SHINGLE,
  dykeById,
  dykeTiles,
  edgeById,
  edgesFor,
  firstHop,
  horseLatency,
  isPlaceable,
  nodeById,
  officerEdgesFor,
  otherEnd,
} from '../sim/map';
import { dayPhaseOf, isFlooded, ticksUntilTideTurn, tideLevel } from '../sim/time';
import { carterWageOf, garrisonCap, reachableNodesFor, woolOnTheBooks } from '../sim/tick';
import { HEAT_RED, REVENUE_BLUE } from './palette';
import {
  dykeCost,
  dykeDays,
  dykePreview,
  dykeWaterways,
  flockCapOf,
  stoneRefuses,
} from '../sim/dykes';
import type { WaterwayPair } from '../sim/dykes';
import { CONTRABAND, coverOf, fortVisibility, illicitAnywhere, illicitCount } from '../sim/revenue';
import { GOOD_LABEL, spanOf, storeSummary } from './format';
import type {
  Action,
  Cart,
  CarterOrder,
  CarterStop,
  CutDepth,
  EdgeId,
  GameState,
  Good,
  NodeId,
} from '../sim/types';
import { useGameStore } from '../state/store';
import { CameraController } from './camera';
import { pathPoints, pointAlong, TILE, tileCenter } from './geometry';
import { getTerrainCanvas } from './paint';
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
  drawWorkshopBadge,
} from './sprites';

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

function cargoCount(cargo: Partial<Record<Good, number>>): number {
  return Object.values(cargo).reduce((a, b) => a + (b ?? 0), 0);
}

/** §6.19 — a standing order read aloud: the stops in order, each naming what
 *  he picks up there. This is the sentence the picker builds, spoken back. */
function orderLabel(state: GameState, order: CarterOrder): string {
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

/** §6.11 (M5a-4) — what a carter can bring home from each destination. The
 *  shingle's list follows the Dutchman's trust ladder (§6.9): no menu names
 *  a good he has not yet shown you. */
function backOptionsFor(state: GameState, to: NodeId): Good[] {
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
function shingleRoutesOpen(state: GameState): boolean {
  return state.dutchman.met && (state.dutchman.fleeceBought > 0 || state.contrabandSold > 0);
}

/** §10 — one-line whispers for the smuggled goods, so nothing arrives unnamed. */
const GOOD_WHISPER: Partial<Record<Good, string>> = {
  lace: 'Flanders lace — Ryne pays 24 the parcel, quietly, for about 2 a day. The Crown calls it smuggling.',
  tea: 'Bohea tea — Ryne drinks 8 chests a day at 7 the chest. The Crown calls it smuggling.',
  jenever: 'Overproof jenever — no buyer in Ryne will touch it raw. It wants cutting, and cutting wants a house.',
};

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

/** '· lanterns lit' suffix (§6.14 Marsh 1 — M5c playtest): the word is
 *  passive and the game must say when it is working. Night moves over marsh
 *  read a tenth as loud, one Debt the laden run; the button says so at the
 *  moment the choice is made. */
function lanternNote(state: GameState, edgeId: EdgeId): string {
  if (state.research.completed.marsh < 1) return '';
  if (!(edgeId === 'marsh-track' || edgeId.startsWith('cut-'))) return '';
  return dayPhaseOf(state.tick) === 'night' ? ' · lanterns lit — a tenth as loud' : '';
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

// §20.2 — the goods overlay's short names: one small chip per place, so
// "which goods are where" is read off the map, not hunted through popovers.
const GOOD_SHORT: Record<Good, string> = {
  fleece: 'wool',
  jenever: 'jenever',
  tea: 'tea',
  'bulked-tea': 'bulked tea',
  lace: 'lace',
  'brandy-rough': 'rough brandy',
  'brandy-fair': 'brandy',
  'brandy-gent': 'gent’s brandy',
};

function stockRows(store: Partial<Record<Good, number>>): Array<{ text: string; color?: string }> {
  return (Object.entries(store) as Array<[Good, number]>)
    .filter(([, n]) => n > 0)
    .map(([g, n]) => ({
      text: `${n} ${GOOD_SHORT[g]}`,
      color: CONTRABAND.includes(g) ? '#D9A6A0' : undefined, // contraband reads warm
    }));
}

/** Units of a good held anywhere the player controls — stores and carts. */
function heldAnywhere(state: GameState, good: Good): number {
  let n = 0;
  for (const k of Object.keys(state.stores)) n += state.stores[k]?.[good] ?? 0;
  for (const c of state.carts) n += c.cargo[good] ?? 0;
  return n;
}

function moteLife(m: Mote): number {
  return m.kind === 'wool' ? WOOL_MOTE_MS : COIN_MOTE_MS;
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
  // The goods overlay (spec §20.2): stock chips at every place, on by default
  // — once the hub splits the stores, "what is where" must be read at a glance.
  const [showGoods, setShowGoods] = useState(true);
  const showGoodsRef = useRef(true);
  showGoodsRef.current = showGoods;
  const hoverTileRef = useRef<{ x: number; y: number } | null>(null);
  // Feedback motes (§20): spawned by state deltas below, drawn by the loop.
  const motesRef = useRef<Mote[]>([]);
  const prevFxRef = useRef<GameState | null>(null);
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
      const served = carterRouteEdges(s);
      for (const edge of edgesFor(s.farm, s.cuttingHouse)) {
        if (served.has(edge.id)) drawCarterRoute(ctx, pathPoints(edge, false));
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
      // §6.18 (M5½a) — the survey and the water: under the buildings, over
      // the roads. The lines appear with the improver's eye (cutting house).
      if (s.cuttingHouse) {
        for (const seg of DYKE_SEGMENTS) {
          const status = s.dykesDug.includes(seg.id)
            ? 'dug'
            : s.digging?.id === seg.id
              ? 'digging'
              : 'survey';
          drawDyke(ctx, seg.path, status);
          if (status !== 'dug') {
            drawSurveyPost(ctx, pointAlong(seg.path.map(tileCenter), 0.5));
          }
        }
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

      // §6.14 — the marsh's own marks: the sign, and the stone once bound.
      const wightPhase = (performance.now() / 2600) % 1;
      if (s.wights.sign) drawWightSign(ctx, s.wights.sign, wightPhase);
      if (s.wights.stone) {
        drawWightStone(ctx, s.wights.stone, wightPhase);
        const wc = tileCenter(s.wights.stone);
        drawLabel(ctx, 'The Wight-Stone', wc.x, wc.y - 16);
      }

      // §6.14 (M5c) — the workshop's mark on its host, in the owner's orange.
      if (s.leiden.state === 'housed' && s.leiden.node) {
        const host = s.leiden.node === 'farm' ? s.farm : s.cuttingHouse;
        if (host) {
          drawWorkshopBadge(ctx, host, wightPhase);
          const hc = tileCenter(host);
          drawLabel(ctx, 'The Workshop', hc.x, hc.y + 22);
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
            drawLabel(ctx, 'his next call', t.x, t.y - 18);
          } catch {
            /* a target that no longer exists is no target */
          }
        }
      }

      for (const cart of s.carts) {
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
      if (showGoodsRef.current) {
        const farmStore = s.stores.farm ?? {};
        const farmCount = cargoCount(farmStore);
        const farmRows = stockRows(farmStore);
        if (s.fleeceReady > 0 && (farmCount >= FARM_STORE_CAPACITY || farmRows.length > 0)) {
          farmRows.push({
            text: `+${s.fleeceReady} stuck on the sheep`,
            color: farmCount >= FARM_STORE_CAPACITY ? '#E0837A' : undefined,
          });
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
              color: FARM_STORE_CAPACITY - farmCount <= 4 ? '#E0837A' : '#CBBFA8',
            },
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
                color: CUTTING_HOUSE_STORE_CAPACITY - chCount <= 4 ? '#E0837A' : '#CBBFA8',
              },
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
          sway: Math.random() * Math.PI * 2,
        });
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

      {(state.heat.regional >= 0.5 || state.revenue.officer.arrived) && (
        <button
          className={showGossip ? 'gossip-toggle on' : 'gossip-toggle'}
          title={
            state.research.completed.leiden >= 3
              ? 'The Aetheric Telegraph: the Revenue’s mind, live, and where he calls next (§6.14).'
              : "What the parish says the Revenue thinks. Yesterday's news, like all gossip."
          }
          onClick={(e) => {
            e.stopPropagation();
            setShowGossip((v) => !v);
          }}
        >
          {state.research.completed.leiden >= 3
            ? showGossip
              ? 'telegraph · on'
              : 'telegraph'
            : showGossip
              ? 'gossip · on'
              : 'gossip'}
        </button>
      )}

      <button
        className={showGoods ? 'gossip-toggle goods on-goods' : 'gossip-toggle goods'}
        title="What sits where, what the town still buys, and where the walls press — overlay A: what you are actually doing (§20.2)."
        onClick={(e) => {
          e.stopPropagation();
          setShowGoods((v) => !v);
        }}
      >
        {showGoods ? 'goods · on' : 'goods'}
      </button>

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
            {selected === 'wight-sign' && <SignMenu state={state} />}
            {selected === 'wight-stone' && <StoneMenu state={state} />}
            {selected === 'officer' && <OfficerMenu state={state} />}
            {selected?.startsWith('dyke:') && (
              <DykeMenu state={state} dykeId={selected.slice(5)} />
            )}
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

/**
 * §6.18 (M5½a) — a surveyed channel's post: the dig offered with its whole
 * price on its face (coin, days, Debt, the parish, the pasture — §21.2's
 * axis, read aloud before the spade goes in). M5½b playtest: and what it
 * JOINS, said before the price — a player digs channels to link places, and
 * the one thing the post would not tell them was which places.
 */
function DykeMenu({ state, dykeId }: { state: GameState; dykeId: string }) {
  const enqueue = useEnqueue();
  const seg = dykeById(dykeId);
  if (!seg) return null;
  const dug = state.dykesDug.includes(seg.id);
  const inHand = state.digging?.id === seg.id;
  const busy = state.digging !== null && !inHand;
  const refused = stoneRefuses(state, seg);
  const cost = dykeCost(seg);
  const short = state.coin < cost;
  // §6.18 (M5½b playtest) — the route this cut would open, one step of
  // lookahead when it opens none alone.
  const preview = dug || inHand ? null : dykePreview(state, seg.id);
  const pairName = (p: WaterwayPair) =>
    `${nodeById(p.a, state.farm, state.cuttingHouse).name} to ${
      nodeById(p.b, state.farm, state.cuttingHouse).name
    }`;
  const pairList = (pairs: WaterwayPair[]) => pairs.map(pairName).join(', and ');
  const standing = dug ? dykeWaterways(state) : [];
  return (
    <>
      <h4>{seg.name}</h4>
      {dug ? (
        <>
          <p className="flavour">
            Clean water, cut banks, and drained grazing either side. The gentry call it
            improvement; the marsh keeps its own account of it. A dyke is never filled in.
          </p>
          <p className="flavour">
            {standing.length > 0
              ? `Water you can carry on, as it stands: ${standing
                  .map((e) => e.name)
                  .join(', ')}.`
              : 'No landing yet stands at both ends of your water. Until one does, this is drainage and pasture, and no road at all.'}
          </p>
        </>
      ) : inHand ? (
        <p className="flavour">
          The crew is in it now — mud to the knees, done in about{' '}
          {Math.max(1, Math.ceil((state.digging!.doneTick - state.tick) / TICKS_PER_DAY))} day
          {Math.ceil((state.digging!.doneTick - state.tick) / TICKS_PER_DAY) === 1 ? '' : 's'}.
        </p>
      ) : (
        <>
          {/* §6.18 (M5½b playtest) — the road first, the price second: what a
              cut JOINS is the reason to dig it, and the post never said. */}
          {preview && preview.opens.length > 0 ? (
            <p className="flavour">
              <strong>Dug, this opens the water from {pairList(preview.opens)}</strong> —{' '}
              {TUB_BOAT_CAPACITY} to the load, quiet as weed, and no blue coat rides a
              channel.
            </p>
          ) : preview?.nextStep ? (
            <p className="flavour">
              Alone, this joins no landing. Cut it <em>and</em> {preview.nextStep.name} and the
              two together open {pairList(preview.nextStep.opens)} — half a road, and the
              other half is on the survey.
            </p>
          ) : preview ? (
            <p className="flavour">
              This line reaches no landing at either end, and no hull will ever use it. A
              channel is a road only where it meets a landing at both ends; some cuts are
              only pasture, and the marsh does not mind which you dig.
            </p>
          ) : null}
          <p className="flavour">
            An old line, silted a century: {dykeTiles(seg)} chains of channel wanting a crew.
            Cut it and the water runs for ever — the marsh smaller by that much ({DYKE_DEBT}{' '}
            to the account), the parish colder for the enclosure, and the drained margin
            grazing {DYKE_PASTURE_HEAD} more head.
          </p>
          <div className="menu-buttons">
            <button
              disabled={busy || refused || short}
              title={
                refused
                  ? 'The men will not put a spade in the ground by the stone.'
                  : busy
                    ? 'The crew is one crew: one dig at a time.'
                    : short
                      ? `The diggers want ${cost} coin up front, and the till is short.`
                      : 'Slow, permanent, and the whole parish will have an opinion.'
              }
              onClick={() => enqueue({ type: 'digDyke', id: seg.id })}
            >
              Cut the channel · {cost} coin · {dykeDays(seg)} days
            </button>
          </div>
          {refused && (
            <p className="flavour">
              The wight-stone stands too near this line. The men will not dig by it, and you
              would not ask twice.
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * §6.14 — the wight-sign: a ring of stones, and the trap as a deliberate
 * verb. Iron and salt in coin; the bait in sheep, rising with each binding.
 */
function SignMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const bait = state.boundWights + 1;
  const trapped = state.wights.trap !== null;
  return (
    <>
      <h4>A Ring of White Stones</h4>
      <p className="flavour">
        The grass inside lies drowned, and the sheep will not graze within a chain of it. The old
        people call it a wight-sign, and know better than to want one.
      </p>
      {/* Playtest: a second ring read as the first being reset — say plainly
          that the stone and the bound stand untouched, and this one is new. */}
      {state.boundWights > 0 && (
        <p className="flavour">
          This ring is a new one. Your stone stands where it stood, and{' '}
          {state.boundWights === 1
            ? 'the bound wight still carries'
            : `the ${state.boundWights} bound still carry`}{' '}
          the account — each ring is its own wight, and each wants its own iron.
        </p>
      )}
      {trapped ? (
        <p className="flavour">
          The trap is staked: iron, salt, and {state.wights.trap!.bait} sheep hobbled in the ring.
          You do not stay to watch. Dawn will tell.
        </p>
      ) : (
        <div className="menu-buttons">
          <button
            disabled={state.coin < WIGHT_TRAP_IRON || state.flockSize < bait}
            title={
              state.coin < WIGHT_TRAP_IRON
                ? `Iron and salt run ${WIGHT_TRAP_IRON} coin, and the till is short.`
                : state.flockSize < bait
                  ? `The trap wants ${bait} sheep staked as bait, and the flock cannot spare them.`
                  : 'At dawn the wight is bound. No roll, no maybe — the marsh keeps bargains it did not offer.'
            }
            onClick={() => enqueue({ type: 'trapWight' })}
          >
            Stake the trap · {WIGHT_TRAP_IRON} coin of iron & salt · {bait} sheep as bait
          </button>
        </div>
      )}
      <p className="flavour">
        Or leave it be. The ring does not fade, and the marsh does not forget being used either
        way.
      </p>
    </>
  );
}

/** §6.14 — marsh research, named for the stone's menu. */
const MARSH_TIERS: ReadonlyArray<{ name: string; effect: string; price: string }> = [
  {
    name: 'Marsh-lantern haulers',
    effect: 'night moves read a tenth as loud',
    price: '+1 Debt each laden night run',
  },
  {
    name: 'Wight-fog',
    effect: 'a Call in battle: the raiders fight half-blind',
    price: '+8 Debt each fog',
  },
  {
    name: 'The Hollow Way',
    effect: 'one marsh track leaves the world’s knowing',
    price: '+1 Debt each crossing, laden or empty',
  },
  {
    name: 'The Reed-Veil',
    effect: 'the reeds swallow three parts in four of every work’s showing',
    price: `+${MARSH_VEIL_DEBT} Debt per hidden building, each dawn it stands`,
  },
];

/**
 * §6.14 — the wight-stone: the account read plainly, tribute paid in sheep,
 * and the marsh tree researched where its teacher leans.
 */
function StoneMenu({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const bindings = state.boundWights * BINDING_CAPACITY;
  const over = state.debt > bindings;
  const r = state.research;
  const tier = r.completed.marsh;
  const cost = RESEARCH_COST.marsh[tier];
  return (
    <>
      <h4>The Wight-Stone</h4>
      <p className="flavour" style={{ color: over ? HEAT_RED : undefined }}>
        The account: <strong>{Math.ceil(state.debt)}</strong> owed against{' '}
        <strong>{bindings}</strong> the bound will carry ({state.boundWights} wight
        {state.boundWights === 1 ? '' : 's'} bound).
        {over
          ? ' The Debt outruns the bound. They are patient for three dawns, and then they are not.'
          : ' It never decays. Nothing about it decays.'}
      </p>
      <StoreFill count={Math.min(Math.ceil(state.debt), Math.max(bindings, 1))} cap={Math.max(bindings, 1)} />
      <div className="menu-buttons">
        <button
          disabled={state.flockSize < 1 || state.debt <= 0}
          title={
            state.debt <= 0
              ? 'The account stands at nothing.'
              : state.flockSize < 1
                ? 'The tribute is a sheep, and there are none to give.'
                : 'Hobbled at the stone tonight; gone by morning. It is always gone by morning.'
          }
          onClick={() => enqueue({ type: 'payTribute' })}
        >
          Leave a sheep in tribute · forgives {TRIBUTE_RELIEF}
        </button>
      </div>

      <h5>what the stone teaches</h5>
      {r.active?.tree === 'marsh' ? (
        <p className="flavour">
          The teaching is under way. Done in about{' '}
          {Math.max(1, Math.ceil((r.active.doneTick - state.tick) / TICKS_PER_DAY))} day
          {Math.ceil((r.active.doneTick - state.tick) / TICKS_PER_DAY) === 1 ? '' : 's'}.
        </p>
      ) : tier >= MARSH_TIERS.length ? (
        <p className="flavour">The stone has taught all it will — for now.</p>
      ) : (
        <div className="menu-buttons">
          <button
            disabled={r.active !== null || state.coin < cost}
            title={
              r.active !== null
                ? 'The bench holds one project at a time.'
                : state.coin < cost
                  ? `The work wants ${cost} coin up front, and the till is short.`
                  : `${MARSH_TIERS[tier].effect} — ${MARSH_TIERS[tier].price}. Coin is the least of what this costs.`
            }
            onClick={() => enqueue({ type: 'startResearch', tree: 'marsh' })}
          >
            Learn: {MARSH_TIERS[tier].name} · {cost} coin · {RESEARCH_DAYS.marsh[tier]} days
          </button>
        </div>
      )}
      {tier >= 1 && (
        <p className="flavour">
          Learned:{' '}
          {MARSH_TIERS.slice(0, tier)
            .map((t) => t.name)
            .join(' · ')}
          .
        </p>
      )}
      {tier >= 4 && (
        <>
          <h5>the reed-veil</h5>
          <p className="flavour">
            {state.wights.veil
              ? 'The reeds stand around your works and the mist stands with them. Every hidden building owes the marsh one, each dawn, while they hold.'
              : 'The reeds lie ready. Raised, they swallow three parts in four of every work’s showing — the fence, the walls, all of it — and the marsh charges by the dawn for the holding.'}
          </p>
          <div className="menu-buttons">
            <button
              title={
                state.wights.veil
                  ? 'The works stand showing again, and the account stops running.'
                  : `fortVisibility ÷ ${MARSH_VEIL_DIV} at every building · +${MARSH_VEIL_DEBT} Debt per hidden building each dawn. Free to raise, free to lower.`
              }
              onClick={() => enqueue({ type: 'setVeil', up: !state.wights.veil })}
            >
              {state.wights.veil ? 'Let the reeds fall' : 'Raise the veil'}
            </button>
          </div>
        </>
      )}
      {tier >= 3 && state.wights.hollowWay === null && (
        <>
          <h5>the way that is not there</h5>
          <div className="menu-buttons">
            {edgesFor(state.farm, state.cuttingHouse)
              .filter((e) => e.id === 'marsh-track' || e.id.startsWith('cut-'))
              .map((e) => (
                <button
                  key={e.id}
                  title="Exposure nothing; the blue coat never sees it; every laden crossing owes a favour."
                  onClick={() => enqueue({ type: 'designateHollowWay', edgeId: e.id })}
                >
                  Open the hollow way through {e.name.toLowerCase()}
                </button>
              ))}
          </div>
        </>
      )}
      {state.wights.hollowWay !== null && (
        <p className="flavour">
          The hollow way runs where{' '}
          {edgesFor(state.farm, state.cuttingHouse)
            .find((e) => e.id === state.wights.hollowWay)
            ?.name.toLowerCase() ?? 'a track'}{' '}
          used to. Nobody watches it, and it is never free.
        </p>
      )}
    </>
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
// Tier 2 says "firing steps", not men (spec §6.12, playtest): the works are a
// wall for §6.13's garrison to shoot from — the men are posted separately.
const FORT_TIER_LABEL = ['open ground', 'dogs & hedge', 'bolted doors & firing steps', 'gunported', 'a fortress'];

/**
 * Spec §6.12 — dig in one rung of the Trade line. The cost is coin now; the
 * cost the player learns to fear is being *seen* — the button says so.
 */
/** §6.12 (M5½ playtest) — the fort ladder's quiet twin: cover, bought. */
function CellarRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const tier = state.cellars[nodeId] ?? 0;
  const maxed = tier >= MAX_CELLAR_TIER;
  const cost = maxed ? 0 : CELLAR_COST[tier + 1];
  const canAfford = state.coin >= cost;

  return (
    <>
      <p className="flavour">
        Hides: <strong>{coverOf(state, nodeId)}</strong> of anything rest unseen here
        {tier > 0 ? ` (a cellar${tier > 1 ? ' with a false wall' : ''} under the boards)` : ''}.
        {state.informer && tier > 0
          ? ' The parish talked, but nobody ever saw this dug.'
          : ''}
      </p>
      <div className="menu-buttons">
        <button
          disabled={maxed || !canAfford}
          title={
            maxed
              ? 'Any deeper is a well.'
              : canAfford
                ? 'Dry, dark, on no plan anywhere — and the Revenue never notices, which is the point.'
                : `${cost} coin, and the till is short.`
          }
          onClick={() => enqueue({ type: 'digCellar', nodeId })}
        >
          {maxed
            ? 'The hides are dug'
            : `Dig a cellar hide · +${CELLAR_COVER_PER_TIER} cover · ${cost} coin`}
        </button>
      </div>
    </>
  );
}

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
 * Spec §6.13 — the garrison: the men behind the works. Militia are cheap and
 * break early; crew hold. Wages fall at dawn with the carter's, and a wall
 * that cannot be paid deserts — the row says all of it before the coin moves.
 */
function GarrisonRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  const g = state.garrisons[nodeId] ?? { militia: 0, crew: 0 };
  const men = g.militia + g.crew;
  const cap = garrisonCap(state, nodeId);
  const full = men >= cap;
  const wageBill = g.militia * MILITIA_WAGE + g.crew * CREW_WAGE;
  const held =
    men === 0
      ? 'nobody'
      : [
          g.militia > 0 ? `${g.militia} militia` : '',
          g.crew > 0 ? `${g.crew} crew` : '',
        ]
          .filter(Boolean)
          .join(', ');
  return (
    <>
      <p className="flavour">
        The wall: <strong>{held}</strong> ({men}/{cap} quartered).{' '}
        {men === 0
          ? 'Works without men stop nothing — a raid walks in over empty steps.'
          : `Wages at dawn: ${wageBill} coin. A wall that cannot be paid deserts.`}
      </p>
      {/* §6.13 / §14 — the difference, on the face (read-the-charge rule):
          the smuggler's price buys alpha AND nerve, and the card must say so. */}
      <p className="flavour">
        A militiaman is a marsh farmer with a fowling piece: he shoots at half a
        smuggler&rsquo;s rate and runs at twice the losses — he has a family to get back
        to. A smuggler is armed, willing, and stays for the worst of it. Cheap walls
        waver; dear walls hold.
      </p>
      <div className="menu-buttons">
        <button
          disabled={full || state.coin < MILITIA_MUSTER}
          title={
            full
              ? 'No more quarters. Dig in deeper to hold a larger garrison.'
              : state.coin < MILITIA_MUSTER
                ? `${MILITIA_MUSTER} coin to raise, and the till is short.`
                : 'Fowling pieces and families: cheap, and they break early.'
          }
          onClick={() => enqueue({ type: 'raiseGarrison', nodeId, kind: 'militia' })}
        >
          Post a militiaman · {MILITIA_MUSTER} coin · {MILITIA_WAGE}/day
        </button>
        <button
          disabled={full || state.coin < CREW_MUSTER}
          title={
            full
              ? 'No more quarters. Dig in deeper to hold a larger garrison.'
              : state.coin < CREW_MUSTER
                ? `${CREW_MUSTER} coin to raise, and the till is short.`
                : 'Armed, willing, experienced — they hold the wall.'
          }
          onClick={() => enqueue({ type: 'raiseGarrison', nodeId, kind: 'crew' })}
        >
          Post a smuggler · {CREW_MUSTER} coin · {CREW_WAGE}/day
        </button>
        {g.militia > 0 && (
          <button onClick={() => enqueue({ type: 'dismissGarrison', nodeId, kind: 'militia' })}>
            Stand a militiaman down
          </button>
        )}
        {g.crew > 0 && (
          <button onClick={() => enqueue({ type: 'dismissGarrison', nodeId, kind: 'crew' })}>
            Stand a smuggler down
          </button>
        )}
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
  const room = flockCapOf(state) - state.flockSize - state.sheepArriving;
  return (
    <>
      <p className="flavour">
        The pasture holds {flockCapOf(state)}
        {state.dykesDug.length > 0 ? ' (the drained land grazes more)' : ''}. More sheep, more
        wool, more alibi — and Ryne buys only so much honest fleece.
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

/** Spec §6.14 — the bench: one project at a time; trade tier 1 in M5a.
 *  Offered once contraband has touched your hands (§10, playtest): hollow
 *  floors mean nothing to a farmer who has nothing to hide. */
function BenchRow({ state }: { state: GameState }) {
  const enqueue = useEnqueue();
  const r = state.research;
  if (
    !r.active &&
    r.completed.trade < 1 &&
    !(state.dutchman.unlocked && (state.contrabandSold > 0 || illicitAnywhere(state) > 0))
  ) {
    return null;
  }
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

// §6.14 (M5c) — the leiden ladder, for the workshop's menu. Coin is nominal;
// the price column is the letter each tier wants sent.
const LEIDEN_TIERS: ReadonlyArray<{ name: string; effect: string; price: string }> = [
  {
    name: 'Galvanic fence',
    effect: 'the workshop’s men kill the better',
    price: 'the wired wall reads for miles',
  },
  {
    name: 'Steam-lighter',
    effect: 'a hull, sixteen tubs, no bedtime — the sea lane opens',
    price: 'the engine is loud over water',
  },
  {
    name: 'Aetheric Telegraph',
    effect: 'the overlay defogs — the Revenue’s mind, live',
    price: 'the largest letter of all',
  },
];

/**
 * §6.14 (M5c) — the workshop: Leiden's bench, in the building that houses
 * him. Research here, and the strongbox's held letters when there are any.
 */
function WorkshopRow({ state, nodeId }: { state: GameState; nodeId: NodeId }) {
  const enqueue = useEnqueue();
  if (state.leiden.state !== 'housed' || state.leiden.node !== nodeId) return null;
  const r = state.research;
  const tier = r.completed.leiden;
  const held = state.leiden.heldLetters.length;
  const benchBusy = r.active !== null;
  const downedTools = held >= 3;
  return (
    <>
      <h5>the workshop</h5>
      <p className="flavour">
        The philosopher keeps his bench behind the hides, and the room smells of storms.
        {tier > 0 &&
          ` Learned: ${LEIDEN_TIERS.slice(0, tier)
            .map((t) => t.name)
            .join(' · ')}.`}
      </p>
      {state.leiden.letterPending !== null && (
        <p className="flavour">A letter sits sealed on the bench. He will not work past it.</p>
      )}
      {tier < LEIDEN_TIERS.length && state.leiden.letterPending === null && (
        <div className="menu-buttons">
          <button
            disabled={benchBusy || downedTools || state.coin < RESEARCH_COST.leiden[tier]}
            title={
              benchBusy
                ? 'The bench holds one project at a time.'
                : downedTools
                  ? 'Three letters sit in your strongbox. He has downed tools until one goes out.'
                  : state.coin < RESEARCH_COST.leiden[tier]
                    ? `The work wants ${RESEARCH_COST.leiden[tier]} coin up front, and the till is short.`
                    : `${LEIDEN_TIERS[tier].effect} — ${LEIDEN_TIERS[tier].price}. And a letter will want sending.`
            }
            onClick={() => enqueue({ type: 'startResearch', tree: 'leiden' })}
          >
            Learn: {LEIDEN_TIERS[tier].name} · {RESEARCH_COST.leiden[tier]} coin ·{' '}
            {RESEARCH_DAYS.leiden[tier]} days
          </button>
        </div>
      )}
      {held > 0 && (
        <div className="menu-buttons">
          <button
            title="The floor rises late — late news from this parish is still news."
            onClick={() => enqueue({ type: 'releaseLetter' })}
          >
            Let an old letter out of the strongbox · {held} held
          </button>
        </div>
      )}
    </>
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
              state.carts.filter((c) => !c.vessel).length < MAX_CARTS && (
                <button
                  disabled={state.coin < CART_COST}
                  title="Cart, pony, and no questions from the wheelwright."
                  onClick={() => enqueue({ type: 'buyCart' })}
                >
                  Buy a cart · {CART_COST} coin
                </button>
              )}
            {/* §6.18 (M5½b) — a hull, not a stall: offered once water runs. */}
            {dykeWaterways(state).length > 0 &&
              state.carts.filter((c) => c.vessel === 'dyke').length < MAX_TUB_BOATS && (
                <button
                  disabled={state.coin < TUB_BOAT_COST}
                  title="Flat-bottomed, quiet as weed, and twelve tubs to the load. It rides the waterways you have dug, when the tide gives them depth."
                  onClick={() => enqueue({ type: 'buyTubBoat' })}
                >
                  Buy a tub-boat · {TUB_BOAT_COST} coin
                </button>
              )}
          </div>
        </div>

        <div>
          <h5>works &amp; men</h5>
          {/* Fortification appears once you have something worth guarding (§10). */}
          {state.dutchman.unlocked && <FortifyRow state={state} nodeId="farm" />}
          {/* §6.12 — the quiet twin, same gate as the works (§10). */}
          {state.dutchman.unlocked && <CellarRow state={state} nodeId="farm" />}
          {/* §6.13 — the men behind the works, same gate as the works. */}
          {state.dutchman.unlocked && <GarrisonRow state={state} nodeId="farm" />}
          {/* §6.14 M5c — the workshop, if the philosopher is behind these hides. */}
          <WorkshopRow state={state} nodeId="farm" />

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
      {/* §10 — no contraband is named before the player holds any: the
          appetite board grows a channel the day its good first exists. */}
      <p className="flavour">
        The town will still take today —{' '}
        {(Object.keys(DAILY_DEMAND) as Good[])
          .filter(
            (g) =>
              DAILY_DEMAND[g] > 0 &&
              // A contraband channel is named only while its good is actually
              // in your hands somewhere — no spoilers, nothing stale (§10).
              (!CONTRABAND.includes(g) || heldAnywhere(state, g) > 0),
          )
          .map((g) => `${GOOD_LABEL[g]} ${state.demandRemaining[g] ?? 0}/${DAILY_DEMAND[g]}`)
          .join(' · ')}
        .{' '}
        {state.contrabandSold > 0 || illicitAnywhere(state) > 0
          ? 'Sell past the day’s appetite and the rest waits exposed — unless a fence takes it.'
          : 'Sell past the day’s appetite and the rest waits for dawn.'}
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
  const waiting = useGameStore((s) => s.waitingForLugger);
  const setWaiting = useGameStore((s) => s.setWaitingForLugger);
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
        <>
          <p className="flavour">
            Shingle and grey water. They say a lugger stands off here some nights — after dark, on
            a falling tide, while the Customs House is counting other things.
          </p>
          <div className="menu-buttons">
            {/* §6.9 (playtest) — no foot-tapping: run the hours until he shows,
                a card interrupts, or dawn calls the vigil off. */}
            <button
              title={
                waiting
                  ? 'The hours are running. Any speed button also calls it off.'
                  : 'The clock runs fast until the lugger stands off — or dawn, if he never comes. Nothing is skipped: cards still interrupt.'
              }
              onClick={() => setWaiting(!waiting)}
            >
              {waiting ? 'Waiting on the water… · call it off' : 'Wait for the lugger · let the hours run'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="flavour">
            The Dutchman. {beachPrice} coin the fleece, and he&rsquo;ll take {d.fleeceAppetite}{' '}
            more tonight. Coin on the nail; no credit, no names, no questions in either direction.
            {!d.met
              ? ' He came to meet you, and he will wait the night out.'
              : ' Gone when the tide turns — he minds it better than you do.'}
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
      <CellarRow state={state} nodeId="cutting-house" />
      <GarrisonRow state={state} nodeId="cutting-house" />
      <WorkshopRow state={state} nodeId="cutting-house" />

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
            title={
              can <= 0
                ? 'No room in the cart, or no coin. He does not give credit.'
                : GOOD_WHISPER[good]
            }
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
  // §6.14 (M5c) — the lighter answers only the sea lane: its buttons are its
  // own, and no cart is ever offered the water.
  if (cart.vessel === 'sea') {
    if (nodeId === 'shingle') {
      btns.push(
        <button
          key="sea"
          title="Steam minds neither tide nor night. Every ear on the coast minds the steam."
          onClick={() => send(cart.id, 'sea-lane')}
        >
          Steam for Ryne&rsquo;s quay · the sea lane
        </button>,
      );
    } else if (nodeId === 'ryne') {
      btns.push(
        <button
          key="sea"
          title="Steam minds neither tide nor night. Every ear on the coast minds the steam."
          onClick={() => send(cart.id, 'sea-lane')}
        >
          Steam for the shingle · the sea lane
        </button>,
      );
    }
    return btns;
  }
  // §6.18 (M5½b) — the tub-boat answers the waterways from this landing.
  if (cart.vessel === 'dyke') {
    for (const w of dykeWaterways(state)) {
      if (w.a !== nodeId && w.b !== nodeId) continue;
      const farEnd = w.a === nodeId ? w.b : w.a;
      const lowWater = tideLevel(state.tick) < TUB_TIDE_MIN;
      btns.push(
        <button
          key={w.id}
          disabled={lowWater}
          title={
            lowWater
              ? 'The channel wants more tide under the keel. It will come.'
              : 'Quiet as weed, and nobody counts what moves under the banks.'
          }
          onClick={() => send(cart.id, w.id)}
        >
          Pole {name} down {w.name.toLowerCase()} — to{' '}
          {nodeById(farEnd, state.farm, state.cuttingHouse).name}
          {lowWater ? ' · waits on the tide' : ''}
        </button>,
      );
    }
    return btns;
  }
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
            {lanternNote(state, 'marsh-track')}
          </button>,
        );
      }
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-farm-track')}>
            Send {name} to the cutting house{coatNote(state, 'cut-farm-track', 'farm')}
            {lanternNote(state, 'cut-farm-track')}
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
            {lanternNote(state, 'cut-ryne-track')}
          </button>,
        );
      }
      break;
    }
    case 'shingle': {
      btns.push(
        <button key="marsh" onClick={() => send(cart.id, 'marsh-track')}>
          Home over the marsh{coatNote(state, 'marsh-track', 'shingle')}
          {lanternNote(state, 'marsh-track')}
        </button>,
      );
      if (state.cuttingHouse) {
        btns.push(
          <button key="cut" onClick={() => send(cart.id, 'cut-shingle-track')}>
            To the cutting house{coatNote(state, 'cut-shingle-track', 'shingle')}
            {lanternNote(state, 'cut-shingle-track')}
          </button>,
        );
      }
      break;
    }
    case 'cutting-house': {
      btns.push(
        <button key="ryne" onClick={() => send(cart.id, 'cut-ryne-track')}>
          Send to Ryne{coatNote(state, 'cut-ryne-track', 'cutting-house')}
          {lanternNote(state, 'cut-ryne-track')}
        </button>,
        <button key="farm" onClick={() => send(cart.id, 'cut-farm-track')}>
          Send home to the farm{coatNote(state, 'cut-farm-track', 'cutting-house')}
          {lanternNote(state, 'cut-farm-track')}
        </button>,
        <button key="shingle" onClick={() => send(cart.id, 'cut-shingle-track')}>
          Send to the shingle{coatNote(state, 'cut-shingle-track', 'cutting-house')}
          {lanternNote(state, 'cut-shingle-track')}
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
    /** The stops answered so far. */
    stops: CarterStop[];
    /** A stop chosen but not yet answered ("and what does he pick up there?"). */
    where?: NodeId;
    /** The stop whose load cap is being asked about (§6.11's wool-split lever). */
    capFor?: number;
  } | null>(null);
  const carts = stable
    ? state.carts
    : state.carts.filter((c) => c.location.kind === 'node' && c.location.nodeId === nodeId);
  if (carts.length === 0) return null;

  const hire = (cartId: string, stops: CarterStop[]) => {
    enqueue({ type: 'hireCarter', cartId, order: { stops } });
    setHiring(null);
    // A directed cart is dealt with: if that was the last undirected one, the
    // visit is over (§20). Re-orders never empty the yard (the cart was
    // already crewed), so they leave the menu open.
    if (undirectedCartsAt(state, nodeId, cartId) === 0) close();
  };

  /** Add the stop just answered. The first load asks its cap (the wool-split
   *  lever, §6.11); later stops take what they can and go on. */
  const addStop = (at: NodeId, take: Good | undefined, fenceRest?: boolean) => {
    if (!hiring) return;
    const stop: CarterStop = { at };
    if (take !== undefined) stop.take = take;
    if (fenceRest) stop.fenceRest = true;
    const stops = [...hiring.stops, stop];
    const firstLoad = take !== undefined && !hiring.stops.some((x) => x.take !== undefined);
    setHiring({
      cartId: hiring.cartId,
      stops,
      ...(firstLoad ? { capFor: stops.length - 1 } : {}),
    });
  };

  const setCap = (max: number | undefined) => {
    if (!hiring || hiring.capFor === undefined) return;
    const at = hiring.capFor;
    setHiring({
      cartId: hiring.cartId,
      stops: hiring.stops.map((s, i) => (i === at && max !== undefined ? { ...s, max } : s)),
    });
  };

  // §6.11 / §10 — a carter is offered only once the manual round is a felt
  // chore: two cart-loads sold by hand, or crime already begun (by which point
  // you have hauled plenty). Before that, automation would only overwhelm.
  const carterAvailable =
    state.dutchman.unlocked || (state.ledger.soldLawfully >= CARTER_UNLOCK_FLEECE);

  // A standing order loads from a node: what it can haul, and where to. The
  // shingle is named only once the Dutchman is (§6.11) — no menu speaks of
  // the trade before the coast has.
  /**
   * §6.19 — the KNOWLEDGE gate, which replaces the old stock gate. A stop may
   * name any good the player knows of, whether or not one sits in the store
   * today: an order is a sentence about the future, and the second cart of a
   * relay has to be writable before the first has run. What gates a good is
   * the ladder the game already climbs (§10 — no menu names a good before the
   * coast or the still has), never a barn's contents this instant.
   */
  const knownGoods = (): Good[] => {
    const goods: Good[] = ['fleece'];
    if (state.dutchman.met) goods.push('lace');
    if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_TEA) goods.push('tea');
    if (state.dutchman.fleeceBought >= DUTCHMAN_TRUST_JENEVER) goods.push('jenever');
    if (state.cuttingHouse) {
      goods.push('bulked-tea', 'brandy-rough', 'brandy-fair', 'brandy-gent');
    }
    return goods;
  };
  /** What he can pick up at a stop: off the lugger at the shingle, out of the
   *  store anywhere that keeps one. A market sells; it does not supply. */
  const takeOptionsAt = (at: NodeId): Good[] =>
    at === 'shingle' ? backOptionsFor(state, 'shingle') : at === 'ryne' ? [] : knownGoods();
  // §6.18 (M5½b playtest) — a hull answers only its own element. The picker
  // asks the sim which nodes this cart could ever reach and greys the rest
  // with the reason: a tub ordered to a landlocked node used to take the
  // order, refuse the dispatch, and idle. (The lighter had this bug too.)
  const adriftFor = (cart: Cart, from: NodeId, to: NodeId): string | null => {
    if (!cart.vessel) return null;
    if (reachableNodesFor(state, cart, from).includes(to)) return null;
    return cart.vessel === 'sea'
      ? 'No sea lane runs there. Steam does not climb mud.'
      : 'No water of yours runs there yet. Dig the channels that join these two, and the tub will go.';
  };
  /**
   * §6.19 — where the round may call next: never the stop it already stands
   * on, never past CARTER_MAX_STOPS, and the shingle only once the coast has
   * spoken (§6.11's gate, §10). Unreachable-for-this-hull nodes come back with
   * their reason rather than vanishing.
   */
  const nextNodesFor = (
    cart: Cart,
    stops: CarterStop[],
  ): Array<{ node: NodeId; adrift: string | null }> => {
    if (stops.length >= CARTER_MAX_STOPS) return [];
    const last = stops.length > 0 ? stops[stops.length - 1].at : null;
    const here = cart.location.kind === 'node' ? cart.location.nodeId : 'farm';
    return (['farm', 'ryne', 'shingle', 'cutting-house'] as NodeId[])
      .filter(
        (n) =>
          n !== last &&
          (n !== 'cutting-house' || state.cuttingHouse) &&
          (n !== 'shingle' || shingleRoutesOpen(state) || state.dutchman.unlocked),
      )
      .map((node) => ({ node, adrift: adriftFor(cart, last ?? here, node) }));
  };
  /** §6.19's refusals, asked before the button is offered rather than after:
   *  two stops at least, and something picked up somewhere. */
  const roundIsSayable = (stops: CarterStop[]): boolean =>
    stops.length >= 2 && stops.some((s) => s.take !== undefined);

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
                ? ` · standing order: ${orderLabel(state, cart.carter)}, and round again — ${carterWageOf(
                    cart.carter,
                  )} coin a day${
                    carterWageOf(cart.carter) > CARTER_WAGE ? ' (danger money)' : ''
                  }. ` +
                  (cart.carter.stops.some((s) => s.at === 'shingle')
                    ? 'He deals over the gunwale when the lugger stands off, and waits when it does not.'
                    : 'He minds the tide and nothing else.')
                : ' · no carter — yours to drive'}
            </p>
            <div className="menu-buttons">
              {drivable && cargoButtons(nodeId, state, cart, enqueue)}
              {drivable && roadButtons(nodeId, state, cart, send, flooded)}
              {hiring?.cartId === cart.id ? (
                hiring.capFor !== undefined ? (
                  // §6.11 (M5b playtest) — the load cap: how much of the shared
                  // store each round may take. The wool-split lever.
                  <>
                    <button onClick={() => setCap(undefined)}>…as much as he can carry</button>
                    <button
                      title="Half the cart, so the barn keeps enough for the other round."
                      onClick={() => setCap(cart.capacity / 2)}
                    >
                      …no more than {cart.capacity / 2} a run
                    </button>
                    <button
                      title="A token load — the alibi, not the trade."
                      onClick={() => setCap(cart.capacity / 4)}
                    >
                      …no more than {cart.capacity / 4} a run
                    </button>
                    {/* Playtest 2026-08: the old picker offered a way out on
                        its first step only, so a mis-click had to be clicked
                        through to the end. Every step can be left. */}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                ) : hiring.where !== undefined ? (
                  // What he picks up at the stop just named. §6.19 — the goods
                  // offered are the ones the PLAYER KNOWS, not the ones that
                  // happen to be in the store this instant: an order is a
                  // sentence about the future, and the second cart of a relay
                  // must be writable before the first has run.
                  <>
                    {takeOptionsAt(hiring.where).map((good) => {
                      const inStore = (state.stores[hiring.where!]?.[good] ?? 0) > 0;
                      const beach = hiring.where === 'shingle';
                      return (
                        <button
                          key={good}
                          title={
                            beach
                              ? `${GOOD_WHISPER[good] ?? ''} He buys with the coin in the till, to the cart’s room. No credit, and no keeping back the rent.`
                              : inStore
                                ? GOOD_WHISPER[good]
                                : 'None there today — he loads what he finds, and lies waiting when he finds none.'
                          }
                          onClick={() => addStop(hiring.where!, good)}
                        >
                          {beach ? 'Take' : 'Load'} {GOOD_LABEL[good]} at{' '}
                          {nodeById(hiring.where!, state.farm, state.cuttingHouse).name}
                          {!beach && !inStore ? ' · none there today' : ''}
                        </button>
                      );
                    })}
                    <button
                      title="He calls, unloads what he is carrying, and goes on. This is how a load is delivered somewhere that is not the end of the round."
                      onClick={() => addStop(hiring.where!, undefined)}
                    >
                      …just call at {nodeById(hiring.where, state.farm, state.cuttingHouse).name} and
                      unload
                    </button>
                    {hiring.where === 'ryne' && (
                      <button
                        title="The whole remainder, round the back, at the haircut — the carter looks away, then goes on."
                        onClick={() => addStop('ryne', undefined, true)}
                      >
                        …sell at Ryne, and the fence takes the remainder
                      </button>
                    )}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                ) : (
                  // Where next? The round is a loop, so the last stop is
                  // followed by the first — "and home again" is not a stop.
                  <>
                    {nextNodesFor(cart, hiring.stops).map(({ node, adrift }) => (
                      <button
                        key={node}
                        disabled={!!adrift}
                        title={adrift ?? undefined}
                        onClick={() => setHiring({ ...hiring, where: node })}
                      >
                        {hiring.stops.length === 0 ? 'Start the round at' : '…then on to'}{' '}
                        {nodeById(node, state.farm, state.cuttingHouse).name}
                        {node === 'shingle' ? ' · danger money' : ''}
                        {adrift ? ' · no way there for this hull' : ''}
                      </button>
                    ))}
                    {roundIsSayable(hiring.stops) && (
                      <button
                        title="The round closes: from the last stop he goes back to the first, and round again."
                        onClick={() => hire(cart.id, hiring.stops)}
                      >
                        …and that is the round — {orderLabel(state, { stops: hiring.stops })} ·{' '}
                        {carterWageOf({ stops: hiring.stops })} coin a day
                      </button>
                    )}
                    {hiring.stops.length >= CARTER_MAX_STOPS && (
                      <p className="flavour">
                        Four calls is as long a sentence as a man will hold in his head.
                      </p>
                    )}
                    <button onClick={() => setHiring(null)}>Never mind — leave the order</button>
                  </>
                )
              ) : cart.carter ? (
                <>
                  {/* §6.17 (M5½ playtest) — the fence over the carter's
                      shoulder: a crewed cart stuck on the appetite can be
                      emptied by hand at the market, and the man simply turns
                      for home. */}
                  {present &&
                    nodeId === 'ryne' &&
                    CONTRABAND.filter(
                      (g) => (cart.cargo[g] ?? 0) > 0 && RYNE_PRICE[g] > 0,
                    ).map((g) => {
                      const n = cart.cargo[g] ?? 0;
                      const fencePrice = Math.round(RYNE_PRICE[g] * FENCE_PRICE_MULT);
                      return (
                        <button
                          key={`fence-${g}`}
                          title="The whole remainder, round the back, at once — the carter looks away, then turns for home."
                          onClick={() => enqueue({ type: 'sellToFence', cartId: cart.id, good: g })}
                        >
                          Fence the remaining {n} {GOOD_LABEL[g]} · {n * fencePrice} coin
                        </button>
                      );
                    })}
                  <button
                    title="The same man keeps the reins; the round is written afresh."
                    onClick={() => setHiring({ cartId: cart.id, stops: [] })}
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
                  {/* §6.19 — one door into the picker, and the round is
                      written a stop at a time from there. The old menu offered
                      a button per good in the barn, which is where the stock
                      gate leaked into the UI in the first place. */}
                  <button
                    title="Where he calls, and what he picks up at each — any loop among the known places, up to four calls."
                    onClick={() => setHiring({ cartId: cart.id, stops: [] })}
                  >
                    Hire a carter, and write him a round · {CARTER_WAGE} coin a day
                    {shingleRoutesOpen(state) || state.dutchman.unlocked
                      ? `, ${CARTER_DANGER_WAGE} if it touches the coast`
                      : ''}
                  </button>
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

  // §6.18 — the world's ways include the dug waterways (the tub rides them).
  const edge = [...edgesFor(state.farm, state.cuttingHouse), ...dykeWaterways(state)].find(
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
            A carter holds the reins: {orderLabel(state, cart.carter)}, and round again —{' '}
            {carterWageOf(cart.carter)} coin a day. He minds the tide and nothing else — not even
            the blue coat.
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
