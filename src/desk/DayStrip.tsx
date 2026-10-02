// THE DAY AHEAD (spec §20.4, D3): the strip along the foot of the table. Most
// decisions in this game are timing — run on the falling tide after dark, keep
// off the low road at high water, be home before the audit — and this is where
// timing is read. Hover a route in a tag and the trip lies along it.

import { useEffect, useRef, useState } from 'react';
import { TICKS_PER_HOUR } from '../sim/balance';
import { clockOf, dayPhaseOf, isFlooded, tideLevel } from '../sim/time';
import { useGameStore } from '../state/store';
import { dayAhead, ticksToOrigin, tripOf, WINDOW, type DayAhead, type Mark } from './dayAhead';
import { useDeskUi } from './deskUi';
import { routeRisk } from './routes';

const GUTTER = 96;
const RIGHT = 120;
const LAMP = '#F0CF8A';
const PAPER = '#E8E1D2';
const DIM = 'rgba(232, 225, 210, 0.55)';
const OFFICER = '#4b6d97'; // the Revenue's own blue, lifted to read on ink
const HEAT = '#e0837a';
const TONE: Record<string, string> = { quiet: '#9fbf7a', seen: '#e0c27a', watched: '#e0837a', water: '#8fb2b5' };

const hhmm = (tick: number) => {
  const c = clockOf(tick);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
};

