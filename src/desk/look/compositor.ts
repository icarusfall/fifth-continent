// The shader pass (spec §15.1, option B): Canvas 2D draws the scene; ONE
// WebGL2 fragment shader composites it to the screen, adding only what 2D
// cannot — refraction and glints on water, foam working the shore, the tide
// visibly flooding the flats, wind across the fields, bloom round every lamp
// with its light laid on the water, fog that drifts and thins near light, and
// a colour grade by the hour. Nothing here is read by the sim, and nothing
// here says anything the 2D fallback does not also show.

import { TILE } from '../../shared/geometry';
import type { Mask } from './terrain';

export interface Lamp {
  x: number; // world px
  y: number;
  r: number; // world px
  i: number; // 0..1
  rgb: [number, number, number]; // 0..1
}

export interface FrameParams {
  camX: number;
  camY: number;
  /** device px per world px */
  scale: number;
  time: number;
  dark: number;
  dusk: number;
  tide: number;
  lamps: Lamp[];
}

const MAX_LAMPS = 32;

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene, uMask;
uniform vec2 uRes, uCam; uniform float uScale, uTile, uTime, uDark, uDusk, uTide;
uniform vec4 uMaskRect; // x0, y0, w, h in world px
uniform vec4 uL[${MAX_LAMPS}]; uniform vec3 uC[${MAX_LAMPS}]; uniform int uN;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.03 + 1.7; a *= 0.5; } return v; }
vec2 maskUV(vec2 world){ return (world - uMaskRect.xy) / uMaskRect.zw; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = px / uRes;
  vec2 world = px / uScale + uCam;
  vec2 w = world / uTile;                          // tiles: effects pinned to the land
  vec2 muv = maskUV(world);
  vec4 mk = texture(uMask, muv);
  float m = mk.r;                                  // water
  float near = mk.g;                               // nearness to the sea
  // the tide over the flats: the higher the water, the further it reaches
  float thr = 1.0 - uTide * 0.62;
  float flood = (1.0 - m) * smoothstep(thr, thr + 0.07, near);
  float wetv = max(m, flood);
  vec2 rip = vec2(fbm(w*1.4 + vec2(uTime*0.18, 0.0)), fbm(w*1.4 + vec2(3.1, uTime*0.14))) - 0.5;
  // a ripple a fixed size in the world (a quarter-tile), not a fraction of the screen
  vec3 col = texture(uScene, uv + rip * (0.22 * uTile * uScale / uRes) * wetv).rgb;
  vec3 sea = mix(vec3(0.32, 0.43, 0.46), vec3(0.17, 0.22, 0.26), uDark);
  col = mix(col, sea, flood * 0.62);
  float fedge = flood * (1.0 - flood) * 4.0;
  col = mix(col, vec3(0.9, 0.88, 0.83), fedge * 0.45 * (1.0 - uDark*0.4));
  float glint = smoothstep(0.62, 0.8, noise(w*vec2(4.0, 11.0) + vec2(uTime*0.25, 0.0)) * noise(w*vec2(5.5, 9.0) - vec2(0.0, uTime*0.2)) * 2.0);
  col += wetv * glint * mix(vec3(0.07), vec3(0.04, 0.05, 0.09), uDark);
  // foam working the shoreline
  float b = 0.0; for (int i = 0; i < 8; i++){ float a = float(i) * 0.785; b += texture(uMask, maskUV(world + vec2(cos(a), sin(a)) * 0.6 * uTile)).r; } b /= 8.0;
  // only the sea's shore works: a dyke or the inland water lies still (near = 0 there)
  float shore = clamp(m * (1.0 - b) * 3.0, 0.0, 1.0) * smoothstep(0.6, 0.95, near);
  float foam = smoothstep(0.42, 0.75, fbm(w*2.6 + vec2(uTime*0.35, -uTime*0.12))) * shore;
  col = mix(col, vec3(0.9, 0.88, 0.83), foam * mix(0.6, 0.3, uDark));
  // wind across the fields
  float land = 1.0 - wetv;
  float gust = smoothstep(0.55, 0.78, fbm(vec2(w.x*0.45 - uTime*0.55, w.y*1.3 + uTime*0.05)));
  col *= 1.0 + land * (gust * 0.065 * (1.0 - uDark*0.6) + (fbm(w*0.3 + uTime*0.03) - 0.5) * 0.06);
  // lamps: bloom, and their light laid on the water as a broken column
  float lit = 0.0;
  for (int i = 0; i < ${MAX_LAMPS}; i++){ if (i >= uN) break; vec4 L = uL[i]; vec2 d = (px - L.xy) / L.z;
    float g = exp(-dot(d, d) * 3.0) * L.w; lit += g;
    col += uC[i] * g * 0.3 * uDark;
    if (d.y > 0.0) { float streak = exp(-d.x*d.x*50.0) * exp(-d.y*0.8) * step(0.5, noise(vec2(w.x*3.0, w.y*9.0 - uTime*1.5)));
      col += uC[i] * streak * wetv * 0.45 * L.w * uDark; } }
  // fog that drifts, and thins near light
  float f = smoothstep(0.45, 0.86, fbm(w*0.2 + vec2(uTime*0.03, uTime*0.008)));
  vec3 fogC = mix(vec3(0.86, 0.85, 0.8), vec3(0.3, 0.34, 0.43), uDark);
  col = mix(col, fogC, f * (0.1 + 0.26*uDark) * (1.0 - clamp(lit, 0.0, 1.0)));
  // grade: cool moonlit shadows, warm dusk
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, mix(vec3(lum)*vec3(0.72, 0.84, 1.12), col, clamp(lit*1.5, 0.0, 1.0)), uDark * 0.5);
  col *= mix(vec3(1.0), vec3(1.08, 0.96, 0.84), uDusk * 0.5);
  vec2 v = uv - 0.5; col *= 1.0 - 0.22 * dot(v, v) * 1.6;
  col += (hash(px + fract(uTime)) - 0.5) * 0.018;
  o = vec4(col, 1.0);
}`;

export class Compositor {
  readonly ok: boolean;
  private gl: WebGL2RenderingContext | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private texScene: WebGLTexture | null = null;
  private texMask: WebGLTexture | null = null;
  private maskKey = '';
  private maskRect: [number, number, number, number] = [0, 0, 1, 1];

  constructor(canvas: HTMLCanvasElement) {
    let ok = false;
    try {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
      if (gl) {
        const sh = (t: number, src: string) => {
          const x = gl.createShader(t)!;
          gl.shaderSource(x, src);
          gl.compileShader(x);
          if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? 'shader');
          return x;
        };
        const pr = gl.createProgram()!;
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT));
        gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) ?? 'link');
        gl.useProgram(pr);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(pr, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ['uScene', 'uMask', 'uRes', 'uCam', 'uScale', 'uTile', 'uTime', 'uDark', 'uDusk', 'uTide', 'uMaskRect', 'uN'])
          this.u[n] = gl.getUniformLocation(pr, n);
        this.u.uL = gl.getUniformLocation(pr, 'uL[0]');
        this.u.uC = gl.getUniformLocation(pr, 'uC[0]');
        const tex = () => {
          const t = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          return t;
        };
        this.texScene = tex();
        this.texMask = tex();
        gl.uniform1i(this.u.uScene, 0);
        gl.uniform1i(this.u.uMask, 1);
        gl.uniform1f(this.u.uTile, TILE);
        this.gl = gl;
        ok = true;
      }
    } catch (e) {
      console.warn('The shader pass is unavailable; the desk draws in plain 2D.', e);
      this.gl = null;
    }
    this.ok = ok;
  }

  setMask(mask: Mask): void {
    const gl = this.gl;
    if (!gl || mask.key === this.maskKey) return;
    this.maskKey = mask.key;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask.canvas);
    this.maskRect = [mask.x0 * TILE, mask.y0 * TILE, mask.w * TILE, mask.h * TILE];
  }

  render(scene: HTMLCanvasElement, out: HTMLCanvasElement, p: FrameParams): void {
    const gl = this.gl;
    if (!gl) return;
    gl.viewport(0, 0, out.width, out.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texScene);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.uniform2f(this.u.uRes, out.width, out.height);
    gl.uniform2f(this.u.uCam, p.camX, p.camY);
    gl.uniform1f(this.u.uScale, p.scale);
    gl.uniform1f(this.u.uTime, p.time);
    gl.uniform1f(this.u.uDark, p.dark);
    gl.uniform1f(this.u.uDusk, p.dusk);
    gl.uniform1f(this.u.uTide, p.tide);
    gl.uniform4f(this.u.uMaskRect, ...this.maskRect);
    const lamps = p.lamps.slice(0, MAX_LAMPS);
    const l = new Float32Array(MAX_LAMPS * 4);
    const c = new Float32Array(MAX_LAMPS * 3);
    lamps.forEach((lp, i) => {
      l.set([(lp.x - p.camX) * p.scale, (lp.y - p.camY) * p.scale, lp.r * p.scale, lp.i], i * 4);
      c.set(lp.rgb, i * 3);
    });
    gl.uniform4fv(this.u.uL, l);
    gl.uniform3fv(this.u.uC, c);
    gl.uniform1i(this.u.uN, lamps.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
