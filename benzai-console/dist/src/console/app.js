// Consola BENZAI AUDIO · aspecto «Candidata B» (P3, docs/P3_CONSOLA_B.md) sobre el nucleo existente.
//
// Reglas (sin cambios respecto a DG-007/DG-010):
//  - La interfaz no procesa audio: solo envia cambios por el contrato de control y muestra lo que el
//    MOTOR confirma (enviada / aceptada / aplicada) y lo que MIDE (efectiva, medidores post-permiso).
//  - Solo se crean controles para parametros que el motor declara implementados; las funciones que
//    el motor no tiene se muestran como «No disponible», sin controles que envien ordenes.
//  - P3 pantallas (docs/P3_PANTALLAS.md): FX 1-4 reales, envios a FX, DCA y grupos de mute, patch de
//    entrada y de salida, oscilador de prueba. Mismo modelo de confirmacion y la misma seguridad.
//  - Si el motor se desconecta, todos los controles se bloquean y se dice claramente.
//  - PANIC es inmediato; rearmar PANIC, iniciar tras STOP y reanudar una retencion piden confirmacion.
import { ConsoleModel, EngineClient, RequestFailed } from "../protocol.js";
import { AUX_COUNT, COLOR_PALETTE, DCA_COUNT, FX_COUNT, GROUP_COUNT, MUTEGROUP_COUNT, NAME_MAX_CHARS, OUTPUT_SLOTS, SCENE_COUNT, SCENE_FAMILIES, SCENE_NAME_MAX_CHARS, SHOW_NAME_MAX_CHARS } from "../../generated/params.js";
import { colorPath, defaultLabel, displayValue, fitLabel, nameProblem, namePath, normalizeName, ownerOf, paletteCss, paramLabel } from "./names_ui.js";
import { bankSize, dbToPos, formatClock, formatDb, formatPan, meterFrac, OFF_DB, posToDb, stepDb } from "./faderlaw.js";
import { connectTransport } from "./transport.js";
import { compCurveDb, responseDb } from "./eqcurve.js";
import { clampRound, descOf, enumLabel, formatValue, fromNorm, stepValue, toNorm } from "./params_ui.js";
import { FX_CATALOG, FX_ENGINE_EQUIV, FX_FAMILIES } from "./fx_catalog.js";
const OUTPUTS = ["main_l", "main_r", "aux1", "aux2", "aux3", "aux4", "mon_l", "mon_r"];
const OUTPUT_LABEL = {
    main_l: "MAIN L", main_r: "MAIN R", aux1: "AUX 1", aux2: "AUX 2", aux3: "AUX 3", aux4: "AUX 4", mon_l: "MON L", mon_r: "MON R",
};
const STATE_LABEL = { open: "abierta", ramping: "rampa", silent: "silencio", unknown: "sin dato" };
const PHASE_LABEL = {
    confirmed: "confirmado", sending: "enviado", accepted: "aceptado", applied: "aplicado", rejected: "rechazado",
    unknown: "resultado desconocido",
};
const TABS = [["canal", "VISTA GENERAL"], ["eq", "EQ"], ["din", "DINÁMICA"], ["env", "ENVÍOS"]];
const BUS_TABS = [["matriz", "MATRIZ"], ["grupos", "SUBGRUPOS"], ["monitores", "MONITOR"]];
const FX_TABS = [["rack", "RACK"], ["retornos", "RETORNOS"]];
const SCENE_TABS = [["lista", "ESCENAS"], ["safes", "SAFES"], ["nombres", "NOMBRES"]];
const NAME_KINDS = [["ch", "CANALES", 0], ["aux", "AUX", AUX_COUNT], ["fx", "FX", FX_COUNT],
    ["grp", "SUBGRUPOS", GROUP_COUNT], ["dca", "DCA", DCA_COUNT], ["mg", "GRUPOS DE MUTE", MUTEGROUP_COUNT], ["show", "SHOW", 1]];
