// P2 · Nombres, colores y textos de escenas en la consola. Funciones puras (sin DOM salvo fitLabel).
// Las reglas de texto son las MISMAS que aplica el motor (check_short_text en engine/src/core/show.cpp):
// la interfaz avisa antes de enviar, pero la verdad es siempre la respuesta del motor.
import { COLOR_PALETTE, NAME_MAX_CHARS } from "../../generated/params.js";
import { descOf, formatValue, enumLabel } from "./params_ui.js";
const pad2 = (n) => String(n).padStart(2, "0");
/** Nombre por defecto de cada elemento (lo que la consola muestra con el nombre vacio). */
export function defaultLabel(kind, n) {
    switch (kind) {
        case "ch": return `CH ${pad2(n)}`;
        case "aux": return `AUX ${n}`;
        case "fx": return `FX ${n}`;
        case "grp": return `GRP ${n}`;
        case "dca": return `DCA ${n}`;
        case "mg": return `MUTE ${n}`;
    }
}
/** Ruta del parametro de nombre / color de un elemento. */
export function namePath(kind, n) {
    return `${kind === "mg" ? "mutegroup" : kind}.${n}.name`;
}
export function colorPath(kind, n) {
    return `${kind === "mg" ? "mutegroup" : kind}.${n}.color`;
}
/** Color CSS de un indice de la paleta fija (0 = sin color: devuelve ""). */
export function paletteCss(i) {
    return typeof i === "number" && i > 0 ? COLOR_PALETTE[i]?.css ?? "" : "";
}
/** Normaliza lo que teclea el operador: sin espacios al principio/final ni dobles (el motor los rechaza). */
export function normalizeName(s) {
    return s.replace(/\s+/g, " ").trim();
}
/** Puntos de codigo de un texto (lo que cuenta el motor; los caracteres combinantes cuentan uno). */
export function codePoints(s) {
    return [...s].length;
}
/** "" si el nombre es valido para el motor; si no, el motivo en castellano. */
export function nameProblem(s, max = NAME_MAX_CHARS) {
    for (const ch of s) {
        const cp = ch.codePointAt(0);
        if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f))
            return "caracteres de control no permitidos";
        if (cp === 0x200e || cp === 0x200f || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0x2028 ||
            cp === 0x2029 || cp === 0xfeff || (cp >= 0xfdd0 && cp <= 0xfdef) || (cp & 0xfffe) === 0xfffe || (cp >= 0xd800 && cp <= 0xdfff))
            return "carácter no permitido";
    }
    if (s !== normalizeName(s))
        return "espacios al principio, al final o dobles";
    if (codePoints(s) > max)
        return `máximo ${max} caracteres`;
    if (new TextEncoder().encode(s).length > 128)
        return "demasiado largo";
    return "";
}
/** Propietario legible de una ruta: "ch.3.eq..." -> "CH 03"; "fx.2.aux.1..." -> "FX 2". */
export function ownerOf(path, nameOf) {
    const p = path.split(".");
    const n = Number(p[1]);
    switch (p[0]) {
        case "ch": return nameOf("ch", n);
        case "aux": return nameOf("aux", n);
        case "fx": return nameOf("fx", n);
        case "grp": return nameOf("grp", n);
        case "dca": return nameOf("dca", n);
        case "mutegroup": return nameOf("mg", n);
        case "out": return `RANURA ${n}`;
        case "main": return "MAIN";
        case "mon": return "MON";
        case "osc": return "OSCILADOR";
        case "show": return "SHOW";
        default: return p[0].toUpperCase();
    }
}
/** Valor de un parametro tal como lo lee el operador (diff de escenas). */
export function displayValue(path, v) {
    const d = descOf(path);
    if (typeof v === "boolean")
        return v ? "SÍ" : "NO";
    if (typeof v === "string")
        return v === "" ? "(sin nombre)" : `«${v}»`;
    if (typeof v !== "number")
        return "—";
    if (!d)
        return String(v);
    if (d.pattern.endsWith(".color"))
        return COLOR_PALETTE[v]?.labelEs ?? String(v);
    if (d.type === "enum")
        return enumLabel(d.values[v] ?? String(v));
    if (d.type === "db" && d.offAtMin && v <= d.min)
        return "−∞";
    if (d.type === "db" && d.unit === "dB")
        return `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",").replace("-", "−")} dB`;
    return formatValue(d, v);
}
/** Etiqueta corta del parametro (sin el propietario): "Fader de canal", "EQ graves: ganancia"... */
export function paramLabel(path) {
    const d = descOf(path);
    if (!d)
        return path;
    // La etiqueta del esquema puede llevar una explicacion entre parentesis: se omite en la lista.
    let l = d.labelEs.replace(/\s*\(.*\)\s*$/, "");
    // Segundo indice de la ruta (envio a AUX 2, miembro del DCA 3...).
    const m = d.pattern.match(/\{([kfdgno])\}[^{]*$/);
    const p = path.split(".");
    if (m && p.length >= 4) {
        const idx = path.match(/\.(\d+)\.[a-z_]+$/)?.[1] ?? path.match(/\.(\d+)$/)?.[1];
        const what = { k: "AUX", f: "FX", d: "DCA", g: "grupo", n: "GRP", o: "ranura" };
        if (idx && d.pattern.split(".").filter((x) => x.startsWith("{")).length === 2)
            l += ` ${what[m[1]] ?? ""} ${idx}`;
    }
    return l;
}
/**
 * Ajusta un rotulo de una sola linea a su caja: reduce la letra hasta 12 px y, si aun no cabe, lo abrevia
 * (el nombre completo queda en title y en el nombre accesible). Nunca deja texto recortado por CSS.
 */
export function fitLabel(el, full, maxW) {
    if (el.dataset.full === full && el.dataset.fitw === String(Math.round(maxW)))
        return;
    el.dataset.full = full;
    el.dataset.fitw = String(Math.round(maxW));
    el.style.fontSize = "";
    el.textContent = full;
    el.title = full;
    if (maxW <= 0)
        return;
    // Anchura del TEXTO (no de la caja: un rotulo de bloque ocupa toda su celda).
    const rg = document.createRange();
    const w = () => {
        rg.selectNodeContents(el);
        return rg.getBoundingClientRect().width;
    };
    let fs = parseFloat(getComputedStyle(el).fontSize) || 14;
    while (w() > maxW && fs > 12) {
        fs = Math.max(12, fs - 1);
        el.style.fontSize = `${fs}px`;
    }
    if (w() <= maxW)
        return;
    const chars = [...full];
    for (let n = chars.length - 1; n > 0; n--) {
        el.textContent = chars.slice(0, n).join("").trimEnd() + "…";
        if (w() <= maxW)
            return;
    }
}
