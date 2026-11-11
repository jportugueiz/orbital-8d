// Cliente del protocolo local de BENZAI AUDIO (v1) y modelo de estado honesto para la UI.
//
// Es codigo de PRODUCTO: la consola definitiva (mascara aprobada en WebView2, hito H5) lo usara tal
// cual. Es independiente del transporte: en H5 el transporte sera el puente nativo de WebView2;
// en H1 las pruebas usan un adaptador de socket local.
//
// Regla DG-004 n.4: ningun control aparenta funcionar si no esta conectado al motor.
//   - Solo se pueden crear controles para parametros que el MOTOR declara en 'hello'.
//   - El estado mostrado de un control distingue: confirmado por el motor / enviado / ACCEPTED /
//     APPLIED / rechazado. Nunca se pinta como hecho un valor que el motor no ha aceptado.
//   - El estado de una SALIDA (silenciosa/abierta) solo procede de eventos 'effective', que se basan
//     en el medidor posterior al permiso de salida.
import { PARAMS, SCHEMA_VERSION } from "../generated/params.js";
export const PROTOCOL_VERSION = 1;
// Temporizadores del entorno (navegador, WebView2 o Node) sin depender de las tipificaciones DOM.
const timers = globalThis;
export class RequestFailed extends Error {
    error;
    constructor(error) {
        super(`${error.code}: ${error.message}`);
        this.error = error;
    }
}
/** Comprueba que un patron del esquema corresponde a una ruta concreta. */
function patternMatches(pattern, path) {
    // Indices de ruta: {i} canal, {k} AUX, {f} FX, {d} DCA, {g} grupo de mute, {o} ranura de salida.
    const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\{[a-z]\}/g, "([1-9][0-9]{0,2})") + "$");
    return re.test(path);
}
export class EngineClient {
    t;
    nextId = 1;
    pending = new Map();
    eventHandlers = [];
    closeHandlers = [];
    closed = false;
    implemented = [];
    edition = 0;
    revision = 0;
    /** P6-control (#5): identificador del arranque del motor que dio 'hello' por ESTA conexion. set, undo/redo y
     *  scene.recall lo envian; si el motor se reinicio, responde STALE_BOOT y la consola resincroniza. */
    bootId = "";
    constructor(t) {
        this.t = t;
        t.onLine((line) => this.onLine(line));
        t.onClose(() => {
            this.closed = true;
            for (const p of this.pending.values())
                p.reject(new Error("RESULTADO DESCONOCIDO: la conexion se cerro antes de la respuesta"));
            this.pending.clear();
            for (const h of this.closeHandlers)
                h();
        });
    }
    onClosed(cb) {
        this.closeHandlers.push(cb);
    }
    get isClosed() {
        return this.closed;
    }
    /** Cierra la conexion (la interfaz bloquea los controles y reconecta con un 'hello' nuevo). */
    close() {
        this.t.close();
    }
    onLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            return; // linea ilegible: se ignora, nunca se interpreta
        }
        if ("ok" in msg) {
            const id = typeof msg.id === "number" ? msg.id : -1;
            const p = this.pending.get(id);
            if (!p)
                return;
            this.pending.delete(id);
            if (msg.ok === true)
                p.resolve(msg.result ?? null);
            else
                p.reject(new RequestFailed(msg.error));
            return;
        }
        if (typeof msg.event === "string")
            for (const h of this.eventHandlers)
                h(msg);
    }
    onEvent(cb) {
        this.eventHandlers.push(cb);
    }
    /** Tiempo maximo de respuesta del motor. Un motor que no responde se trata como desconectado. */
    timeoutMs = 4000;
    /** P6-control (#2): operaciones que escriben en disco. El motor las responde cuando termina el disco (en su hilo de
     *  E/S; nada mas espera): con un disco lento tardan mas que una orden normal sin que el motor este colgado. */
    static DISK_OPS = new Set(["save", "scene.store", "scene.rename", "scene.set_scope", "scene.delete"]);
    diskTimeoutMs = 20000;
    request(op, args = {}) {
        if (this.closed)
            return Promise.reject(new Error("conexion cerrada"));
        const id = this.nextId++;
        const timeoutMs = EngineClient.DISK_OPS.has(op) ? Math.max(this.timeoutMs, this.diskTimeoutMs) : this.timeoutMs;
        return new Promise((resolve, reject) => {
            const timer = timers.setTimeout(() => {
                if (!this.pending.has(id))
                    return;
                this.pending.delete(id);
                reject(new Error("RESULTADO DESCONOCIDO: el motor no respondio a tiempo"));
                // Conexion sospechosa: se cierra para que la interfaz bloquee los controles y reconecte.
                this.t.close();
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (r) => {
                    timers.clearTimeout(timer);
                    resolve(r);
                },
                reject: (e) => {
                    timers.clearTimeout(timer);
                    reject(e);
                },
            });
            // Caducidad: el motor rechaza (EXPIRED) la orden si la procesa cuando esta consola ya la dio por
            // perdida (margen de 500 ms antes de nuestro propio plazo). PANIC activar y STOP se aplican siempre.
            const validUntil = Date.now() + Math.max(250, timeoutMs - 500);
            this.t.send(JSON.stringify({ ...args, op, id, valid_until_ms: validUntil }));
        });
    }
    async hello() {
        const r = (await this.request("hello"));
        if (r.protocol !== PROTOCOL_VERSION)
            throw new Error(`protocolo ${String(r.protocol)} no soportado`);
        this.edition = r.edition;
        this.revision = r.revision;
        this.bootId = typeof r.boot_id === "string" ? r.boot_id : "";
        const declared = (r.implemented_params ?? []);
        this.implemented = declared.map((p) => p.pattern);
        // La consola se entrega con su motor: el esquema debe coincidir EXACTAMENTE (patrones, version y
        // rangos), para no generar nunca valores fuera de rango (auditoria DG-010). Un cliente externo
        // (p. ej. SHOW CENTER) debe en cambio ignorar los patrones que no conozca.
        if (typeof r.schema_version === "number" && r.schema_version !== SCHEMA_VERSION)
            throw new Error(`version de esquema del motor ${String(r.schema_version)} distinta de la de la consola (${SCHEMA_VERSION})`);
        const local = new Map(PARAMS.map((p) => [p.pattern, p]));
        for (const p of declared) {
            const l = local.get(p.pattern);
            if (!l)
                throw new Error(`parametro del motor desconocido por la UI: ${p.pattern}`);
            if (typeof p.min === "number" && (p.min !== l.min || p.max !== l.max))
                throw new Error(`rango distinto en ${p.pattern}: motor ${p.min}..${p.max}, consola ${l.min}..${l.max}`);
        }
        return r;
    }
    // Resultado de isImplemented por ruta (la consola lo consulta para cada control en cada cuadro: sin
    // cache se compilaban cientos de expresiones regulares por cuadro). Se rehace si cambia 'implemented'.
    implCache = new Map();
    implCacheOf = null;
    isImplemented(path) {
        if (this.implCacheOf !== this.implemented) {
            this.implCache.clear();
            this.implCacheOf = this.implemented;
        }
        let v = this.implCache.get(path);
        if (v === undefined) {
            v = this.implemented.some((pat) => patternMatches(pat, path));
            this.implCache.set(path, v);
        }
        return v;
    }
}
/**
 * Modelo de estado de la consola. Mantiene la verdad del MOTOR y, aparte, las peticiones del
 * operador en curso. La vista nunca mezcla ambas cosas.
 */