/** Familias de escena que la consola puede poner en el alcance (las recuperables del esquema). */
const SCOPE_FAMILIES = SCENE_FAMILIES.filter((f) => f.recall);
const FAMILY_SHORT = {
    channel: "CANAL", eq: "EQ", dynamics: "DINÁMICA", sends: "ENVÍOS", fx: "EFECTOS", buses: "BUSES", dca: "DCA", mutegroups: "GRUPOS MUTE",
    names: "NOMBRES", patch: "PATCH", outputs: "SALIDAS", monitor: "MON",
};
/** Escenas por pagina en la pantalla de escenas (10 paginas de 10). */
const SPAGE = 10;
/** Diferencias por pagina en la vista de diferencias. */
const DPAGE = 7;
const DCA_TABS = [["dca", "DCA"], ["mg", "GRUPOS DE MUTE"]];
const ROUTE_TABS = [["salidas", "SALIDAS"], ["entradas", "PATCH ENTRADA"], ["patch", "PATCH SALIDA"]];
// Tipos REALES de efecto del motor (fx.{f}.type, en el orden del esquema) y su familia visual.
const FX_TYPES = ["off", "hall", "plate", "room", "delay", "pingpong", "chorus"];
const FX_FAMILY = { off: "off", hall: "reverb", plate: "reverb", room: "reverb", delay: "delay", pingpong: "delay", chorus: "modulation" };
const FX_FAMILY_LABEL = { off: "APAGADO", reverb: "REVERB · FDN 8 LÍNEAS", delay: "DELAY ESTÉREO", modulation: "MODULACIÓN" };
// Parametros de cada tipo (el motor guarda todos; la consola muestra los que actuan con ese tipo).
const FX_PARAMS = {
    reverb: [["decay_s", "DECAY"], ["size", "TAMAÑO"], ["predelay_ms", "PRE-DELAY"], ["damping", "AMORTIG."], ["mix", "MEZCLA"]],
    delay: [["time_ms", "TIEMPO"], ["feedback", "REALIM."], ["tone_hz", "TONO"], ["mix", "MEZCLA"]],
    modulation: [["rate_hz", "VELOCIDAD"], ["depth", "PROFUND."], ["mix", "MEZCLA"]],
};
const FX_KNOB_COLOR = { reverb: "#7cc4ff", delay: "#ffb224", modulation: "#5ce1a0", off: "#8a95a1" };
const fxTypeName = (i) => (i === undefined ? "" : FX_TYPES[i] ?? "");
/** Canales por pagina en las pantallas de pertenencia y de patch de entrada. */
const GPAGE = 16;
// Colores de las cuatro bandas (identifican la banda en la curva, en su mando y en la lista).
const BAND_COLOR = { low: "#ff8a5c", lmid: "#ffd166", hmid: "#5ce1a0", high: "#7cc4ff" };
const BANDS = [["low", "Grave", "estante"], ["lmid", "Medio-grave", "campana"], ["hmid", "Medio-agudo", "campana"], ["high", "Agudo", "estante"]];
// Texto de un error para el operador. Un resultado desconocido pide comprobar el estado (no dice "fallo").
/** Rampa de reapertura en texto («2 s», «20 ms»), tal como la informa el motor (reopen_ramp_ms). */
const rampText = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0).replace(".", ",")} s` : `${Math.round(ms)} ms`);
/** Revision 03-11: nivel del oscilador encendido que se puede subir sin confirmacion (docs/P3_PANTALLAS.md). */
const OSC_SAFE_DB = -20;
const errText = (e) => {
    const s = e instanceof Error ? e.message : String(e);
    return s.startsWith("RESULTADO DESCONOCIDO") ? s + " — compruebe el estado al reconectar" : s;
};
const $ = (sel, root = document) => {
    const e = root.querySelector(sel);
    if (!e)
        throw new Error(`falta ${sel}`);
    return e;
};
const pad2 = (n) => String(n).padStart(2, "0");
/** Numero con un decimal en el formato unico de la consola (coma y signo menos tipografico). */
const n1 = (v) => v.toFixed(1).replace(".", ",").replace("-", "−");
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
class App {
    model = null;
    view = "consola";
    tab = "canal";
    btab = "matriz";
    page = { kind: "ch", start: 1 };
    /** Envios en faders: 0 = faders de canal; k = los faders de canal manejan el envio a AUX k. */
    sof = 0;
    /** Unidad seleccionada del rack de efectos (FX 1-4). */
    fxUnit = 1;
    dtab = "dca";
    rtab = "salidas";
    // ---- P2: escenas, safes, nombres, retornos de FX y subgrupos ----
    ftab = "rack";
    stab = "lista";
    /** Lista de escenas leida del motor (null: sin leer). */
    scenes = null;
    /** Escena elegida en la pantalla (navegacion: elegir no envia nada). */
    sceneSel = 1;
    /** Primera escena de la pagina visible. */
    scenePage = 1;
    /** Diferencias de la escena elegida frente al estado actual (null: sin calcular). */
    diff = null;
    diffPage = 0;
    /** Revision 03-11: borrador del alcance de una escena EXISTENTE (se guarda solo con «GUARDAR ALCANCE»). */
    scopeEdit = new Map();
    /** Alcance para guardar en una ranura vacia (las escenas existentes guardan el suyo en el motor). */
    scopeDraft = new Set(SCOPE_FAMILIES.filter((f) => f.defaultScope).map((f) => f.id));
    nameKind = "ch";
    scenesSeen = -1;
    /** Sube cuando cambia la maquetacion: los rotulos ajustados se vuelven a medir. */
    fitEpoch = 0;
    historyBusy = false;
    /** Primer canal de la pagina de pertenencia (DCA/grupos) y de patch de entrada. */
    gpage = 1;
    /** Tipo de efecto con el que se dibujo el panel frontal (se redibuja cuando el motor confirma otro). */
    fxPanelType = "";
    /** Golpes de TAP (ms, reloj local) por unidad: el tiempo se calcula en la interfaz y se envia como time_ms. */
    taps = new Map();
    selected = 1;
    novice = false;
    /** Nivel de la interfaz. Solo cambia la presentacion: ninguna orden se envia al motor al cambiarlo. */
    level = "pro";
    fine = false;
    perBank = 14;
    connecting = false;
    lastStatus = {};
    // ---- Dialogo de confirmacion (revision 03-11): UN gestor, como mucho UNA accion pendiente ----
    // Cada dialogo lleva su ficha (token). Abrir otro dialogo, pulsar PANIC o STOP, Escape o perder el motor
    // CANCELAN la accion pendiente. Los botones Aceptar/Cancelar tienen un unico oyente fijo (bindStatic) que
    // solo resuelve la ficha vigente: nunca se apilan oyentes ni se ejecuta una accion oculta.
    dlg = null;
    dlgSeq = 0;
    /** Sube con cada pulsacion de PANIC o STOP: una confirmacion pedida antes ya no se abre ni vale. */
    safetyGen = 0;
    /** PANIC enviado y aun sin respuesta del motor, y fallo persistente de PANIC (revision 03-11). */
    panicPending = null;
    panicFail = null;
    toastTimer = null;
    /** Aviso visible de orden rechazada (revision 03-11): persiste hasta «ENTENDIDO» o el siguiente. */
    opsAlert = null;
    lastOverloads = 0;
    meterLevels = new Map();
    lastFrameTime = performance.now();
    renderQueued = false;
    safetyKey = "";
    init() {
        this.applyLevel();
        this.bindStatic();
        this.layout();
        window.addEventListener("resize", () => {
            this.layout();
            this.placeAlerts();
        });
        requestAnimationFrame((t) => this.tick(t));
        void this.connect();
        setInterval(() => {
            if (!this.model?.connected)
                void this.connect();
            else
                void this.refreshStatus();
        }, 2000);
    }
    // ---------------------------------------------------------------- conexion
    async connect() {
        if (this.connecting)
            return;
        this.connecting = true;
        try {
            const t = await connectTransport();
            if (!t) {
                this.setConnState(false, "sin respuesta del motor");
                return;
            }
            const client = new EngineClient(t);
            const model = new ConsoleModel(client);
            model.onChange(() => this.queueRender());
            model.onReject((r) => this.onRejected(r));
            client.onClosed(() => this.setConnState(false, "conexion cerrada"));
            await model.connect({ meters: true });
            this.model = model;
            // Revision 03-11: cada (re)conexion vuelve a leer las listas (antes la de escenas quedaba vieja: el
            // contador de versiones del modelo nuevo empieza en 0 y coincidia con el visto).
            this.invalidateCaches();
            if (this.selected > model.edition)
                this.selected = 1;
            this.setConnState(true, "");
            this.layout();
            await this.refreshStatus();
        }
        catch (e) {
            this.setConnState(false, String(e));
        }
        finally {
            this.connecting = false;
        }
    }
    async refreshStatus() {
        if (!this.model?.connected)
            return;
        try {
            this.lastStatus = await this.model.status();
            this.queueRender();
        }
        catch {
            /* desconexion: la gestiona onClosed */
        }
    }
    setConnState(ok, why) {
        if (!ok) {
            this.lastStatus = {};
            this.cancelDialog();
            this.historyBusy = false;
            // Revision 03-11: las listas leidas del motor (escenas, diferencias) no sobreviven a la conexion.
            this.invalidateCaches();
            if (this.panicPending) {
                this.panicPending = null;
                this.panicFail = "conexión perdida con PANIC en camino: no se sabe si se aplicó";
            }
        }
        document.body.classList.toggle("disconnected", !ok);
        $("#engine-state").textContent = ok ? "Conectado" : "Desconectado";
        $("#cell-engine").dataset.level = ok ? "ok" : "bad";
        $("#disc-why").textContent = why;
        this.queueRender();
    }
    // ---------------------------------------------------------------- estructura
    bindStatic() {
        document.querySelectorAll(".rail button[data-view]").forEach((b) => b.addEventListener("click", () => {
            this.view = b.dataset.view;
            this.renderNav();
            this.renderMonitor();
        }));
        $("#tabs").addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b)
                return;
            if (b.dataset.tab)
                this.openTab(b.dataset.tab);
            else if (b.dataset.btab)
                this.openBusTab(b.dataset.btab);
            else if (b.dataset.dtab)
                this.openDcaTab(b.dataset.dtab);
            else if (b.dataset.rtab)
                this.openRouteTab(b.dataset.rtab);
            else if (b.dataset.ftab)
                this.openFxTab(b.dataset.ftab);
            else if (b.dataset.stab)
                this.openSceneTab(b.dataset.stab);
        });
        $("#btn-undo").addEventListener("click", () => void this.onUndo(true));
        $("#btn-redo").addEventListener("click", () => void this.onUndo(false));
        document.querySelectorAll(".level-switch button[data-level]").forEach((b) => b.addEventListener("click", () => {
            this.level = b.dataset.level;
            this.applyLevel();
            this.layout();
        }));
        $("#fine-toggle").addEventListener("click", () => {
            this.fine = !this.fine;
            $("#fine-toggle").classList.toggle("sel", this.fine);
            $("#fine-toggle").classList.toggle("on", this.fine);
            $("#fine-toggle").setAttribute("aria-pressed", String(this.fine));
        });
        $("#btn-panic").addEventListener("click", () => void this.onPanic());
        $("#modal-ok").addEventListener("click", () => this.closeDialog(true));
        $("#modal-cancel").addEventListener("click", () => this.closeDialog(false));
        $("#ops-alert-ok").addEventListener("click", () => { this.opsAlert = null; this.renderOpsAlert(); });
        $("#btn-stop").addEventListener("click", () => void this.onStop());
        $("#btn-resume").addEventListener("click", () => void this.onResume());
        document.addEventListener("keydown", (e) => this.onGlobalKey(e));
        // Delegacion: todos los controles de las tiras y del monitor.
        for (const root of [$("#strips"), $("#masters"), $("#monitor-body")]) {
            root.addEventListener("click", (e) => this.onClick(e));
            root.addEventListener("pointerdown", (e) => this.onPointerDown(e));
            root.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
            root.addEventListener("keydown", (e) => this.onKey(e));
            root.addEventListener("dblclick", (e) => this.onDblClick(e));
            root.addEventListener("change", (e) => this.onChange(e));
            // Un borrador de teclado de un selector se descarta al salir de el (nunca se aplica solo).
            root.addEventListener("focusout", (e) => {
                const sel = e.target.closest?.("select[data-kind='sel']");
                if (sel && sel.dataset.draft !== undefined)
                    this.discardSelect(sel);
            });
        }
        $("#banks").addEventListener("click", (e) => {
            const b = e.target.closest("button[data-bank]");
            if (!b)
                return;
            const v = b.dataset.bank;
            this.page = v === "aux" ? { kind: "aux" } : v === "dca" ? { kind: "dca" } : { kind: "ch", start: Number(v) };
            this.sof = 0; // un banco devuelve los faders a su funcion normal
            this.renderStrips();
            this.renderBanks();
            if (this.view === "buses")
                this.renderMonitor();
        });
    }
    applyLevel() {
        this.novice = this.level === "facil";
        document.body.classList.toggle("novice", this.novice);
        for (const l of ["facil", "asistido", "pro"])
            document.body.classList.toggle(`lvl-${l}`, this.level === l);
        document.querySelectorAll(".level-switch button[data-level]").forEach((b) => {
            const on = b.dataset.level === this.level;
            b.classList.toggle("on", on);
            b.setAttribute("aria-checked", String(on));
        });
    }
    layout() {
        this.fitEpoch++;
        const ed = this.model?.edition ?? 16;
        const area = $("#strips");
        const w = area.getBoundingClientRect().width || window.innerWidth - 520;
        const cs = getComputedStyle(document.body);
        const stripW = parseFloat(cs.getPropertyValue("--strip-w")) || (this.novice ? 126 : 96);
        const gap = parseFloat(cs.getPropertyValue("--strip-gap")) || 4;
        this.perBank = bankSize(w, stripW, gap, ed);
        if (this.page.kind === "ch") {
            const s = this.page.start;
            this.page = { kind: "ch", start: Math.max(1, Math.min(s - ((s - 1) % this.perBank), ed)) };
        }
        this.renderBanks();
        this.renderStrips();
        this.renderMasters();
        this.renderNav();
        this.renderMonitor();
    }
    renderNav() {
        document.querySelectorAll(".rail button[data-view]").forEach((b) => {
            const on = b.dataset.view === this.view;
            b.classList.toggle("sel", on);
            b.setAttribute("aria-pressed", String(on));
        });
        document.body.classList.toggle("strip-tab", this.view === "consola" && (this.tab === "eq" || this.tab === "din"));
        document.body.dataset.view = this.view;
        let tabs = "";
        if (this.view === "consola")
            tabs = TABS.map(([t, l]) => `<button class="tab${t === this.tab ? " on active" : ""}" data-tab="${t}" role="tab" aria-selected="${t === this.tab}">${l}</button>`).join("");
        else if (this.view === "buses")
            tabs = BUS_TABS.map(([t, l]) => `<button class="tab${t === this.btab ? " on active" : ""}" data-btab="${t}" role="tab" aria-selected="${t === this.btab}">${l}</button>`).join("");
        else if (this.view === "dca")
            tabs = DCA_TABS.map(([t, l]) => `<button class="tab${t === this.dtab ? " on active" : ""}" data-dtab="${t}" role="tab" aria-selected="${t === this.dtab}">${l}</button>`).join("");
        else if (this.view === "fx")
            tabs = FX_TABS.map(([t, l]) => `<button class="tab${t === this.ftab ? " on active" : ""}" data-ftab="${t}" role="tab" aria-selected="${t === this.ftab}">${l}</button>`).join("");
        else if (this.view === "escenas")
            tabs = SCENE_TABS.map(([t, l]) => `<button class="tab${t === this.stab ? " on active" : ""}" data-stab="${t}" role="tab" aria-selected="${t === this.stab}">${l}</button>`).join("");
        else if (this.view === "routing")
            tabs = ROUTE_TABS.map(([t, l]) => `<button class="tab${t === this.rtab ? " on active" : ""}" data-rtab="${t}" role="tab" aria-selected="${t === this.rtab}">${l}</button>`).join("");
        const tb = $("#tabs");
        if (tb.innerHTML !== tabs)
            tb.innerHTML = tabs;
    }
    openTab(t) {
        this.tab = t;
        this.view = "consola";
        this.renderNav();
        this.layout(); // la altura de la pantalla central cambia en pantallas bajas
    }
    openBusTab(t) {
        this.btab = t;
        this.view = "buses";
        this.renderNav();
        this.renderMonitor();
    }
    openDcaTab(t) {
        this.dtab = t;
        this.view = "dca";
        this.renderNav();
        this.renderMonitor();
    }
    openFxTab(t) {
        this.ftab = t;
        this.view = "fx";
        this.renderNav();
        this.renderMonitor();
    }
    openSceneTab(t) {
        this.stab = t;
        this.view = "escenas";
        this.renderNav();
        this.renderMonitor();
    }
    openRouteTab(t) {
        this.rtab = t;
        this.view = "routing";
        this.renderNav();
        this.renderMonitor();
    }
    renderBanks() {
        const ed = this.model?.edition ?? 16;
        let html = "";
        for (let s = 1; s <= ed; s += this.perBank) {
            const e = Math.min(ed, s + this.perBank - 1);
            const active = !this.sof && this.page.kind === "ch" && this.page.start === s;
            html += `<button class="key bank ch${active ? " sel active" : ""}" data-bank="${s}" aria-pressed="${active}" aria-label="Canales ${s} a ${e}" title="Canales ${s}–${e}"><span class="b1">${s}</span><span class="b2">–${e}</span><small>CANALES</small></button>`;
        }
        const aux = !this.sof && this.page.kind === "aux";
        html += `<button class="key bank${aux ? " sel active" : ""}" data-bank="aux" aria-pressed="${aux}">AUX<small>1–${AUX_COUNT}</small></button>`;
        const dca = !this.sof && this.page.kind === "dca";
        html += `<button class="key bank${dca ? " sel active" : ""}" data-bank="dca" aria-pressed="${dca}">DCA<small>1–${DCA_COUNT}</small></button>`;
        const banks = $("#banks");
        if (banks.innerHTML !== html)
            banks.innerHTML = html;
        this.fitRail();
    }
    /** Revision 03-11: todos los bancos, AUX, DCA y FINO caben SIEMPRE en el carril (16/32/64 canales a
     *  1920 x 1080 y 1366 x 768). Se elige la densidad mas holgada que no desborda: 0 = una columna (diseño B),
     *  1 = bancos en dos columnas, 2 y 3 = teclas mas bajas. Nunca se desplaza el carril. */
    fitRail() {
        const rail = document.querySelector(".rail");
        if (!rail)
            return;
        for (const lvl of [0, 1, 2, 3]) {
            rail.dataset.dense = String(lvl);
            if (rail.scrollHeight <= rail.clientHeight + 1)
                break;
        }
    }
    // ---------------------------------------------------------------- tiras
    faderHtml(path, meters, grKey = "") {
        // Escala a la izquierda de la ranura (fuera del recorrido de la tapa), medidor a la derecha.
        const scale = [10, 5, 0, -5, -10, -20, -30, -40, -60]
            .map((d) => `<span class="${d === 0 ? "z" : [5, -5, -30, -40].includes(d) ? "minor" : ""}" style="bottom:${(dbToPos(d) * 100).toFixed(2)}%">${d > 0 ? "+" + d : d === 0 ? "0" : "−" + -d}</span>`)
            .join("") + `<span class="inf" style="bottom:0">−∞</span>`;
        return `<div class="fader-row">
      <div class="scale" aria-hidden="true">${scale}</div>
      <div class="fader" data-path="${path}" data-kind="fader" tabindex="0" role="slider" aria-label="${path}"
           aria-valuemin="-144" aria-valuemax="10"><div class="slot"></div><div class="cap"><i></i></div></div>
      <div class="meters${meters.length > 1 ? " stereo" : ""}">${meters
            .map((k) => `<div class="meter" data-meter="${k}"><i></i><b></b><em class="clip"></em></div>`)
            .join("")}</div>
      ${grKey ? `<div class="grbar" data-grmeter="${grKey}" aria-hidden="true"><i></i></div>` : ""}
    </div>`;
    }
    renderStrips() {
        this.fitEpoch++;
        const root = $("#strips");
        const deck = $(".deck");
        deck.classList.toggle("sof", this.sof > 0);
        const banner = $("#sof-banner");
        banner.hidden = !this.sof;
        banner.textContent = this.sof ? `FADERS = ENVÍOS A AUX ${this.sof} · pulse un banco para volver` : "";
        if (this.page.kind === "aux" && !this.sof) {
            let html = "";
            for (let k = 1; k <= AUX_COUNT; k++) {
                html += `<div class="strip aux-strip" data-aux="${k}">
          <div class="scribble name"><span class="tag" data-lblc="aux:${k}"></span><span class="num" data-lblnum="aux:${k}">AUX</span><span class="nm fit" data-lbl="aux:${k}">AUX ${k}</span>
            <span class="sub2"><span class="eff" data-eff="aux${k}">—</span><span class="lim" data-lim="aux${k}">LIM</span></span></div>
          <div class="keybed"><button class="key msk toggle on-btn" data-path="aux.${k}.enabled" data-kind="bool" data-on="ON" data-off="OFF">ON</button>
            <button class="key msk m" data-path="aux.${k}.mute" data-kind="bool">MUTE</button></div>
          ${this.faderHtml(`aux.${k}.level_db`, [`out:aux${k}`])}
          <div class="readout" data-readout="aux.${k}.level_db">—</div>
          <div class="phase" data-phase-for="aux.${k}.level_db aux.${k}.mute aux.${k}.enabled"></div>
        </div>`;
            }
            root.innerHTML = html;
            this.queueRender();
            return;
        }
        if (this.page.kind === "dca" && !this.sof) {
            // Banco DCA (P3): 8 tiras de DCA (nivel, mute, miembros) y las 4 teclas de grupo de mute.
            let html = "";
            for (let d = 1; d <= DCA_COUNT; d++) {
                html += `<div class="strip dca-strip" data-dca="${d}">
          <div class="scribble name"><span class="tag" data-lblc="dca:${d}"></span><span class="num" data-lblnum="dca:${d}">DCA</span><span class="nm fit" data-lbl="dca:${d}">DCA ${d}</span>
            <span class="sub2"><span data-members="dca:${d}" data-short="1">—</span></span></div>
          <div class="keybed"><button class="key msk memb" data-dcaedit="${d}" title="Elegir los canales miembros del DCA ${d}">MIEMBROS</button>
            <button class="key msk m" data-path="dca.${d}.mute" data-kind="bool" aria-label="Mute DCA ${d}">MUTE</button></div>
          ${this.faderHtml(`dca.${d}.level_db`, [])}
          <div class="readout" data-readout="dca.${d}.level_db">—</div>
          <div class="phase" data-phase-for="dca.${d}.level_db dca.${d}.mute"></div>
        </div>`;
            }
            let keys = "";
            for (let g = 1; g <= MUTEGROUP_COUNT; g++)
                keys += `<button class="key mgkey" data-path="mutegroup.${g}.on" data-kind="bool" aria-label="Grupo de mute ${g}"><b class="fit" data-lbl="mg:${g}">MUTE ${g}</b><small data-members="mg:${g}" data-short="1">—</small></button>`;
            html += `<div class="mgpanel" role="group" aria-label="Grupos de mute"><div class="mgh">GRUPOS DE MUTE</div><div class="mgkeys">${keys}</div>
        <div class="phase" data-phase-for="${Array.from({ length: MUTEGROUP_COUNT }, (_, i) => `mutegroup.${i + 1}.on`).join(" ")}"></div>
        <button class="sk mgedit" data-mgedit="1">MIEMBROS DE LOS GRUPOS</button></div>`;
            root.innerHTML = html;
            this.queueRender();
            return;
        }
        const ed = this.model?.edition ?? 16;
        const s = this.page.kind === "ch" ? this.page.start : 1;
        const e = Math.min(ed, s + this.perBank - 1);
        let html = "";
        for (let c = s; c <= e; c++) {
            const p = `ch.${c}`;
            const fp = this.sof ? `${p}.aux.${this.sof}.level_db` : `${p}.fader_db`;
            html += `<div class="strip${c === this.selected ? " selected" : ""}" data-ch="${c}">
        <button class="scribble name" data-select="${c}" title="Seleccionar canal ${c}"><span class="tag" data-lblc="ch:${c}"></span><span class="num">${pad2(c)}</span><span class="nm fit" data-lbl="ch:${c}">CH ${pad2(c)}</span></button>
        <div class="fx pro-only" aria-label="Procesado del canal ${c}">
          <button data-fx="${p}.hpf_on" data-fxtab="eq" data-fxch="${c}" title="Paso alto">HPF</button>
          <button data-fx="${p}.eq_on" data-fxtab="eq" data-fxch="${c}" title="Ecualizador">EQ</button>
          <button data-fx="${p}.gate.on" data-fxtab="din" data-fxch="${c}" data-grbadge="gate:${c}" title="Puerta">G</button>
          <button data-fx="${p}.comp.on" data-fxtab="din" data-fxch="${c}" data-grbadge="comp:${c}" title="Compresor">C</button>
        </div>
        <div class="keybed"><button class="key msk s" data-path="${p}.solo" data-kind="bool" aria-label="Solo canal ${c}">SOLO</button>
          <button class="key msk m" data-path="${p}.mute" data-kind="bool" aria-label="Mute canal ${c}">MUTE</button></div>
        ${this.faderHtml(fp, [`ch:${c}`], `comp:${c}`)}
        <div class="readout" data-readout="${fp}">—</div>
        <div class="phase" data-phase-for="${fp} ${p}.mute ${p}.solo"></div>
      </div>`;
        }
        root.innerHTML = html;
        this.queueRender();
    }
    renderMasters() {
        $("#masters").innerHTML = `
      <div class="strip master main" data-master="main">
        <div class="scribble"><span class="tag"></span><span class="num">SALIDA</span><span class="mtitle nm">MAIN L/R</span>
          <span class="sub2"><span class="lim" data-lim="main_l">LIM</span></span></div>
        <div class="keybed"><button class="key msk lim-key" data-path="main.limiter_on" data-kind="bool" title="Limitador de protección de MAIN">LIMITADOR</button>
          <button class="key msk m" data-path="main.mute" data-kind="bool">MUTE</button></div>
        ${this.faderHtml("main.level_db", ["out:main_l", "out:main_r"])}
        <div class="readout" data-readout="main.level_db">—</div>
        <div class="phase" data-phase-for="main.level_db main.mute main.limiter_on"></div>
      </div>
      <div class="strip master mon" data-master="mon">
        <div class="scribble"><span class="tag"></span><span class="num">MONITOR</span><span class="mtitle nm">MON</span>
          <span class="sub2"><span class="solo-ind" id="solo-ind">SOLO</span><button class="afl" data-path="mon.afl" data-kind="bool" title="Modo de solo: PFL (antes del fader) o AFL (después)">PFL</button></span></div>
        <div class="keybed"><button class="key msk clear-solo" data-action="clear-solo" title="Quitar todos los SOLO">BORRAR SOLOS</button>
          <button class="key msk m" data-path="mon.mute" data-kind="bool">MUTE</button></div>
        ${this.faderHtml("mon.level_db", ["out:mon_l", "out:mon_r"])}
        <div class="readout" data-readout="mon.level_db">—</div>
        <div class="phase" data-phase-for="mon.level_db mon.mute mon.afl"></div>
      </div>`;
        this.queueRender();
    }
    // ---------------------------------------------------------------- pantalla central
    head(no, title, sub, hint, noCls = "") {
        const n = $("#monitor-no");
        n.textContent = no;
        n.className = "no" + (noCls ? " " + noCls : "");
        $("#monitor-title").textContent = title;
        $("#monitor-sub").textContent = sub;
        $("#monitor-hint").innerHTML = hint;
    }
    renderMonitor() {
        this.fitEpoch++;
        const body = $("#monitor-body");
        const sub = this.view === "consola" ? this.tab : this.view === "buses" ? this.btab : this.view === "dca" ? this.dtab : this.view === "routing" ? this.rtab
            : this.view === "fx" ? this.ftab : this.view === "escenas" ? this.stab : "";
        body.className = `sbody v-${this.view}${sub ? " t-" + sub : ""}`;
        const c = this.selected;
        // El titulo de la pantalla del canal es su NOMBRE (o «CH nn»): se actualiza solo si cambia en el motor.
        const title = $("#monitor-title");
        delete title.dataset.lbl;
        delete title.dataset.full;
        if (this.view === "consola") {
            this.head(pad2(c), this.label("ch", c), `Canal ${c} · seleccionado`, this.tab === "canal" ? "Toque un bloque para abrirlo" : "Doble clic en un mando: valor por defecto");
            title.dataset.lbl = `ch:${c}`;
            if (this.tab === "eq")
                this.renderEqTab(body);
            else if (this.tab === "din")
                this.renderDynTab(body);
            else if (this.tab === "env")
                this.renderSendsTab(body);
            else
                this.renderOverview(body);
        }
        else if (this.view === "buses") {
            if (this.btab === "grupos") {
                this.head("BUSES", `SUBGRUPOS 1–${GROUP_COUNT}`, "Subgrupos estéreo: suma post-fader y post-pan de sus canales", "Nombres y colores: ESCENAS › NOMBRES", "wide bus");
                this.renderGroups(body);
            }
            else {
                this.head("BUSES", `AUX 1–${AUX_COUNT}`, this.btab === "matriz" ? "Envíos de cada canal a los buses auxiliares" : "Escucha del técnico (MON) y solo", "Nombres y colores: ESCENAS › NOMBRES", "wide bus");
                if (this.btab === "monitores")
                    this.renderMonitorTab(body);
                else
                    this.renderMatrix(body);
            }
        }
        else if (this.view === "fx") {
            if (this.ftab === "retornos") {
                this.head("FX", "RETORNOS DE EFECTOS", "Envíos de los retornos a AUX, solo, DCA y grupos de mute", "Envíos mono (suma L+R) antes o después del nivel de retorno", "wide fxv");
                this.renderFxReturns(body);
            }
            else {
                this.head("FX", "RACK DE EFECTOS", `${FX_COUNT} retornos estéreo a MAIN · conectados al motor`, "Algoritmos propios medidos en banco · sin escucha física aún", "wide fxv");
                this.renderFx(body);
            }
        }
        else if (this.view === "dca") {
            this.head("DCA", this.dtab === "dca" ? `DCA 1–${DCA_COUNT}` : `GRUPOS DE MUTE 1–${MUTEGROUP_COUNT}`, this.dtab === "dca" ? "Nivel y mute de grupos de canales; pertenencia por canal" : "Silencian a la vez a todos sus miembros", "Toque una celda para añadir o quitar un canal", "wide dcav");
            if (this.dtab === "mg")
                this.renderMuteGroups(body);
            else
                this.renderDca(body);
        }
        else if (this.view === "routing") {
            if (this.rtab === "entradas") {
                this.head("RUTEO", "Patch de entrada", "Qué entrada del dispositivo lee cada canal", "", "wide");
                this.renderInputPatch(body);
            }
            else if (this.rtab === "patch") {
                this.head("RUTEO", "Patch de salida", "Qué bus alimenta cada ranura de salida del motor", "", "wide");
                this.renderOutputPatch(body);
            }
            else {
                this.head("RUTEO", "Salidas y protección", "Estado medido tras el permiso de seguridad", "", "wide");
                this.renderRouting(body);
            }
        }
        else if (this.view === "escenas") {
            if (this.stab === "safes") {
                this.head("ESC", "Safes de recuperación", "Canales que ninguna escena cambia", "", "wide scn");
                this.renderSafes(body);
            }
            else if (this.stab === "nombres") {
                this.head("ESC", "Nombres y colores", "En el show y en las escenas", `Hasta ${NAME_MAX_CHARS} caracteres · Intro aplica · Esc deshace lo tecleado`, "wide scn");
                this.renderNames(body);
            }
            else {
                this.head("ESC", "Escenas", `Hasta ${SCENE_COUNT} escenas · se pueden deshacer`, "", "wide scn");
                this.renderScenes(body);
            }
        }
        else {
            this.head("SIST", "Sistema", "Motor, oscilador de prueba y estado de cada cambio", "", "wide");
            this.renderSystem(body);
        }
        this.queueRender();
    }
    /** Nombre visible de un elemento: el que confirma el motor o, vacio, el nombre por defecto. */
    label(kind, n) {
        const v = this.engineVal(namePath(kind, n));
        return typeof v === "string" && v !== "" ? v : defaultLabel(kind, n);
    }
    sk(path, on, off, cls = "") {
        return `<button class="sk${cls ? " " + cls : ""}" data-path="${path}" data-kind="bool" data-on="${on}" data-off="${off}">—</button>`;
    }
    open(tab) {
        return `<button class="open" data-tab-go="${tab}">Abrir ›</button>`;
    }
    renderOverview(body) {
        const c = this.selected;
        const p = `ch.${c}`;
        let sends = "";
        for (let k = 1; k <= AUX_COUNT; k++) {
            sends += `<div class="srow"><span class="sn fit" data-lbl="aux:${k}">AUX ${k}</span>
        <div class="hfader bar" data-path="${p}.aux.${k}.level_db" data-kind="hfader" tabindex="0" role="slider" aria-label="Envío canal ${c} a AUX ${k}"><div class="slot"><i></i></div><div class="cap"></div></div>
        <b data-readout="${p}.aux.${k}.level_db">—</b>
        ${this.sk(`${p}.aux.${k}.pre_fader`, "PRE", "POST", "pre")}</div>`;
        }
        const bandRows = BANDS.map(([k, l]) => `<div class="brow"><b style="color:${BAND_COLOR[k]}">${BANDS.findIndex((b) => b[0] === k) + 1}</b><span>${l}</span>
      <span class="r" data-readout="${p}.eq.${k}.freq_hz">—</span><b class="r" data-readout="${p}.eq.${k}.gain_db">—</b></div>`).join("");
        body.innerHTML = `
     <div class="mod m-in"><h3>ENTRADA${this.open("eq")}</h3>
       <div class="big"><span data-chpeak="${c}" data-bare="1">—</span><small>dBFS pico</small></div>
       <div class="meter h" data-meter="ch:${c}"><i></i><b></b><em class="clip"></em></div>
       <div class="row"><span>Ganancia (trim)</span><b data-readout="${p}.trim_db">—</b></div>
       <div class="row"><span>Polaridad</span>${this.sk(`${p}.polarity_invert`, "Ø INVERTIDA", "Ø NORMAL")}</div>
       <div class="row"><span>Pasa altos</span><span class="pair"><b data-readout="${p}.hpf_hz">—</b>${this.sk(`${p}.hpf_on`, "ON", "OFF")}</span></div>
       <div class="row"><span>Pasa bajos</span><span class="pair"><b data-readout="${p}.lpf_hz">—</b>${this.sk(`${p}.lpf_on`, "ON", "OFF")}</span></div>
       <div class="phase wide" data-phase-for="${p}.trim_db ${p}.polarity_invert ${p}.hpf_on ${p}.hpf_hz ${p}.lpf_on ${p}.lpf_hz"></div></div>
     <div class="mod m-eq"><h3>EQ ${this.sk(`${p}.eq_on`, "ON", "BYPASS", "pill")}${this.open("eq")}</h3>
       <svg id="eq-mini" class="curve mini" viewBox="0 0 300 100" role="img" aria-label="Respuesta en frecuencia del canal ${c}"></svg>
       <div class="bands-list">${bandRows}</div>
       <div class="phase wide" data-phase-for="${p}.eq_on"></div></div>
     <div class="mod m-dyn"><h3>DINÁMICA${this.open("din")}</h3>
       <div class="row"><span>Puerta</span>${this.sk(`${p}.gate.on`, "ACTIVA", "APAGADA", "pill")}</div>
       <div class="dynmini"><svg id="comp-mini" class="curve sq" viewBox="0 0 100 100" role="img" aria-label="Curva del compresor del canal ${c}"></svg>
         <div class="col"><div class="row"><span>Compresor</span>${this.sk(`${p}.comp.on`, "ON", "OFF", "pill")}</div>
           <div class="row"><span>Umbral</span><b data-readout="${p}.comp.threshold_db">—</b></div>
           <div class="row"><span>Relación</span><b data-readout="${p}.comp.ratio">—</b></div></div></div>
       <div class="row"><span>Reducción</span><b class="amber" data-grval="comp:${c}">—</b></div>
       <div class="grm" data-grmeter="comp:${c}" role="meter" aria-label="Reducción del compresor" aria-valuemin="-40" aria-valuemax="0"><i></i></div>
       <div class="phase wide" data-phase-for="${p}.gate.on ${p}.comp.on"></div></div>
     <div class="mod m-env"><h3>ENVÍOS${this.open("env")}</h3>
       <div class="sends-mini">${sends}</div>
       <div class="fxsep"><span>EFECTOS</span></div>
       <div class="fxmini">${Array.from({ length: FX_COUNT }, (_, i) => `<span><small>FX ${i + 1}</small><b data-readout="${p}.fx.${i + 1}.level_db">—</b></span>`).join("")}</div>
       <div class="phase wide" data-phase-for="${Array.from({ length: AUX_COUNT }, (_, i) => `${p}.aux.${i + 1}.level_db ${p}.aux.${i + 1}.pre_fader`).join(" ")} ${Array.from({ length: FX_COUNT }, (_, i) => `${p}.fx.${i + 1}.level_db ${p}.fx.${i + 1}.pre_fader`).join(" ")}"></div></div>
     <div class="mod m-out"><h3>SALIDA</h3>
       <div class="row"><span>Panorama</span><b data-readout="${p}.pan">—</b></div>
       <div class="hpan" data-path="${p}.pan" data-kind="pan" data-axis="x" tabindex="0" role="slider" aria-label="Pan canal ${c}" aria-valuemin="-1" aria-valuemax="1"><span class="mid"></span><span class="pcap"></span></div>
       <div class="row"><span class="stepper"><button data-panset="${p}.pan" data-v="-1">L</button><button data-panset="${p}.pan" data-v="0">C</button><button data-panset="${p}.pan" data-v="1">R</button></span></div>
       <div class="row"><span>A MAIN L/R</span>${this.sk(`${p}.main_assign`, "ASIGNADO", "NO ASIGNADO")}</div>
       <div class="row"><span>Fader</span><b data-readout="${p}.fader_db">—</b></div>
       <div class="row"><span class="stepper"><button data-step="${p}.fader_db" data-delta="-1">−1</button><button data-step="${p}.fader_db" data-delta="-0.1">−0,1</button><button data-step="${p}.fader_db" data-delta="0.1">+0,1</button><button data-step="${p}.fader_db" data-delta="1">+1</button></span></div>
       <div class="phase wide" data-phase-for="${p}.fader_db ${p}.pan ${p}.main_assign ${p}.mute ${p}.solo"></div></div>
     <p class="help lvl-help">Canal seleccionado: cada bloque resume una parte del canal y «Abrir ›» lleva a su pestaña. <b>MUTE</b> lo silencia en todas las mezclas; <b>SOLO</b> lo escucha en MON sin cambiar la sala.</p>`;
    }
    // ---------------------------------------------------------------- EQ, dinamica y envios (H3)
    knob(path, label, aria = label, color = "#4aa3ff", size = "") {
        return `<div class="pk${size ? " " + size : ""}"><div class="knob num" data-path="${path}" data-kind="num" tabindex="0" role="slider" style="--kc:${color}"
      aria-label="${esc(aria)} (canal ${this.selected})"><i></i></div><span class="pk-label">${esc(label)}</span><b class="pk-val" data-readout="${path}">—</b></div>`;
    }
    renderEqTab(body) {
        const c = this.selected;
        const p = `ch.${c}`;
        const bands = BANDS.map(([k, l, kind], i) => `<div class="band" style="--bc:${BAND_COLOR[k]}">
        <h4><b>${i + 1}</b> ${l.toLowerCase()}</h4>
        ${this.knob(`${p}.eq.${k}.gain_db`, "GANANCIA", `${l}: ganancia`, BAND_COLOR[k], "big")}
        <span class="kind">${kind}</span>
        <div class="bk2">${this.knob(`${p}.eq.${k}.freq_hz`, "FREC.", `${l}: frecuencia`, BAND_COLOR[k], "small")}
        ${kind === "campana" ? this.knob(`${p}.eq.${k}.q`, "Q", `${l}: Q`, BAND_COLOR[k], "small") : ""}</div>
      </div>`).join("");
        body.innerHTML = `
      <div class="mod m-curve"><h3>EQ DEL CANAL ${this.sk(`${p}.eq_on`, "ON", "BYPASS", "pill")}<span class="open">Doble clic en un mando = valor por defecto</span></h3>
        <svg id="eq-curve" class="curve" viewBox="0 0 600 200" role="img" aria-label="Respuesta en frecuencia del canal ${c}"></svg>
        <div class="phase wide" data-phase-for="${p}.eq_on ${BANDS.map(([b]) => `${p}.eq.${b}.gain_db ${p}.eq.${b}.freq_hz`).join(" ")} ${p}.eq.lmid.q ${p}.eq.hmid.q"></div>
        <p class="help">La curva es exactamente lo que el motor aplica a este canal. Ganancia positiva realza esa zona; negativa la atenúa.</p></div>
      <div class="mod m-bands">${bands}</div>
      <div class="mod m-filt"><h3>ENTRADA Y FILTROS</h3>
        <div class="fgrid">
          ${this.knob(`${p}.trim_db`, "TRIM", "Trim", "#4aa3ff", "small")}
          ${this.knob(`${p}.hpf_hz`, "HPF", "Paso alto", "#4aa3ff", "small")}
          ${this.knob(`${p}.lpf_hz`, "LPF", "Paso bajo", "#4aa3ff", "small")}
          ${this.sk(`${p}.polarity_invert`, "Ø INV.", "Ø NORM.")}
          ${this.sk(`${p}.hpf_on`, "ON", "OFF")}
          ${this.sk(`${p}.lpf_on`, "ON", "OFF")}
          ${this.enumKeys(`${p}.hpf_slope`, "Pendiente del paso alto (dB/oct)").replace('<span class="seg"', '<span class="seg hslope"')}
        </div>
        <div class="phase wide" data-phase-for="${p}.trim_db ${p}.polarity_invert ${p}.hpf_on ${p}.hpf_hz ${p}.hpf_slope ${p}.lpf_on ${p}.lpf_hz"></div>
        <p class="dim">HPF 12/18/24 dB/oct · LPF 12 dB/oct · sin latencia.</p></div>`;
    }
    renderDynTab(body) {
        const c = this.selected;
        const p = `ch.${c}`;
        const gate = ["threshold_db", "range_db", "attack_ms", "hold_ms", "release_ms", "hysteresis_db"];
        const comp = ["threshold_db", "ratio", "knee_db", "attack_ms", "release_ms", "makeup_db"];
        const L = {
            threshold_db: "UMBRAL", range_db: "RANGO", attack_ms: "ATAQUE", hold_ms: "MANTENER", release_ms: "RELAJAC.",
            ratio: "RELACIÓN", knee_db: "RODILLA", makeup_db: "GANANCIA", hysteresis_db: "HISTÉRESIS", sc_hpf_hz: "HPF LATERAL",
        };
        body.innerHTML = `
      <div class="mod m-gate"><div class="dcol"><h3>PUERTA ${this.sk(`${p}.gate.on`, "ACTIVA", "APAGADA", "pill")}</h3>
          <svg id="gate-curve" class="curve sq" viewBox="0 0 200 200" role="img" aria-label="Curva de la puerta del canal ${c}"></svg>
          <div class="row"><span>Atenuación</span><b data-grval="gate:${c}">—</b></div>
          <div class="grm" data-grmeter="gate:${c}" role="meter" aria-label="Atenuación de la puerta" aria-valuemin="-40" aria-valuemax="0"><i></i></div></div>
        <div class="kgrid">${gate.map((k) => this.knob(`${p}.gate.${k}`, L[k], `Puerta: ${L[k]}`, "#7cc4ff")).join("")}</div>
        <div class="phase wide" data-phase-for="${p}.gate.on ${gate.map((k) => `${p}.gate.${k}`).join(" ")}"></div></div>
      <div class="mod m-comp"><div class="dcol"><h3>COMPRESOR ${this.sk(`${p}.comp.on`, "ON", "OFF", "pill")}</h3>
          <svg id="comp-curve" class="curve sq" viewBox="0 0 200 200" role="img" aria-label="Curva del compresor del canal ${c}"></svg>
          <div class="row"><span>Reducción</span><b class="amber" data-grval="comp:${c}">—</b></div>
          <div class="grm gr-h" data-grmeter="comp:${c}" aria-hidden="true"><i></i></div></div>
        <div class="kgrid">${comp.map((k) => this.knob(`${p}.comp.${k}`, L[k], `Compresor: ${L[k]}`, "#ffb224")).join("")}</div>
        <div class="compopts"><span class="row"><span>DETECTOR</span>${this.enumKeys(`${p}.comp.detector`, "Detector del compresor")}</span>
          <span class="row"><span>LIBERACIÓN AUTO</span>${this.sk(`${p}.comp.auto_release`, "AUTO ON", "AUTO OFF")}</span>
          <span class="row"><span>HPF LATERAL</span>${this.sk(`${p}.comp.sc_hpf_on`, "ACTIVO", "APAGADO")}</span>
          ${this.knob(`${p}.comp.sc_hpf_hz`, "FREC. LATERAL", "Compresor: frecuencia del paso alto lateral", "#ffb224", "small")}</div>
        <div class="grcol"><span>GR</span><div class="grm v" data-grmeter="comp:${c}" role="meter" aria-label="Reducción del compresor" aria-valuemin="-40" aria-valuemax="0"><i></i></div><b class="amber" data-grval="comp:${c}" data-bare="1">—</b></div>
        <div class="phase wide" data-phase-for="${p}.comp.on ${comp.map((k) => `${p}.comp.${k}`).join(" ")} ${p}.comp.sc_hpf_hz ${p}.comp.detector ${p}.comp.auto_release ${p}.comp.sc_hpf_on"></div></div>
      <p class="help">La puerta cierra el canal cuando la señal baja del umbral; el compresor reduce los picos por encima del suyo. Las barras ámbar muestran cuánto actúa cada uno ahora (medido por el motor).</p>`;
    }
    renderSendsTab(body) {
        const c = this.selected;
        const p = `ch.${c}`;
        let rows = "";
        for (let k = 1; k <= AUX_COUNT; k++) {
            rows += `<tr><th><span class="fit" data-lbl="aux:${k}">AUX ${k}</span></th>
        <td class="hf"><div class="hfader" data-path="${p}.aux.${k}.level_db" data-kind="hfader" tabindex="0" role="slider"
            aria-label="Envío canal ${c} a AUX ${k}"><div class="slot"><i></i></div><div class="cap"></div></div></td>
        <td class="num" data-readout="${p}.aux.${k}.level_db">—</td>
        <td>${this.sk(`${p}.aux.${k}.pre_fader`, "PRE", "POST", "pre")}</td>
        <td class="dim" data-auxstate="${k}">—</td>
        <td class="phase" data-phase-for="${p}.aux.${k}.level_db ${p}.aux.${k}.pre_fader"></td></tr>`;
        }
        let fxRows = "";
        for (let f = 1; f <= FX_COUNT; f++) {
            fxRows += `<tr><th><span class="fit" data-lbl="fx:${f}">FX ${f}</span></th>
        <td class="hf"><div class="hfader fxs" data-path="${p}.fx.${f}.level_db" data-kind="hfader" tabindex="0" role="slider"
            aria-label="Envío canal ${c} a FX ${f}"><div class="slot"><i></i></div><div class="cap"></div></div></td>
        <td class="num" data-readout="${p}.fx.${f}.level_db">—</td>
        <td>${this.sk(`${p}.fx.${f}.pre_fader`, "PRE", "POST", "pre")}</td>
        <td class="dim" data-fxstate="${f}">—</td>
        <td class="phase" data-phase-for="${p}.fx.${f}.level_db ${p}.fx.${f}.pre_fader"></td></tr>`;
        }
        body.innerHTML = `<div class="mod m-sends"><h3>ENVÍOS A AUX · canal ${c}<span class="open">Arrastre la tapa · rueda o flechas · Alt+doble clic = 0 dB</span></h3>
        <table class="sends">${rows}</table></div>
      <div class="mod m-sends m-fxsends"><h3>ENVÍOS A EFECTOS · canal ${c}<button class="open" data-goview="fx">Rack FX ›</button></h3>
        <table class="sends">${fxRows}</table></div>
      <div class="mod m-sendhelp"><h3>PRE / POST</h3>
        <p><b>POST</b>: el envío sigue al fader (y al DCA) del canal: efectos, sala.</p>
        <p><b>PRE</b>: el envío no depende del fader del canal (monitores de escenario).</p>
        <p>El <b>mute</b> del canal, de su DCA o de su grupo corta todos los envíos.</p>
        <p class="dim">Envíos a FX mono; la matriz de AUX está en BUSES.</p></div>`;
    }
    renderMatrix(body) {
        const ed = this.model?.edition ?? 16;
        const s = this.page.kind === "ch" ? this.page.start : 1;
        const e = Math.min(ed, s + this.perBank - 1);
        const n = e - s + 1;
        let grid = `<span></span>`;
        for (let c = s; c <= e; c++)
            grid += `<span class="mh${c === this.selected ? " sel" : ""}">${pad2(c)}</span>`;
        for (let k = 1; k <= AUX_COUNT; k++) {
            grid += `<span class="ma${this.sof === k ? " sof" : ""}"><span class="fit" data-lbl="aux:${k}">AUX ${k}</span></span>`;
            for (let c = s; c <= e; c++)
                grid += `<button class="mcell${this.sof === k ? " sof" : ""}" data-mcell="${c}" title="CH ${pad2(c)} → AUX ${k}: abrir sus envíos"><b data-readout="ch.${c}.aux.${k}.level_db" data-mlvl="ch.${c}.aux.${k}.level_db">—</b><small data-prepost="ch.${c}.aux.${k}.pre_fader">—</small></button>`;
        }
        let cols = "";
        for (let k = 1; k <= AUX_COUNT; k++) {
            cols += `<div class="auxcol${this.sof === k ? " sof" : ""}"><b class="an fit" data-lbl="aux:${k}">AUX ${k}</b><span class="ad"><i class="cdot" data-lblc="aux:${k}"></i>AUX ${k}</span>
        <div class="big"><span data-readout="aux.${k}.level_db">—</span><small>dB</small></div>
        <div class="meter h" data-meter="out:aux${k}"><i></i><b></b><em class="clip"></em></div>
        ${this.sk(`aux.${k}.enabled`, "AUX ON", "AUX OFF")}
        ${this.sk(`aux.${k}.mute`, "MUTE ON", "MUTE", "red")}
        ${this.sk(`aux.${k}.limiter_on`, "LIM ON", "LIM OFF")}
        <button class="sk blue-on${this.sof === k ? " on" : ""}" data-sof="${k}" aria-pressed="${this.sof === k}" title="Los faders de canal pasan a manejar el envío a AUX ${k}">${this.sof === k ? "EN FADERS" : "A FADERS"}</button>
        <div class="phase" data-phase-for="aux.${k}.enabled aux.${k}.mute aux.${k}.limiter_on aux.${k}.level_db"></div></div>`;
        }
        body.innerHTML = `<div class="mod m-matrix"><h3>MATRIZ DE ENVÍOS · niveles en dB<span class="open">Toque una celda para editar los envíos de ese canal</span></h3>
        <div class="mgrid" style="--n:${n}">${grid}</div></div>
      <div class="mod m-auxcols">${cols}</div>`;
    }
    renderMonitorTab(body) {
        const ed = this.model?.edition ?? 16;
        body.innerHTML = `<div class="mod m-mon"><h3>ESCUCHA MON</h3>
        <p class="help">MON es lo que oye el técnico en auriculares. Sin ningún SOLO escucha MAIN; con SOLO escucha solo esos canales. Nada de esta pantalla cambia lo que suena en la sala.</p>
        <div class="row"><span>Modo de solo</span>${this.sk("mon.afl", "AFL", "PFL")}</div>
        <div class="row"><span>Nivel MON</span><span class="pair"><b data-readout="mon.level_db">—</b><span class="stepper"><button data-step="mon.level_db" data-delta="-1">−1</button><button data-step="mon.level_db" data-delta="1">+1</button></span></span></div>
        <div class="row"><span>Mute MON</span>${this.sk("mon.mute", "MUTE ON", "MUTE", "red")}</div>
        <div class="row"><span>Limitador MON</span><span class="pair">${this.sk("mon.limiter_on", "ACTIVO", "DESACTIVADO")}<b data-readout="mon.limiter_db">—</b><span class="stepper"><button data-step="mon.limiter_db" data-delta="-1">−1</button><button data-step="mon.limiter_db" data-delta="1">+1</button></span></span></div>
        <div class="row"><span>Canales en solo</span><b id="solo-list">—</b></div>
        <div class="phase wide" data-phase-for="mon.afl mon.level_db mon.mute mon.limiter_on mon.limiter_db"></div></div>
      <div class="mod m-monspec"><h3>COMPORTAMIENTO VERIFICADO</h3>
        <p><b>Sin solo</b>: MON escucha MAIN (después de su nivel, mute y limitador).</p>
        <p><b>PFL</b>: el canal antes del mute y del fader. Sirve para escuchar un canal cerrado antes de abrirlo.</p>
        <p><b>AFL</b>: el canal después del fader y del pan, aunque no esté asignado a MAIN.</p>
        <p>Cambio entre MAIN y solo con fundido de 10 ms. <b>Solo nunca altera MAIN ni AUX.</b> MON tiene nivel, mute, limitador y permiso propios: PANIC, STOP y la retención lo cierran.</p>
        <p class="unavail">Monitores personales por músico: <b>No disponible en esta versión</b>. Use AUX 1–${AUX_COUNT}. Edición ${ed} canales.</p></div>`;
    }
    renderRouting(body) {
        let rows = "";
        for (const o of OUTPUTS) {
            const lim = o.startsWith("main") ? "main" : o.startsWith("mon") ? "mon" : `aux.${o.slice(3)}`;
            const showLim = o !== "main_r" && o !== "mon_r";
            rows += `<tr><th>${OUTPUT_LABEL[o]}</th>
        <td><span class="eff" data-eff="${o}">—</span></td>
        <td data-forced="${o}">—</td>
        <td>${showLim ? this.sk(`${lim}.limiter_on`, "ACTIVO", "DESACTIVADO") : "enlazado"}</td>
        <td>${showLim ? `<b data-readout="${lim}.limiter_db">—</b> <span class="stepper"><button data-step="${lim}.limiter_db" data-delta="-1">−1</button><button data-step="${lim}.limiter_db" data-delta="1">+1</button></span>` : ""}</td>
        <td data-gr="${o}">—</td>
        <td data-peak="${o}">—</td></tr>`;
        }
        body.innerHTML = `<div class="mod m-outs"><h3>SALIDAS LÓGICAS<span class="open">Efectiva = medidor posterior al permiso de salida</span></h3>
        <p class="help">Estado real de cada salida medido después del permiso de seguridad: <b>abierta</b> (verde), <b>en rampa</b> (ámbar) o <b>en silencio</b>. El limitador protege cada salida de picos.</p>
        <table class="outs"><thead><tr><th>Salida</th><th>Efectiva</th><th>Cierre de seguridad</th><th>Limitador</th><th>Umbral</th><th>Reducción</th><th>Pico</th></tr></thead>${rows}</table></div>
      <div class="mod m-dev"><h3>DISPOSITIVO</h3>
        <p id="device-info">—</p>
        <p class="dim">Limitador de pico de muestra, latencia cero; <b>no garantiza la protección auditiva ni de altavoces</b>.</p>
        <p class="unavail">Selección de interfaz WASAPI y mapa de canales físicos: <b>No disponible en esta versión</b> (apertura de dispositivos no autorizada).</p></div>`;
    }
    renderSystem(body) {
        const dests = descOf("osc.dest")?.values ?? [];
        body.innerHTML = `<div class="mod m-sys"><h3>MOTOR</h3>
        <p id="status-line">—</p>
        <p>La interfaz no procesa audio: si se cierra, el motor sigue funcionando.</p>
        <p class="dim">Escenas, safes, nombres y colores: vista <b>ESCENAS</b>. Deshacer/rehacer: arriba a la derecha o Ctrl+Z / Ctrl+Mayús+Z.</p>
        <p class="unavail">Análisis (RTA): <b>No disponible en esta versión</b>.</p></div>
      <div class="mod m-osc" aria-label="Oscilador de prueba (peligro: emite señal)">
        <h3><span class="oscw">⚠</span> OSCILADOR DE PRUEBA <span class="oscstate" data-oscstate>—</span></h3>
        <div class="oscgrid">
          <div class="osccol">
            <button class="sk oscon red" data-path="osc.on" data-kind="bool" data-on="ENCENDIDO · EMITE" data-off="APAGADO · ENCENDER…" aria-label="Oscilador de prueba: encender o apagar">—</button>
            <div class="row"><span>Señal</span>${this.enumKeys("osc.type", "Tipo de señal del oscilador")}</div>
            <div class="row"><span>Destino</span>${this.enumKeys("osc.dest", "Destino del oscilador", dests.map((_, i) => i))}</div>
          </div>
          <div class="oscknobs">${this.pknob("osc.freq_hz", "FRECUENCIA", "Oscilador: frecuencia del seno", "#ff8a82", "")}
            ${this.pknob("osc.level_db", "NIVEL", "Oscilador: nivel", "#ff8a82", "")}</div>
        </div>
        <p class="oscnote">Entra en el bus de destino <b>antes</b> de su nivel, mute, limitador y permiso. Encender pide confirmación. <b>Siempre apagado</b> al arrancar o reiniciar; PANIC y STOP lo apagan y al rearmar no vuelve. La frecuencia solo afecta al seno.</p>
        <div class="phase wide" data-phase-for="osc.on osc.type osc.dest osc.freq_hz osc.level_db"></div></div>
      <div class="mod m-legend"><h3>ESTADO DE CADA CAMBIO</h3>
        <p><i class="ph sending"></i>Enviado: la petición salió de la interfaz.</p>
        <p><i class="ph accepted"></i>Aceptado: el motor validó el cambio (aún no suena).</p>
        <p><i class="ph applied"></i>Aplicado: el hilo de audio adoptó el plan nuevo.</p>
        <p><i class="ph open"></i>Efectivo: lo que mide la salida después del permiso.</p>
        <p><i class="ph rejected"></i>Rechazado: el motor no lo aceptó; nada cambió.</p></div>
      <div class="mod m-keys"><h3>TECLADO Y RATÓN</h3>
        <p><b>F9 / Pausa</b>: PANIC (solo activa). <b>[ ]</b>: banco anterior / siguiente.</p>
        <p><b>Flechas</b>: 0,5 dB; con <b>Mayús</b> o <b>FINO</b>, 0,1 dB. <b>Fin</b>: −∞. <b>Alt+Inicio</b>: 0 dB.</p>
        <p>Solo la <b>tapa</b> arrastra: un toque en la ranura no mueve el fader.</p></div>`;
    }
    // ---------------------------------------------------------------- P2 · escenas (F031/F032)
    renderScenes(body) {
        let pages = "";
        for (let s = 1; s <= SCENE_COUNT; s += SPAGE)
            pages += `<button class="sk${s === this.scenePage ? " blue-on on" : ""}" data-action="scene-page" data-v="${s}" aria-pressed="${s === this.scenePage}">${s}–${Math.min(SCENE_COUNT, s + SPAGE - 1)}</button>`;
        body.innerHTML = `<div class="mod m-scenes"><h3>ESCENAS<span class="open" data-scenecount>—</span></h3>
        <div class="spages" role="group" aria-label="Página de escenas">${pages}</div>
        <div class="spads" data-scenelist role="listbox" aria-label="Escenas de la página">—</div></div>
      <div class="mod m-scenedet" data-scenedetail>—</div>
      <div class="mod m-scenediff" data-scenediff>—</div>`;
        this.renderSceneParts();
    }
    sceneInfo(n) {
        return this.scenes?.scenes.find((s) => s.number === n);
    }
    /** Partes de la pantalla de escenas que dependen de la lista del motor (se redibujan sin perder el foco). */
    renderSceneParts() {
        const m = this.model;
        const L = this.scenes;
        const connected = !!m?.connected && !!L;
        const setHtml = (sel, html) => {
            const el = document.querySelector(sel);
            if (el && el.innerHTML !== html)
                el.innerHTML = html;
        };
        const cnt = L ? L.scenes.filter((s) => !s.damaged).length : 0;
        setHtml("[data-scenecount]", connected ? `${cnt} guardada${cnt === 1 ? "" : "s"} de ${SCENE_COUNT}${L.persistent ? "" : " · solo en memoria"}` : "—");
        const pads = [];
        for (let n = this.scenePage; n < this.scenePage + SPAGE && n <= SCENE_COUNT; n++) {
            const s = this.sceneInfo(n);
            const cur = connected && L.current === n;
            const badge = !connected ? "" : s?.damaged ? `<em class="bad">DAÑADA</em>` : s && s.compatible === false ? `<em class="bad">${s.edition} CH</em>`
                : cur ? (L.current_modified ? `<em class="warn">ACTUAL *</em>` : `<em class="ok">ACTUAL</em>`) : s?.from_prev ? `<em class="warn">COPIA ANTERIOR</em>` : "";
            const nm = !connected ? "—" : s?.damaged ? "archivo dañado" : s ? esc(s.name || `Escena ${n}`) : "vacía";
            pads.push(`<button class="spad${n === this.sceneSel ? " sel" : ""}${s ? " used" : ""}${cur ? " cur" : ""}" data-action="scene-sel" data-v="${n}" role="option" aria-selected="${n === this.sceneSel}"
        aria-label="Escena ${n}${s && !s.damaged ? ": " + esc(s.name || "sin nombre") : s?.damaged ? ": dañada" : ": vacía"}"><b>${pad2(n)}</b><span class="spn">${nm}</span>${badge}</button>`);
        }
        // Las ranuras se actualizan EN SU SITIO (mismos botones): una lista que se rehace entre pulsar y soltar
        // perderia el clic (visto con la maquina cargada).
        const list = document.querySelector("[data-scenelist]");
        if (list) {
            const btns = Array.from(list.querySelectorAll("button.spad"));
            const tmpl = document.createElement("div");
            tmpl.innerHTML = pads.join("");
            const fresh = Array.from(tmpl.querySelectorAll("button.spad"));
            if (btns.length !== fresh.length || btns.some((b, i) => b.dataset.v !== fresh[i].dataset.v)) {
                list.replaceChildren(...fresh);
            }
            else {
                btns.forEach((b, i) => {
                    const f = fresh[i];
                    if (b.className !== f.className)
                        b.className = f.className;
                    for (const at of ["aria-selected", "aria-label"])
                        if (b.getAttribute(at) !== f.getAttribute(at))
                            b.setAttribute(at, f.getAttribute(at) ?? "");
                    if (b.innerHTML !== f.innerHTML)
                        b.innerHTML = f.innerHTML;
                });
            }
        }
        // Detalle de la escena elegida: nombre, alcance y acciones.
        const n = this.sceneSel;
        const s = this.sceneInfo(n);
        const exists = !!s && !s.damaged;
        const panic = !!m?.flags.panic;
        // Revision 03-11: en una escena existente el alcance se edita como BORRADOR (nada se guarda al tocar).
        const stored = new Set(exists ? s.scope ?? [] : []);
        const edit = exists ? this.scopeEdit.get(n) : undefined;
        const scope = exists ? edit ?? stored : this.scopeDraft;
        const scopeDirty = !!edit && (edit.size !== stored.size || [...edit].some((f) => !stored.has(f)));
        const fams = SCOPE_FAMILIES.map((f) => {
            const changed = scopeDirty && scope.has(f.id) !== stored.has(f.id);
            return `<button class="sk scope${scope.has(f.id) ? " blue-on on" : ""}${changed ? " changed" : ""}" data-action="scene-scope" data-v="${f.id}" aria-pressed="${scope.has(f.id)}"
        title="${esc(f.labelEs)}${changed ? " (sin guardar)" : ""}">${FAMILY_SHORT[f.id] ?? f.id}</button>`;
        }).join("");
        const det = document.querySelector("[data-scenedetail]");
        if (det) {
            const key = `${connected}|${n}|${exists}|${!!s?.damaged}|${[...scope].join(",")}|${scopeDirty}|${panic}|${s?.compatible}`;
            if (det.dataset.key !== key) {
                // Lo que el operador esta tecleando en el nombre sobrevive al redibujo (misma ranura).
                const old = det.querySelector("#scene-name");
                const keep = old && det.dataset.slot === String(n) && old.dataset.dirty === "1" ? old.value : null;
                const hadFocus = old !== null && document.activeElement === old;
                det.dataset.key = key;
                det.dataset.slot = String(n);
                // Revision 03-11: las teclas de accion van justo bajo el titulo (a 1366 x 768 quedaban bajo el pliegue).
                det.innerHTML = `<h3>ESCENA ${pad2(n)}<span class="open">${!connected ? "" : exists ? (s.from_prev ? "cargada de la copia anterior" : `guardada en la revisión ${s.stored_revision ?? "—"}`) : s?.damaged ? "archivo dañado: sobrescríbala o bórrela" : "ranura vacía"}</span></h3>
          <div class="sacts">
            <button class="sk blue-on" data-action="scene-store" ${connected ? "" : "disabled"}>${exists || s?.damaged ? "SOBRESCRIBIR…" : "GUARDAR AQUÍ"}</button>
            <button class="sk recall" data-action="scene-recall" ${connected && exists && !panic && !scopeDirty && s.compatible !== false ? "" : "disabled"} title="${panic ? "Con PANIC activo no se recupera ninguna escena" : scopeDirty ? "Guarde o descarte primero el alcance editado" : "Recuperar (pide confirmación)"}">RECUPERAR…</button>
            <button class="sk" data-action="scene-diff" ${connected && exists && s.compatible !== false ? "" : "disabled"}>DIFERENCIAS</button>
            <button class="sk red" data-action="scene-delete" ${connected && s ? "" : "disabled"}>BORRAR…</button></div>
          <div class="row sname"><span>Nombre</span><input class="nin" id="scene-name" type="text" maxlength="128" spellcheck="false" autocomplete="off" aria-label="Nombre de la escena ${n}" placeholder="Escena ${n}" ${connected ? "" : "disabled"}>
            ${exists ? `<button class="sk" data-action="scene-rename" ${connected ? "" : "disabled"}>RENOMBRAR</button>` : ""}</div>
          <div class="scope-h"><span>ALCANCE <small>${exists ? (scopeDirty ? "editado · sin guardar" : "guardado con la escena") : "para la escena nueva"}</small></span>
            ${exists ? `<span class="scopeacts"><button class="sk blue-on" data-action="scope-save" ${connected && scopeDirty ? "" : "disabled"}>GUARDAR ALCANCE</button><button class="sk" data-action="scope-discard" ${scopeDirty ? "" : "disabled"}>DESCARTAR</button></span>` : ""}</div>
          <div class="scopes" role="group" aria-label="Alcance de la escena ${n}">${fams}</div>
          <p class="dim snote">${panic ? '<b class="bad">PANIC activo: no se recupera ninguna escena hasta rearmar.</b>' : "No toca PANIC, STOP, retenciones ni el oscilador; respeta los safes."}</p>`;
                const inp = det.querySelector("#scene-name");
                if (inp) {
                    inp.value = keep ?? (exists ? s.name ?? "" : "");
                    if (keep !== null)
                        inp.dataset.dirty = "1";
                    inp.addEventListener("input", () => (inp.dataset.dirty = "1"));
                    if (hadFocus)
                        inp.focus();
                }
            }
        }
        // Diferencias.
        const D = this.diff && this.diff.number === n && exists ? this.diff : null;
        let dh = `<h3>DIFERENCIAS · ESCENA ${pad2(n)} ↔ ACTUAL</h3>`;
        if (!D)
            dh += `<p class="dim">${exists ? "Pulse DIFERENCIAS para comparar la escena con el estado actual." : "Sin escena en esta ranura."}</p>`;
        else {
            const byReason = (r) => D.differences.filter((d) => d.reason === r).length;
            dh += `<div class="dsum"><span><b>${D.would_apply}</b> se aplicarían</span><span><b>${byReason("safe")}</b> en safe</span><span><b>${byReason("scope")}</b> fuera del alcance</span>${byReason("safety") ? `<span class="warn"><b>${byReason("safety")}</b> por seguridad</span>` : ""}</div>`;
            if (!D.total)
                dh += `<p class="ok">La escena coincide con el estado actual.</p>`;
            else {
                const pages = Math.max(1, Math.ceil(D.total / DPAGE));
                if (this.diffPage >= pages)
                    this.diffPage = pages - 1;
                const rows = D.differences.slice(this.diffPage * DPAGE, (this.diffPage + 1) * DPAGE).map((d) => `<div class="drow r-${d.reason}"><span class="dw">${esc(ownerOf(d.path, (k, i) => this.label(k, i)))} · ${esc(paramLabel(d.path))}</span>
            <span class="dv">${esc(displayValue(d.path, d.current))} → <b>${esc(displayValue(d.path, d.scene))}</b></span>
            <em>${d.reason === "recall" ? "" : d.reason === "safe" ? "SAFE" : d.reason === "scope" ? "FUERA" : "SEGURIDAD"}</em></div>`).join("");
                dh += `<div class="dlist">${rows}</div><div class="dpager"><button class="sk" data-action="diff-page" data-v="-1" ${this.diffPage > 0 ? "" : "disabled"}>‹</button>
          <span>${this.diffPage + 1} / ${pages} · ${D.total} diferencia${D.total === 1 ? "" : "s"}</span><button class="sk" data-action="diff-page" data-v="1" ${this.diffPage < pages - 1 ? "" : "disabled"}>›</button></div>`;
            }
        }
        setHtml("[data-scenediff]", dh);
    }
    /** Revision 03-11: olvida todo lo leido del motor que no llega por eventos (lista de escenas, diferencias,
     *  borradores de alcance). Se llama al perder la conexion y en cada (re)conexion. */
    invalidateCaches() {
        this.scenes = null;
        this.scenesSeen = -1;
        this.diff = null;
        this.scopeEdit.clear();
        this.queueRender();
    }
    async refreshScenes() {
        const m = this.model;
        if (!m?.connected)
            return;
        this.scenesSeen = m.scenesVersion;
        try {
            this.scenes = await m.sceneList();
            // Una diferencia calculada antes de un cambio de escenas ya no vale.
            if (this.diff && !this.sceneInfo(this.diff.number))
                this.diff = null;
            if (this.view === "escenas" && this.stab === "lista")
                this.renderSceneParts();
            this.queueRender();
        }
        catch {
            /* desconexion: la gestiona onClosed */
        }
    }
    failText(e) {
        if (e instanceof RequestFailed) {
            const c = e.error.code;
            if (c === "PANIC_ENGAGED")
                return "PANIC activo: rearme primero (no se cambió nada)";
            if (c === "STORAGE_ERROR")
                return `no se pudo guardar en disco; nada cambió (${e.error.message})`;
            if (c === "NOTHING_TO_UNDO")
                return "no hay nada que deshacer";
            if (c === "NOTHING_TO_REDO")
                return "no hay nada que rehacer";
            if (c === "SCENE_DAMAGED")
                return "la escena está dañada en disco";
            if (c === "INVALID_NAME")
                return `nombre no válido: ${e.error.message}`;
            return `${c}: ${e.error.message}`;
        }
        return errText(e);
    }
    async onSceneAction(act, v) {
        const m = this.model;
        if (!m?.connected)
            return;
        const n = this.sceneSel;
        const s = this.sceneInfo(n);
        const exists = !!s && !s.damaged;
        const nameInput = document.querySelector("#scene-name");
        const typed = normalizeName(nameInput?.value ?? "");
        try {
            if (act === "scene-page") {
                this.scenePage = Number(v);
                this.renderMonitor();
            }
            else if (act === "scene-sel") {
                this.sceneSel = Number(v);
                if (this.diff?.number !== this.sceneSel)
                    this.diff = null;
                this.diffPage = 0;
                this.renderSceneParts();
            }
            else if (act === "scene-scope") {
                const fam = v;
                if (exists) {
                    // Borrador: nada se guarda hasta «GUARDAR ALCANCE» (revision 03-11).
                    const sc = new Set(this.scopeEdit.get(n) ?? s.scope ?? []);
                    if (sc.has(fam))
                        sc.delete(fam);
                    else
                        sc.add(fam);
                    this.scopeEdit.set(n, sc);
                }
                else {
                    if (this.scopeDraft.has(fam))
                        this.scopeDraft.delete(fam);
                    else
                        this.scopeDraft.add(fam);
                }
                this.renderSceneParts();
            }
            else if (act === "scope-save") {
                const sc = this.scopeEdit.get(n);
                if (!exists || !sc)
                    return;
                await m.sceneSetScope(n, SCOPE_FAMILIES.map((f) => f.id).filter((id) => sc.has(id)));
                this.scopeEdit.delete(n);
                await this.refreshScenes();
                if (this.diff?.number === n)
                    this.diff = await m.sceneDiff(n);
                this.renderSceneParts();
                this.toast(`Escena ${n}: alcance guardado`);
            }
            else if (act === "scope-discard") {
                this.scopeEdit.delete(n);
                this.renderSceneParts();
            }
            else if (act === "scene-rename") {
                const why = nameProblem(typed, SCENE_NAME_MAX_CHARS);
                if (why)
                    return this.toast(`Nombre de escena: ${why}`);
                await m.sceneRename(n, typed);
                await this.refreshScenes();
            }
            else if (act === "scene-store") {
                const why = nameProblem(typed, SCENE_NAME_MAX_CHARS);
                if (why)
                    return this.toast(`Nombre de escena: ${why}`);
                if (s && !(await this.confirmBox(`Sobrescribir la escena ${n}`, `La escena ${n}${s.name ? ` «${s.name}»` : ""} se sustituirá por el estado actual de la consola. Su alcance se conserva.`, "Sobrescribir", { gen: this.safetyGen })))
                    return;
                await m.sceneStore(n, { name: typed, overwrite: !!s, ...(s ? {} : { scope: SCOPE_FAMILIES.map((f) => f.id).filter((id) => this.scopeDraft.has(id)) }) });
                this.diff = null;
                await this.refreshScenes();
                this.toast(`Escena ${n} guardada`);
            }
            else if (act === "scene-diff") {
                this.diff = await m.sceneDiff(n);
                this.diffPage = 0;
                this.renderSceneParts();
            }
            else if (act === "diff-page") {
                this.diffPage = Math.max(0, this.diffPage + Number(v));
                this.renderSceneParts();
            }
            else if (act === "scene-delete") {
                if (!(await this.confirmBox(`Borrar la escena ${n}`, `Se borrará la escena ${n}${s?.name ? ` «${s.name}»` : ""} del disco. No se puede deshacer.`, "Borrar", { gen: this.safetyGen })))
                    return;
                await m.sceneDelete(n);
                this.diff = null;
                await this.refreshScenes();
            }
            else if (act === "scene-recall") {
                if (!exists)
                    return;
                const gen = this.safetyGen;
                const sceneGen = s.gen;
                // La confirmacion dice exactamente que va a pasar (diferencias calculadas por el motor ahora) y queda
                // ligada a ESE diff: el motor rechaza la recuperacion si algo de su alcance cambio despues.
                const d = await m.sceneDiff(n);
                this.diff = d;
                this.diffPage = 0;
                this.renderSceneParts();
                const safe = d.differences.filter((x) => x.reason === "safe").length, out = d.differences.filter((x) => x.reason === "scope").length;
                const sft = d.differences.filter((x) => x.reason === "safety").length;
                // Revision 03-11: familias afectadas, con PATCH y SALIDAS marcadas (cambian lo que sale por cada salida).
                const byFam = new Map();
                for (const x of d.differences)
                    if (x.reason === "recall")
                        byFam.set(x.family, (byFam.get(x.family) ?? 0) + 1);
                const list = SCOPE_FAMILIES.filter((f) => byFam.has(f.id)).map((f) => {
                    const warn = f.id === "patch" || f.id === "outputs" || f.id === "monitor";
                    const k = byFam.get(f.id);
                    return { text: `${FAMILY_SHORT[f.id] ?? f.id}: ${k} cambio${k === 1 ? "" : "s"}${f.id === "patch" ? " · CAMBIA EL PATCH DE ENTRADA/SALIDA" : f.id === "outputs" ? " · CAMBIA SALIDAS AUX Y LIMITADORES" : f.id === "monitor" ? " · CAMBIA LA ESCUCHA MON" : ""}`, warn };
                });
                const txt = `Escena ${n}${s.name ? ` «${s.name}»` : ""}: ${d.would_apply ? `cambiarán ${d.would_apply} parámetro${d.would_apply === 1 ? "" : "s"} en un solo paso, con las rampas del motor` : "no cambia nada"}` +
                    `${safe ? `; ${safe} protegido${safe === 1 ? "" : "s"} por safes` : ""}${out ? `; ${out} fuera del alcance` : ""}${sft ? `; ${sft} no se aplica${sft === 1 ? "" : "n"} por seguridad (limitador)` : ""}. Se puede deshacer.`;
                if (!(await this.confirmBox(`Recuperar la escena ${n}`, txt, "Recuperar", { gen, list })))
                    return;
                let r;
                try {
                    r = await m.sceneRecall(n, { expectedRevision: d.revision, ...(typeof sceneGen === "number" ? { sceneGen } : {}) });
                }
                catch (e) {
                    // El rechazo (STALE_*) ya se anuncia en grande; se recalcula el diff para que el operador lo vea.
                    this.diff = await m.sceneDiff(n).catch(() => null);
                    await this.refreshScenes();
                    if (e instanceof RequestFailed && e.error.code.startsWith("STALE"))
                        return;
                    throw e;
                }
                this.diff = await m.sceneDiff(n);
                await this.refreshScenes();
                this.toast(`Escena ${n} recuperada: ${String(r.applied ?? 0)} cambio${r.applied === 1 ? "" : "s"}`);
            }
        }
        catch (e) {
            this.toast(`Escenas: ${this.failText(e)}`);
            await this.refreshScenes();
        }
    }
    // ---------------------------------------------------------------- P2 · safes de recuperacion
    renderSafes(body) {
        const [s, e] = this.gRange();
        let cells = "";
        for (let c = s; c <= e; c++)
            cells += `<div class="safe-cell"><span class="sc-h"><i class="cdot" data-lblc="ch:${c}"></i>${pad2(c)}</span><span class="fit sc-n" data-lbl="ch:${c}" data-fitmax="150">CH ${pad2(c)}</span>
        ${this.sk(`ch.${c}.recall_safe`, "SAFE", "LIBRE", "red safe")}</div>`;
        body.innerHTML = `<div class="mod m-safes"><h3>SAFES · CH ${pad2(s)}–${pad2(e)}${this.gpageKeys()}<span class="open"><button class="sk" data-action="safes-all" title="Los ${this.model?.edition ?? 16} canales del show (todas las páginas)">TODOS SAFE</button><button class="sk" data-action="safes-none" title="Ningún canal del show (todas las páginas)">NINGUNO</button></span></h3>
        <div class="safegrid">${cells}</div>
        <div class="phase wide" data-phase-for="${Array.from({ length: e - s + 1 }, (_, i) => `ch.${s + i}.recall_safe`).join(" ")}"></div></div>
      <div class="mod m-safehelp"><h3>CÓMO ACTÚA</h3>
        <p>Un canal en <b>SAFE</b> no cambia al recuperar <b>ninguna</b> escena: ni fader, ni EQ, ni envíos, ni nombre, ni patch.</p>
        <p>Es un ajuste global del show (no se guarda en las escenas) y se puede deshacer.</p>
        <p class="dim">Las diferencias de una escena marcan los parámetros protegidos como SAFE.</p></div>`;
    }
    // ---------------------------------------------------------------- P2 · nombres y colores
    renderNames(body) {
        const kinds = NAME_KINDS.map(([k, l]) => `<button class="sk${k === this.nameKind ? " blue-on on" : ""}" data-action="names-kind" data-v="${k}" aria-pressed="${k === this.nameKind}">${l}</button>`).join("");
        const colorSel = (path, aria) => `<select class="psel csel" data-path="${path}" data-kind="sel" aria-label="${esc(aria)}">${COLOR_PALETTE.map((c, i) => `<option value="${i}">${esc(c.labelEs)}</option>`).join("")}</select>`;
        const card = (kind, n) => {
            const dl = defaultLabel(kind, n);
            return `<div class="ncard"><i class="cbar" data-lblc="${kind}:${n}"></i><b>${dl}</b>
        <input class="nin" type="text" data-kind="text" data-path="${namePath(kind, n)}" maxlength="128" spellcheck="false" autocomplete="off" placeholder="${dl}" aria-label="Nombre de ${dl}">
        ${colorSel(colorPath(kind, n), `Color de ${dl}`)}<span class="phase" data-phase-for="${namePath(kind, n)} ${colorPath(kind, n)}"></span></div>`;
        };
        let cards = "", title = "";
        if (this.nameKind === "show") {
            title = "NOMBRE DEL SHOW";
            cards = `<div class="ncard wide"><b>SHOW</b><input class="nin" type="text" data-kind="text" data-path="show.name" maxlength="160" spellcheck="false" autocomplete="off" placeholder="Show sin nombre" aria-label="Nombre del show">
        <span class="phase" data-phase-for="show.name"></span><small class="dim">Hasta ${SHOW_NAME_MAX_CHARS} caracteres. Aparece arriba a la izquierda. No forma parte de las escenas.</small></div>`;
        }
        else if (this.nameKind === "ch") {
            const [s, e] = this.gRange();
            title = `CANALES ${pad2(s)}–${pad2(e)}${this.gpageKeys()}`;
            for (let c = s; c <= e; c++)
                cards += card("ch", c);
        }
        else {
            const [, l, cnt] = NAME_KINDS.find(([k]) => k === this.nameKind);
            title = l;
            for (let i = 1; i <= cnt; i++)
                cards += card(this.nameKind, i);
        }
        body.innerHTML = `<div class="mod m-names"><h3>${title}</h3><div class="nkinds" role="group" aria-label="Elementos">${kinds}</div>
        <div class="ngrid${this.nameKind === "show" ? " one" : ""}">${cards}</div></div>`;
    }
    /** Aplica el nombre tecleado en un campo (Intro o al salir del campo). */
    commitText(inp) {
        const path = inp.dataset.path;
        const d = descOf(path);
        const v = normalizeName(inp.value);
        const cur = this.engineVal(path);
        if (v === cur) {
            inp.value = typeof cur === "string" ? cur : "";
            return;
        }
        const why = nameProblem(v, d?.max ?? NAME_MAX_CHARS);
        if (why) {
            this.toast(`Nombre: ${why}`);
            inp.value = typeof cur === "string" ? cur : "";
            return;
        }
        inp.value = v;
        this.send(path, v);
    }
    // ---------------------------------------------------------------- P2 · retornos de FX (P1b sin pantalla)
    renderFxReturns(body) {
        let rows = "", grid = `<span class="gh0">RETORNO</span><span class="gh0">SOLO</span>`;
        for (let d = 1; d <= DCA_COUNT; d++)
            grid += `<span class="mh">D${d}</span>`;
        for (let g = 1; g <= MUTEGROUP_COUNT; g++)
            grid += `<span class="mh">M${g}</span>`;
        const phase = [];
        for (let f = 1; f <= FX_COUNT; f++) {
            let cells = "";
            for (let k = 1; k <= AUX_COUNT; k++) {
                const p = `fx.${f}.aux.${k}`;
                phase.push(`${p}.level_db`, `${p}.pre_fader`);
                cells += `<td class="hf"><div class="hfader bar" data-path="${p}.level_db" data-kind="hfader" tabindex="0" role="slider" aria-label="Envío de FX ${f} a AUX ${k}"><div class="slot"><i></i></div><div class="cap"></div></div></td>
          <td class="num" data-readout="${p}.level_db">—</td><td>${this.sk(`${p}.pre_fader`, "PRE", "POST", "pre")}</td>`;
            }
            rows += `<tr><th><span class="fit" data-lbl="fx:${f}" data-fitmax="104">FX ${f}</span></th>${cells}</tr>`;
            grid += `<b class="gname fit" data-lbl="fx:${f}">FX ${f}</b>${this.sk(`fx.${f}.solo`, "SOLO", "SOLO", "solo gm")}`;
            for (let d = 1; d <= DCA_COUNT; d++)
                grid += `<button class="mx" data-path="fx.${f}.dca.${d}" data-kind="bool" aria-label="FX ${f} en DCA ${d}" title="FX ${f} → DCA ${d}"></button>`;
            for (let g = 1; g <= MUTEGROUP_COUNT; g++)
                grid += `<button class="mx mgx" data-path="fx.${f}.mutegroup.${g}" data-kind="bool" aria-label="FX ${f} en grupo de mute ${g}" title="FX ${f} → MUTE ${g}"></button>`;
            phase.push(`fx.${f}.solo`, ...Array.from({ length: DCA_COUNT }, (_, i) => `fx.${f}.dca.${i + 1}`), ...Array.from({ length: MUTEGROUP_COUNT }, (_, i) => `fx.${f}.mutegroup.${i + 1}`));
        }
        let head = "<tr><th></th>";
        for (let k = 1; k <= AUX_COUNT; k++)
            head += `<th colspan="3" class="auxh"><span class="fit" data-lbl="aux:${k}" data-fitmax="150">AUX ${k}</span></th>`;
        body.innerHTML = `<div class="mod m-fxaux"><h3>ENVÍOS DE LOS RETORNOS A AUX<span class="open">Reverb y delay en monitores · suma mono L+R</span></h3>
        <table class="sends fxaux">${head}</tr>${rows}</table></div>
      <div class="mod m-fxgrp"><h3>SOLO · DCA · GRUPOS DE MUTE</h3>
        <div class="ggrid fxg" style="--n:${DCA_COUNT + MUTEGROUP_COUNT}">${grid}</div>
        <p class="dim">SOLO escucha el retorno en MON (PFL/AFL). DCA y grupos actúan sobre el retorno como sobre un canal.</p>
        <div class="phase wide" data-phase-for="${phase.join(" ")}"></div></div>`;
    }
    // ---------------------------------------------------------------- P2 · subgrupos estereo (P1b sin pantalla)
    renderGroups(body) {
        let cols = "";
        for (let n = 1; n <= GROUP_COUNT; n++) {
            const p = `grp.${n}`;
            cols += `<div class="grpcol"><b class="an fit" data-lbl="grp:${n}">GRP ${n}</b>
        <span class="ad"><i class="cdot" data-lblc="grp:${n}"></i><span data-members="grp:${n}" data-short="1">—</span></span>
        <div class="hfader bar" data-path="${p}.level_db" data-kind="hfader" tabindex="0" role="slider" aria-label="Nivel del subgrupo ${n}"><div class="slot"><i></i></div><div class="cap"></div></div>
        <span class="gv"><b data-readout="${p}.level_db">—</b><b data-readout="${p}.pan">—</b></span>
        <span class="gk">${this.sk(`${p}.mute`, "MUTE", "MUTE", "red")}${this.sk(`${p}.solo`, "SOLO", "SOLO", "solo")}</span>
        <div class="hpan" data-path="${p}.pan" data-kind="pan" data-axis="x" tabindex="0" role="slider" aria-label="Balance del subgrupo ${n}" aria-valuemin="-1" aria-valuemax="1"><span class="mid"></span><span class="pcap"></span></div>
        <span class="gk">${this.sk(`${p}.main_assign`, "MAIN", "MAIN")}${this.pknob(`${p}.width`, "ANCHO", `Subgrupo ${n}: anchura`, "#9aa7b4", "small")}</span>
        <div class="phase" data-phase-for="${p}.level_db ${p}.mute ${p}.main_assign ${p}.solo ${p}.pan ${p}.width"></div></div>`;
        }
        const [s, e] = this.gRange();
        let g = `<span class="gh0">GRUPO</span><span class="gh0">CANALES</span>`;
        for (let c = s; c <= e; c++)
            g += `<span class="mh">${pad2(c)}</span>`;
        const paths = [];
        for (let n = 1; n <= GROUP_COUNT; n++) {
            g += `<b class="gname fit" data-lbl="grp:${n}">GRP ${n}</b><span class="gcount" data-members="grp:${n}">—</span>`;
            for (let c = s; c <= e; c++) {
                g += `<button class="mx" data-path="ch.${c}.grp.${n}" data-kind="bool" aria-label="CH ${pad2(c)} al subgrupo ${n}" title="CH ${pad2(c)} → GRP ${n}"></button>`;
                paths.push(`ch.${c}.grp.${n}`);
            }
        }
        let dg = `<span class="gh0">GRUPO</span>`;
        for (let d = 1; d <= DCA_COUNT; d++)
            dg += `<span class="mh">D${d}</span>`;
        for (let m = 1; m <= MUTEGROUP_COUNT; m++)
            dg += `<span class="mh">M${m}</span>`;
        for (let n = 1; n <= GROUP_COUNT; n++) {
            dg += `<b class="gname fit" data-lbl="grp:${n}">GRP ${n}</b>`;
            for (let d = 1; d <= DCA_COUNT; d++) {
                dg += `<button class="mx" data-path="grp.${n}.dca.${d}" data-kind="bool" aria-label="Subgrupo ${n} en DCA ${d}" title="GRP ${n} → DCA ${d}"></button>`;
                paths.push(`grp.${n}.dca.${d}`);
            }
            for (let m = 1; m <= MUTEGROUP_COUNT; m++) {
                dg += `<button class="mx mgx" data-path="grp.${n}.mutegroup.${m}" data-kind="bool" aria-label="Subgrupo ${n} en grupo de mute ${m}" title="GRP ${n} → MUTE ${m}"></button>`;
                paths.push(`grp.${n}.mutegroup.${m}`);
            }
        }
        body.innerHTML = `<div class="mod m-grpcols">${cols}</div>
      <div class="mod m-grpassign"><h3>CANALES → SUBGRUPOS · CH ${pad2(s)}–${pad2(e)}${this.gpageKeys()}<span class="open">post-fader · post-pan</span></h3>
        <div class="ggrid grpg" style="--n:${e - s + 1}">${g}</div>
        <div class="phase wide" data-phase-for="${paths.filter((x) => x.startsWith("ch.")).join(" ")}"></div></div>
      <div class="mod m-grpdca"><h3>DCA Y GRUPOS DE MUTE</h3>
        <div class="ggrid grpd" style="--n:${DCA_COUNT + MUTEGROUP_COUNT}">${dg}</div>
        <div class="phase wide" data-phase-for="${paths.filter((x) => x.startsWith("grp.")).join(" ")}"></div></div>`;
    }
    // ---------------------------------------------------------------- P2 · deshacer / rehacer
    /** Revision 03-11: como mucho UNA orden de deshacer/rehacer en camino; las pulsaciones de mas se descartan
     *  (con aviso), nunca se encolan. Deshacer una escena o un paso de OTRA consola pide confirmacion, que dice
     *  que se va a deshacer; la orden lleva el paso visto (el motor la rechaza si otro paso se puso encima). */
    async onUndo(undo) {
        const m = this.model;
        if (!m?.connected)
            return;
        const verb = undo ? "Deshacer" : "Rehacer";
        if (this.historyBusy) {
            this.toast(`${verb}: ya hay una orden en camino; esta pulsación se ignora`);
            return;
        }
        const h = m.history;
        const step = undo ? h.undoStep : h.redoStep;
        const label = undo ? h.undoLabel : h.redoLabel;
        const client = undo ? h.undoClient : h.redoClient;
        const scene = undo ? h.undoScene : h.redoScene;
        if (!step) {
            this.toast(`${verb}: nada`);
            return;
        }
        this.historyBusy = true;
        this.queueRender();
        try {
            const other = !scene && client !== m.clientId;
            if (scene || other) {
                const what = scene ? `la recuperación de la escena ${scene} («${label}»): todos los parámetros que cambió volverán a su valor anterior en un solo paso`
                    : `«${label}», un cambio hecho por OTRA consola`;
                if (!(await this.confirmBox(`${verb}: ${scene ? `escena ${scene}` : "cambio de otra consola"}`, `Se ${undo ? "deshará" : "rehará"} ${what}.`, verb, { gen: this.safetyGen })))
                    return;
            }
            const r = undo ? await m.undo(step) : await m.redo(step);
            const lbl = typeof r.label === "string" ? r.label : label;
            const sk = Array.isArray(r.skipped_safety) ? r.skipped_safety.length : 0;
            this.toast(`${undo ? "Deshecho" : "Rehecho"}: ${lbl}${sk ? ` · ${sk} limitador${sk === 1 ? "" : "es"} sin cambiar (protección)` : ""}`);
            if (this.view === "escenas")
                await this.refreshScenes();
        }
        catch (e) {
            if (!(e instanceof RequestFailed && e.error.code.startsWith("STALE")))
                this.toast(`${verb}: ${this.failText(e)}`);
        }
        finally {
            this.historyBusy = false;
            this.queueRender();
        }
    }
    // ---------------------------------------------------------------- piezas comunes de las pantallas P3
    /** Mando giratorio de un parametro del motor (sin canal en el nombre accesible). */
    pknob(path, label, aria, color, size) {
        return `<div class="pk${size ? " " + size : ""}"><div class="knob num" data-path="${path}" data-kind="num" tabindex="0" role="slider" style="--kc:${color}"
      aria-label="${esc(aria)}"><i></i></div><span class="pk-label">${esc(label)}</span><b class="pk-val" data-readout="${path}">—</b></div>`;
    }
    /** Teclas de un parametro enumerado: se ilumina SOLO el valor que el motor confirma. */
    enumKeys(path, aria, only) {
        const d = descOf(path);
        const idx = only ?? (d?.values ?? []).map((_, i) => i);
        return `<span class="seg" role="radiogroup" aria-label="${esc(aria)}">${idx.map((i) => `<button class="sk segk" data-path="${path}" data-kind="enumv" data-v="${i}" role="radio" aria-checked="false">${esc(enumLabel(d?.values[i] ?? String(i)))}</button>`).join("")}</span>`;
    }
    /** Selector de un parametro entero o enumerado (patch). Muestra el valor CONFIRMADO por el motor. */
    selectHtml(path, aria) {
        const d = descOf(path);
        let opts = "";
        if (d?.type === "enum")
            opts = d.values.map((v, i) => `<option value="${i}">${esc(enumLabel(v))}</option>`).join("");
        else {
            const ed = this.model?.edition ?? 16;
            for (let i = 0; i <= ed; i++)
                opts += `<option value="${i}">${i === 0 ? "Ninguna" : `Entrada ${i}`}</option>`;
        }
        return `<select class="psel" data-path="${path}" data-kind="sel" aria-label="${esc(aria)}">${opts}</select>`;
    }
    /** Paginas de 16 canales (ediciones de 32 y 64) para pertenencia y patch de entrada. */
    gpageKeys() {
        const ed = this.model?.edition ?? 16;
        if (ed <= GPAGE)
            return "";
        let h = `<span class="gpages" role="group" aria-label="Página de canales">`;
        for (let s = 1; s <= ed; s += GPAGE)
            h += `<button class="sk${s === this.gpage ? " blue-on on" : ""}" data-gpage="${s}" aria-pressed="${s === this.gpage}">${s}–${Math.min(ed, s + GPAGE - 1)}</button>`;
        return h + "</span>";
    }
    gRange() {
        const ed = this.model?.edition ?? 16;
        if (this.gpage > ed)
            this.gpage = 1;
        return [this.gpage, Math.min(ed, this.gpage + GPAGE - 1)];
    }
    // ---------------------------------------------------------------- DCA y grupos de mute (F030)
    memberGrid(kind) {
        const [s, e] = this.gRange();
        const n = e - s + 1;
        const rows = kind === "dca" ? DCA_COUNT : MUTEGROUP_COUNT;
        let g = `<span class="gh0">${kind === "dca" ? "DCA" : "GRUPO"}</span><span class="gh0">${kind === "dca" ? "NIVEL" : "ESTADO"}</span><span class="gh0">${kind === "dca" ? "MUTE" : ""}</span><span class="gh0">MIEMBROS</span>`;
        for (let c = s; c <= e; c++)
            g += `<span class="mh">${pad2(c)}</span>`;
        for (let r = 1; r <= rows; r++) {
            if (kind === "dca") {
                g += `<b class="gname fit" data-lbl="dca:${r}">DCA ${r}</b><b class="gval" data-readout="dca.${r}.level_db">—</b>${this.sk(`dca.${r}.mute`, "MUTE", "MUTE", "red gm")}`;
            }
            else {
                g += `<b class="gname fit" data-lbl="mg:${r}">MUTE ${r}</b>${this.sk(`mutegroup.${r}.on`, "ACTIVO", "INACTIVO", "red gm")}<span></span>`;
            }
            g += `<span class="gcount" data-members="${kind}:${r}">—</span>`;
            for (let c = s; c <= e; c++) {
                const path = kind === "dca" ? `ch.${c}.dca.${r}` : `ch.${c}.mutegroup.${r}`;
                g += `<button class="mx" data-path="${path}" data-kind="bool" aria-label="CH ${pad2(c)} en ${kind === "dca" ? "DCA" : "grupo de mute"} ${r}" title="CH ${pad2(c)} → ${kind === "dca" ? "DCA" : "MUTE"} ${r}"></button>`;
            }
        }
        const paths = [];
        for (let r = 1; r <= rows; r++)
            for (let c = s; c <= e; c++)
                paths.push(kind === "dca" ? `ch.${c}.dca.${r}` : `ch.${c}.mutegroup.${r}`);
        return `<div class="ggrid${kind === "mg" ? " mg" : ""}" style="--n:${n}">${g}</div>
      <div class="phase wide" data-phase-for="${paths.join(" ")} ${Array.from({ length: rows }, (_, i) => kind === "dca" ? `dca.${i + 1}.mute dca.${i + 1}.level_db` : `mutegroup.${i + 1}.on`).join(" ")}"></div>`;
    }
    renderDca(body) {
        const [s, e] = this.gRange();
        body.innerHTML = `<div class="mod m-members"><h3>PERTENENCIA A DCA · CH ${pad2(s)}–${pad2(e)}${this.gpageKeys()}<span class="open">Nivel de DCA: banco DCA de los faders</span></h3>
        ${this.memberGrid("dca")}</div>
      <div class="mod m-ghelp"><h3>CÓMO ACTÚA</h3>
        <p>Un <b>DCA</b> desplaza en dB el fader de sus miembros: a 0 dB no cambia nada; en −∞ los apaga. Un canal en varios DCA suma sus niveles (tope +10 dB).</p>
        <p><b>MUTE</b> de DCA silencia a sus miembros, también sus envíos pre-fader.</p>
        <p class="dim">El DCA no tiene audio propio: no hay medidor de DCA.</p>
        <button class="sk blue-on" data-bank-go="dca">VER BANCO DCA EN LOS FADERS</button></div>`;
    }
    renderMuteGroups(body) {
        const [s, e] = this.gRange();
        body.innerHTML = `<div class="mod m-members"><h3>PERTENENCIA A GRUPOS DE MUTE · CH ${pad2(s)}–${pad2(e)}${this.gpageKeys()}</h3>
        ${this.memberGrid("mg")}</div>
      <div class="mod m-ghelp"><h3>CÓMO ACTÚA</h3>
        <p>Un <b>grupo activo</b> silencia a la vez a todos sus miembros (rampa de 5 ms), también sus envíos pre-fader, como el mute del canal.</p>
        <p>Un canal puede estar en varios grupos; basta uno activo para silenciarlo. Su tecla MUTE propia no cambia.</p>
        <p class="dim">Las teclas de grupo también están en el banco DCA de los faders.</p></div>`;
    }
    // ---------------------------------------------------------------- patch (F006, F027)
    renderInputPatch(body) {
        const [s, e] = this.gRange();
        let cells = "";
        for (let c = s; c <= e; c++)
            cells += `<div class="ipc" data-ipc="${c}"><b>CH ${pad2(c)}</b>${this.selectHtml(`ch.${c}.input`, `Entrada del canal ${c}`)}<span class="phase" data-phase-for="ch.${c}.input"></span></div>`;
        body.innerHTML = `<div class="mod m-ipatch"><h3>PATCH DE ENTRADA · CH ${pad2(s)}–${pad2(e)}${this.gpageKeys()}<span class="open">Resaltado: canal que no lee su entrada del mismo número</span></h3>
        <div class="ipgrid">${cells}</div></div>
      <div class="mod m-ipnote"><h3>SEGURIDAD</h3>
        <p><b>Ninguna</b>: el canal recibe <b>cero exacto</b>.</p>
        <p>El cambio baja la entrada anterior en 5 ms y sube la nueva en 5 ms (sin clic). Dos canales pueden leer la misma entrada.</p>
        <p class="dim">El mapa físico → lógico del dispositivo sigue fijado por CONFIG.</p>
        <button class="sk" data-action="ipatch-identity">PATCH 1:1…</button></div>`;
    }
    renderOutputPatch(body) {
        let rows = "";
        const d = descOf("out.1.source");
        for (let o = 1; o <= OUTPUT_SLOTS; o++)
            rows += `<tr><th>RANURA ${o}</th><td>${this.selectHtml(`out.${o}.source`, `Fuente de la ranura de salida ${o}`)}</td>
        <td class="dim">${esc(enumLabel(d?.values[o] ?? ""))}</td><td><span class="eff" data-effsrc="${o}">—</span></td>
        <td class="phase" data-phase-for="out.${o}.source"></td></tr>`;
        body.innerHTML = `<div class="mod m-opatch"><h3>PATCH DE SALIDA · ranura ← bus<span class="open">Estado = salida efectiva del bus elegido</span></h3>
        <table class="outs opatch"><thead><tr><th>Ranura</th><th>Fuente</th><th>Por defecto</th><th>Estado del bus</th><th>Fase</th></tr></thead>${rows}</table></div>
      <div class="mod m-nodest"><h3>BUSES SIN DESTINO</h3>
        <div class="nodest" data-nodest>—</div>
        <p>Un bus que no alimenta ninguna ranura <b>no tiene destino</b>: su permiso es falso y sale <b>cero exacto</b> (lo exige el monitor de seguridad).</p>
        <p>Ranura sin fuente: cero exacto desde el primer bloque. Cambio de fuente: baja 5 ms, cambia y sube.</p>
        <p class="dim">Qué canal físico es cada ranura: fijado por CONFIG al arrancar.</p></div>`;
    }
    // ---------------------------------------------------------------- FX 1-4 (F028, F029)
    renderFx(body) {
        const f = this.fxUnit;
        const type = fxTypeName(this.num(`fx.${f}.type`));
        const fam = FX_FAMILY[type] ?? "off";
        this.fxPanelType = `${f}:${type}`;
        const units = Array.from({ length: FX_COUNT }, (_, i) => {
            const u = i + 1;
            return `<button class="fxu${u === f ? " sel" : ""}" data-fxunit="${u}" aria-pressed="${u === f}" aria-label="Unidad FX ${u}">
        <span class="face"><span class="u1-pos">FX ${u}</span><span class="u1-name"><b data-fxname="${u}">—</b><small data-fxsub="${u}">—</small></span><span class="u1-lcd" data-fxlcd="${u}">—</span></span>
        <span class="ret"><small>RET</small><span class="meter h" data-meter="fx:${u}"><i></i><b></b><em class="clip"></em></span><b data-readout="fx.${u}.level_db">—</b></span></button>`;
        }).join("");
        const knobs = (FX_PARAMS[fam] ?? []).map(([k, l]) => this.pknob(`fx.${f}.${k}`, l, `FX ${f}: ${l.toLowerCase()}`, FX_KNOB_COLOR[fam] ?? "#4aa3ff", "")).join("");
        const isDelay = fam === "delay";
        const mid = !type
            ? `<p class="fpmsg">Sin dato del motor.</p>`
            : type === "off"
                ? `<p class="fpmsg">Unidad <b>apagada</b>: no procesa y sus envíos no suenan. Elija un tipo para activarla (el nuevo arranca con memoria vacía).</p>`
                : `<div class="fp-knobs">${knobs}</div>${isDelay ? `<div class="fp-keys"><button class="hwkey tap" data-tap="${f}" title="Pulse a tempo (2 o más golpes): fija el tiempo">TAP</button><span class="tapinfo" data-tapinfo="${f}">—</span></div>` : ""}`;
        const params = [...(FX_PARAMS[fam] ?? []).map(([k]) => `fx.${f}.${k}`), `fx.${f}.type`, `fx.${f}.level_db`, `fx.${f}.mute`, `fx.${f}.main_assign`, `fx.${f}.pan`, `fx.${f}.width`];
        const avail = Object.values(FX_ENGINE_EQUIV);
        const libOn = FX_TYPES.filter((t) => t !== "off").map((t) => `<span class="lon${t === type ? " on" : ""}">${enumLabel(t)}<small>${esc(FX_CATALOG.find((x) => x.id === FX_ENGINE_EQUIV[t])?.name ?? "")}</small></span>`).join("");
        const libOff = FX_FAMILIES.flatMap((fm) => FX_CATALOG.filter((x) => x.family === fm && !avail.includes(x.id)).map((x) => esc(x.name))).join(" · ");
        const nOff = FX_CATALOG.filter((x) => !avail.includes(x.id)).length;
        body.innerHTML = `<div class="vrack fxrack" role="group" aria-label="Rack de efectos FX 1–${FX_COUNT}">${units}</div>
      <div class="fp-wrap">
        <div class="fp" data-fam="${fam}">
          <div class="fp-top"><span class="fp-brand">BENZAI</span><span class="fp-model"><b><span data-lbl="fx:${f}">FX ${f}</span> · ${type ? enumLabel(type) : "—"}</b><small>${FX_FAMILY_LABEL[fam] ?? ""}</small></span>
            ${this.enumKeys(`fx.${f}.type`, `Tipo de efecto de FX ${f}`)}</div>
          <div class="fp-mid">${mid}</div>
          <div class="fp-ret"><span class="rl">RETORNO</span>
            <div class="hfader" data-path="fx.${f}.level_db" data-kind="hfader" tabindex="0" role="slider" aria-label="Nivel de retorno de FX ${f}"><div class="slot"><i></i></div><div class="cap"></div></div>
            <b class="rv" data-readout="fx.${f}.level_db">—</b>
            ${this.sk(`fx.${f}.mute`, "MUTE ON", "MUTE", "red")}${this.sk(`fx.${f}.main_assign`, "A MAIN", "SIN MAIN")}
            <span class="rl">PAN</span><div class="hpan" data-path="fx.${f}.pan" data-kind="pan" data-axis="x" tabindex="0" role="slider" aria-label="Balance del retorno de FX ${f}" aria-valuemin="-1" aria-valuemax="1"><span class="mid"></span><span class="pcap"></span></div>
            <b class="rv sm" data-readout="fx.${f}.pan">—</b>
            ${this.pknob(`fx.${f}.width`, "ANCHURA", `FX ${f}: anchura estéreo`, "#9aa7b4", "small")}</div>
          <div class="phase wide fp-phase" data-phase-for="${params.join(" ")}"></div>
        </div>
      </div>
      <div class="lib2 fxlib"><div class="rk-h">ENVÍOS A FX ${f}<small>canales con envío</small></div>
        <div class="fxsends" data-fxsends="${f}">—</div>
        <div class="rk-h">ALGORITMOS<small>en el motor: ${FX_TYPES.length - 1}</small></div>
        <div class="libon">${libOn}</div>
        <div class="liboff"><span class="nc">HISTÓRICO · NO DISPONIBLE (${nOff} + presets)</span><p>${libOff}</p></div></div>`;
    }
    // Las curvas se dibujan con los valores CONFIRMADOS por el motor (no con un cambio aun enviado):
    // la curva es la respuesta del filtro que esta aplicando el motor.
    num(path) {
        const v = this.model?.value(path);
        return typeof v === "number" ? v : undefined;
    }
    flag(path) {
        return this.model?.value(path) === true;
    }
    drawEq(svg, big) {
        const m = this.model;
        const p = `ch.${this.selected}`;
        const n = (k, d) => this.num(`${p}.${k}`) ?? d;
        const b = (k) => this.flag(`${p}.${k}`);
        const s = {
            hpfOn: b("hpf_on"), hpfHz: n("hpf_hz", 80), lpfOn: b("lpf_on"), lpfHz: n("lpf_hz", 18000), eqOn: b("eq_on"),
            low: { f: n("eq.low.freq_hz", 100), g: n("eq.low.gain_db", 0) },
            lmid: { f: n("eq.lmid.freq_hz", 400), g: n("eq.lmid.gain_db", 0), q: n("eq.lmid.q", 1) },
            hmid: { f: n("eq.hmid.freq_hz", 2500), g: n("eq.hmid.gain_db", 0), q: n("eq.hmid.q", 1) },
            high: { f: n("eq.high.freq_hz", 8000), g: n("eq.high.gain_db", 0) },
        };
        const rate = m?.rate || 48000;
        // El sistema de coordenadas sigue al tamano real del elemento (sin deformar el texto).
        const W = Math.max(120, Math.round(svg.clientWidth || 600)), H = Math.max(50, Math.round(svg.clientHeight || 120)), range = 18;
        svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
        const x = (f) => (Math.log(f / 20) / Math.log(1000)) * W;
        const y = (d) => H / 2 - (Math.max(-range * 1.4, Math.min(range * 1.4, d)) / range) * (H / 2 - 6);
        let path = "";
        for (let i = 0; i <= 240; i++) {
            const f = 20 * Math.pow(1000, i / 240);
            path += `${i ? "L" : "M"}${x(f).toFixed(1)},${Math.max(1, Math.min(H - 1, y(responseDb(s, f, rate)))).toFixed(1)}`;
        }
        let grid = "";
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000])
            grid += `<line x1="${x(f)}" x2="${x(f)}" y1="0" y2="${H}"/>${big ? `<text x="${x(f) + 4}" y="${H - 6}">${f >= 1000 ? f / 1000 + "k" : f}</text>` : ""}`;
        for (const d of [-12, -6, 6, 12])
            grid += `<line x1="0" x2="${W}" y1="${y(d)}" y2="${y(d)}"/>${big ? `<text x="6" y="${y(d) - 4}">${d > 0 ? "+" : "−"}${Math.abs(d)}</text>` : ""}`;
        const live = !!m?.connected;
        let nodes = "";
        if (live && big) {
            BANDS.forEach(([k], i) => {
                const f = s[k].f, g = s[k].g;
                const col = BAND_COLOR[k];
                nodes += `<circle cx="${x(f).toFixed(1)}" cy="${y(g).toFixed(1)}" r="13" fill="${col}" fill-opacity=".18" stroke="${col}" stroke-width="2" opacity="${s.eqOn ? 1 : 0.45}"/><text class="node" x="${x(f).toFixed(1)}" y="${(y(g) + 5).toFixed(1)}" fill="${col}" text-anchor="middle">${i + 1}</text>`;
            });
            if (s.hpfOn)
                nodes += `<line class="hpf" x1="${x(s.hpfHz)}" x2="${x(s.hpfHz)}" y1="8" y2="${H - 22}"/><text class="hpf" x="${x(s.hpfHz) + 6}" y="20">HPF ${formatValue(descOf(`${p}.hpf_hz`), s.hpfHz)}</text>`;
        }
        svg.innerHTML = `<g class="grid">${grid}<line class="zero" x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}"/></g>${live ? `<path class="fill" d="${path}L${W},${y(0)}L0,${y(0)}Z"/><path class="resp" d="${path}"/>${nodes}` : ""}`;
    }
    drawComp(svg) {
        const p = `ch.${this.selected}`;
        const n = (k, d) => this.num(`${p}.comp.${k}`) ?? d;
        const on = this.flag(`${p}.comp.on`);
        const thr = n("threshold_db", -20), ratio = n("ratio", 3), knee = n("knee_db", 6), mk = n("makeup_db", 0);
        const S = 200, lo = -60;
        const xy = (d) => ((Math.max(lo, Math.min(0, d)) - lo) / -lo) * S;
        let path = "";
        for (let i = 0; i <= 120; i++) {
            const inDb = lo + (i / 120) * -lo;
            const out = on ? compCurveDb(inDb, thr, ratio, knee, mk) : inDb;
            path += `${i ? "L" : "M"}${xy(inDb).toFixed(1)},${(S - xy(out)).toFixed(1)}`;
        }
        const live = !!this.model?.connected;
        svg.setAttribute("viewBox", `0 0 ${S} ${S}`);
        svg.innerHTML = `<g class="grid">${[-48, -36, -24, -12].map((g) => `<line x1="${xy(g)}" x2="${xy(g)}" y1="0" y2="${S}"/><line y1="${S - xy(g)}" y2="${S - xy(g)}" x1="0" x2="${S}"/>`).join("")}<line class="diag" x1="0" y1="${S}" x2="${S}" y2="0"/>${live ? `<line class="thr" x1="${xy(thr)}" x2="${xy(thr)}" y1="0" y2="${S}"/>` : ""}</g>${live ? `<path class="resp comp${on ? "" : " off"}" d="${path}"/>` : ""}`;
    }
    drawGate(svg) {
        const p = `ch.${this.selected}`;
        const thr = this.num(`${p}.gate.threshold_db`) ?? -50, range = this.num(`${p}.gate.range_db`) ?? 60;
        const on = this.flag(`${p}.gate.on`);
        const S = 200, lo = -80;
        const xy = (d) => ((Math.max(lo, Math.min(0, d)) - lo) / -lo) * S;
        let path = "";
        for (let i = 0; i <= 160; i++) {
            const inDb = lo + (i / 160) * -lo;
            const out = on && inDb < thr ? Math.max(lo, inDb - range) : inDb;
            path += `${i ? "L" : "M"}${xy(inDb).toFixed(1)},${(S - xy(out)).toFixed(1)}`;
        }
        const live = !!this.model?.connected;
        svg.innerHTML = `<g class="grid">${[-60, -40, -20].map((g) => `<line x1="${xy(g)}" x2="${xy(g)}" y1="0" y2="${S}"/><line y1="${S - xy(g)}" y2="${S - xy(g)}" x1="0" x2="${S}"/>`).join("")}<line class="diag" x1="0" y1="${S}" x2="${S}" y2="0"/>${live ? `<line class="thr" x1="${xy(thr)}" x2="${xy(thr)}" y1="0" y2="${S}"/>` : ""}</g>${live ? `<path class="resp gate${on ? "" : " off"}" d="${path}"/>` : ""}`;
    }
    drawCurves() {
        const eq = document.getElementById("eq-curve");
        if (eq)
            this.drawEq(eq, true);
        const mini = document.getElementById("eq-mini");
        if (mini)
            this.drawEq(mini, false);
        for (const id of ["comp-curve", "comp-mini"]) {
            const cc = document.getElementById(id);
            if (cc)
                this.drawComp(cc);
        }
        const gc = document.getElementById("gate-curve");
        if (gc)
            this.drawGate(gc);
    }
    // ---------------------------------------------------------------- actualizacion
    queueRender() {
        if (this.renderQueued)
            return;
        this.renderQueued = true;
        requestAnimationFrame(() => {
            this.renderQueued = false;
            this.renderValues();
        });
    }
    ctl(path) {
        const m = this.model;
        if (!m || !m.has(path))
            return { v: undefined, phase: null };
        const c = m.control(path);
        // Conmutadores (mute, solo, asignaciones): SIEMPRE el valor del motor; el envio se marca aparte.
        // Faders y mandos: el valor pedido mientras se arrastran (marcado "enviado").
        const req = c.requestedValue;
        return { v: c.phase === "sending" && typeof req !== "boolean" ? req : c.engineValue, phase: c.phase, error: c.error };
    }
    /** Valor CONFIRMADO por el motor (nunca el pedido): conmutadores, teclas de tipo y selectores. */
    engineVal(path) {
        const m = this.model;
        if (!m?.connected || !m.has(path))
            return undefined;
        return m.control(path).engineValue;
    }
    /** Canal silenciado por un DCA en MUTE o por un grupo de mute activo (estado confirmado por el motor). */
    groupMuted(c) {
        const why = [];
        for (let d = 1; d <= DCA_COUNT; d++)
            if (this.engineVal(`ch.${c}.dca.${d}`) === true && this.engineVal(`dca.${d}.mute`) === true)
                why.push(`DCA ${d}`);
        for (let g = 1; g <= MUTEGROUP_COUNT; g++)
            if (this.engineVal(`ch.${c}.mutegroup.${g}`) === true && this.engineVal(`mutegroup.${g}.on`) === true)
                why.push(`grupo ${g}`);
        return why;
    }
    oscText() {
        const t = this.engineVal("osc.type"), d = this.engineVal("osc.dest"), l = this.engineVal("osc.level_db"), fq = this.engineVal("osc.freq_hz");
        if (typeof t !== "number" || typeof d !== "number" || typeof l !== "number")
            return "";
        const sig = t === 0 ? `seno ${formatValue(descOf("osc.freq_hz"), typeof fq === "number" ? fq : 1000)}` : "ruido rosa";
        return `${sig} a ${formatValue(descOf("osc.level_db"), l)} en ${enumLabel(descOf("osc.dest")?.values[d] ?? "")}`;
    }
    /** Alarmas activas, de mas a menos grave, a partir del estado que informa el motor. */
    alarms(connected, forced, solos, clipped) {
        const m = this.model;
        const f = m?.flags ?? {};
        const st = this.lastStatus;
        const out = [];
        const list = (a) => a.slice(0, 4).map((c) => `CH ${pad2(c)}`).join(", ") + (a.length > 4 ? "…" : "");
        if (!connected)
            return [{ lvl: "crit", title: "Motor desconectado", sub: "Controles bloqueados; el audio no depende de esta pantalla" }];
        if (f.silent_test)
            out.push({ lvl: "warn", short: "PRUEBA SILENCIOSA", title: "Prueba silenciosa", sub: "Salidas bloqueadas por diseño" });
        if (f.panic)
            out.push({ lvl: "crit", short: "PANIC ACTIVO", title: "PANIC activo", sub: "Todas las salidas en silencio" });
        if (forced.length)
            out.push({ lvl: "crit", short: "SALIDA CERRADA", title: "Salida cerrada por seguridad", sub: forced.map((o) => OUTPUT_LABEL[o] ?? o).join(", ") + " · vea RUTEO" });
        if (f.device_lost)
            out.push({ lvl: "crit", short: "DISPOSITIVO PERDIDO", title: "Dispositivo perdido", sub: "Salidas cerradas hasta su vuelta" });
        else if (m?.deviceProblem)
            out.push({ lvl: "crit", short: "DISPOSITIVO", title: "Problema de dispositivo", sub: m.deviceProblem });
        if (f.recovery_hold)
            out.push({ lvl: "warn", short: "SALIDAS RETENIDAS", title: "Salidas retenidas", sub: "Confirme «Reanudar salidas»" });
        if (f.stop)
            out.push({ lvl: "warn", short: "STOP", title: "STOP", sub: "Salidas detenidas; «Iniciar» las reabre con rampa" });
        const unknown = [...OUTPUTS].filter((o) => m?.output(o) === "unknown");
        if (unknown.length)
            out.push({ lvl: "warn", short: "SALIDA SIN DATO", title: "Salida sin dato", sub: unknown.map((o) => OUTPUT_LABEL[o] ?? o).join(", ") });
        const viol = Number(st.safety_violations ?? 0);
        if (viol > 0)
            out.push({ lvl: "warn", short: "SEGURIDAD", title: `Seguridad: ${viol} violación(es)`, sub: "Registradas desde el arranque · vea RUTEO" });
        if (st.safety_persisted === false)
            out.push({ lvl: "crit", short: "SEGURIDAD SIN GUARDAR", title: "Seguridad sin guardar", sub: "El motor no pudo guardar el estado de seguridad" });
        if (clipped.length)
            out.push({ lvl: "crit", short: "SATURACIÓN", title: `Saturación en ${list(clipped)}`, sub: "Entrada a 0 dBFS: baje el trim o la fuente" });
        if (this.engineVal("osc.on") === true)
            out.push({ lvl: "warn", short: "OSCILADOR", title: "Oscilador de prueba ENCENDIDO", sub: this.oscText() + " · vea SISTEMA" });
        if (solos.length)
            out.push({ lvl: "warn", short: "SOLO ACTIVO", title: `SOLO activo en ${list(solos)}`, sub: "Solo cambia lo que se oye en MON" });
        return out;
    }
    renderValues() {
        const m = this.model;
        const connected = !!m?.connected;
        document.querySelectorAll("[data-path]").forEach((el) => {
            const path = el.dataset.path;
            const { v, phase } = this.ctl(path);
            const available = connected && v !== undefined;
            el.classList.toggle("na", !available);
            el.setAttribute("aria-disabled", String(!available));
            el.dataset.phase = phase ?? "";
            const kind = el.dataset.kind;
            if (kind === "enumv") {
                // Tecla de un valor enumerado: encendida solo si el MOTOR confirma ese valor.
                const ev = this.engineVal(path);
                const on = available && ev === Number(el.dataset.v);
                el.classList.toggle("on", on);
                el.setAttribute("aria-checked", String(on));
                const req = this.model?.connected && this.model.has(path) ? this.model.control(path).requestedValue : undefined;
                el.dataset.phase = phase === "sending" && req === Number(el.dataset.v) ? "sending" : phase === "rejected" && on ? "rejected" : "";
            }
            else if (kind === "text") {
                // Campo de nombre: muestra el valor del MOTOR salvo mientras el operador escribe o su orden viaja.
                const inp = el;
                inp.disabled = !available;
                const ev = this.engineVal(path);
                if (document.activeElement !== inp && phase !== "sending") {
                    const want = typeof ev === "string" ? ev : "";
                    if (inp.value !== want)
                        inp.value = want;
                }
            }
            else if (kind === "sel") {
                const sel = el;
                sel.disabled = !available;
                const ev = this.engineVal(path);
                // Revision 03-11: el selector muestra SIEMPRE el valor del motor, tambien con el foco. Solo un
                // borrador de teclado (flechas, sin Intro) se conserva, y si el motor cambia debajo se marca conflicto.
                const draft = sel.dataset.draft;
                if (draft !== undefined && available) {
                    if (sel.value !== draft)
                        sel.value = draft;
                    const conflict = typeof ev === "number" && String(ev) !== sel.dataset.base;
                    sel.classList.toggle("conflict", conflict);
                    sel.title = conflict ? `Otra consola cambió este valor a «${sel.options[ev]?.text ?? ev}». Intro aplica su elección; Esc vuelve al valor del motor.`
                        : "Sin aplicar: Intro aplica, Esc descarta";
                }
                else {
                    const want = phase === "sending" ? this.model.control(path).requestedValue : ev;
                    if (typeof want === "number" && sel.value !== String(want))
                        sel.value = String(want);
                    sel.classList.remove("conflict");
                    sel.title = "";
                }
                sel.classList.toggle("draft", draft !== undefined);
                if (!available)
                    sel.selectedIndex = -1;
            }
            else if (kind === "bool") {
                const on = available && v === true;
                el.classList.toggle("on", on);
                el.setAttribute("aria-pressed", String(on));
                // Sin valor confirmado del motor no se muestra un estado como vigente.
                if (el.dataset.on)
                    el.textContent = available ? (on ? el.dataset.on : el.dataset.off) : "—";
                else if (path === "mon.afl")
                    el.textContent = on ? "AFL" : "PFL";
            }
            else if (kind === "fader" || kind === "hfader") {
                const db = typeof v === "number" ? v : OFF_DB;
                el.style.setProperty("--pos", String(dbToPos(db)));
                el.setAttribute("aria-valuenow", String(db));
                el.setAttribute("aria-valuetext", formatDb(db) + " dB");
            }
            else if (kind === "pan") {
                const p = typeof v === "number" ? v : 0;
                el.style.setProperty("--turn", `${p * 135}deg`);
                el.style.setProperty("--panpos", String((p + 1) / 2));
                el.setAttribute("aria-valuenow", String(p));
                el.setAttribute("aria-valuetext", formatPan(p));
            }
            else if (kind === "num") {
                const d = descOf(path);
                if (!available) {
                    el.removeAttribute("aria-valuenow");
                    el.setAttribute("aria-valuetext", "sin conexión con el motor");
                    el.style.setProperty("--frac", "0");
                }
                else if (d && typeof v === "number") {
                    const nv = toNorm(d, v);
                    el.style.setProperty("--turn", `${(nv * 270 - 135).toFixed(1)}deg`);
                    el.style.setProperty("--frac", nv.toFixed(3));
                    el.setAttribute("aria-valuenow", String(v));
                    el.setAttribute("aria-valuetext", formatValue(d, v));
                    el.setAttribute("aria-valuemin", String(d.min));
                    el.setAttribute("aria-valuemax", String(d.max));
                }
            }
        });
        // Tiras: canal en MUTE (lectura en rojo) y fader en −∞. Silenciado por DCA o grupo: lectura en rojo
        // y el motivo en el visor (la tecla MUTE del canal sigue mostrando solo su mute propio).
        document.querySelectorAll(".strip[data-ch]").forEach((s) => {
            s.classList.toggle("muted", connected && this.ctl(`ch.${s.dataset.ch}.mute`).v === true);
            const why = connected ? this.groupMuted(Number(s.dataset.ch)) : [];
            s.classList.toggle("gmuted", why.length > 0);
            s.title = why.length ? `Silenciado por ${why.join(", ")}` : "";
        });
        this.renderP3Values(connected);
        this.renderP2Values(connected);
        // Indicadores de procesado en las tiras de la mesa.
        document.querySelectorAll("[data-fx]").forEach((el) => {
            const on = connected && this.ctl(el.dataset.fx).v === true;
            el.classList.toggle("on", on);
            // Abren la pestana del canal (navegacion); su estado se anuncia en el nombre accesible.
            el.setAttribute("aria-label", `${el.title} del canal ${el.dataset.fxch}: ${on ? "activo" : "apagado"}. Abrir`);
        });
        document.querySelectorAll("[data-readout]").forEach((el) => {
            const path = el.dataset.readout;
            const { v } = this.ctl(path);
            // Sin motor no se muestra ningun valor como si fuera vigente.
            const d = descOf(path);
            let t;
            if (v === undefined || !connected)
                t = "—";
            else if (path.endsWith(".pan"))
                t = formatPan(v);
            else if (d && (d.since === "H3" || ((d.since === "P1" || d.since === "P1b") && (d.type !== "db" || d.unit === "dBFS"))))
                t = formatValue(d, v);
            else
                t = formatDb(v) + (path.endsWith("limiter_db") ? " dBFS" : "");
            if (el.textContent !== t)
                el.textContent = t;
            el.classList.toggle("inf", t === "−∞");
        });
        // Matriz de envios: intensidad de la celda segun el nivel y PRE/POST confirmados.
        document.querySelectorAll("[data-mlvl]").forEach((el) => {
            const v = connected ? this.ctl(el.dataset.mlvl).v : undefined;
            const cell = el.parentElement;
            const on = typeof v === "number" && v > OFF_DB;
            cell.classList.toggle("on", on);
            cell.style.setProperty("--lvl", on ? dbToPos(v).toFixed(3) : "0");
        });
        document.querySelectorAll("[data-prepost]").forEach((el) => {
            const v = connected ? this.ctl(el.dataset.prepost).v : undefined;
            el.textContent = v === undefined ? "—" : v ? "PRE" : "POST";
        });
        this.drawCurves();
        document.querySelectorAll("[data-phase-for]").forEach((el) => {
            // Fase mas reciente/relevante de los controles del grupo: rechazado > enviado > aceptado > aplicado.
            const order = ["rejected", "unknown", "sending", "accepted", "applied"];
            let best = null;
            for (const p of el.dataset.phaseFor.split(" ")) {
                const c = this.ctl(p);
                if (!c.phase || c.phase === "confirmed")
                    continue;
                if (!best || order.indexOf(c.phase) < order.indexOf(best.phase))
                    best = { phase: c.phase, error: c.error };
            }
            if (!connected)
                best = null;
            el.dataset.phase = best?.phase ?? "";
            const txt = best
                ? best.phase === "rejected" && best.error === "STALE_REVISION"
                    ? "rechazado: otra consola cambió el show; no se aplicó, repita la acción"
                    : PHASE_LABEL[best.phase] + ((best.phase === "rejected" || best.phase === "unknown") && best.error ? `: ${best.error}` : "")
                : "";
            // En cajas estrechas (tira de canal, celda de tabla) el texto completo no cabe: se muestra solo la fase
            // («rechazado») y el detalle queda en title y en el nombre accesible; nunca un texto recortado.
            if (el.dataset.full !== `${txt}|${this.fitEpoch}`) {
                el.dataset.full = `${txt}|${this.fitEpoch}`;
                el.textContent = txt;
                el.title = txt;
                el.setAttribute("aria-label", txt);
                if (txt && !el.classList.contains("wide") && el.scrollWidth > el.clientWidth + 1 && best) {
                    const short = best.phase === "unknown" ? "desconocido" : PHASE_LABEL[best.phase];
                    el.textContent = short;
                    if (el.scrollWidth > el.clientWidth + 1)
                        el.textContent = short.slice(0, 5) + ".";
                }
            }
        });
        document.querySelectorAll("[data-eff]").forEach((el) => {
            const o = el.dataset.eff;
            const st = connected && m ? m.output(o) : "unknown";
            el.dataset.state = st;
            // Las letras L/R de MAIN se conservan; el resto de celdas muestra el estado medido.
            if (!el.parentElement?.classList.contains("eff2"))
                el.textContent = STATE_LABEL[st] ?? st;
            el.title = `${OUTPUT_LABEL[o] ?? o}: ${STATE_LABEL[st] ?? st}`;
        });
        // El evento del motor manda en cuanto llega (sin esperar al sondeo de estado de cada 2 s).
        const forced = connected ? (m?.forcedClosed ?? this.lastStatus.forced_closed ?? []) : [];
        document.querySelectorAll("[data-forced]").forEach((el) => {
            const o = el.dataset.forced;
            const isForced = forced.includes(o);
            const html = isForced ? `<span class="bad">CERRADA</span> <button class="sk red" data-action="release" data-output="${o}">Liberar…</button>` : "no";
            if (el.innerHTML !== html)
                el.innerHTML = html;
        });
        document.querySelectorAll("[data-auxstate]").forEach((el) => {
            const k = el.dataset.auxstate;
            const en = connected ? m?.value(`aux.${k}.enabled`) : undefined;
            el.textContent = en === undefined ? "—" : en ? "AUX activo" : "AUX apagado";
        });
        // Solo
        const ed = m?.edition ?? 0;
        const solos = [];
        if (connected)
            for (let c = 1; c <= ed; c++)
                if (m?.value(`ch.${c}.solo`) === true)
                    solos.push(c);
        const ind = document.getElementById("solo-ind");
        if (ind)
            ind.classList.toggle("on", solos.length > 0);
        document.body.classList.toggle("solo-active", solos.length > 0);
        const sl = document.getElementById("solo-list");
        if (sl)
            sl.textContent = !connected ? "—" : solos.length ? solos.map((c) => `CH ${pad2(c)}`).join(", ") : "ninguno (MON = MAIN)";
        // Banderas: aviso en su propia fila de la pantalla central (nunca tapa faders ni nombres de canal).
        const f = m?.flags ?? {};
        const banner = $("#flag-banner");
        const msgs = [];
        if (f.silent_test)
            msgs.push("PRUEBA SILENCIOSA — salidas bloqueadas por diseño; ninguna orden las reabre");
        if (f.panic)
            msgs.push("PANIC ACTIVO — todas las salidas en silencio");
        if (f.stop)
            msgs.push("STOP — salidas detenidas");
        if (f.recovery_hold)
            msgs.push("SALIDAS RETENIDAS tras recuperación — confirme «Reanudar»");
        if (f.device_lost)
            msgs.push("DISPOSITIVO PERDIDO — salidas cerradas");
        if (forced.length)
            msgs.push(`SALIDA CERRADA POR SEGURIDAD: ${forced.map((o) => OUTPUT_LABEL[o] ?? o).join(", ")} — vea RUTEO`);
        const bt = msgs.join(" · ");
        if (banner.textContent !== bt)
            banner.textContent = bt;
        banner.title = bt;
        banner.classList.toggle("show", connected && msgs.length > 0);
        banner.dataset.level = f.panic || f.device_lost || forced.length ? "bad" : "warn";
        document.body.classList.toggle("flag-shown", connected && msgs.length > 0);
        // Bandeja de seguridad.
        this.renderSafetyTray();
        $("#btn-resume").hidden = !f.recovery_hold;
        // PANIC y STOP siempre operativos, tambien con un dialogo abierto (lo cancelan: revision 03-11).
        for (const id of ["#btn-panic", "#btn-stop", "#btn-resume"])
            $(id).disabled = !connected;
        const ml = connected && m ? m.output("main_l") : "unknown", mr = connected && m ? m.output("main_r") : "unknown";
        const [ost, oled] = !connected ? ["Sin dato", ""]
            : ml === "open" && mr === "open" ? ["Activas", "g"]
                : ml === "ramping" || mr === "ramping" ? ["En rampa", "a"]
                    : ml === "unknown" || mr === "unknown" ? ["Sin dato", "a"] : ["En silencio", "r"];
        $("#out-state").textContent = ost;
        $("#out-led").className = "led" + (oled ? " " + oled : "");
        // Estado del motor
        const st = this.lastStatus;
        // Carga DSP del motor (media y pico del ultimo segundo; bloques que no cupieron en su periodo).
        const dl = st.dsp_load;
        const dspEl = $("#dsp-load");
        if (connected && dl) {
            const over = dl.overloads > this.lastOverloads;
            this.lastOverloads = dl.overloads;
            // Dos partes que pueden pasar a dos lineas sin recortarse (antes «13 % · pico 124 %» se recortaba con
            // un pico de tres cifras y la auditoria de maquetacion fallaba de forma intermitente).
            const dhtml = `<span class="dsp-avg">${Math.round(dl.avg_pct)} %</span><span class="dsp-sep"> · </span><span class="dsp-pk">pico ${Math.round(dl.peak_pct)} %</span>`;
            if (dspEl.innerHTML !== dhtml)
                dspEl.innerHTML = dhtml;
            dspEl.dataset.level = over || dl.peak_pct >= 100 ? "bad" : dl.peak_pct >= 80 ? "warn" : "ok";
            dspEl.title = `Carga DSP: media ${n1(dl.avg_pct)} %, pico ${n1(dl.peak_pct)} % en el último segundo; ${dl.overloads} bloques por encima de su periodo desde el arranque.`;
            $("#m-overloads").textContent = String(dl.overloads);
            $("#m-overloads").dataset.level = dl.overloads > 0 ? "warn" : "";
        }
        else {
            dspEl.textContent = "—";
            dspEl.dataset.level = "";
            $("#m-overloads").textContent = "—";
        }
        const frames = Number(st.frames ?? 0), blocks = Number(st.blocks ?? 0);
        if (connected && m && blocks > 0 && frames > 0) {
            const blk = Math.round(frames / blocks);
            $("#m-block").textContent = `${blk} · ${n1((blk / m.rate) * 1000)} ms`;
        }
        else
            $("#m-block").textContent = "—";
        if (connected && typeof st.revision === "number" && typeof st.applied_revision === "number") {
            $("#m-changes").textContent = st.revision === st.applied_revision ? "aplicados" : "pendientes";
        }
        else
            $("#m-changes").textContent = "—";
        const sline = document.getElementById("status-line");
        if (connected && m) {
            if (sline)
                sline.textContent = `${n1(m.rate / 1000)} kHz · edición ${m.edition} · revisión ${String(st.revision ?? "—")} · aplicada ${String(st.applied_revision ?? "—")} · violaciones de seguridad ${String(st.safety_violations ?? "—")} · backend ${m.backend || "—"}`;
            // La nota de recuperacion completa va en title, en el aviso y en GENIUS; aqui, un resumen que cabe en
            // dos lineas junto al nombre del show (P2: la franja tiene ademas la escena y deshacer/rehacer).
            const note = m.recoveryNote;
            const shortNote = /reconect/i.test(note) ? "SALIDAS RETENIDAS: el dispositivo se reconectó · confirme «Reanudar»"
                : /cierre|limpi/i.test(note) ? "SALIDAS RETENIDAS: cierre anterior no limpio · confirme «Reanudar»"
                    : note.length > 70 ? [...note].slice(0, 68).join("").trimEnd() + "…" : note;
            $("#show-sub").textContent = f.recovery_hold && note ? shortNote
                : m.benchBackend ? "Motor de banco: sin dispositivo físico y sin audio"
                    : m.backend === "wasapi-sim" ? "Dispositivo SIMULADO: sin audio físico"
                        : m.backend === "uacm" ? "Motor dentro de UACM" : "Motor con dispositivo de audio";
            $("#show-sub").title = f.recovery_hold && note ? note : $("#show-sub").textContent ?? "";
            $("#clock").textContent = formatClock(Number(st.frames ?? 0), m.rate);
        }
        else {
            if (sline)
                sline.textContent = "Sin conexión con el motor: los controles están bloqueados.";
            $("#clock").textContent = "--:--:--";
            document.querySelectorAll("[data-chpeak],[data-gr],[data-peak]").forEach((e) => (e.textContent = "—"));
        }
        // Franja superior: todo procede del motor (hello/status); sin motor no se afirma nada.
        const cell = (id, text, lvl) => {
            const el = $(id);
            const v = $(".v", el);
            if (v.textContent !== text)
                v.textContent = text;
            el.dataset.level = lvl;
        };
        if (connected && m) {
            const sim = m.backend === "wasapi-sim";
            cell("#pill-device", f.device_lost ? (sim ? "Simulado · perdido" : "Perdido")
                : m.benchBackend ? "Banco · sin audio" : sim ? "Simulado · sin audio" : m.backend === "uacm" ? "UACM" : "Activo", f.device_lost ? "bad" : m.benchBackend || sim ? "neutral" : "ok");
            $("#pill-device").title = m.deviceProblem ? `Dispositivo: ${m.deviceProblem}` : "Dispositivo de audio, según el motor";
            cell("#pill-rate", `${(m.rate / 1000).toFixed(1).replace(".", ",")} kHz`, "");
            const saveErr = typeof st.last_save_error === "string" && st.last_save_error !== "";
            cell("#pill-saved", st.safety_persisted === false ? "Seguridad sin guardar" : saveErr ? "Error al guardar" : st.unsaved_changes ? "Cambios sin guardar" : st.unsaved_changes === false ? "Guardado" : "—", st.safety_persisted === false || saveErr ? "bad" : st.unsaved_changes ? "warn" : st.unsaved_changes === false ? "ok" : "");
        }
        else {
            cell("#pill-device", "—", "");
            cell("#pill-rate", "— kHz", "");
            cell("#pill-saved", "—", "");
        }
        // Alarmas (columna derecha y franja superior) y GENIUS.
        const now = performance.now();
        const clipped = [];
        if (connected)
            for (const [k, v] of this.meterLevels)
                if (k.startsWith("ch:") && now - v.clipAt < 2000)
                    clipped.push(Number(k.slice(3)));
        const al = this.alarms(connected, forced, solos, clipped);
        const crit = al.filter((a) => a.lvl === "crit").length;
        const alHtml = al.length
            ? al.slice(0, 4).map((a) => `<div class="al ${a.lvl}"><i class="led ${a.lvl === "crit" ? "r" : "a"}"></i><div><b>${esc(a.title)}</b><small>${esc(a.sub)}</small></div></div>`).join("") +
                (al.length > 4 ? `<div class="al more">y ${al.length - 4} más</div>` : "")
            : `<div class="al ok"><i class="led g"></i><div><b>Sin alarmas</b><small>Motor, dispositivo y show sin incidencias</small></div></div>`;
        const alEl = $("#alarm-list");
        if (alEl.innerHTML !== alHtml)
            alEl.innerHTML = alHtml;
        const cnt = $("#alarm-count");
        cnt.textContent = connected ? String(al.length) : "—";
        cnt.className = "pill " + (crit ? "crit" : al.length ? "warn" : "on");
        const top = al[0];
        cell("#alarm-cell", !connected ? "SIN MOTOR" : !top ? "SIN ALARMAS" : al.length === 1 ? top.short ?? top.title.toUpperCase() : `${top.short ?? top.title.toUpperCase()} · ${al.length}`, !connected || crit ? "crit" : al.length ? "warn" : "ok");
        $("#alarm-cell").title = al.map((a) => `${a.title}: ${a.sub}`).join("\n") || "Sin alarmas";
        // GENIUS: explica en una frase lo mas importante del estado REAL que informa el motor. Nunca
        // propone ni ejecuta cambios.
        const g = $("#genius");
        const muted = [];
        if (connected)
            for (let c = 1; c <= ed; c++)
                if (m?.value(`ch.${c}.mute`) === true)
                    muted.push(c);
        const list = (a) => a.slice(0, 4).map((c) => `CH\u00a0${pad2(c)}`).join(", ") + (a.length > 4 ? "…" : "");
        let text = "", lvl = "";
        const outs = connected ? [...OUTPUTS].filter((o) => m?.output(o) === "unknown") : [];
        const viol = Number(st.safety_violations ?? 0);
        if (!connected)
            [text, lvl] = ["Sin motor: los controles están bloqueados. El audio no depende de esta pantalla.", "bad"];
        else if (f.silent_test)
            [text, lvl] = ["Prueba silenciosa: las salidas están bloqueadas por diseño y ninguna orden puede reabrirlas.", "warn"];
        else if (forced.length)
            [text, lvl] = [`Salida cerrada por el monitor de seguridad: ${forced.map((o) => OUTPUT_LABEL[o] ?? o).join(", ")}. Revise RUTEO antes de liberarla.`, "bad"];
        else if (m?.deviceProblem)
            [text, lvl] = [`Dispositivo: ${m.deviceProblem}.`, "bad"];
        else if (f.panic)
            [text, lvl] = ["PANIC activo: nada sonará hasta que alguien rearme PANIC y lo confirme.", "bad"];
        else if (f.device_lost)
            [text, lvl] = ["El dispositivo de audio se perdió: salidas cerradas hasta que vuelva.", "bad"];
        else if (f.recovery_hold)
            [text, lvl] = ["Salidas retenidas tras una recuperación: compruebe niveles y pulse «Reanudar salidas».", "warn"];
        else if (f.stop)
            [text, lvl] = ["STOP: salidas detenidas. Pulse «Iniciar» para reabrirlas con rampa.", "warn"];
        else if (outs.length)
            [text, lvl] = [`Estado de salida desconocido: ${outs.map((o) => OUTPUT_LABEL[o] ?? o).join(", ")}. Compruebe RUTEO.`, "warn"];
        else if (viol > 0)
            [text, lvl] = [`El monitor de seguridad registró ${viol} violación(es) desde el arranque. Revise RUTEO.`, "warn"];
        else if (clipped.length)
            [text, lvl] = [`Saturación en ${list(clipped)}: baje el trim o la fuente.`, "warn"];
        else if (this.engineVal("osc.on") === true)
            [text, lvl] = [`Oscilador de prueba encendido: ${this.oscText()}. Apáguelo en SISTEMA al terminar.`, "warn"];
        else if (solos.length)
            [text, lvl] = [`SOLO en ${list(solos)}: lo oye solo MON; la sala no cambia.`, "warn"];
        else if (this.sof)
            [text, lvl] = [`Los faders de canal manejan ahora los envíos a AUX ${this.sof}; MAIN no cambia al moverlos.`, "warn"];
        else if (muted.length)
            [text, lvl] = [`Todo en orden. En MUTE: ${list(muted)}.`, "ok"];
        else
            [text, lvl] = ["Todo en orden: el motor está conectado y ninguna salida requiere atención.", "ok"];
        if (g.textContent !== text)
            g.textContent = text;
        g.title = `GENIUS · ${text}`;
        g.dataset.level = lvl;
        const di = document.getElementById("device-info");
        if (di)
            di.textContent = !connected ? "—" : m?.benchBackend ? "Backend de banco: no abre dispositivos ni emite audio. Las salidas sin destino físico quedan en cero exacto." : f.device_lost ? "Dispositivo perdido: salidas cerradas hasta su vuelta y la confirmación del operador." : "Dispositivo de audio activo (configurado en CONFIG.cmd).";
    }
    /** P2: nombres, colores, show, escena actual e historial (siempre lo CONFIRMADO por el motor). */
    renderP2Values(connected) {
        const m = this.model;
        document.querySelectorAll("[data-lbl]").forEach((el) => {
            const [k, n] = el.dataset.lbl.split(":");
            const full = connected ? this.label(k, Number(n)) : defaultLabel(k, Number(n));
            if (!el.classList.contains("fit")) {
                if (el.textContent !== full)
                    el.textContent = full;
                return;
            }
            // Rotulo de una linea en una caja estrecha (tira, celda): letra mas pequena o abreviado, nunca recortado.
            // Solo se mide si cambio el nombre o la maquetacion (medir fuerza un calculo de estilo por rotulo).
            if (el.dataset.full === full && el.dataset.fite === String(this.fitEpoch))
                return;
            el.dataset.fite = String(this.fitEpoch);
            const cs = getComputedStyle(el);
            // Caja que limita el rotulo: la tecla o el visor que lo contiene (un rotulo centrado se encoge a su texto).
            const box = el.closest(".scribble, .mgkey") ?? (cs.display === "inline" ? el.parentElement : el);
            const bcs = getComputedStyle(box);
            let maxW = box.clientWidth - parseFloat(bcs.paddingLeft) - parseFloat(bcs.paddingRight) - 2;
            if (box === el.parentElement)
                for (const sib of Array.from(box.children))
                    if (sib !== el && getComputedStyle(sib).position !== "absolute" && bcs.display.includes("flex") && bcs.flexDirection.startsWith("row"))
                        maxW -= sib.getBoundingClientRect().width;
            if (el.dataset.fitmax)
                maxW = Math.min(maxW > 0 ? maxW : Infinity, Number(el.dataset.fitmax));
            fitLabel(el, full, maxW);
        });
        document.querySelectorAll("[data-lblnum]").forEach((el) => {
            const [k, n] = el.dataset.lblnum.split(":");
            const named = connected && this.label(k, Number(n)) !== defaultLabel(k, Number(n));
            const t = named ? defaultLabel(k, Number(n)) : k.toUpperCase();
            if (el.textContent !== t)
                el.textContent = t;
        });
        document.querySelectorAll("[data-lblc]").forEach((el) => {
            const [k, n] = el.dataset.lblc.split(":");
            const css = connected ? paletteCss(this.engineVal(colorPath(k, Number(n)))) : "";
            if (el.style.background !== css)
                el.style.background = css;
            el.classList.toggle("has-color", !!css);
        });
        // Nombre del show en la franja superior.
        const sn = connected ? this.engineVal("show.name") : undefined;
        const showName = typeof sn === "string" && sn ? sn : connected ? "Show sin nombre" : "Show actual";
        const sne = $("#show-name");
        fitLabel(sne, showName, sne.parentElement.clientWidth - 2);
        // Escena actual.
        if (connected && m && (this.scenes === null || m.scenesVersion !== this.scenesSeen))
            void this.refreshScenes();
        const cur = connected ? m?.currentScene ?? null : null;
        const curInfo = cur ? this.sceneInfo(cur) : undefined;
        const sc = $("#cell-scene");
        const scv = $(".v", sc);
        const st = !connected ? "—" : cur === null ? "ninguna" : `${pad2(cur)}${curInfo?.name ? " · " + curInfo.name : ""}${m?.currentSceneModified ? " *" : ""}`;
        if (scv.textContent !== st)
            scv.textContent = st;
        sc.dataset.level = !connected ? "" : cur === null ? "neutral" : m?.currentSceneModified ? "warn" : "ok";
        sc.title = !connected ? "Escena actual" : cur === null ? "Ninguna escena recuperada ni guardada en esta sesión del motor"
            : `Escena actual ${cur}${curInfo?.name ? " «" + curInfo.name + "»" : ""}${m?.currentSceneModified ? ": modificada desde que se recuperó o guardó" : ""}`;
        // Deshacer / rehacer: estado del historial del motor (compartido por todas las consolas).
        const h = m?.history;
        const panic = !!m?.flags.panic;
        for (const [id, depth, lbl, verb] of [["#btn-undo", h?.undoDepth ?? 0, h?.undoLabel ?? "", "Deshacer"], ["#btn-redo", h?.redoDepth ?? 0, h?.redoLabel ?? "", "Rehacer"]]) {
            const b = $(id);
            b.disabled = !connected || depth === 0 || panic || this.historyBusy || document.body.classList.contains("modal-open");
            b.title = !connected ? `${verb}: sin motor` : panic ? `${verb}: no disponible con PANIC activo` : depth ? `${verb}: ${lbl} (${depth} paso${depth === 1 ? "" : "s"}) · Ctrl+${verb === "Deshacer" ? "Z" : "Mayús+Z"}` : `${verb}: nada`;
            b.setAttribute("aria-label", b.title);
        }
        if (this.view === "escenas" && this.stab === "lista")
            this.renderSceneParts();
    }
    /** Valores derivados de las pantallas P3 (siempre del estado CONFIRMADO por el motor). */
    renderP3Values(connected) {
        const m = this.model;
        const ed = m?.edition ?? 0;
        const setText = (el, t) => { if (el.textContent !== t)
            el.textContent = t; };
        // Miembros de cada DCA / grupo de mute.
        document.querySelectorAll("[data-members]").forEach((el) => {
            const [k, n] = el.dataset.members.split(":");
            if (!connected)
                return setText(el, "—");
            let cnt = 0;
            for (let c = 1; c <= ed; c++)
                if (this.engineVal(k === "dca" ? `ch.${c}.dca.${n}` : k === "grp" ? `ch.${c}.grp.${n}` : `ch.${c}.mutegroup.${n}`) === true)
                    cnt++;
            setText(el, el.dataset.short ? (cnt ? `${cnt} ${cnt === 1 ? "miembro" : "miembros"}` : "sin miembros") : cnt ? `${cnt} ${cnt === 1 ? "miembro" : "miembros"}` : "ninguno");
            el.classList.toggle("zero", cnt === 0);
        });
        // Rack FX: nombre, familia y estado de cada unidad segun el motor.
        for (let f = 1; f <= FX_COUNT; f++) {
            const type = connected ? fxTypeName(this.engineVal(`fx.${f}.type`)) : "";
            const fam = FX_FAMILY[type] ?? "off";
            document.querySelectorAll(`[data-fxname="${f}"]`).forEach((el) => setText(el, type ? enumLabel(type) : "—"));
            document.querySelectorAll(`[data-fxsub="${f}"]`).forEach((el) => setText(el, type ? FX_FAMILY_LABEL[fam].split(" · ")[0] : "sin dato"));
            document.querySelectorAll(`[data-fxunit="${f}"]`).forEach((el) => (el.dataset.fam = fam));
            const lvl = this.engineVal(`fx.${f}.level_db`), mute = this.engineVal(`fx.${f}.mute`), asg = this.engineVal(`fx.${f}.main_assign`);
            const lcd = !type ? "—" : type === "off" ? "OFF" : mute === true ? "MUTE" : asg === false ? "SIN MAIN" : typeof lvl === "number" && lvl <= OFF_DB ? "RET −∞" : "ACTIVO";
            document.querySelectorAll(`[data-fxlcd="${f}"]`).forEach((el) => { setText(el, lcd); el.dataset.state = lcd === "ACTIVO" ? "on" : lcd === "MUTE" ? "mute" : ""; });
            document.querySelectorAll(`[data-fxstate="${f}"]`).forEach((el) => setText(el, !type ? "—" : type === "off" ? `FX ${f} apagado` : `FX ${f}: ${enumLabel(type)}${mute === true ? " · MUTE" : ""}`));
            // Canales que envian a esta unidad.
            document.querySelectorAll(`[data-fxsends="${f}"]`).forEach((el) => {
                if (!connected)
                    return setText(el, "—");
                const list = [];
                for (let c = 1; c <= ed; c++) {
                    const v = this.engineVal(`ch.${c}.fx.${f}.level_db`);
                    if (typeof v === "number" && v > OFF_DB)
                        list.push(`CH ${pad2(c)} ${formatDb(v)}${this.engineVal(`ch.${c}.fx.${f}.pre_fader`) === true ? " PRE" : ""}`);
                }
                setText(el, list.length ? list.slice(0, 8).join(" · ") + (list.length > 8 ? ` · y ${list.length - 8} más` : "") : "Ningún canal envía a esta unidad.");
            });
            // Tiempo del delay en tempo (negra) y estado del TAP.
            document.querySelectorAll(`[data-tapinfo="${f}"]`).forEach((el) => {
                const t = this.engineVal(`fx.${f}.time_ms`);
                const taps = this.taps.get(f) ?? [];
                const live = taps.length > 0 && performance.now() - taps[taps.length - 1] < 2000;
                setText(el, typeof t !== "number" ? "—" : `${n1(60000 / t)} BPM${live ? ` · ${taps.length} golpe${taps.length > 1 ? "s" : ""}` : ""}`);
            });
        }
        // El panel frontal depende del tipo que el MOTOR confirma: se redibuja cuando cambia.
        if (this.view === "fx" && connected && this.fxPanelType !== `${this.fxUnit}:${fxTypeName(this.engineVal(`fx.${this.fxUnit}.type`))}`)
            this.renderMonitor();
        document.querySelectorAll(".fp[data-fam]").forEach((el) => {
            const type = connected ? fxTypeName(this.engineVal(`fx.${this.fxUnit}.type`)) : "";
            el.dataset.fam = FX_FAMILY[type] ?? "off";
        });
        // Patch de entrada: canal que no lee su entrada del mismo numero, o sin entrada.
        document.querySelectorAll("[data-ipc]").forEach((el) => {
            const c = Number(el.dataset.ipc);
            const v = this.engineVal(`ch.${c}.input`);
            el.classList.toggle("moved", typeof v === "number" && v !== c && v !== 0);
            el.classList.toggle("none", v === 0);
        });
        // Patch de salida: estado efectivo del bus elegido y buses sin destino.
        const used = new Set();
        const srcVals = descOf("out.1.source")?.values ?? [];
        let known = connected;
        for (let o = 1; o <= OUTPUT_SLOTS; o++) {
            const v = this.engineVal(`out.${o}.source`);
            if (typeof v !== "number")
                known = false;
            else if (v > 0)
                used.add(srcVals[v] ?? "");
        }
        document.querySelectorAll("[data-effsrc]").forEach((el) => {
            const v = this.engineVal(`out.${el.dataset.effsrc}.source`);
            const src = typeof v === "number" ? srcVals[v] ?? "" : "";
            const st = !connected || !src ? "" : src === "none" ? "silent" : m?.output(src) ?? "unknown";
            el.dataset.state = st || "unknown";
            setText(el, !connected || typeof v !== "number" ? "—" : src === "none" ? "sin fuente · cero" : `${enumLabel(src)} · ${STATE_LABEL[st] ?? st}`);
        });
        document.querySelectorAll("[data-nodest]").forEach((el) => {
            const none = OUTPUTS.filter((o) => !used.has(o));
            const html = !known ? "—" : none.length ? none.map((o) => `<span class="ndb">${OUTPUT_LABEL[o]}</span>`).join("") + `<small>sin destino · cero exacto</small>` : `<small class="okd">Todos los buses tienen destino.</small>`;
            if (el.innerHTML !== html)
                el.innerHTML = html;
        });
        // Oscilador.
        document.querySelectorAll("[data-oscstate]").forEach((el) => {
            const on = this.engineVal("osc.on");
            setText(el, !connected || on === undefined ? "—" : on ? "EMITIENDO" : "APAGADO");
            el.dataset.on = String(on === true);
            el.closest(".m-osc")?.classList.toggle("live", on === true);
        });
    }
    // ---------------------------------------------------------------- medidores (60 Hz)
    tick(t) {
        const dt = Math.min(0.1, (t - this.lastFrameTime) / 1000);
        this.lastFrameTime = t;
        const m = this.model;
        const mv = m?.connected ? m.meters : null;
        const stale = !mv || Date.now() - mv.receivedAt > 1000;
        document.body.classList.toggle("meters-stale", !!m?.connected && stale);
        document.querySelectorAll("[data-meter]").forEach((el) => {
            const key = el.dataset.meter;
            let db = -Infinity;
            if (mv && !stale) {
                if (key.startsWith("out:"))
                    db = mv.peakDbfs[key.slice(4)] ?? -Infinity;
                else if (key.startsWith("ch:"))
                    db = mv.channelPeakDbfs[Number(key.slice(3)) - 1] ?? -Infinity;
                else if (key.startsWith("fx:"))
                    db = mv.fxPeakDbfs[Number(key.slice(3)) - 1] ?? -Infinity;
            }
            const target = meterFrac(db);
            const s = this.meterLevels.get(key) ?? { v: 0, hold: 0, holdAt: 0, clipAt: -Infinity };
            // Subida inmediata, caida 20 dB/s; pico retenido 1,5 s. (Una misma clave puede tener varios
            // medidores en pantalla: se actualiza una vez por cuadro.)
            if (s.at !== t) {
                s.at = t;
                s.v = target >= s.v ? target : Math.max(target, s.v - (20 / 66) * dt);
                if (s.v >= s.hold || t - s.holdAt > 1500) {
                    s.hold = s.v;
                    s.holdAt = t;
                }
                // Saturacion retenida 2 s: un pico de un solo bloque no pasa desapercibido. Sin medidores
                // recientes se apaga (no se muestra un dato viejo como actual).
                if (db > -0.1)
                    s.clipAt = t;
                if (!mv || stale)
                    s.clipAt = -Infinity;
            }
            this.meterLevels.set(key, s);
            el.style.setProperty("--lvl", s.v.toFixed(4));
            el.style.setProperty("--hold", s.hold.toFixed(4));
            el.classList.toggle("clip", t - s.clipAt < 2000);
        });
        if (!mv || stale) {
            // Sin medidores recientes (motor desconectado o medidores congelados) no se muestra ninguna
            // reduccion como si fuera actual (auditoria DG-010).
            document.querySelectorAll("[data-grmeter]").forEach((el) => {
                el.style.setProperty("--gr", "0");
                if (el.getAttribute("role") === "meter")
                    el.setAttribute("aria-valuetext", "sin dato");
            });
            document.querySelectorAll("[data-grval]").forEach((el) => (el.textContent = "—"));
            document.querySelectorAll("[data-grbadge]").forEach((el) => el.classList.remove("acting"));
            document.querySelectorAll("[data-lim]").forEach((el) => {
                el.classList.remove("active");
                el.textContent = "LIM";
            });
        }
        if (mv && !stale) {
            document.querySelectorAll("[data-lim]").forEach((el) => {
                const gr = mv.limiterGrDb[el.dataset.lim] ?? 0;
                el.classList.toggle("active", gr < -0.05);
                el.textContent = gr < -0.05 ? `LIM ${n1(gr)} dB` : "LIM";
            });
            document.querySelectorAll("[data-gr]").forEach((el) => {
                const gr = mv.limiterGrDb[el.dataset.gr] ?? 0;
                el.textContent = gr < -0.05 ? `${n1(gr)} dB` : "0,0 dB";
            });
            document.querySelectorAll("[data-peak]").forEach((el) => {
                const p = mv.peakDbfs[el.dataset.peak] ?? -999;
                el.textContent = p <= -998 ? "−∞" : `${n1(p)} dBFS`;
            });
            const grOf = (key) => {
                const [kind, ch] = key.split(":");
                const arr = kind === "gate" ? mv.channelGateDb : mv.channelCompGrDb;
                return arr[Number(ch) - 1] ?? 0;
            };
            document.querySelectorAll("[data-grmeter]").forEach((el) => {
                const g = grOf(el.dataset.grmeter);
                el.style.setProperty("--gr", Math.min(1, -g / 40).toFixed(3));
                if (el.getAttribute("role") === "meter") {
                    el.setAttribute("aria-valuenow", g.toFixed(1));
                    el.setAttribute("aria-valuetext", `${n1(g)} dB`);
                }
            });
            document.querySelectorAll("[data-grval]").forEach((el) => {
                const g = grOf(el.dataset.grval);
                el.textContent = (g < -0.05 ? g.toFixed(1).replace(".", ",").replace("-", "−") : "0,0") + (el.dataset.bare ? "" : " dB");
            });
            document.querySelectorAll("[data-grbadge]").forEach((el) => {
                el.classList.toggle("acting", grOf(el.dataset.grbadge) < -1);
            });
            document.querySelectorAll("[data-chpeak]").forEach((el) => {
                const p = mv.channelPeakDbfs[Number(el.dataset.chpeak) - 1] ?? -999;
                el.textContent = p <= -998 ? "−∞" : `${n1(p)}${el.dataset.bare ? "" : " dBFS"}`;
            });
        }
        requestAnimationFrame((tt) => this.tick(tt));
    }
    // ---------------------------------------------------------------- entrada
    usable(el) {
        return !!el && !!this.model?.connected && el.getAttribute("aria-disabled") !== "true";
    }
    /** Arrastre del mando de nivel del oscilador en curso: nivel pedido por encima del techo (o NaN). */
    oscDragWanted = NaN;
    send(path, value) {
        const m = this.model;
        if (!m?.connected || !m.has(path))
            return;
        // Revision 03-11: con el oscilador EMITIENDO, subir su nivel por encima de −20 dBFS (o de su nivel actual
        // si ya era mayor) pide confirmacion. Un arrastre se detiene en el techo y pide confirmacion al soltar.
        if (path === "osc.level_db" && typeof value === "number" && this.engineVal("osc.on") === true && value > this.oscCeiling() + 1e-9) {
            if (this.oscDragging) {
                this.oscDragWanted = value;
                value = this.oscCeiling();
            }
            else {
                void this.onOscLevelUp(value);
                return;
            }
        }
        void m.set(path, value).catch(() => undefined);
    }
    oscDragging = false;
    numValue(path) {
        const v = this.ctl(path).v;
        return typeof v === "number" ? v : OFF_DB;
    }
    rangeOf(path) {
        if (path.endsWith("limiter_db"))
            return [-30, 0];
        if (path.endsWith(".pan"))
            return [-1, 1];
        return [OFF_DB, 10];
    }
    markSelected() {
        document.querySelectorAll(".strip[data-ch]").forEach((s) => s.classList.toggle("selected", s.dataset.ch === String(this.selected)));
    }
    onClick(e) {
        const t = e.target;
        const sel = t.closest("[data-select]");
        if (sel) {
            this.selected = Number(sel.dataset.select);
            this.markSelected();
            this.view = "consola";
            this.renderNav();
            this.renderMonitor();
            return;
        }
        const fx = t.closest("[data-fxtab]");
        if (fx) {
            // Indicador de procesado de una tira: selecciona el canal y abre su pestana.
            this.selected = Number(fx.dataset.fxch);
            this.markSelected();
            this.openTab(fx.dataset.fxtab);
            return;
        }
        const go = t.closest("[data-tab-go]");
        if (go) {
            this.openTab(go.dataset.tabGo);
            return;
        }
        const mc = t.closest("[data-mcell]");
        if (mc) {
            // Celda de la matriz: abre los envios de ese canal (navegacion; no envia nada).
            this.selected = Number(mc.dataset.mcell);
            this.markSelected();
            this.openTab("env");
            return;
        }
        const sofB = t.closest("[data-sof]");
        if (sofB) {
            // Envios en faders: solo cambia que parametro maneja cada fader de canal (presentacion).
            const k = Number(sofB.dataset.sof);
            this.sof = this.sof === k ? 0 : k;
            if (this.page.kind === "aux")
                this.page = { kind: "ch", start: 1 };
            this.renderStrips();
            this.renderBanks();
            this.renderMonitor();
            return;
        }
        const fu = t.closest("[data-fxunit]");
        if (fu) {
            // Elegir unidad del rack: navegacion, no envia nada.
            this.fxUnit = Number(fu.dataset.fxunit);
            this.renderMonitor();
            $(`[data-fxunit="${this.fxUnit}"]`).focus();
            return;
        }
        const gv = t.closest("[data-goview]");
        if (gv) {
            this.view = gv.dataset.goview;
            this.renderNav();
            this.renderMonitor();
            return;
        }
        const de = t.closest("[data-dcaedit],[data-mgedit]");
        if (de) {
            this.openDcaTab(de.dataset.dcaedit ? "dca" : "mg");
            return;
        }
        const bg = t.closest("[data-bank-go]");
        if (bg) {
            this.page = { kind: "dca" };
            this.sof = 0;
            this.renderStrips();
            this.renderBanks();
            return;
        }
        const gp = t.closest("[data-gpage]");
        if (gp) {
            this.gpage = Number(gp.dataset.gpage);
            this.renderMonitor();
            return;
        }
        const tap = t.closest("[data-tap]");
        if (tap && this.usable(tap.closest(".fp")?.querySelector("[data-kind='num']") ?? null)) {
            this.onTap(Number(tap.dataset.tap));
            return;
        }
        const ek = t.closest("[data-kind='enumv']");
        if (ek) {
            if (!this.usable(ek))
                return;
            const path = ek.dataset.path, v = Number(ek.dataset.v);
            // Revision 03-11: con el oscilador EMITIENDO, cambiar destino o senal pide confirmacion.
            if ((path === "osc.dest" || path === "osc.type") && this.engineVal("osc.on") === true && this.engineVal(path) !== v)
                void this.onOscChange(path, v);
            else
                this.send(path, v);
            return;
        }
        const step = t.closest("[data-step]");
        if (step && this.model?.connected) {
            const path = step.dataset.step;
            const [mn, mx] = this.rangeOf(path);
            this.send(path, stepDb(this.numValue(path), Number(step.dataset.delta), mn, mx));
            return;
        }
        const ps = t.closest("[data-panset]");
        if (ps && this.model?.connected) {
            this.send(ps.dataset.panset, Number(ps.dataset.v));
            return;
        }
        const act = t.closest("[data-action]");
        if (act && this.model?.connected) {
            const a = act.dataset.action;
            if (act.disabled)
                return;
            if (a.startsWith("scene-") || a.startsWith("scope-") || a === "diff-page")
                return void this.onSceneAction(a, act.dataset.v);
            if (a === "names-kind") {
                this.nameKind = act.dataset.v;
                this.renderMonitor();
                return;
            }
            if (a === "safes-all" || a === "safes-none") {
                // Revision 03-11: TODOS los canales del show (antes solo la pagina de 16 visible).
                const ch = [];
                for (let c = 1; c <= this.model.edition; c++)
                    if (this.engineVal(`ch.${c}.recall_safe`) !== (a === "safes-all"))
                        ch.push([`ch.${c}.recall_safe`, a === "safes-all"]);
                if (ch.length)
                    void this.model.setMany(ch).catch(() => undefined);
                return;
            }
            if (act.dataset.action === "clear-solo")
                void this.clearSolos();
            else if (act.dataset.action === "release")
                void this.onRelease(act.dataset.output);
            else if (act.dataset.action === "ipatch-identity")
                void this.onInputIdentity();
            return;
        }
        const el = t.closest("[data-kind='bool']");
        if (this.usable(el)) {
            const v = this.ctl(el.dataset.path).v;
            // Encender el oscilador (emite señal a un bus) pide confirmacion; apagarlo es inmediato.
            if (el.dataset.path === "osc.on" && v !== true)
                void this.onOscOn();
            else
                this.send(el.dataset.path, !(v === true));
        }
    }
    onChange(e) {
        const inp = e.target.closest("input[data-kind='text']");
        if (inp) {
            if (this.usable(inp))
                this.commitText(inp);
            return;
        }
        const el = e.target.closest("select[data-kind='sel']");
        if (!el)
            return;
        // Eleccion explicita (raton en la lista o seleccion programatica): se aplica.
        void this.commitSelect(el);
    }
    /** Aplica la eleccion de un selector (patch, color). Patch de salida: con confirmacion. Luego suelta el foco. */
    async commitSelect(el) {
        const path = el.dataset.path;
        const value = Number(el.value);
        delete el.dataset.draft;
        delete el.dataset.base;
        const ev = this.engineVal(path);
        const back = () => {
            if (typeof ev === "number")
                el.value = String(this.engineVal(path) ?? ev);
            this.queueRender();
        };
        if (!this.usable(el) || value === ev) {
            back();
            el.blur();
            return;
        }
        if (/^out\.\d+\.source$/.test(path)) {
            // Patch de salida: cambia lo que suena por una salida fisica. Se confirma con el antes y el despues.
            const o = path.split(".")[1];
            const name = (v) => (typeof v === "number" ? el.options[v]?.text ?? String(v) : "—");
            const gen = this.safetyGen;
            el.blur();
            if (!(await this.confirmBox(`Patch de salida · ranura ${o}`, `La ranura ${o} pasará de «${name(ev)}» a «${name(value)}». Lo que sale por esa salida física cambia ya (fundido de 5 ms).`, "Cambiar", { gen }))) {
                back();
                return;
            }
            if (this.engineVal(path) !== ev) {
                this.alertOps(`PATCH NO CAMBIADO: otra consola cambió la ranura ${o} mientras confirmaba. Revise y vuelva a elegir.`);
                back();
                return;
            }
        }
        this.send(path, value);
        el.blur();
    }
    /** Teclado en un selector: las flechas solo preparan un borrador (nada se envia); Intro aplica, Esc descarta. */
    onSelectKey(sel, e) {
        const nav = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
        if (nav.includes(e.key) && !e.altKey) {
            e.preventDefault();
            if (!this.usable(sel))
                return;
            if (sel.dataset.draft === undefined)
                sel.dataset.base = String(this.engineVal(sel.dataset.path) ?? sel.value);
            const n = sel.options.length;
            let i = sel.selectedIndex < 0 ? 0 : sel.selectedIndex;
            if (e.key === "Home")
                i = 0;
            else if (e.key === "End")
                i = n - 1;
            else
                i += (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "PageUp" ? -1 : 1) * (e.key.startsWith("Page") ? 4 : 1);
            i = Math.max(0, Math.min(n - 1, i));
            sel.selectedIndex = i;
            sel.dataset.draft = sel.value;
            this.queueRender();
        }
        else if (e.key === "Enter") {
            e.preventDefault();
            if (sel.dataset.draft !== undefined)
                void this.commitSelect(sel);
        }
        else if (e.key === "Escape") {
            if (sel.dataset.draft !== undefined) {
                e.preventDefault();
                e.stopPropagation();
                this.discardSelect(sel);
            }
        }
        else if (e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey) {
            e.preventDefault(); // sin busqueda por letra: cambiaria el valor sin eleccion explicita
        }
    }
    discardSelect(sel) {
        delete sel.dataset.draft;
        delete sel.dataset.base;
        const ev = this.engineVal(sel.dataset.path);
        if (typeof ev === "number")
            sel.value = String(ev);
        this.queueRender();
    }
    /** TAP: el tiempo es la media de los ultimos intervalos (hasta 4); una pausa de 2 s empieza de nuevo. */
    onTap(f) {
        const now = performance.now();
        let taps = this.taps.get(f) ?? [];
        if (taps.length && now - taps[taps.length - 1] > 2000)
            taps = [];
        taps.push(now);
        if (taps.length > 5)
            taps = taps.slice(-5);
        this.taps.set(f, taps);
        if (taps.length >= 2) {
            const iv = [];
            for (let i = 1; i < taps.length; i++)
                iv.push(taps[i] - taps[i - 1]);
            const ms = iv.reduce((a, b) => a + b, 0) / iv.length;
            const d = descOf(`fx.${f}.time_ms`);
            if (d)
                this.send(`fx.${f}.time_ms`, clampRound(d, ms));
        }
        this.queueRender();
    }
    async onOscOn() {
        if (!this.model?.connected)
            return;
        const lvl = this.engineVal("osc.level_db");
        const loud = typeof lvl === "number" && lvl > OSC_SAFE_DB;
        if (!(await this.confirmBox("Encender el oscilador de prueba", `Se emitirá ${this.oscText() || "la señal de prueba"} (antes de su nivel, mute, limitador y permiso).${loud ? ` ATENCIÓN: nivel por encima de ${n1(OSC_SAFE_DB)} dBFS.` : ""} Compruebe el nivel y el destino antes de confirmar.`, "Encender", { gen: this.safetyGen })))
            return;
        this.send("osc.on", true);
    }
    /** Destino o senal del oscilador encendido: confirmacion que dice exactamente que pasara. */
    async onOscChange(path, v) {
        const d = descOf(path);
        const to = enumLabel(d?.values[v] ?? String(v));
        const main = path === "osc.dest" && (d?.values[v] ?? "") === "main";
        const title = path === "osc.dest" ? `Llevar el oscilador encendido a ${to}` : `Cambiar la señal del oscilador encendido a ${to}`;
        const text = path === "osc.dest"
            ? `El oscilador está EMITIENDO (${this.oscText()}). Pasará a sonar en ${to}${main ? ": la SALA (PA) lo oirá" : ""} al instante, con la rampa del motor.`
            : `El oscilador está EMITIENDO (${this.oscText()}). Cambiará a ${to} al instante, con la rampa del motor.`;
        if (!(await this.confirmBox(title, text, "Cambiar", { gen: this.safetyGen })))
            return;
        this.send(path, v);
    }
    /** Nivel del oscilador encendido por encima del techo: confirmacion explicita. */
    async onOscLevelUp(v) {
        if (!(await this.confirmBox("Subir el oscilador encendido", `El oscilador está EMITIENDO (${this.oscText()}). Su nivel pasará a ${n1(v)} dBFS, por encima de ${n1(this.oscCeiling())} dBFS.`, "Subir", { gen: this.safetyGen })))
            return;
        this.model?.set("osc.level_db", v).catch(() => undefined);
    }
    /** Techo sin confirmacion del nivel del oscilador encendido: −20 dBFS, o el nivel actual si ya es mayor. */
    oscCeiling() {
        const cur = this.engineVal("osc.level_db");
        return Math.max(OSC_SAFE_DB, typeof cur === "number" ? cur : OSC_SAFE_DB);
    }
    async onInputIdentity() {
        const m = this.model;
        if (!m?.connected)
            return;
        if (!(await this.confirmBox("Patch de entrada 1:1", `Cada canal (1–${m.edition}) leerá la entrada de su mismo número. Los canales que hoy leen otra entrada cambiarán de fuente (con fundido de 5 ms).`, "Aplicar 1:1", { gen: this.safetyGen })))
            return;
        // Un solo lote atomico (todos o ninguno).
        const changes = [];
        for (let c = 1; c <= m.edition; c++)
            if (this.engineVal(`ch.${c}.input`) !== c)
                changes.push([`ch.${c}.input`, c]);
        if (changes.length)
            void m.setMany(changes).catch(() => undefined);
    }
    onDblClick(e) {
        const el = e.target.closest("[data-kind='fader'],[data-kind='hfader'],[data-kind='pan'],[data-kind='num']");
        if (!this.usable(el))
            return;
        // Doble clic: pan al centro; mandos de la tira: valor por defecto del esquema. Faders y envios a
        // 0 dB SOLO con Alt + doble clic (un doble clic accidental no puede subir un canal de -inf a 0 dB).
        if (el.dataset.kind === "num") {
            const d = descOf(el.dataset.path);
            if (d)
                this.send(el.dataset.path, d.def);
            return;
        }
        if ((el.dataset.kind === "fader" || el.dataset.kind === "hfader") && !e.altKey)
            return;
        this.send(el.dataset.path, 0);
    }
    onPointerDown(e) {
        const el = e.target.closest("[data-kind='fader'],[data-kind='hfader'],[data-kind='pan'],[data-kind='num']");
        if (!this.usable(el))
            return;
        const kind = el.dataset.kind;
        const path = el.dataset.path;
        // Solo la TAPA arrastra (un toque en la ranura no salta: evita cambios bruscos accidentales).
        if (kind !== "pan" && kind !== "num" && !e.target.closest(".cap"))
            return;
        if (kind === "num") {
            const d = descOf(path);
            if (!d)
                return;
            e.preventDefault();
            el.setPointerCapture(e.pointerId);
            el.classList.add("dragging");
            this.model?.beginGesture(); // P2: todo el arrastre es UN paso de deshacer
            this.oscDragging = path === "osc.level_db";
            this.oscDragWanted = NaN;
            const y0 = e.clientY;
            const n0 = toNorm(d, typeof this.ctl(path).v === "number" ? this.ctl(path).v : d.def);
            let lastV = NaN;
            const mv = (ev) => {
                const fine = this.fine || ev.shiftKey ? 0.2 : 1;
                const v = fromNorm(d, n0 + ((y0 - ev.clientY) / 200) * fine);
                if (v !== lastV) {
                    lastV = v;
                    this.send(path, v);
                }
            };
            const done = () => {
                el.classList.remove("dragging");
                this.model?.endGesture();
                if (this.oscDragging) {
                    this.oscDragging = false;
                    const want = this.oscDragWanted;
                    this.oscDragWanted = NaN;
                    if (!Number.isNaN(want) && this.engineVal("osc.on") === true)
                        void this.onOscLevelUp(want);
                }
                el.removeEventListener("pointermove", mv);
                el.removeEventListener("pointerup", done);
                el.removeEventListener("pointercancel", done);
            };
            el.addEventListener("pointermove", mv);
            el.addEventListener("pointerup", done);
            el.addEventListener("pointercancel", done);
            return;
        }
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        el.classList.add("dragging");
        this.model?.beginGesture(); // P2: todo el arrastre es UN paso de deshacer
        const rect = el.getBoundingClientRect();
        // Ejes: fader vertical; envio y pan horizontal (barra de pan de la pantalla) en X.
        const horiz = kind === "hfader" || el.dataset.axis === "x";
        const travel = kind === "hfader" ? rect.width : kind === "pan" ? (horiz ? Math.max(120, rect.width) : 200) : rect.height;
        const startCoord = horiz ? e.clientX : e.clientY;
        const startVal = kind === "pan" ? this.ctl(path).v ?? 0 : dbToPos(this.numValue(path));
        let last = NaN;
        const move = (ev) => {
            const fine = this.fine || ev.shiftKey ? 0.2 : 1;
            const coord = horiz ? ev.clientX : ev.clientY;
            const d = ((horiz ? coord - startCoord : startCoord - coord) / travel) * fine;
            let v;
            if (kind === "pan")
                v = Math.round(Math.max(-1, Math.min(1, startVal + d * 2)) * 100) / 100;
            else
                v = posToDb(Math.max(0, Math.min(1, startVal + d)));
            if (v !== last) {
                last = v;
                this.send(path, v);
            }
        };
        const up = () => {
            el.classList.remove("dragging");
            this.model?.endGesture();
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
    }
    onWheel(e) {
        const el = e.target.closest("[data-kind='fader'],[data-kind='hfader'],[data-kind='pan'],[data-kind='num']");
        if (!this.usable(el))
            return;
        e.preventDefault();
        const path = el.dataset.path;
        const dir = e.deltaY < 0 ? 1 : -1;
        if (el.dataset.kind === "num") {
            const d = descOf(path);
            const v = this.ctl(path).v;
            if (d && typeof v === "number")
                this.send(path, stepValue(d, v, dir, e.shiftKey || this.fine));
            return;
        }
        if (el.dataset.kind === "pan") {
            const p = this.ctl(path).v ?? 0;
            this.send(path, Math.round(Math.max(-1, Math.min(1, p + dir * (e.shiftKey ? 0.01 : 0.05))) * 100) / 100);
        }
        else {
            this.send(path, stepDb(this.numValue(path), dir * (e.shiftKey || this.fine ? 0.1 : 0.5)));
        }
    }
    onKey(e) {
        const selk = e.target.closest("select[data-kind='sel']");
        if (selk)
            return this.onSelectKey(selk, e);
        const inp = e.target.closest("input.nin");
        if (inp) {
            // Intro aplica (al salir del campo se envia); Esc devuelve el valor del motor sin enviar nada.
            if (e.key === "Enter") {
                e.preventDefault();
                inp.blur();
            }
            else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                const v = inp.dataset.path ? this.engineVal(inp.dataset.path) : undefined;
                inp.value = typeof v === "string" ? v : inp.id === "scene-name" ? this.sceneInfo(this.sceneSel)?.name ?? "" : "";
                inp.blur();
            }
            return;
        }
        const el = e.target.closest("[data-kind='fader'],[data-kind='hfader'],[data-kind='pan'],[data-kind='num']");
        if (!this.usable(el))
            return;
        const path = el.dataset.path;
        const big = e.key === "PageUp" || e.key === "PageDown";
        const up = e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "PageUp";
        const down = e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "PageDown";
        if (el.dataset.kind === "num") {
            const d = descOf(path);
            const v = this.ctl(path).v;
            if (!d || typeof v !== "number")
                return;
            if (up || down) {
                const dir = up ? 1 : -1;
                this.send(path, big ? fromNorm(d, toNorm(d, v) + dir * 0.1) : stepValue(d, v, dir, e.shiftKey || this.fine));
            }
            else if (e.key === "Home")
                this.send(path, d.def);
            else
                return;
            e.preventDefault();
            return;
        }
        if (el.dataset.kind === "pan") {
            const p = this.ctl(path).v ?? 0;
            if (up || down)
                this.send(path, Math.round(Math.max(-1, Math.min(1, p + (up ? 1 : -1) * (big ? 0.25 : 0.05))) * 100) / 100);
            else if (e.key === "Home")
                this.send(path, 0);
            else
                return;
        }
        else {
            if (up || down)
                this.send(path, stepDb(this.numValue(path), (up ? 1 : -1) * (big ? 5 : e.shiftKey || this.fine ? 0.1 : 0.5)));
            else if (e.key === "Home" && e.altKey)
                this.send(path, 0); // Alt+Inicio: 0 dB (nunca por accidente)
            else if (e.key === "End")
                this.send(path, OFF_DB);
            else
                return;
        }
        e.preventDefault();
    }
    onGlobalKey(e) {
        // PANIC por teclado (F9 o Pausa), con el foco donde este, tambien con un dialogo abierto. Solo ACTIVA.
        if ((e.key === "F9" || e.key === "Pause") && this.model?.connected && !this.model.flags.panic) {
            e.preventDefault();
            void this.onPanic();
            return;
        }
        if (e.key === "Escape" && this.dlg) {
            this.cancelDialog();
            return;
        }
        if (e.target.closest("input,textarea,select") || document.body.classList.contains("modal-open"))
            return;
        // Deshacer / rehacer (Ctrl+Z, Ctrl+Mayus+Z o Ctrl+Y): el motor decide (nunca con PANIC activo).
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
            e.preventDefault();
            void this.onUndo(e.key.toLowerCase() === "z" && !e.shiftKey);
            return;
        }
        if (e.key === "[" || e.key === "]") {
            const ed = this.model?.edition ?? 16;
            if (this.page.kind !== "ch")
                this.page = { kind: "ch", start: 1 };
            else {
                const n = this.page.start + (e.key === "]" ? this.perBank : -this.perBank);
                this.page = { kind: "ch", start: Math.max(1, Math.min(n, ed - ((ed - 1) % this.perBank))) };
            }
            this.renderStrips();
            this.renderBanks();
        }
    }
    // ---------------------------------------------------------------- seguridad
    /** Bandeja de SEGURIDAD: PANIC (activo, enviado, fallido) y STOP. */
    renderSafetyTray() {
        const f = this.model?.connected ? this.model.flags : {};
        // Un PANIC confirmado por el motor borra el fallo anterior.
        if (f.panic && this.panicFail)
            this.panicFail = null;
        const pend = this.panicPending === "engage" && !f.panic;
        const fail = !f.panic && this.panicFail !== null;
        const sk = `${!!f.panic}|${!!f.stop}|${pend}|${fail}`;
        const pb = $("#btn-panic");
        if (sk !== this.safetyKey) {
            this.safetyKey = sk;
            pb.innerHTML = f.panic ? "<b>PANIC</b><span>ACTIVO<br>Pulsar para rearmar</span>"
                : pend ? "<b>PANIC</b><span>ENVIADO…<br>esperando al motor</span>"
                    : fail ? "<b>PANIC</b><span>NO CONFIRMADO<br>pulse otra vez</span>"
                        : "<b>PANIC</b><span>Todas las salidas a cero<br>Tecla F9</span>";
            pb.setAttribute("aria-label", f.panic ? "Rearmar PANIC (pide confirmación)" : pend ? "PANIC enviado: esperando confirmación del motor" : fail ? "PANIC NO CONFIRMADO: pulse otra vez" : "PANIC: todas las salidas a cero");
            $("#btn-stop").innerHTML = f.stop ? "<b>INICIAR</b><span>Reabrir con rampa</span>" : "<b>STOP</b><span>Rampa y detención</span>";
            $("#btn-stop").setAttribute("aria-label", f.stop ? "Iniciar salidas (pide confirmación)" : "STOP: detener salidas con rampa");
        }
        pb.classList.toggle("engaged", !!f.panic);
        pb.classList.toggle("pending", pend);
        pb.classList.toggle("failed", fail);
        pb.dataset.state = f.panic ? "engaged" : pend ? "pending" : fail ? "failed" : "idle";
        $("#btn-stop").classList.toggle("engaged", !!f.stop);
        // Fallo de PANIC: aviso fijo y grande hasta que el motor confirme un PANIC (no un aviso de 4 s).
        const pf = $("#panic-fail");
        if (fail || this.opsAlert)
            this.placeAlerts();
        pf.hidden = !fail;
        if (fail)
            $("#panic-fail-text").textContent = `PANIC NO CONFIRMADO POR EL MOTOR (${this.panicFail}). Pulse PANIC otra vez; si no responde, corte el audio en el amplificador o la mesa de sala.`;
        document.body.classList.toggle("panic-failed", fail);
    }
    /** Pide confirmacion. Cancela cualquier dialogo pendiente (como mucho UNA accion pendiente).
     *  gen: valor de safetyGen cuando empezo la accion; si PANIC/STOP se pulso despues, no se abre. */
    confirmBox(title, text, ok, opts = {}) {
        if (opts.gen !== undefined && opts.gen !== this.safetyGen)
            return Promise.resolve(false);
        if (!this.model?.connected)
            return Promise.resolve(false);
        this.cancelDialog();
        const token = ++this.dlgSeq;
        const dlg = $("#modal");
        $("#modal-title").textContent = title;
        $("#modal-text").textContent = text;
        $("#modal-ok").textContent = ok;
        const ul = $("#modal-list");
        ul.innerHTML = (opts.list ?? []).map((i) => `<li${i.warn ? ' class="warn"' : ""}>${esc(i.text)}</li>`).join("");
        ul.hidden = !opts.list?.length;
        dlg.dataset.token = String(token);
        dlg.hidden = false;
        document.body.classList.add("modal-open");
        this.queueRender();
        $("#modal-cancel").focus();
        return new Promise((resolve) => {
            this.dlg = { token, gen: this.safetyGen, resolve };
        });
    }
    /** Cierra el dialogo vigente. Una confirmacion solo vale si no se pulso PANIC/STOP mientras estaba abierto. */
    closeDialog(ok) {
        const d = this.dlg;
        if (!d)
            return;
        this.dlg = null;
        const dlg = $("#modal");
        dlg.hidden = true;
        delete dlg.dataset.token;
        document.body.classList.remove("modal-open");
        this.queueRender();
        d.resolve(ok && d.gen === this.safetyGen && !!this.model?.connected);
    }
    cancelDialog() {
        this.closeDialog(false);
    }
    get dialogOpen() {
        return this.dlg !== null;
    }
    /** PANIC o STOP pulsados: cancelan cualquier confirmacion pendiente o por abrir. */
    safetyPressed() {
        this.safetyGen++;
        this.cancelDialog();
    }
    async onPanic() {
        const m = this.model;
        if (!m?.connected)
            return;
        this.safetyPressed();
        if (!m.flags.panic) {
            // Activar: inmediato, sin confirmacion. Se marca ENVIADO en el boton al instante (revision 03-11: con
            // un enlace lento no se veia nada hasta la respuesta) y el fallo queda fijo y visible.
            this.panicPending = "engage";
            this.panicFail = null;
            this.renderSafetyTray();
            try {
                await m.panic(true);
                this.panicPending = null;
            }
            catch (e) {
                this.panicPending = null;
                this.panicFail = errText(e);
            }
            this.renderSafetyTray();
            this.queueRender();
            return;
        }
        // Rearmar: la confirmacion vale solo para el PANIC que el operador esta viendo ahora (episodio).
        const seen = m.panicEpoch;
        if (!(await this.confirmBox("Rearmar PANIC", `Las salidas se reabrirán con rampa de ${rampText(m.reopenRampMs)} al nivel actual de la consola.`, "Rearmar")))
            return;
        try {
            await m.panic(false, seen);
            this.toast(`PANIC rearmado: salidas reabriéndose con rampa de ${rampText(m.reopenRampMs)}`);
        }
        catch (e) {
            const code = e.error?.code;
            this.alertOps(code === "STALE_PANIC" ? "PANIC NO REARMADO: cambió mientras confirmaba (se rearmó o se activó otro). Revise y confirme de nuevo." : `PANIC NO REARMADO: ${errText(e)}`, "bad");
        }
    }
    async onStop() {
        const m = this.model;
        if (!m?.connected)
            return;
        this.safetyPressed();
        try {
            if (!m.flags.stop)
                await m.stop();
            else {
                const seen = m.stopEpoch;
                if (await this.confirmBox("Iniciar salidas", `Las salidas se reabrirán con rampa de ${rampText(m.reopenRampMs)} al nivel actual de la consola.`, "Iniciar")) {
                    await m.start(seen);
                    this.toast(`Salidas iniciadas: reabriéndose con rampa de ${rampText(m.reopenRampMs)}`);
                }
            }
        }
        catch (e) {
            const code = e.error?.code;
            this.alertOps(code === "STALE_STOP" ? "NO SE INICIÓ: el STOP cambió mientras confirmaba. Revise y confirme de nuevo." : `STOP: ${errText(e)}`, "bad");
        }
    }
    async onResume() {
        const m = this.model;
        if (!m?.connected)
            return;
        // La confirmacion vale solo para la retencion que el operador esta viendo ahora.
        const seen = m.recoveries;
        if (!(await this.confirmBox("Reanudar salidas", "El motor retuvo las salidas tras un cierre no limpio. Se reabrirán con rampa de 2 s. Compruebe niveles y monitores antes de confirmar.", "Reanudar", { gen: this.safetyGen })))
            return;
        try {
            await m.resume(seen);
        }
        catch (e) {
            const code = e.error?.code;
            this.toast(code === "STALE_HOLD" ? "Reanudar: el dispositivo volvió a reconectarse mientras confirmaba. Revise y confirme de nuevo." : `Reanudar: ${errText(e)}`);
        }
    }
    async onRelease(output) {
        const m = this.model;
        if (!m?.connected)
            return;
        if (!(await this.confirmBox("Liberar salida", `El monitor de seguridad cerró ${OUTPUT_LABEL[output] ?? output}. Libérela solo si conoce la causa.`, "Liberar", { gen: this.safetyGen })))
            return;
        try {
            await m.releaseForced(output);
            await this.refreshStatus();
        }
        catch (e) {
            this.toast(`Liberar: ${errText(e)}`);
        }
    }
    async clearSolos() {
        const m = this.model;
        if (!m)
            return;
        const ed = m.edition;
        const ps = [];
        for (let c = 1; c <= ed; c++)
            if (m.value(`ch.${c}.solo`) === true)
                ps.push(m.set(`ch.${c}.solo`, false));
        await Promise.all(ps);
    }
    toast(text) {
        const t = $("#toast");
        t.textContent = text;
        t.classList.add("show");
        // Un aviso nuevo reinicia su plazo (antes el temporizador del anterior lo apagaba antes de tiempo).
        if (this.toastTimer !== null)
            clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            this.toastTimer = null;
            t.classList.remove("show");
        }, 4000);
    }
    /** Aviso grande y persistente de la pantalla central (no tapa faders, PANIC ni STOP). */
    alertOps(text, level = "warn") {
        const same = this.opsAlert && this.opsAlert.text === text;
        this.opsAlert = { text, level, count: same ? this.opsAlert.count + 1 : 1 };
        this.renderOpsAlert();
        // Sin «ENTENDIDO», se retira a los 15 s (tapa la cabecera de la pantalla: titulo y pestanas).
        if (this.opsTimer !== null)
            clearTimeout(this.opsTimer);
        this.opsTimer = setTimeout(() => {
            this.opsTimer = null;
            this.opsAlert = null;
            this.renderOpsAlert();
        }, 15000);
    }
    opsTimer = null;
    /** Coloca los avisos grandes sobre la cabecera de la pantalla central (titulo y pestanas). */
    placeAlerts() {
        const box = $("#alerts");
        const r = $(".shead").getBoundingClientRect();
        box.style.left = `${Math.round(r.left)}px`;
        box.style.top = `${Math.round(r.top)}px`;
        box.style.width = `${Math.round(r.width)}px`;
    }
    renderOpsAlert() {
        const el = $("#ops-alert");
        const a = this.opsAlert;
        this.placeAlerts();
        el.hidden = !a;
        document.body.classList.toggle("ops-alert-shown", !!a);
        if (!a)
            return;
        el.dataset.level = a.level;
        $("#ops-alert-text").textContent = a.text + (a.count > 1 ? ` (×${a.count})` : "");
        // Reinicia el parpadeo de llamada de atencion.
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
    }
    /** Orden rechazada por el motor: se dice en grande que NO se aplico y por que (sin reintento). */
    onRejected(r) {
        const what = (p) => `${ownerOf(p, (k, i) => this.label(k, i))} · ${paramLabel(p)}`;
        const target = r.conflict ?? r.paths[0];
        let text;
        if (r.code === "STALE_REVISION")
            text = `NO APLICADO: otra consola cambió ${target ? `«${what(target)}»` : "el show"} justo antes. Su orden no se repitió; vuelva a hacerla si sigue siendo necesaria.`;
        else if (r.code === "STALE_HISTORY")
            text = "NO SE DESHIZO NADA: otra consola añadió un paso al historial mientras tanto. Revise el rótulo de DESHACER y vuelva a pulsar.";
        else if (r.code === "STALE_BOOT")
            text = "NO APLICADO: el motor se reinició mientras tanto. La consola se reconecta y relee el estado; revise y vuelva a hacer la acción.";
        else if (r.code === "SCENE_BUSY")
            text = "ESCENA OCUPADA: la escena se está escribiendo en disco. Espere un momento y repita.";
        else if (r.code === "STALE_SCENE")
            text = "ESCENA NO RECUPERADA: la escena se guardó, renombró o cambió de alcance mientras confirmaba. Revise y confirme de nuevo.";
        else if (r.code === "OSC_BLOCKED")
            text = "OSCILADOR NO ENCENDIDO: con PANIC, STOP o salidas retenidas no se enciende.";
        else if (r.code === "PANIC_ENGAGED")
            text = "NO APLICADO: PANIC activo. Rearme primero.";
        else {
            // Validacion (INVALID_PARAM, ...): la interfaz ya limita los valores; basta el aviso breve y la fase
            // «rechazado» del control. La franja grande es para los conflictos y bloqueos de seguridad.
            this.toast(`No aplicado (${r.code}): ${target ? what(target) + " · " : ""}${r.message}`);
            return;
        }
        this.alertOps(text, r.code.startsWith("STALE") ? "warn" : "bad");
    }
}
const app = new App();
window.benzaiApp = app;
app.init();
