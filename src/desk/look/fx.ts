// The map answers back (spec §20.4, D6): when something happens, it happens
// WHERE it happens. A sale rings coin over the place it was made, shearing
// throws wool off the flock, a load lands in the cart, the rent leaves the
// farm, and the Customs House's eye flares when it counts a load. Read off the
// difference between one frame's state and the last: pure UI, nothing in the
// save, and a loaded or new game resets it without a fanfare.

import { nodeById } from '../../sim/map';
import type { GameState, NodeId } from '../../sim/types';
import { tileCenter } from '../../shared/geometry';
import { cargoCount } from '../../shared/words';

type Kind = 'coin' | 'loss' | 'note' | 'heat';

interface Floater {
  kind: Kind;
  text: string;
  wx: number;
  wy: number;
  born: number;
}

interface Tuft {
  wx: number;
  wy: number;
  vx: number;
  vy: number;
  dark: boolean;
  born: number;
}

interface Ring {
  wx: number;
  wy: number;
  born: number;
}

interface Snap {
  seed: number;
  tick: number;
  coin: number;
  rentPaid: number;
  heat: number;
  barn: { white: number; dark: number };
  carts: Record<string, { n: number; at: NodeId | null }>;
}

const FLOAT_S = 1.9;
const TUFT_S = 1.2;
const RING_S = 1.6;

function snap(s: GameState): Snap {
  const carts: Snap['carts'] = {};
  for (const c of s.carts) carts[c.id] = { n: cargoCount(c.cargo), at: c.location.kind === 'node' ? c.location.nodeId : null };
  return {
    seed: s.seed,
    tick: s.tick,
    coin: s.coin,
    rentPaid: s.rentPaid,
    heat: s.heat.regional,
    barn: { white: s.stores.farm?.fleece ?? 0, dark: s.stores.farm?.['dark-fleece'] ?? 0 },
    carts,
  };
}

export class Fx {
  private last: Snap | null = null;
  private floaters: Floater[] = [];
  private tufts: Tuft[] = [];
  private rings: Ring[] = [];

  private at(s: GameState, id: NodeId): { x: number; y: number } {
    return tileCenter(nodeById(id, s.farm, s.cuttingHouse));
  }

  /** What is live, by kind: for tests. */
  live(): { texts: string[]; tufts: number; rings: number } {
    return { texts: this.floaters.map((f) => f.text), tufts: this.tufts.length, rings: this.rings.length };
  }

  /** Compare with the last frame and spawn what changed. `now` in seconds. */
  observe(s: GameState, now: number): void {
    const cur = snap(s);
    const prev = this.last;
    this.last = cur;
    // a different game, or time run backwards (a load): no fanfare
    if (!prev || prev.seed !== cur.seed || cur.tick < prev.tick || cur.tick - prev.tick > 600) return;
    if (cur.tick === prev.tick) return;

    // where cargo left a cart, and where it arrived in one
    const unloadedAt: NodeId[] = [];
    for (const [id, c] of Object.entries(cur.carts)) {
      const p = prev.carts[id];
      if (!p || !c.at || p.at !== c.at) continue;
      if (c.n < p.n) unloadedAt.push(c.at);
      if (c.n > p.n) {
        const o = this.at(s, c.at);
        this.floaters.push({ kind: 'note', text: `+${c.n - p.n} aboard`, wx: o.x + 10, wy: o.y - 4, born: now });
      }
    }

    if (cur.coin > prev.coin) {
      const where = unloadedAt.find((n) => n !== 'farm') ?? 'ryne';
      const o = this.at(s, where);
      this.floaters.push({ kind: 'coin', text: `+${cur.coin - prev.coin}`, wx: o.x, wy: o.y - 12, born: now });
    }
    if (cur.rentPaid > prev.rentPaid) {
      const o = this.at(s, 'farm');
      this.floaters.push({ kind: 'loss', text: `rent −${cur.rentPaid - prev.rentPaid}`, wx: o.x, wy: o.y - 16, born: now });
    }

    // shearing: the barn fills from the flock's backs
    const white = cur.barn.white - prev.barn.white;
    const dark = cur.barn.dark - prev.barn.dark;
    if (white > 0 || dark > 0) {
      const o = this.at(s, 'farm');
      const n = Math.min(26, 6 + Math.round((white + dark) / 2));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const v = 18 + Math.random() * 26;
        this.tufts.push({
          wx: o.x + (Math.random() - 0.5) * 14,
          wy: o.y + 6 + (Math.random() - 0.5) * 8,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          dark: i < (n * dark) / Math.max(1, white + dark),
          born: now + Math.random() * 0.15,
        });
      }
    }

