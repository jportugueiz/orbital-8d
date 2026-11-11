// Ley de fader y utilidades numericas de la consola (funciones puras, probadas en ui/test).
// Recorrido estilo consola de directo: +10 arriba, 0 dB al 76 % del recorrido, -inf abajo.
export const OFF_DB = -144;
const LAW = [
    [OFF_DB, 0.0],
    [-80, 0.025],
    [-60, 0.06],
    [-40, 0.17],
    [-30, 0.27],
    [-20, 0.39],
    [-10, 0.56],
    [-5, 0.66],
    [0, 0.76],
    [5, 0.88],
    [10, 1.0],
];
/** dB -> posicion 0..1 del recorrido. */
export function dbToPos(db) {
    if (!Number.isFinite(db) || db <= OFF_DB)
        return 0;
    if (db >= 10)
        return 1;
    for (let i = 1; i < LAW.length; i++) {
        const [d1, p1] = LAW[i];
        const [d0, p0] = LAW[i - 1];
        if (db <= d1)
            return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
    }
    return 1;
}
/** Posicion 0..1 -> dB, redondeado a 0,1 dB; por debajo del 1 % es apagado (-144, "-inf"). */
export function posToDb(pos, maxDb = 10) {
    if (!(pos > 0.01))
        return OFF_DB;
    if (pos >= 1)
        return Math.min(10, maxDb);
    for (let i = 1; i < LAW.length; i++) {
        const [d1, p1] = LAW[i];
        const [d0, p0] = LAW[i - 1];
        if (pos <= p1) {
            const db = d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
            return Math.min(maxDb, Math.round(db * 10) / 10);
        }
    }
    return maxDb;
}
/** Paso fino de teclado/rueda: limita al rango y redondea a 0,1 dB. Bajar desde -60 apaga. */
export function stepDb(db, delta, min = OFF_DB, max = 10) {
    if (db <= OFF_DB)
        return delta > 0 ? Math.min(max, Math.max(min, -60)) : Math.max(min, OFF_DB);
    let v = Math.round((db + delta) * 10) / 10;
    if (v < -60 && min <= OFF_DB)
        v = delta < 0 ? OFF_DB : -60;
    return Math.max(min, Math.min(max, v));
}
export function formatDb(db) {
    // Formato unico de la consola: coma decimal y signo menos tipografico (DG 30-10).
    if (!Number.isFinite(db) || db <= OFF_DB)
        return "−∞";
    const r = Math.round(db * 10) / 10;
    return ((r > 0 ? "+" : "") + r.toFixed(1)).replace(".", ",").replace("-", "−");
}
export function formatPan(p) {
    if (Math.abs(p) < 0.005)
        return "C";
    const v = Math.round(Math.abs(p) * 100);
    return (p < 0 ? "L" : "R") + v;
}
/** Medidor: dBFS -> fraccion 0..1 de la barra (escala -60..+6 dBFS, lineal en dB). */
export function meterFrac(dbfs) {
    if (!Number.isFinite(dbfs) || dbfs <= -60)
        return 0;
    return Math.min(1, (dbfs + 60) / 66);
}
/** Canales visibles por banco segun el ancho disponible para tiras (DG: >=1303 px -> 12, >=1085 -> 10...). */
export function bankSize(widthPx, stripPx, gapPx, edition) {
    // n tiras caben si n*tira + (n-1)*hueco <= ancho  (12*104 + 11*5 = 1303; 10*104 + 9*5 = 1085).
    const fit = Math.floor((widthPx + gapPx) / (stripPx + gapPx));
    for (const n of [16, 14, 12, 10, 8, 6, 4, 2])
        if (n <= fit && n <= edition)
            return n;
    return Math.min(2, edition);
}
/** Tiempo de sesion hh:mm:ss a partir de muestras procesadas por el motor. */
export function formatClock(frames, rate) {
    if (!(rate > 0))
        return "--:--:--";
    const s = Math.floor(frames / rate);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return [hh, mm, ss].map((x) => String(x).padStart(2, "0")).join(":");
}