export class ConsoleModel {
    client;
    controls = new Map();
    // Cola de envio: UNA peticion 'set' en vuelo; los cambios pendientes se agrupan (el ultimo valor
    // de cada control gana). Evita STALE_REVISION entre controles del mismo cliente al mover faders.
    queue = new Map();
    inflight = false;
    panicToken = null;
    meters = null;
    connected = false;
    rate = 0;
    recoveryNote = "";
    /** Recuperaciones del dispositivo vistas (identifica la retencion que el operador confirma). */
    recoveries = 0;
    /** El motor declara en 'hello' si usa el backend de banco (sin dispositivo ni audio). */
    benchBackend = false;
    /** Backend del motor tal como lo declara ('bench', 'wasapi-sim', 'wasapi', 'uacm'). */
    backend = "";
    /** Rampa con la que el motor reabre las salidas al liberar PANIC o STOP (ms). La informa el motor en la
     *  respuesta (reopen_ramp_ms); hasta la primera, la del motor de esta entrega (2 s, rampa de reanudacion). */
    reopenRampMs = 2000;
    /** Episodios de PANIC y STOP del motor (identifican lo que el operador confirma). */
    panicEpoch = 0;
    stopEpoch = 0;
    /** Problema del dispositivo informado por el motor (vacio = ninguno). */
    deviceProblem = "";
    /** P2: historial de edicion del motor (evento 'history'). */
    history = { undoDepth: 0, redoDepth: 0, undoLabel: "", redoLabel: "", undoStep: 0, redoStep: 0, undoClient: -1, redoClient: -1, undoScene: 0, redoScene: 0 };
    /** Identificador de esta conexion en el motor (hello.client_id); -2 si el motor no lo da. */
    clientId = -2;
    /** Ordenes rechazadas por el motor (las ultimas 50), de la mas antigua a la mas reciente. */
    rejections = [];
    rejectListeners = [];
    /** P2: escena actual (ultima recuperada o guardada) y si el show cambio desde entonces. */
    currentScene = null;
    currentSceneModified = false;
    /** P2: sube cada vez que el motor anuncia un cambio en las escenas (evento 'scenes'). */
    scenesVersion = 0;
    // P2: gesto en curso (arrastre de un fader o mando): los cambios que viajan durante el gesto se
    // funden en UN paso del historial del motor.
    gesture = null;
    gestureSeq = 0;
    // Salidas cerradas por aislamiento (evento 'forced_closed'); null hasta el primer evento.
    forcedClosed = null;
    outputs = new Map();
    flags = {};
    // Ultima revision APLICADA por el motor. El evento 'applied' puede llegar en el mismo bloque de datos
    // que la respuesta ACCEPTED y procesarse antes de que continue set(): se recuerda aqui.
    appliedRevision = 0;
    listeners = [];
    constructor(client) {
        this.client = client;
        client.onEvent((e) => this.onEvent(e));
        client.onClosed(() => {
            this.connected = false;
            for (const c of this.controls.values())
                if (c.phase === "sending") {
                    c.phase = "unknown";
                    c.requested = c.engine;
                    c.error = "desconectado con la orden en vuelo";
                }
            for (const o of this.outputs.keys())
                this.outputs.set(o, "unknown");
            this.meters = null;
            this.flags = {};
            this.forcedClosed = null;
            for (const [, q] of this.queue)
                for (const w of q.waiters)
                    w();
            this.queue.clear();
            this.changed();
        });
    }
    async connect(opts = {}) {
        const h = await this.client.hello();
        this.flags = h.flags ?? {};
        this.rate = typeof h.rate === "number" ? h.rate : 0;
        this.benchBackend = h.bench_backend === true;
        this.backend = typeof h.backend === "string" ? h.backend : this.benchBackend ? "bench" : "";
        if (typeof h.panic_epoch === "number")
            this.panicEpoch = h.panic_epoch;
        if (typeof h.stop_epoch === "number")
            this.stopEpoch = h.stop_epoch;
        this.recoveryNote = typeof h.recovery_note === "string" ? h.recovery_note : "";
        if (typeof h.client_id === "number")
            this.clientId = h.client_id;
        this.noteRamp(h);
        // Suscribirse ANTES de leer el estado: ningun cambio puede caer entre la lectura y la suscripcion.
        await this.client.request("subscribe", { meters: opts.meters === true });
        const g = (await this.client.request("get"));
        this.client.revision = g.revision;
        for (const [path, v] of Object.entries(g.params))
            this.controls.set(path, { engine: v, requested: v, phase: "confirmed", rev: g.revision });
        const st = (await this.client.request("status"));
        // Revision independiente 30-10 (control M1): las banderas leidas en 'hello' pueden haber cambiado
        // antes de 'subscribe' (ese evento no llega a esta consola). El 'status' posterior a la suscripcion
        // es la referencia; desde aqui, todo cambio llega como evento por la misma conexion, en orden.
        this.applyStatus(st);
        this.connected = true;
        this.changed();
    }
    get edition() {
        return this.client.edition;
    }
    /** Valor del motor de un parametro, o undefined si no existe en esta edicion o no esta implementado. */
    value(path) {
        if (!this.client.isImplemented(path))
            return undefined;
        return this.controls.get(path)?.engine;
    }
    has(path) {
        return this.client.isImplemented(path) && this.controls.has(path);
    }
    /** PANIC: silencio inmediato de todas las salidas. El rearme exige el token devuelto.
     *  seenEpoch: episodio de PANIC que el operador estaba viendo al confirmar el rearme. Si el motor ya
     *  esta en otro (se rearmo o se activo uno nuevo mientras tanto), responde STALE_PANIC y nada cambia. */
    async panic(engage, seenEpoch) {
        if (engage) {
            const r = (await this.client.request("panic", { engage: true }));
            this.panicToken = r.release_token;
            if (typeof r.epoch === "number")
                this.panicTokenEpoch = r.epoch;
        }
        else {
            const epoch = typeof seenEpoch === "number" ? seenEpoch : this.panicEpoch;
            // Sin el token de ESE episodio (lo activo otro cliente o una sesion anterior) se pide ligado al
            // episodio confirmado: el motor nunca activa uno nuevo ni entrega el token de otro.
            if (this.panicToken === null || this.panicTokenEpoch !== epoch) {
                const r = (await this.client.request("panic", { engage: true, epoch }));
                this.panicToken = r.release_token;
                this.panicTokenEpoch = epoch;
            }
            const rr = (await this.client.request("panic", { engage: false, token: this.panicToken ?? "", epoch }));
            this.panicToken = null;
            this.noteRamp(rr);
        }
    }
    panicTokenEpoch = -1;
    async stop() {
        await this.client.request("stop");
    }
    /** seenEpoch: episodio de STOP confirmado; STALE_STOP si el motor ya esta en otro. */
    async start(seenEpoch) {
        const args = {};
        if (typeof seenEpoch === "number")
            args.epoch = seenEpoch;
        this.noteRamp((await this.client.request("start", args)));
    }
    noteRamp(r) {
        if (r && typeof r.reopen_ramp_ms === "number" && r.reopen_ramp_ms > 0)
            this.reopenRampMs = r.reopen_ramp_ms;
    }
    /** Confirmacion del operador tras una retencion de recuperacion (rampa de 2 s). */
    /** expectedRecoveries: numero de recuperaciones del dispositivo cuando el operador vio la retencion. */
    async resume(expectedRecoveries) {
        const args = { confirm: "RESUME" };
        if (typeof expectedRecoveries === "number")
            args.recoveries = expectedRecoveries;
        await this.client.request("resume", args);
    }
    async releaseForced(output) {
        await this.client.request("release_forced", { output, confirm: "RELEASE" });
    }
    async status() {
        const st = (await this.client.request("status"));
        // La respuesta viaja por la misma conexion que los eventos y en orden: refleja el motor en este
        // punto. Corrige las banderas si por cualquier motivo se perdio un evento.
        this.applyStatus(st);
        this.changed();
        return st;
    }
    applyStatus(st) {
        const f = st.flags;
        if (f && typeof f === "object")
            this.flags = { silent_test: !!f.silent_test, panic: !!f.panic, stop: !!f.stop, recovery_hold: !!f.recovery_hold, device_lost: !!f.device_lost };
        if (typeof st.recovery_note === "string")
            this.recoveryNote = st.recovery_note;
        const eff = st.effective;
        if (eff && typeof eff === "object")
            for (const [o, s] of Object.entries(eff))
                this.outputs.set(o, s === "open" ? "open" : s === "silent" ? "silent" : s === "ramping" ? "ramping" : "unknown");
        if (typeof st.device_recoveries === "number")
            this.recoveries = st.device_recoveries;
        if (typeof st.panic_epoch === "number")
            this.panicEpoch = st.panic_epoch;
        if (typeof st.stop_epoch === "number")
            this.stopEpoch = st.stop_epoch;
        if (typeof st.device_problem === "string")
            this.deviceProblem = st.device_problem;
        if (Array.isArray(st.forced_closed))
            this.forcedClosed = st.forced_closed.filter((x) => typeof x === "string");
        if (st.history && typeof st.history === "object")
            this.applyHistory(st.history);
        const sc = st.scene;
        if (sc && typeof sc === "object") {
            this.currentScene = typeof sc.current === "number" ? sc.current : null;
            this.currentSceneModified = sc.modified === true;
        }
    }
    applyHistory(h) {
        this.history = {
            undoDepth: typeof h.undo_depth === "number" ? h.undo_depth : 0,
            redoDepth: typeof h.redo_depth === "number" ? h.redo_depth : 0,
            undoLabel: typeof h.undo_label === "string" ? h.undo_label : "",
            redoLabel: typeof h.redo_label === "string" ? h.redo_label : "",
            undoStep: typeof h.undo_step === "number" ? h.undo_step : 0,
            redoStep: typeof h.redo_step === "number" ? h.redo_step : 0,
            undoClient: typeof h.undo_client === "number" ? h.undo_client : -1,
            redoClient: typeof h.redo_client === "number" ? h.redo_client : -1,
            undoScene: typeof h.undo_scene === "number" ? h.undo_scene : 0,
            redoScene: typeof h.redo_scene === "number" ? h.redo_scene : 0,
        };
    }
    // ---------------------------------------------------------------- P2: historial
    /** Empieza un gesto continuo (arrastre): hasta endGesture, los cambios son UN paso de deshacer. */
    beginGesture() {
        this.gesture = `g${Date.now().toString(36)}-${++this.gestureSeq}`;
    }
    endGesture() {
        this.gesture = null;
    }
    /** Deshacer/rehacer el paso que el operador VIO (step; por defecto el de arriba segun este modelo).
     *  Revision 03-11: el motor exige expected_revision y step; si otra consola anadio un paso entretanto
     *  responde STALE_HISTORY y nada cambia. El motor lo rechaza tambien con PANIC activo. */
    async undo(step) {
        return this.history_op("undo", step ?? this.history.undoStep);
    }
    async redo(step) {
        return this.history_op("redo", step ?? this.history.redoStep);
    }
    async history_op(op, step) {
        try {
            const r = (await this.client.request(op, { boot_id: this.client.bootId, expected_revision: this.client.revision, step }));
            this.applyHistory(r);
            this.changed();
            return r;
        }
        catch (e) {
            if (e instanceof RequestFailed)
                this.reject(e, []);
            this.staleBoot(e);
            throw e;
        }
    }
    /** P6-control (#5): el motor se reinicio (los numeros de revision de antes ya no valen). Nada se aplico; la
     *  consola cierra la conexion: al reconectar lee de nuevo hello + get (resincronizacion completa). */
    staleBoot(e) {
        if (e instanceof RequestFailed && e.error.code === "STALE_BOOT")
            this.client.close();
    }
    /** Suscripcion a los rechazos del motor (para anunciarlos de forma visible). */
    onReject(cb) {
        this.rejectListeners.push(cb);
    }
    reject(e, paths) {
        const d = e.error.detail;
        const r = {
            at: Date.now(), code: e.error.code, message: e.error.message, paths,
            ...(d && typeof d === "object" && typeof d.path === "string" ? { conflict: d.path } : {}),
        };
        this.rejections.push(r);
        if (this.rejections.length > 50)
            this.rejections.shift();
        for (const l of this.rejectListeners)
            l(r);
    }
    // ---------------------------------------------------------------- P2: escenas
    async sceneList() {
        const r = (await this.client.request("scene.list"));
        this.currentScene = r.current;
        this.currentSceneModified = r.current_modified;
        return r;
    }
    async sceneStore(number, opts = {}) {
        const args = { number };
        if (opts.name !== undefined)
            args.name = opts.name;
        if (opts.scope !== undefined)
            args.scope = opts.scope;
        if (opts.overwrite !== undefined)
            args.overwrite = opts.overwrite;
        const r = (await this.client.request("scene.store", args));
        this.currentScene = number;
        this.currentSceneModified = false;
        this.changed();
        return r;
    }
    /** Recupera una escena como UN lote atomico del motor. Revision 03-11: expectedRevision es la revision
     *  del diff que el operador confirmo (STALE_REVISION si cambio algo de su alcance despues) y sceneGen la
     *  generacion de la ranura que vio (STALE_SCENE si se guardo/renombro/cambio de alcance). */
    async sceneRecall(number, opts = {}) {
        const args = { number, boot_id: this.client.bootId, expected_revision: opts.expectedRevision ?? this.client.revision };
        if (opts.scope)
            args.scope = opts.scope;
        if (typeof opts.sceneGen === "number")
            args.scene_gen = opts.sceneGen;
        let r;
        try {
            r = (await this.client.request("scene.recall", args));
        }
        catch (e) {
            if (e instanceof RequestFailed)
                this.reject(e, []);
            this.staleBoot(e);
            throw e;
        }
        if (typeof r.revision === "number" && r.revision > this.client.revision)
            this.client.revision = r.revision;
        this.currentScene = number;
        this.currentSceneModified = false;
        this.changed();
        return r;
    }
    async sceneRename(number, name) {
        await this.client.request("scene.rename", { number, name });
    }
    async sceneSetScope(number, scope) {
        await this.client.request("scene.set_scope", { number, scope });
    }
    async sceneDelete(number) {
        await this.client.request("scene.delete", { number });
        if (this.currentScene === number)
            this.currentScene = null;
        this.changed();
    }
    async sceneDiff(number, scope) {
        const args = { number };
        if (scope)
            args.scope = scope;
        return (await this.client.request("scene.diff", args));
    }
    /** Un control solo existe si el motor lo implementa. */
    control(path) {
        if (!this.client.isImplemented(path))
            throw new Error(`control no conectado al motor: ${path}`);
        const c = this.controls.get(path);
        if (!c)
            throw new Error(`parametro inexistente en esta edicion: ${path}`);
        return { path, engineValue: c.engine, requestedValue: c.requested, phase: c.phase, error: c.error };
    }
    output(name) {
        return this.outputs.get(name) ?? "unknown";
    }
    onChange(cb) {
        this.listeners.push(cb);
    }
    /** Pide un cambio. El valor del motor NO cambia hasta que el motor lo acepta. */
    set(path, value) {
        const p = this.enqueue(path, value);
        void this.pump();
        return p;
    }
    /** Pide varios cambios que viajan en UN mismo lote atomico (el motor los acepta todos o ninguno). */
    setMany(changes) {
        for (const [path] of changes)
            if (!this.controls.has(path) || !this.client.isImplemented(path))
                return Promise.reject(new Error(`control no conectado al motor: ${path}`));
        const ps = changes.map(([path, value]) => this.enqueue(path, value));
        void this.pump();
        return Promise.all(ps).then(() => undefined);
    }
    enqueue(path, value) {
        const c = this.controls.get(path);
        if (!c || !this.client.isImplemented(path))
            return Promise.reject(new Error(`control no conectado al motor: ${path}`));
        c.requested = value;
        c.phase = "sending";
        c.error = undefined;
        this.changed();
        return new Promise((resolve) => {
            const q = this.queue.get(path);
            if (q) {
                q.value = value;
                q.waiters.push(resolve);
            }
            else {
                this.queue.set(path, { value, waiters: [resolve] });
            }
        });
    }
    async pump() {
        if (this.inflight || this.queue.size === 0)
            return;
        this.inflight = true;
        const batch = [...this.queue.entries()];
        this.queue.clear();
        try {
            const args = {
                boot_id: this.client.bootId,
                expected_revision: this.client.revision,
                changes: batch.map(([path, q]) => ({ path, value: q.value })),
            };
            if (this.gesture)
                args.gesture = this.gesture;
            const r = (await this.client.request("set", args));
            this.client.revision = r.revision;
            for (const [path, q] of batch) {
                const c = this.controls.get(path);
                if (!c)
                    continue;
                c.engine = q.value;
                c.rev = r.revision;
                // Si el operador ya movio otra vez el control, sigue "sending" hasta el siguiente envio.
                if (!this.queue.has(path))
                    c.phase = this.appliedRevision >= r.revision ? "applied" : "accepted";
            }
        }
        catch (e) {
            const engineFailed = e instanceof RequestFailed;
            for (const [path] of batch) {
                const c = this.controls.get(path);
                if (!c || this.queue.has(path))
                    continue;
                c.phase = engineFailed ? "rejected" : "unknown";
                c.requested = c.engine;
                c.error = engineFailed ? e.error.code : String(e);
            }
            if (e instanceof RequestFailed)
                this.reject(e, batch.map(([p]) => p));
            this.staleBoot(e);
            if (e instanceof RequestFailed && e.error.code === "STALE_REVISION") {
                // DG 30-10: una orden rechazada por revision desactualizada NO se reintenta ni se ejecuta. Se
                // resincroniza la consola con el motor y el control queda "rechazado" hasta que el operador
                // vuelva a actuar (otra consola cambio el show mientras tanto).
                try {
                    await this.resync();
                }
                catch {
                    /* conexion perdida: el estado queda como desconocido o rechazado */
                }
            }
        }
        finally {
            this.inflight = false;
            for (const [, q] of batch)
                for (const w of q.waiters)
                    w();
            this.changed();
            void this.pump();
        }
    }
    async resync() {
        const g = (await this.client.request("get"));
        this.client.revision = g.revision;
        for (const [path, v] of Object.entries(g.params)) {
            const c = this.controls.get(path);
            if (c && c.phase !== "sending") {
                c.engine = v;
                c.requested = v;
            }
        }
    }
    onEvent(e) {
        if (e.event === "applied" && typeof e.revision === "number") {
            if (e.revision > this.appliedRevision)
                this.appliedRevision = e.revision;
            for (const c of this.controls.values())
                if (c.phase === "accepted" && c.rev <= e.revision)
                    c.phase = "applied";
        }
        else if (e.event === "changed" && typeof e.revision === "number" && Array.isArray(e.changes)) {
            // Cambio hecho por cualquier cliente (incluido este): el valor del motor es la verdad.
            if (e.revision > this.client.revision)
                this.client.revision = e.revision;
            // P2: una escena recuperada (desde cualquier consola) pasa a ser la actual; cualquier otro cambio
            // del show la deja «modificada».
            if (e.reason === "recall" && typeof e.scene === "number") {
                this.currentScene = e.scene;
                this.currentSceneModified = false;
            }
            else if (this.currentScene !== null)
                this.currentSceneModified = true;
            for (const ch of e.changes) {
                const c = this.controls.get(ch.path);
                if (!c)
                    continue;
                c.engine = ch.value;
                if (c.phase !== "sending")
                    c.requested = ch.value;
            }
        }
        else if (e.event === "effective" && typeof e.output === "string") {
            const st = e.state;
            this.outputs.set(e.output, st === "open" ? "open" : st === "silent" ? "silent" : st === "ramping" ? "ramping" : "unknown");
        }
        else if (e.event === "flags") {
            this.flags = { silent_test: !!e.silent_test, panic: !!e.panic, stop: !!e.stop, recovery_hold: !!e.recovery_hold, device_lost: !!e.device_lost };
            if (typeof e.panic_epoch === "number")
                this.panicEpoch = e.panic_epoch;
            if (typeof e.stop_epoch === "number")
                this.stopEpoch = e.stop_epoch;
        }
        else if (e.event === "history") {
            this.applyHistory(e);
        }
        else if (e.event === "scenes") {
            this.scenesVersion++;
            if (e.reason === "delete" && e.number === this.currentScene)
                this.currentScene = null;
        }
        else if (e.event === "device_problem") {
            this.deviceProblem = typeof e.detail === "string" ? e.detail : "";
        }
        else if (e.event === "safety_violation" && typeof e.output === "string") {
            this.outputs.set(e.output, "unknown");
        }
        else if (e.event === "forced_closed" && Array.isArray(e.outputs)) {
            this.forcedClosed = e.outputs.filter((x) => typeof x === "string");
        }
        else if (e.event === "device_recovered") {
            // Politica A: el motor retuvo las salidas al reconectar el dispositivo.
            if (typeof e.recovery_note === "string")
                this.recoveryNote = e.recovery_note;
            if (typeof e.recoveries === "number")
                this.recoveries = e.recoveries;
        }
        else if (e.event === "meters") {
            this.meters = {
                peakDbfs: e.peak_dbfs ?? {},
                limiterGrDb: e.limiter_gr_db ?? {},
                channelPeakDbfs: Array.isArray(e.ch_peak_dbfs) ? e.ch_peak_dbfs : [],
                channelGateDb: Array.isArray(e.ch_gate_db) ? e.ch_gate_db : [],
                channelCompGrDb: Array.isArray(e.ch_comp_gr_db) ? e.ch_comp_gr_db : [],
                fxPeakDbfs: Array.isArray(e.fx_peak_dbfs) ? e.fx_peak_dbfs : [],
                soloActive: e.solo_active === true,
                frame: typeof e.frame === "number" ? e.frame : 0,
                receivedAt: Date.now(),
            };
        }
        this.changed();
    }
    changed() {
        for (const l of this.listeners)
            l();
    }
}