export function DayStrip() {
  const state = useGameStore((s) => s.state);
  const journeys = useDeskUi((s) => s.journeys);
  const hoverRoute = useDeskUi((s) => s.hoverRoute);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; text: string } | null>(null);
  const dayRef = useRef<DayAhead | null>(null);

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const day = (dayRef.current = dayAhead(state, journeys));
    const dpr = window.devicePixelRatio || 1;
    const h = canvas.parentElement!.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(h * dpr);
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, h);
    const X = (t: number) => GUTTER + (t / WINDOW) * (width - GUTTER - RIGHT);
    const lane = { lugger: 8, tideTop: 26, tideBottom: h - 34, drowned: h - 30, trip: Math.round(h / 2) - 6 };

    // the gutter
    c.font = "12px 'IM Fell English SC', Georgia, serif";
    c.fillStyle = DIM;
    c.textBaseline = 'middle';
    c.fillText('the day', 14, h / 2 - 8);
    c.fillText('ahead', 14, h / 2 + 8);

    // darkness and dusk
    for (const sp of day.dusk) {
      c.fillStyle = 'rgba(30, 30, 60, 0.32)';
      c.fillRect(X(sp.from), 4, X(sp.to) - X(sp.from), h - 8);
    }
    for (const sp of day.night) {
      c.fillStyle = 'rgba(8, 10, 28, 0.7)';
      c.fillRect(X(sp.from), 4, X(sp.to) - X(sp.from), h - 8);
    }

    // the tide, and the low road drowned beneath it
    c.strokeStyle = 'rgba(143, 178, 181, 0.95)';
    c.lineWidth = 1.6;
    c.beginPath();
    day.tide.forEach((v, t) => {
      const y = lane.tideBottom - v * (lane.tideBottom - lane.tideTop);
      if (t === 0) c.moveTo(X(t), y);
      else c.lineTo(X(t), y);
    });
    c.stroke();
    for (const sp of day.drowned) {
      c.fillStyle = 'rgba(94, 122, 125, 0.55)';
      c.fillRect(X(sp.from), lane.drowned, X(sp.to) - X(sp.from), 5);
    }
    if (day.drowned.length > 0) {
      c.font = "italic 11px 'Source Serif 4', Georgia, serif";
      c.fillStyle = 'rgba(181, 208, 210, 0.9)';
      c.fillText('low road drowned', X(day.drowned[0].from) + 4, h - 19);
    }

    // the lugger
    for (const sp of day.lugger) {
      c.fillStyle = LAMP;
      c.fillRect(X(sp.from), lane.lugger, X(sp.to) - X(sp.from), 5);
    }
    if (day.lugger.length > 0) {
      c.font = "italic 11px 'Source Serif 4', Georgia, serif";
      c.fillStyle = LAMP;
      c.fillText('the lugger off the Shingle', X(day.lugger[0].from) + 4, lane.lugger + 14);
    }

    // a route under the pointer, laid along the strip as if sent now
    if (hoverRoute) {
      const startIn = ticksToOrigin(state, hoverRoute.cartId);
      const tone = TONE[routeRisk(state, hoverRoute.route).tone];
      for (const leg of tripOf(state, hoverRoute.route, startIn)) {
        if (leg.from >= WINDOW) break;
        const x0 = X(leg.from);
        const x1 = X(Math.min(WINDOW, leg.to));
        c.fillStyle = tone;
        c.globalAlpha = 0.85;
        c.fillRect(x0, lane.trip, Math.max(2, x1 - x0 - 2), 8);
        c.globalAlpha = 1;
        if (leg.drownsAt !== null && leg.drownsAt < WINDOW) {
          const xd = X(leg.drownsAt);
          c.fillStyle = HEAT;
          c.fillRect(xd, lane.trip - 3, Math.max(3, x1 - xd), 14);
          c.font = "bold 11px 'Source Serif 4', Georgia, serif";
          c.fillText('drowns here', xd + 4, lane.trip + 22);
        }
      }
      const end = tripOf(state, hoverRoute.route, startIn).at(-1);
      if (end && end.to < WINDOW) {
        c.font = "12px 'Source Serif 4', Georgia, serif";
        c.fillStyle = PAPER;
        c.fillText(`arrives ${hhmm(state.tick + end.to)}`, X(end.to) + 6, lane.trip + 4);
      }
    }

    // the hours
    c.font = "11px 'Source Serif 4', Georgia, serif";
    c.fillStyle = DIM;
    c.textAlign = 'center';
    const firstHour = TICKS_PER_HOUR - (state.tick % TICKS_PER_HOUR);
    for (let t = firstHour % TICKS_PER_HOUR; t <= WINDOW; t += TICKS_PER_HOUR) {
      const hour = clockOf(state.tick + t).hour;
      if (hour % 3 !== 0) continue;
      c.fillRect(X(t), h - 13, 1, 4);
      c.fillText(`${String(hour).padStart(2, '0')}:00`, X(t), h - 5);
    }
    c.textAlign = 'left';

    // the marks
    for (const m of day.marks) drawMark(c, m, X(m.at), h);

    // the rent beyond the window
    c.font = "12px 'Source Serif 4', Georgia, serif";
    c.fillStyle = DIM;
    if (day.rentBeyond !== null) c.fillText(`rent in ${day.rentBeyond} days →`, width - RIGHT + 10, h / 2);

    // now
    c.fillStyle = LAMP;
    c.fillRect(X(0) - 1, 2, 2, h - 4);
  }, [state, journeys, hoverRoute, width]);

  const onMove = (e: React.MouseEvent) => {
    const day = dayRef.current;
    if (!day || width === 0) return;
    const x = e.clientX - wrapRef.current!.getBoundingClientRect().left;
    const t = Math.round(((x - GUTTER) / (width - GUTTER - RIGHT)) * WINDOW);
    if (t < 0 || t > WINDOW) return setTip(null);
    const near = day.marks.find((m) => Math.abs(((m.at - t) / WINDOW) * (width - GUTTER - RIGHT)) < 7 && m.kind !== 'high-water');
    const tick = state.tick + t;
    const facts = [
      dayPhaseOf(tick),
      `tide ${Math.round(tideLevel(tick) * 100)}%`,
      isFlooded(tick) ? 'low road drowned' : null,
      day.lugger.some((sp) => t >= sp.from && t < sp.to) ? 'the lugger stands off' : null,
    ].filter(Boolean);
    setTip({ x, text: near ? `${hhmm(state.tick + near.at)} — ${near.label}` : `${hhmm(tick)} — ${facts.join(' · ')}` });
  };

  return (
    <div className="day-strip" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setTip(null)}>
      <canvas ref={canvasRef} aria-label="The next 24 hours: darkness, tide, the lugger, the officer, arrivals and rent" />
      {tip && (
        <div className="strip-tip" style={{ left: Math.min(Math.max(8, tip.x - 120), width - 248) }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

function drawMark(c: CanvasRenderingContext2D, m: Mark, x: number, h: number): void {
  const y = h / 2;
  c.save();
  switch (m.kind) {
    case 'high-water':
      break;
    case 'arrival': {
      c.beginPath();
      c.arc(x, y - 12, 8, 0, Math.PI * 2);
      c.fillStyle = PAPER;
      c.fill();
      c.fillStyle = '#241C18';
      c.font = "bold 11px Georgia, serif";
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(m.num ?? ''), x, y - 11.5);
      break;
    }
    case 'officer':
    case 'audit': {
      c.fillStyle = OFFICER;
      c.beginPath();
      c.moveTo(x, y - 20);
      c.lineTo(x + 6, y - 13);
      c.lineTo(x, y - 6);
      c.lineTo(x - 6, y - 13);
      c.closePath();
      c.fill();
      c.strokeStyle = PAPER;
      c.lineWidth = 1;
      c.stroke();
      if (m.kind === 'audit') {
        c.fillStyle = '#9db4d3';
        c.font = "italic 11px 'Source Serif 4', Georgia, serif";
        c.fillText('the audit', x + 8, y - 13);
      }
      break;
    }
    case 'rent': {
      c.fillStyle = LAMP;
      c.fillRect(x - 1, 4, 2, h - 8);
      c.font = "bold 11px 'Source Serif 4', Georgia, serif";
      c.fillText('rent', x + 4, 16);
      break;
    }
    case 'raid': {
      c.fillStyle = HEAT;
      c.beginPath();
      c.moveTo(x, y - 22);
      c.lineTo(x + 7, y - 9);
      c.lineTo(x - 7, y - 9);
      c.closePath();
      c.fill();
      c.font = "bold 11px 'Source Serif 4', Georgia, serif";
      c.fillText('the raid', x + 8, y - 14);
      break;
    }
  }
  c.restore();
}