    // the Crown counts: a jump in the region's heat flares at the Customs House
    if (cur.heat - prev.heat >= 1) {
      const o = this.at(s, 'customs');
      this.rings.push({ wx: o.x, wy: o.y, born: now });
      this.floaters.push({ kind: 'heat', text: 'counted', wx: o.x, wy: o.y - 14, born: now });
    }

    if (this.floaters.length > 24) this.floaters.splice(0, this.floaters.length - 24);
    if (this.tufts.length > 120) this.tufts.splice(0, this.tufts.length - 120);
  }

  /**
   * Draw over the map. `toScreen` maps world px to CSS px; `dpr` scales to the
   * canvas. Text and rings are a fixed screen size; tufts move in the world.
   */
  draw(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }, dpr: number, zoom: number, now: number): void {
    this.floaters = this.floaters.filter((f) => now - f.born < FLOAT_S);
    this.tufts = this.tufts.filter((t) => now - t.born < TUFT_S);
    this.rings = this.rings.filter((r) => now - r.born < RING_S);
    if (!this.floaters.length && !this.tufts.length && !this.rings.length) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const t of this.tufts) {
      const age = now - t.born;
      if (age < 0) continue;
      const k = age / TUFT_S;
      // flung up, then drifting down as the breeze takes them
      const x = t.wx + t.vx * age + 10 * age * age;
      const y = t.wy + t.vy * age + 34 * age * age;
      const p = toScreen(x, y);
      const r = Math.max(1.6, 2.6 * Math.min(1.6, zoom));
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = t.dark ? '#4a3f37' : '#efe9dc';
      ctx.strokeStyle = 'rgba(36, 28, 24, 0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const r of this.rings) {
      const k = (now - r.born) / RING_S;
      const p = toScreen(r.wx, r.wy);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = '#c9583e';
      ctx.lineWidth = 2.5 * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10 + 46 * Math.sqrt(k), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    for (const f of this.floaters) {
      const k = (now - f.born) / FLOAT_S;
      const p = toScreen(f.wx, f.wy);
      const rise = 34 * (1 - (1 - k) * (1 - k));
      const pop = k < 0.12 ? 0.75 + (k / 0.12) * 0.35 : k < 0.22 ? 1.1 - ((k - 0.12) / 0.1) * 0.1 : 1;
      const size = (f.kind === 'coin' ? 22 : f.kind === 'note' ? 14 : 16) * pop;
      ctx.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
      ctx.font = `${f.kind === 'coin' ? 'bold ' : ''}${size.toFixed(1)}px 'IM Fell English SC', 'IM Fell English', Georgia, serif`;
      const x = p.x;
      const y = p.y - rise;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(36, 28, 24, 0.9)';
      if (f.kind === 'coin') {
        // a coin rung beside the figure
        const tw = ctx.measureText(f.text).width;
        const cx = x - tw / 2 - size * 0.45;
        const cy = y - size * 0.36;
        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#f0cf8a';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
        ctx.lineWidth = 4;
      }
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.kind === 'coin' ? '#f0cf8a' : f.kind === 'loss' ? '#e0a090' : f.kind === 'heat' ? '#e58a70' : '#e8e1d2';
      ctx.fillText(f.text, x, y);
    }
    ctx.restore();
  }
}
