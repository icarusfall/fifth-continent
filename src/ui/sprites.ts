// Layer 1 (spec §15.1): buildings, carts, sheep, roads — drawn every frame
// in world coordinates (the camera transform is already applied). Flat
// fills, ink outlines, deterministic wobble. Line widths are world-space,
// so outlines scale with the camera as the spec asks.

import { hash2, jitter, TILE, tileCenter } from './geometry';
import { CLAY, DYKE, INK, LIMEWASH, MARSH_DARK, ROOF, SEA } from './palette';
import { mix } from './paint';

const OUT = 1.6; // outline width at world scale

interface HouseOpts {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  roof?: string;
  salt?: number;
}

export function drawHouse(ctx: CanvasRenderingContext2D, o: HouseOpts): void {
  const { cx, cy, w = 16, h = 12, roof = ROOF, salt = 0 } = o;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const wallH = h * 0.32;
  const j = (s: number, amp = 1) => jitter(Math.round(cx), Math.round(cy), salt + s, amp);

  // front wall
  ctx.fillStyle = LIMEWASH;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.rect(x, y + h - wallH, w, wallH);
  ctx.fill();
  ctx.stroke();

  // roof plane
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(x + j(1), y + h - wallH);
  ctx.lineTo(x + w + j(2), y + h - wallH);
  ctx.lineTo(x + w - 2 + j(3), y + j(4));
  ctx.lineTo(x + 2 + j(5), y + j(6));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // ridge
  ctx.strokeStyle = 'rgba(36,28,24,0.45)';
  ctx.lineWidth = OUT * 0.5;
  ctx.beginPath();
  ctx.moveTo(x + 3, y + (h - wallH) / 2 + 1);
  ctx.lineTo(x + w - 3, y + (h - wallH) / 2 + 1);
  ctx.stroke();

  // door
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(cx - 1.6, y + h - wallH + 1, 3.2, wallH - 1);
  ctx.globalAlpha = 1;
}

export function drawFarm(ctx: CanvasRenderingContext2D, site: { x: number; y: number }): void {
  const c = tileCenter(site);
  // the beaten yard
  ctx.fillStyle = CLAY;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 2, 22, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  drawHouse(ctx, { cx: c.x - 6, cy: c.y - 3, w: 18, h: 14, salt: 1 });
  drawHouse(ctx, { cx: c.x + 10, cy: c.y + 5, w: 13, h: 10, roof: MARSH_DARK, salt: 2 });
}

export function drawRyne(ctx: CanvasRenderingContext2D): void {
  // the quay
  ctx.fillStyle = INK;
  ctx.globalAlpha = 0.8;
  ctx.fillRect(31 * TILE, 22.5 * TILE - 3, 2.4 * TILE, 6);
  ctx.globalAlpha = 1;

  const spots: Array<[number, number, number, number]> = [
    [27.7, 20.6, 14, 11],
    [29.4, 20.9, 12, 10],
    [27.6, 21.9, 12, 10],
    [29.6, 22.9, 13, 10],
    [27.9, 23.2, 11, 9],
  ];
  spots.forEach(([tx, ty, w, h], i) => {
    drawHouse(ctx, { cx: tx * TILE, cy: ty * TILE, w, h, salt: i + 10 });
  });

  // the church tower, entered at odd hours anyway
  const bx = 28.5 * TILE;
  const by = 21.7 * TILE;
  ctx.fillStyle = LIMEWASH;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.rect(bx - 4, by - 14, 9, 18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ROOF;
  ctx.beginPath();
  ctx.moveTo(bx - 5, by - 14);
  ctx.lineTo(bx + 6, by - 14);
  ctx.lineTo(bx + 0.5, by - 21);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

export function drawCustoms(ctx: CanvasRenderingContext2D): void {
  const c = tileCenter({ x: 26, y: 19 });
  drawHouse(ctx, { cx: c.x, cy: c.y, w: 17, h: 13, roof: SEA, salt: 30 });
  // flag pole, flying nothing yet
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT * 0.8;
  ctx.beginPath();
  ctx.moveTo(c.x + 10, c.y + 4);
  ctx.lineTo(c.x + 10, c.y - 14);
  ctx.stroke();
}

export function drawCart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  laden: boolean,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // wheels
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.beginPath();
  ctx.arc(-3.5, 4.2, 3, 0, Math.PI * 2);
  ctx.moveTo(6.5, 4.2);
  ctx.arc(3.5, 4.2, 3, 0, Math.PI * 2);
  ctx.stroke();

  // bed
  ctx.fillStyle = mix(CLAY, INK, 0.15);
  ctx.beginPath();
  ctx.roundRect(-7, -3.5, 14, 7, 1.5);
  ctx.fill();
  ctx.stroke();

  // the pony, reduced to intent
  ctx.fillStyle = MARSH_DARK;
  ctx.beginPath();
  ctx.ellipse(11, 0, 3.6, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (laden) {
    ctx.fillStyle = LIMEWASH;
    ctx.beginPath();
    ctx.ellipse(0, -1, 5, 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = OUT * 0.75;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSheep(
  ctx: CanvasRenderingContext2D,
  site: { x: number; y: number },
  count: number,
): void {
  const c = tileCenter(site);
  for (let i = 0; i < count; i++) {
    const angle = hash2(site.x, site.y, 100 + i) * Math.PI * 2;
    const dist = (1.1 + hash2(site.x, site.y, 200 + i) * 2.2) * TILE;
    const sx = c.x + Math.cos(angle) * dist;
    const sy = c.y + Math.sin(angle) * dist * 0.7;
    const facing = hash2(site.x, site.y, 300 + i) > 0.5 ? 1 : -1;
    ctx.fillStyle = LIMEWASH;
    ctx.strokeStyle = INK;
    ctx.lineWidth = OUT * 0.7;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 4.4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(sx + 4.2 * facing, sy - 0.8, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawRoad(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  drowned: boolean,
): void {
  const trace = () => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.4;
  ctx.setLineDash([]);
  trace();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = drowned ? DYKE : CLAY;
  ctx.lineWidth = 3.2;
  ctx.setLineDash(drowned ? [3, 7] : [9, 5]);
  trace();
  ctx.setLineDash([]);
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.font = `600 9px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.strokeText(text.toUpperCase(), x, y);
  ctx.fillStyle = LIMEWASH;
  ctx.fillText(text.toUpperCase(), x, y);
}

/**
 * The one non-diegetic affordance of the opening (spec §6.7): the farm
 * pulses gently until first clicked. `phase` is 0..1.
 */
export function drawFarmGlow(
  ctx: CanvasRenderingContext2D,
  site: { x: number; y: number },
  phase: number,
): void {
  const c = tileCenter(site);
  const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  ctx.strokeStyle = LIMEWASH;
  ctx.lineWidth = 1.6 + pulse * 1.2;
  ctx.globalAlpha = 0.5 - pulse * 0.25;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 2, 26 + pulse * 8, 17 + pulse * 5.5, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.25 - pulse * 0.12;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y + 2, 33 + pulse * 10, 21.5 + pulse * 7, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function drawTileHighlight(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  valid: boolean,
): void {
  ctx.fillStyle = valid ? LIMEWASH : INK;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = valid ? LIMEWASH : INK;
  ctx.lineWidth = 1.2;
  ctx.setLineDash(valid ? [] : [3, 3]);
  ctx.strokeRect(tx * TILE, ty * TILE, TILE, TILE);
  ctx.setLineDash([]);
}
