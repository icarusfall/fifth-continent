// The desk's sound (spec §20.4, D6c): every voice synthesised with WebAudio,
// so nothing is downloaded. A bed of wind over the marsh and surf on the
// shingle (louder as the map looks toward the sea), gulls by day and an owl by
// night, hooves while carts are moving, and a short cue whenever the map
// answers back (fx.ts): coin, shears, a load, the rent, the Crown's count.
// Muted by default; the top bar's switch is remembered. UI only: the sim
// never imports this (house rule 1).

export type Cue = 'coin' | 'loss' | 'shear' | 'load' | 'heat';

export interface Ambience {
  /** 0 by day, 1 at night. */
  dark: number;
  /** 0..1, how much the view looks toward the sea. */
  sea: number;
  /** Carts on the road just now. */
  moving: number;
  /** False while paused or a card holds the clock: the world falls quiet. */
  running: boolean;
}

const KEY = 'fifth-continent-sound';
const MASTER = 0.55;

type Listener = (on: boolean) => void;

class DeskSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private surfGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastAmb = 0;
  private nextHoof = 0;
  private hoofSide = 0;
  private nextCall = 0;
  private lastCue: Partial<Record<Cue, number>> = {};
  private listeners = new Set<Listener>();
  on = false;

  /** Reads the remembered choice; audio itself waits for the first gesture. */
  restore(): void {
    let want = false;
    try {
      want = localStorage.getItem(KEY) === 'on';
    } catch {
      /* storage blocked: stay quiet */
    }
    if (!want) return;
    const start = () => {
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
      this.set(true);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call from a click: browsers start audio only in answer to a gesture. */
  set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* the choice is not remembered, and that is all */
    }
    if (on) {
      if (!this.ctx) this.build();
      void this.ctx?.resume();
      this.master?.gain.setTargetAtTime(MASTER, this.ctx!.currentTime, 0.4);
    } else if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
    this.listeners.forEach((fn) => fn(on));
  }

  private build(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // two seconds of noise, looped by every voice that wants it
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // brown noise for the surf: integrated white, a deep roar
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * d[i]) / 1.02;
      b[i] = last * 3.5;
    }

    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.8;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    const surf = ctx.createBufferSource();
    surf.buffer = brown;
    surf.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    surf.connect(lp).connect(this.surfGain).connect(this.master);
    surf.start();
  }

  /** Called every frame; does its work about ten times a second. `now` in seconds. */
  ambient(a: Ambience, now: number): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.windGain || !this.windFilter || !this.surfGain) return;
    if (now - this.lastAmb < 0.1) return;
    this.lastAmb = now;
    const t = ctx.currentTime;
    // wind: gusting, a little stronger at night
    const gust = 0.5 + 0.5 * Math.sin(now * 0.23) * Math.sin(now * 0.071 + 1.3);
    this.windGain.gain.setTargetAtTime(0.035 + 0.05 * gust + 0.015 * a.dark, t, 0.6);
    this.windFilter.frequency.setTargetAtTime(380 + 520 * gust, t, 0.8);
    // surf: a seven-second swell, its weight set by how near the sea we look
    const swell = Math.pow(0.5 + 0.5 * Math.sin((now * Math.PI * 2) / 7.3), 2);
    this.surfGain.gain.setTargetAtTime((0.04 + 0.9 * a.sea) * (0.05 + 0.09 * swell), t, 0.5);

    // hooves, while there are carts on the road and the clock runs
    if (a.running && a.moving > 0 && now >= this.nextHoof) {
      this.hoof(0.018 + 0.01 * Math.min(3, a.moving), this.hoofSide++ % 2 === 0 ? 1900 : 1500);
      this.nextHoof = now + (this.hoofSide % 2 === 0 ? 0.36 : 0.2);
    }
    // the wild things: gulls by day toward the sea, an owl at night
    if (now >= this.nextCall) {
      if (this.nextCall > 0) {
        if (a.dark > 0.6) this.owl();
        else if (a.sea > 0.25 || Math.random() < 0.3) this.gull();
      }
      this.nextCall = now + 9 + Math.random() * 16;
    }
  }

  cue(c: Cue): void {
    const ctx = this.ctx;
    if (!this.on || !ctx) return;
    const now = ctx.currentTime;
    if ((this.lastCue[c] ?? -1) > now - 0.15) return;
    this.lastCue[c] = now;
    switch (c) {
      case 'coin':
        for (let i = 0; i < 3; i++) this.clink(now + i * 0.07 + Math.random() * 0.02);
        break;
      case 'loss':
        this.bell(now, 196, 0.12);
        break;
      case 'shear':
        for (let i = 0; i < 3; i++) this.snip(now + i * 0.11);
        break;
      case 'load':
        this.thunk(now);
        this.thunk(now + 0.14);
        break;
      case 'heat':
        this.drum(now);
        this.drum(now + 0.32);
        break;
    }
  }

  // ---- voices ----

  private env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private tone(at: number, freq: number, type: OscillatorType, g: GainNode, dur: number, glideTo?: number): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
    o.connect(g);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  private burst(at: number, dur: number, filter: BiquadFilterType, freq: number, g: GainNode): void {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    src.connect(f).connect(g);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  private clink(at: number): void {
    const f = 2000 + Math.random() * 500;
    this.tone(at, f, 'sine', this.env(at, 0.09, 0.002, 0.28), 0.3);
    this.tone(at, f * 1.51, 'sine', this.env(at, 0.05, 0.002, 0.18), 0.2);
    this.tone(at, f * 2.76, 'sine', this.env(at, 0.025, 0.002, 0.1), 0.12);
  }

  private bell(at: number, f: number, peak: number): void {
    this.tone(at, f, 'sine', this.env(at, peak, 0.01, 1.4), 1.5);
    this.tone(at, f * 2.4, 'sine', this.env(at, peak * 0.35, 0.01, 0.9), 1);
  }

  private snip(at: number): void {
    this.burst(at, 0.04, 'highpass', 3200, this.env(at, 0.12, 0.003, 0.05));
  }

  private thunk(at: number): void {
    this.tone(at, 130, 'sine', this.env(at, 0.22, 0.004, 0.16), 0.18, 55);
    this.burst(at, 0.06, 'lowpass', 900, this.env(at, 0.08, 0.003, 0.07));
  }

  private drum(at: number): void {
    this.tone(at, 78, 'sine', this.env(at, 0.3, 0.005, 0.6), 0.65, 52);
    this.burst(at, 0.08, 'lowpass', 400, this.env(at, 0.1, 0.004, 0.12));
  }

  private hoof(peak: number, freq: number): void {
    const at = this.ctx!.currentTime + 0.01;
    this.burst(at, 0.03, 'bandpass', freq, this.env(at, peak, 0.002, 0.045));
  }

  private gull(): void {
    const at = this.ctx!.currentTime + 0.05;
    const calls = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < calls; i++) {
      const s = at + i * (0.32 + Math.random() * 0.1);
      const f = 1250 + Math.random() * 250;
      this.tone(s, f, 'triangle', this.env(s, 0.022, 0.03, 0.26), 0.3, f * 0.62);
    }
  }

  private owl(): void {
    const at = this.ctx!.currentTime + 0.05;
    this.tone(at, 410, 'sine', this.env(at, 0.05, 0.05, 0.3), 0.36, 380);
    this.tone(at + 0.62, 420, 'sine', this.env(at + 0.62, 0.05, 0.06, 0.65), 0.75, 360);
  }
}

export const sound = new DeskSound();
