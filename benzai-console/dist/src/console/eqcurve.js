// Curva de respuesta de la tira (HPF, LPF y EQ de 4 bandas) para dibujarla en la consola.
// MISMAS formulas que engine/src/core/dsp.cpp (SVF TPT de A. Simper) y que compile_strip(): la
// curva es la respuesta exacta del filtro que aplica el motor. Se comprueba en la prueba de la UI
// contra los valores de referencia del motor (-3,01 dB en fc, ganancia de la campana en su centro...).
const BUTTERWORTH_Q = Math.SQRT1_2;
const MAX_FREQ_FRACTION = 0.45;
function warp(fc, rate) {
    const f = Math.max(1, Math.min(fc, MAX_FREQ_FRACTION * rate));
    return Math.tan((Math.PI * f) / rate);
}
export const identity = (fc, rate) => ({ g: warp(fc, rate), k: 1 / BUTTERWORTH_Q, m0: 1, m1: 0, m2: 0 });
export function highpass(fc, rate) {
    const k = 1 / BUTTERWORTH_Q;
    return { g: warp(fc, rate), k, m0: 1, m1: -k, m2: -1 };
}
export const lowpass = (fc, rate) => ({ g: warp(fc, rate), k: 1 / BUTTERWORTH_Q, m0: 0, m1: 0, m2: 1 });
export function bell(fc, rate, q, db) {
    const a = Math.pow(10, db / 40);
    const k = 1 / (q * a);
    return { g: warp(fc, rate), k, m0: 1, m1: k * (a * a - 1), m2: 0 };
}
export function lowShelf(fc, rate, db) {
    const a = Math.pow(10, db / 40);
    const k = 1 / BUTTERWORTH_Q;
    return { g: warp(fc, rate) / Math.sqrt(a), k, m0: 1, m1: k * (a - 1), m2: a * a - 1 };
}
export function highShelf(fc, rate, db) {
    const a = Math.pow(10, db / 40);
    const k = 1 / BUTTERWORTH_Q;
    return { g: warp(fc, rate) * Math.sqrt(a), k, m0: a * a, m1: k * (1 - a) * a, m2: 1 - a * a };
}
/** |H(f)| de una etapa: y = m0 + m1*BP + m2*LP con s = j*tan(pi f/fs)/g. */
export function magnitude(c, f, rate) {
    const w = Math.tan((Math.PI * Math.min(f, 0.4999 * rate)) / rate) / c.g;
    // den = s^2 + k s + 1 = (1 - w^2) + j k w
    const dr = 1 - w * w;
    const di = c.k * w;
    const dd = dr * dr + di * di;
    // BP = s/den = j w / den ; LP = 1/den
    const bpR = (w * di) / dd;
    const bpI = (w * dr) / dd;
    const lpR = dr / dd;
    const lpI = -di / dd;
    const re = c.m0 + c.m1 * bpR + c.m2 * lpR;
    const im = c.m1 * bpI + c.m2 * lpI;
    return Math.hypot(re, im);
}
export function stages(s, rate) {
    const on = s.eqOn;
    return [
        s.hpfOn ? highpass(s.hpfHz, rate) : identity(s.hpfHz, rate),
        s.lpfOn ? lowpass(s.lpfHz, rate) : identity(s.lpfHz, rate),
        lowShelf(s.low.f, rate, on ? s.low.g : 0),
        bell(s.lmid.f, rate, s.lmid.q, on ? s.lmid.g : 0),
        bell(s.hmid.f, rate, s.hmid.q, on ? s.hmid.g : 0),
        highShelf(s.high.f, rate, on ? s.high.g : 0),
    ];
}
export function responseDb(s, f, rate) {
    let m = 1;
    for (const c of stages(s, rate))
        m *= magnitude(c, f, rate);
    return 20 * Math.log10(Math.max(m, 1e-12));
}
/** Curva estatica del compresor (entrada dBFS -> salida dBFS), misma formula que el motor. */
export function compCurveDb(inDb, thr, ratio, knee, makeup) {
    const over = inDb - thr;
    const slope = 1 / ratio - 1;
    let gc = 0;
    if (2 * over >= knee)
        gc = slope * over;
    else if (2 * over > -knee)
        gc = (slope * (over + knee / 2) ** 2) / (2 * knee);
    return inDb + gc + makeup;
}
