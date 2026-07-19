// Layer 1 (spec §15.1): buildings, carts, sheep, roads — drawn every frame
// in world coordinates (the camera transform is already applied). Flat
// fills, ink outlines, deterministic wobble. Line widths are world-space,
// so outlines scale with the camera as the spec asks.

import { hash2, jitter, TILE, tileCenter } from './geometry';
import { CLAY, DYKE, HEAT_RED, INK, LIMEWASH, MARSH_DARK, REVENUE_BLUE, ROOF, SEA } from './palette';
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

/** The Riding Officer (spec §6.10): one man, one horse, Revenue blue at last. */
export function drawOfficer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // the horse — bigger than a pony and it knows it
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT;
  ctx.fillStyle = mix(INK, CLAY, 0.35);
  ctx.beginPath();
  ctx.ellipse(0, 1.5, 5.2, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // head
  ctx.beginPath();
  ctx.ellipse(5.6, -0.6, 2.2, 1.4, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // legs, reduced to intent
  ctx.beginPath();
  ctx.moveTo(-3, 4);
  ctx.lineTo(-3, 6.5);
  ctx.moveTo(3, 4);
  ctx.lineTo(3, 6.5);
  ctx.stroke();

  // the rider — the coat is the entire point
  ctx.fillStyle = REVENUE_BLUE;
  ctx.beginPath();
  ctx.roundRect(-2.6, -6.2, 5.2, 6, 1.6);
  ctx.fill();
  ctx.stroke();
  // hat
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, -7, 2.4, 1, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** A gossip stain (spec §6.10): where the parish thinks the Revenue is looking. */
export function drawGossipStain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  strength: number,
): void {
  const r = 10 + Math.sqrt(strength) * 6;
  const g = ctx.createRadialGradient(x, y, 2, x, y, r);
  g.addColorStop(0, `${HEAT_RED}66`);
  g.addColorStop(1, `${HEAT_RED}00`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
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

/**
 * §20 (M5 hub polish, playtest) — a carter's round, named in light: a soft
 * translucent white ribbon over every edge a standing order rides, so the
 * served routes read at a glance. Drawn over the road, under everything
 * that moves.
 */
export function drawCarterRoute(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
): void {
  const trace = () => {
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);

  // The glow: a wide, faint halo, then a thin bright core.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 8;
  trace();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  trace();
}

// ---- Feedback motes (§20, M5 hub polish) --------------------------------
// Little world-anchored particles: wool blossoming off the shears, a coin
// catching the light where a sale lands. Pure decoration — the sim knows
// nothing of them. `t` runs 0..1 over a mote's life.

/** A tuft of fleece lifts, sways, and falls away like a petal. */
export function drawWoolMote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  sway: number,
): void {
  const rise = Math.sin((Math.min(t, 0.35) / 0.35) * (Math.PI / 2)) * 12;
  const fall = t > 0.35 ? (t - 0.35) * 34 : 0;
  const px = x + Math.sin(sway + t * 5) * 6 * t;
  const py = y - rise + fall;
  const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  ctx.globalAlpha = a * 0.95;
  ctx.fillStyle = '#F2EDE2';
  ctx.beginPath();
  ctx.arc(px, py, 3.8, 0, Math.PI * 2);
  ctx.arc(px - 3, py + 1.4, 2.8, 0, Math.PI * 2);
  ctx.arc(px + 3, py + 1.7, 2.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = a * 0.3;
  ctx.fillStyle = '#B9B2A4';
  ctx.beginPath();
  ctx.arc(px + 1.2, py + 2.5, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** A guinea turns in the light where the coin changed hands — no dollar
 *  signs on this coast. */
export function drawCoinMote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
): void {
  const py = y - t * 19;
  const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
  // The coin spins as it rises: its face squashes and opens again.
  const face = Math.abs(Math.sin(t * Math.PI * 2.5)) * 0.6 + 0.4;
  ctx.globalAlpha = a;
  ctx.fillStyle = '#D8B764';
  ctx.beginPath();
  ctx.ellipse(x, py, 3.4 * face, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8F7430';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.globalAlpha = a * 0.8;
  ctx.fillStyle = '#F6E7B2';
  ctx.beginPath();
  ctx.ellipse(x - 1 * face, py - 1.1, 1 * face, 1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
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

export function drawShingle(ctx: CanvasRenderingContext2D, site: { x: number; y: number }): void {
  const c = tileCenter(site);
  // wrack line and a mooring post: just enough beach to click on
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT * 0.7;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(c.x - 14, c.y + 6);
  ctx.quadraticCurveTo(c.x - 4, c.y + 9, c.x + 12, c.y + 5);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(c.x + 4, c.y + 2);
  ctx.lineTo(c.x + 4, c.y - 6);
  ctx.stroke();
  // scattered stones, deterministic
  ctx.fillStyle = INK;
  for (let i = 0; i < 5; i++) {
    const sx = c.x - 10 + hash2(site.x, site.y, 40 + i) * 20;
    const sy = c.y + 1 + hash2(site.x, site.y, 50 + i) * 6;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 1.4, 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The Dutchman's lugger, standing off the shingle. No lights, no flag. */
export function drawLugger(ctx: CanvasRenderingContext2D, site: { x: number; y: number }): void {
  const c = tileCenter({ x: site.x + 2.4, y: site.y + 0.4 });
  ctx.save();
  // hull
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT * 0.8;
  ctx.beginPath();
  ctx.moveTo(c.x - 11, c.y);
  ctx.quadraticCurveTo(c.x, c.y + 6.5, c.x + 11, c.y);
  ctx.lineTo(c.x + 8.5, c.y - 3);
  ctx.lineTo(c.x - 9, c.y - 3);
  ctx.closePath();
  ctx.fill();
  // masts
  ctx.beginPath();
  ctx.moveTo(c.x - 4, c.y - 3);
  ctx.lineTo(c.x - 3, c.y - 17);
  ctx.moveTo(c.x + 5, c.y - 3);
  ctx.lineTo(c.x + 5.5, c.y - 13);
  ctx.stroke();
  // lug sails, half-dropped, pale enough to read at night
  ctx.fillStyle = LIMEWASH;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(c.x - 8.5, c.y - 5);
  ctx.lineTo(c.x - 3.2, c.y - 16);
  ctx.lineTo(c.x + 1.5, c.y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.x + 2.5, c.y - 5);
  ctx.lineTo(c.x + 5.3, c.y - 12);
  ctx.lineTo(c.x + 9, c.y - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** The cutting house: a low shed with no sign over the door (spec §6.9). */
export function drawCuttingHouse(
  ctx: CanvasRenderingContext2D,
  site: { x: number; y: number },
): void {
  const c = tileCenter(site);
  drawHouse(ctx, { cx: c.x, cy: c.y, w: 15, h: 11, roof: MARSH_DARK, salt: 40 });
  // tubs by the wall
  ctx.fillStyle = CLAY;
  ctx.strokeStyle = INK;
  ctx.lineWidth = OUT * 0.6;
  for (const dx of [-9.5, -7]) {
    ctx.beginPath();
    ctx.ellipse(c.x + dx, c.y + 4.5, 1.5, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Spec §6.12 — the works that harden a building, and the meter that shows how
 * loud they are. The silhouette escalates with `tier` (0..4); the Heat-red bar
 * beneath rises with `visibility`. The trade is legible at a glance: the more
 * military the walls look, the redder the tell.
 */
export function drawFortifications(
  ctx: CanvasRenderingContext2D,
  site: { x: number; y: number },
  tier: number,
  visibility: number,
): void {
  const c = tileCenter(site);
  const cx = c.x;
  const cy = c.y + 2;
  const rx = 19;
  const ry = 12;

  if (tier > 0) {
    // The defensive ring — an earth berm, stouter each rung.
    ctx.strokeStyle = mix(CLAY, INK, 0.35);
    ctx.lineWidth = OUT * (0.8 + tier * 0.35);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Stakes around it: a hedge at tier 1, timber above, taller and darker as
    // the works grow. Deterministic placement, so nothing shimmers (§15.3).
    const stakes = tier * 6;
    const isHedge = tier === 1;
    const stakeH = 2.6 + tier * 0.9;
    ctx.lineWidth = OUT * 0.7;
    for (let i = 0; i < stakes; i++) {
      const a = (i / stakes) * Math.PI * 2 + hash2(site.x, site.y, 60 + i) * 0.15;
      const px = cx + Math.cos(a) * rx;
      const py = cy + Math.sin(a) * ry;
      const h = stakeH * (0.8 + hash2(site.x, site.y, 90 + i) * 0.4);
      ctx.strokeStyle = isHedge ? MARSH_DARK : mix(CLAY, INK, 0.45);
      if (isHedge) {
        ctx.beginPath(); // little spiked-hedge chevrons
        ctx.moveTo(px - 1.4, py);
        ctx.lineTo(px, py - h);
        ctx.lineTo(px + 1.4, py);
        ctx.stroke();
      } else {
        ctx.fillStyle = mix(CLAY, INK, 0.45);
        ctx.beginPath(); // a pointed timber stake
        ctx.moveTo(px - 1.1, py);
        ctx.lineTo(px - 1.1, py - h + 1.2);
        ctx.lineTo(px, py - h);
        ctx.lineTo(px + 1.1, py - h + 1.2);
        ctx.lineTo(px + 1.1, py);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // Gunports at tier 3+: dark slits punched into the ring's face.
    if (tier >= 3) {
      ctx.fillStyle = INK;
      for (const a of [-0.9, 0.2, 1.3]) {
        const px = cx + Math.cos(a) * rx;
        const py = cy + Math.sin(a) * ry;
        ctx.fillRect(px - 1.5, py - 2.2, 3, 2);
      }
    }

    // A dog at the gate — the tier-1 warning, present at every rung (§22).
    const dx = cx - rx * 0.5;
    const dy = cy + ry * 0.72;
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = OUT * 0.6;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 2, 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(dx - 1.9, dy - 0.5, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // The visibility meter: a short bar beneath the works, filling Heat-red with
  // how loud the building has become. Drawn even at tier 0? No — silence is
  // silent; only a fortified building carries the tell.
  if (tier > 0) {
    const bw = 22;
    const bx = cx - bw / 2;
    const by = cy + ry + 4;
    const frac = Math.max(0, Math.min(1, visibility / 2.0)); // 2.0 = a full fortress
    ctx.fillStyle = mix(LIMEWASH, INK, 0.12);
    ctx.strokeStyle = INK;
    ctx.lineWidth = OUT * 0.6;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 3, 1.5);
    ctx.fill();
    ctx.stroke();
    if (frac > 0) {
      ctx.fillStyle = HEAT_RED;
      ctx.beginPath();
      ctx.roundRect(bx + 0.6, by + 0.6, (bw - 1.2) * frac, 1.8, 0.9);
      ctx.fill();
    }
  }
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
