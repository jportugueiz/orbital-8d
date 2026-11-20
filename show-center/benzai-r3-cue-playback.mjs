// BENZAI · reproducción de cues con tiempos y tracking (15/11, auditoría «a la altura de una MA / Martin»).
// Lógica pura (sin DOM ni three): se prueba en tests/test_cue_playback.mjs.
//  · Tracking: un cue grabado con tracking guarda SOLO lo que cambió respecto del estado acumulado del cue anterior;
//    al reproducirlo se hereda todo lo demás (como en grandMA / Martin M-series).
//  · Tiempos: delay (espera antes de empezar) y fade (cruce). Intensidad, color, posición y ópticas cruzan suave;
//    gobo, relación y movimiento automático cambian al inicio. Un equipo que se apaga baja a 0 y recién al final queda apagado.
export const NUMERIC_KEYS = ['level', 'pan', 'tilt', 'iris', 'zoom', 'focus', 'frost', 'speed', 'parAngle', 'parBearing'];
export const TIMING_LIMITS = Object.freeze({ fade: [0, 600], delay: [0, 600] });

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function clampTiming(t = {}) {
  const f = Number(t.fade), d = Number(t.delay);
  return { fade: Number.isFinite(f) ? Math.min(600, Math.max(0, f)) : 0, delay: Number.isFinite(d) ? Math.min(600, Math.max(0, d)) : 0 };
}
// Estado completo (por equipo) de cada cue de la lista, resolviendo el tracking en orden.
export function trackedStates(cues) {
  const out = []; let acc = { fixtures: {}, master: 1, environment: undefined };
  for (const cue of cues) {
    const s = cue.state || {};
    const fixtures = s.tracked ? { ...acc.fixtures, ...clone(s.fixtures || {}) } : clone(s.fixtures || {});
    acc = { fixtures, master: typeof s.master === 'number' ? s.master : acc.master, environment: s.environment ? clone(s.environment) : acc.environment };
    out.push(clone(acc));
  }
  return out;
}
// Lo que cambió entre dos estados completos (solo equipos distintos).
export function deltaFixtures(prev, now) {
  const d = {}; for (const [id, v] of Object.entries(now || {})) if (!prev || !same(prev[id], v)) d[id] = clone(v); return d;
}
const hex = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
export function mixColor(a, b, k) { const A = hex(a), B = hex(b); return toHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k); }
// Valor de un equipo en la fracción k (0..1) del cruce.
export function mixFixture(from, to, k) {
  if (!to) return from ? clone(from) : undefined;
  const a = from || { ...to, enabled: false, level: 0 };
  const out = { ...clone(to) };
  // «enabled» ausente = encendido (los estados del programador no siempre lo guardan; solo false apaga).
  const aOn = a.enabled !== false, bOn = to.enabled !== false;
  const aLevel = aOn ? (a.level ?? 0) : 0, bLevel = bOn ? (to.level ?? 0) : 0;
  for (const key of NUMERIC_KEYS) if (typeof to[key] === 'number') out[key] = typeof a[key] === 'number' ? a[key] + (to[key] - a[key]) * k : to[key];
  out.level = aLevel + (bLevel - aLevel) * k;
  if ('enabled' in to || 'enabled' in a) out.enabled = k >= 1 ? bOn : (bOn || aOn);
  if (k >= 1 && !bOn) out.level = to.level ?? 0;
  if (!bOn && k < 1) out.color = a.color || to.color; // apagándose: conserva su color hasta el negro
  else out.color = (aOn && a.color && to.color) ? mixColor(a.color, to.color, k) : (to.color ?? a.color);
  return out;
}
export class CuePlayer {
  constructor() { this.active = false; this.paused = false; }
  // from: Map/obj de valores actuales; target: estado completo {fixtures, master, environment}; ahora en segundos.
  go({ from, fromMaster, fromEnvironment, target, timing, now, index }) {
    const t = clampTiming(timing);
    this.from = clone(from || {}); this.fromMaster = fromMaster; this.fromEnv = fromEnvironment ? clone(fromEnvironment) : null;
    this.target = clone(target); this.timing = t; this.start = now; this.pausedAt = null; this.pausedTotal = 0;
    this.active = true; this.paused = false; this.index = index; this.progress = 0;
  }
  pause(now) { if (!this.active) return; if (this.paused) { this.pausedTotal += now - this.pausedAt; this.pausedAt = null; this.paused = false; } else { this.pausedAt = now; this.paused = true; } }
  fraction(now) {
    const t = (this.paused ? this.pausedAt : now) - this.start - this.pausedTotal - this.timing.delay;
    if (t < 0) return 0; return this.timing.fade <= 0 ? 1 : Math.min(1, t / this.timing.fade);
  }
  // Devuelve {fixtures, master, environment, done} o null si no hay cruce activo.
  tick(now) {
    if (!this.active) return null;
    const k = this.fraction(now); this.progress = k;
    const ids = new Set([...Object.keys(this.from), ...Object.keys(this.target.fixtures || {})]);
    const fixtures = {};
    for (const id of ids) { const v = mixFixture(this.from[id], (this.target.fixtures || {})[id], k); if (v) fixtures[id] = v; }
    const master = typeof this.target.master === 'number' ? (typeof this.fromMaster === 'number' ? this.fromMaster + (this.target.master - this.fromMaster) * k : this.target.master) : this.fromMaster;
    let environment = this.target.environment;
    if (environment && this.fromEnv) environment = { haze: this.fromEnv.haze + (environment.haze - this.fromEnv.haze) * k, smoke: this.fromEnv.smoke + (environment.smoke - this.fromEnv.smoke) * k, house: environment.house };
    const done = k >= 1; if (done) this.active = false;
    return { fixtures, master, environment, done, k };
  }
}
