// Escalas, pasos y formato de los parametros a partir del catalogo UNICO generado (schema/parameters.json).
// La interfaz no inventa rangos: min, max, valor por defecto y unidad vienen del esquema del motor.
import { PARAMS } from "../../generated/params.js";
const byPattern = new Map(PARAMS.map((p) => [p.pattern, p]));
// Todos los indices de ruta del esquema: {i} canal, {k} AUX, {f} FX, {d} DCA, {g} grupo de mute, {o} ranura.
const compiled = PARAMS.map((p) => [new RegExp("^" + p.pattern.replace(/\./g, "\\.").replace(/\{[a-z]\}/g, "[1-9][0-9]{0,2}") + "$"), p]);
const cache = new Map();
/** "ch.5.eq.lmid.q" -> "ch.{i}.eq.lmid.q"; "fx.2.time_ms" -> "fx.{f}.time_ms"; "out.3.source" -> "out.{o}.source". */
export function patternOf(path) {
    return descOf(path)?.pattern ?? path;
}
export function descOf(path) {
    if (cache.has(path))
        return cache.get(path);
    const d = byPattern.get(path) ?? compiled.find(([re]) => re.test(path))?.[1];
    cache.set(path, d);
    return d;
}
/** Escala logaritmica para frecuencias, tiempos, Q y relacion; lineal para dB y el resto. */
function isLog(d) {
    return (d.unit === "Hz" || d.unit === "ms" || d.unit === "s" || d.unit === ":1" || d.pattern.endsWith(".q")) && d.min >= 0;
}
// Escala logaritmica con desplazamiento: si el minimo es 0 (p. ej. mantenimiento de la puerta, 0 ms)
// se usa log(1 + v), de modo que 0 sea alcanzable y el recorrido sea monotono (auditoria DG-010).
function logOffset(d) {
    return d.min > 0 ? 0 : 1;
}
export function toNorm(d, v) {
    if (isLog(d)) {
        const o = logOffset(d);
        const lo = d.min + o, hi = d.max + o;
        return Math.max(0, Math.min(1, Math.log(Math.max(v + o, lo) / lo) / Math.log(hi / lo)));
    }
    return Math.max(0, Math.min(1, (v - d.min) / (d.max - d.min)));
}
export function fromNorm(d, n) {
    const x = Math.max(0, Math.min(1, n));
    let v;
    if (isLog(d)) {
        const o = logOffset(d);
        const lo = d.min + o, hi = d.max + o;
        v = lo * Math.pow(hi / lo, x) - o;
    }
    else {
        v = d.min + x * (d.max - d.min);
    }
    return clampRound(d, v);
}
/** Resolucion del valor enviado (la misma con la que se muestra: lo que se ve es lo que se envia). */
export function resolution(d, v) {
    if (d.type === "int" || d.type === "enum")
        return 1;
    if (d.unit === "Hz")
        return d.max <= 10 ? 0.01 : v < 1000 ? 1 : 10; // velocidad del chorus: centesimas
    if (d.unit === "s")
        return 0.01;
    if (d.unit === "")
        return 0.01; // magnitudes 0..1 (tamano, mezcla, realimentacion...): 1 %
    if (d.unit === "ms")
        return v < 10 ? 0.01 : v < 100 ? 0.1 : 1;
    if (d.pattern.endsWith(".q"))
        return 0.01;
    return 0.1; // dB, dBFS y relacion (x:1)
}
/** Redondeo a la resolucion y siempre dentro del rango del motor. */
export function clampRound(d, v) {
    const r = resolution(d, v);
    const q = Math.round(v / r) * r;
    return Math.max(d.min, Math.min(d.max, Number(q.toFixed(2))));
}
/** Un paso de rueda/teclado: 1/100 del recorrido (1/1000 en fino), al menos una unidad de resolucion. */
export function stepValue(d, v, dir, fine) {
    if (dir === 0)
        return v;
    const next = fromNorm(d, toNorm(d, v) + dir * (fine ? 0.002 : 0.01));
    if (next !== v)
        return next;
    // El redondeo devolvio el mismo valor: avanzar exactamente una unidad de resolucion.
    return clampRound(d, v + dir * resolution(d, v + (dir > 0 ? 0 : -1e-9)));
}
const fmt1 = (v) => v.toFixed(1).replace(".", ",").replace("-", "−");
/** Nombres de los valores enumerados tal como los ve el operador. */
const ENUM_LABEL = {
    off: "OFF", hall: "HALL", plate: "PLATE", room: "ROOM", delay: "DELAY", pingpong: "PING-PONG", chorus: "CHORUS",
    sine: "SENO", pink: "RUIDO ROSA", main: "MAIN", aux1: "AUX 1", aux2: "AUX 2", aux3: "AUX 3", aux4: "AUX 4",
    none: "NINGUNA", main_l: "MAIN L", main_r: "MAIN R", mon_l: "MON L", mon_r: "MON R",
    peak: "PICO", rms: "RMS", "12": "12 dB", "18": "18 dB", "24": "24 dB",
};
export function enumLabel(name) {
    return ENUM_LABEL[name] ?? name.toUpperCase();
}
export function formatValue(d, v) {
    if (!d)
        return String(v);
    if (d.type === "enum")
        return enumLabel(d.values[v] ?? String(v));
    if (d.type === "int")
        return v === 0 ? "Ninguna" : `Entrada ${v}`;
    if (d.offAtMin && v <= d.min)
        return "−∞";
    switch (d.unit) {
        case "s":
            return `${v.toFixed(2).replace(".", ",")} s`;
        case "":
            if (d.pattern.endsWith(".pan"))
                return v === 0 ? "C" : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
            if (!d.pattern.endsWith(".q") && d.min >= 0 && d.max <= 1)
                return `${Math.round(v * 100)} %`;
            break;
        case "Hz":
            if (d.max <= 10)
                return `${v.toFixed(2).replace(".", ",")} Hz`;
            return v >= 1000 ? `${(v / 1000).toFixed(2).replace(".", ",")} kHz` : `${Math.round(v)} Hz`;
        case "ms":
            return `${v < 10 ? v.toFixed(2).replace(".", ",") : v < 100 ? v.toFixed(1).replace(".", ",") : Math.round(v)} ms`;
        case ":1":
            return `${v.toFixed(1).replace(".", ",")}:1`;
        case "dBFS":
            return `${fmt1(v)} dBFS`;
        case "dB":
            // El rango de la puerta es una atenuacion: se muestra en negativo.
            if (d.pattern.endsWith("gate.range_db"))
                return v === 0 ? "0,0 dB" : `−${fmt1(v)} dB`;
            return `${v > 0 ? "+" : ""}${fmt1(v)} dB`;
    }
    return d.pattern.endsWith(".q") ? `Q ${v.toFixed(2).replace(".", ",")}` : String(v);
}
