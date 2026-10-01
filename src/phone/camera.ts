// Eased pan/zoom camera per spec §15.2: input moves a *target*; the camera
// lerps toward it every frame and never snaps. Cursor-anchored wheel zoom,
// drag-to-pan, trackpad pinch (ctrl+wheel) for free, and true two-finger
// touch pinch via pinch(). Pure UI state, no React.

import { APRON_TILES, TILE, WORLD_H, WORLD_W } from '../shared/geometry';

const ZOOM_MAX = 8;
const ZOOM_SPEED = 0.0015; // spec §15.2
const EASE_ZOOM = 0.14;
const EASE_PAN = 0.35; // pans track the hand closely; zoom glides
const DRAG_THRESHOLD_PX = 5;
// §15.2 — the world has no visible edge: this much of min(view, world) must
// stay on screen, and the viewport never leaves the painted apron.
const OVERLAP = 0.55;
const APRON_PX = APRON_TILES * TILE;

export class CameraController {
  // current (rendered) camera
  x = 0;
  y = 0;
  zoom = 1;
  // target camera
  tx = 0;
  ty = 0;
  tzoom = 1;

  private vw = 800;
  private vh = 600;
  private fitZoom = 1;
  private initialised = false;

  private dragStart: { sx: number; sy: number; camX: number; camY: number } | null = null;
  private dragged = false;

  setViewport(w: number, h: number): void {
    this.vw = Math.max(1, w);
    this.vh = Math.max(1, h);
    this.fitZoom = Math.min(this.vw / WORLD_W, this.vh / WORLD_H);
    if (!this.initialised) {
      this.initialised = true;
      this.tzoom = this.zoom = this.fitZoom;
      this.tx = this.x = (WORLD_W - this.vw / this.zoom) / 2;
      this.ty = this.y = (WORLD_H - this.vh / this.zoom) / 2;
    }
  }

  /**
   * Ease the camera so a world point comes to rest at the viewport centre, at
   * a comfortable inspection zoom — never zooming *out* from where the player
   * already is. Used by the location dock (spec §20): click the name, and the
   * map glides to the place. It moves only the target; ease() does the gliding.
   */
  /** `atY` (stage 3): where the point comes to rest vertically, as a fraction
   *  of the viewport — 0.5 is centre; ~0.3 leaves the lower half clear for a
   *  phone's bottom sheet, so the place stays in view above its own menu. */
  focusOn(wx: number, wy: number, atY = 0.5): void {
    const z = Math.min(ZOOM_MAX, Math.max(this.tzoom, this.fitZoom * 1.7));
    this.tzoom = z;
    this.tx = wx - this.vw / (2 * z);
    this.ty = wy - (this.vh * atY) / z;
  }

  /** The fitted zoom (whole world in view) — the LOD bands are read off
   *  zoom relative to this (§15.2, stage 5). */
  get fit(): number {
    return this.fitZoom;
  }

  /** §15.2 — one axis of the world's-edge clamp: keep over half of
   *  min(view, world) on screen, never leave the painted apron; an inverted
   *  range (a viewport wider than apron + world + apron) centres the world.
   *  Applied to the *target*, so the ease turns a hard wall into a glide. */
  private clampAxis(t: number, span: number, world: number): number {
    const keep = OVERLAP * Math.min(span, world);
    const lo = Math.max(keep - span, -APRON_PX);
    const hi = Math.min(world - keep, world + APRON_PX - span);
    return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, t));
  }

  /** Advance the easing one frame. */
  ease(): void {
    this.tx = this.clampAxis(this.tx, this.vw / this.tzoom, WORLD_W);
    this.ty = this.clampAxis(this.ty, this.vh / this.tzoom, WORLD_H);
    this.x += (this.tx - this.x) * EASE_PAN;
    this.y += (this.ty - this.y) * EASE_PAN;
    this.zoom += (this.tzoom - this.zoom) * EASE_ZOOM;
    if (Math.abs(this.tzoom - this.zoom) < 1e-4) this.zoom = this.tzoom;
    if (Math.abs(this.tx - this.x) < 0.01) this.x = this.tx;
    if (Math.abs(this.ty - this.y) < 0.01) this.y = this.ty;
  }

  /** Cursor-anchored zoom (spec §15.2), applied to the target camera. */
  wheel(deltaY: number, sx: number, sy: number, deltaMode = 0): void {
    // Normalise: line-mode wheels (some mice/browsers) report ~3 lines per
    // notch; clamp so one violent notch cannot jump the target far.
    let dy = deltaMode === 1 ? deltaY * 33 : deltaY;
    dy = Math.max(-80, Math.min(80, dy));
    const worldBeforeX = this.tx + sx / this.tzoom;
    const worldBeforeY = this.ty + sy / this.tzoom;
    const minZoom = this.fitZoom * 0.85;
    this.tzoom = Math.min(ZOOM_MAX, Math.max(minZoom, this.tzoom * (1 - dy * ZOOM_SPEED)));
    const worldAfterX = this.tx + sx / this.tzoom;
    const worldAfterY = this.ty + sy / this.tzoom;
    this.tx += worldBeforeX - worldAfterX;
    this.ty += worldBeforeY - worldAfterY;
  }

  /**
   * Two-finger pinch: the wheel's midpoint-anchored zoom math, driven by a
   * scale factor, plus the midpoint's own travel as a pan. A pinch is a
   * gesture, never a click — it marks the interaction as a drag.
   */
  pinch(sx: number, sy: number, scale: number, panDx: number, panDy: number): void {
    this.dragged = true;
    this.tx -= panDx / this.tzoom;
    this.ty -= panDy / this.tzoom;
    const worldBeforeX = this.tx + sx / this.tzoom;
    const worldBeforeY = this.ty + sy / this.tzoom;
    const minZoom = this.fitZoom * 0.85;
    this.tzoom = Math.min(ZOOM_MAX, Math.max(minZoom, this.tzoom * scale));
    const worldAfterX = this.tx + sx / this.tzoom;
    const worldAfterY = this.ty + sy / this.tzoom;
    this.tx += worldBeforeX - worldAfterX;
    this.ty += worldBeforeY - worldAfterY;
  }

  /**
   * Re-anchor panning mid-gesture (a second finger lifted): the surviving
   * finger takes over the drag without resetting the click suppression that
   * pinch() set.
   */
  reanchor(sx: number, sy: number): void {
    this.dragStart = { sx, sy, camX: this.tx, camY: this.ty };
  }

  pointerDown(sx: number, sy: number): void {
    this.dragged = false;
    this.dragStart = { sx, sy, camX: this.tx, camY: this.ty };
  }

  pointerMove(sx: number, sy: number): void {
    if (!this.dragStart) return;
    const dx = sx - this.dragStart.sx;
    const dy = sy - this.dragStart.sy;
    if (!this.dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) this.dragged = true;
    if (this.dragged) {
      this.tx = this.dragStart.camX - dx / this.tzoom;
      this.ty = this.dragStart.camY - dy / this.tzoom;
    }
  }

  pointerUp(): void {
    this.dragStart = null;
    // dragged persists until the click event has been inspected.
  }

  wasDrag(): boolean {
    return this.dragged;
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }
}
