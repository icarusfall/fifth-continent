// Eased pan/zoom camera per spec §15.2: input moves a *target*; the camera
// lerps toward it every frame and never snaps. Cursor-anchored wheel zoom,
// drag-to-pan, trackpad pinch (ctrl+wheel) for free, and true two-finger
// touch pinch via pinch(). Pure UI state, no React.

import { WORLD_H, WORLD_W } from './geometry';

const ZOOM_MAX = 8;
const ZOOM_SPEED = 0.0015; // spec §15.2
const EASE_ZOOM = 0.14;
const EASE_PAN = 0.35; // pans track the hand closely; zoom glides
const DRAG_THRESHOLD_PX = 5;

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

  /** Advance the easing one frame. */
  ease(): void {
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
