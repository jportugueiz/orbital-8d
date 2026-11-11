export declare const PROTOCOL_VERSION: 1;
export type Json = null | boolean | number | string | Json[] | {
    [k: string]: Json;
};
export type ParamValue = boolean | number | string;
export interface Transport {
    send(line: string): void;
    onLine(cb: (line: string) => void): void;
    onClose(cb: () => void): void;
    close(): void;
}
export interface ProtocolError {
    code: string;
    message: string;
    detail?: Json;
}
export declare class RequestFailed extends Error {
    readonly error: ProtocolError;
    constructor(error: ProtocolError);
}
export type ControlPhase = "confirmed" | "sending" | "accepted" | "applied" | "rejected" | "unknown";
export type OutputState = "unknown" | "silent" | "ramping" | "open";
export interface MeterView {
    /** Pico por salida logica, dBFS, medido DESPUES del permiso (lo que realmente salio). */
    readonly peakDbfs: {
        [output: string]: number;
    };
    /** Reduccion de ganancia del limitador de proteccion por salida, dB (0 = sin reduccion). */
    readonly limiterGrDb: {
        [output: string]: number;
    };
    /** Pico de entrada por canal (pre-fader), dBFS. Indice 0 = canal 1. */
    readonly channelPeakDbfs: number[];
    /** Atenuacion de la puerta por canal, dB (0 = abierta). Indice 0 = canal 1. */
    readonly channelGateDb: number[];
    /** Reduccion del compresor por canal, dB (0 = sin reduccion; sin la compensacion). */
    readonly channelCompGrDb: number[];
    /** Pico de cada retorno de FX (1-4) sumado a MAIN, dBFS (P1). Indice 0 = FX 1. Vacio si el motor no lo da. */
    readonly fxPeakDbfs: number[];
    readonly soloActive: boolean;
    readonly frame: number;
    /** Momento local de recepcion (ms); permite detectar medidores congelados. */
    readonly receivedAt: number;
}
/** Historial de edicion del motor (P2): profundidad y rotulo del siguiente paso de deshacer/rehacer. */
export interface HistoryView {
    readonly undoDepth: number;
    readonly redoDepth: number;
    readonly undoLabel: string;
    readonly redoLabel: string;
    /** Revision 03-11: identificador del paso de arriba (se envia con undo/redo: STALE_HISTORY si cambio). */
    readonly undoStep: number;
    readonly redoStep: number;
    /** Cliente que hizo el paso (-1: escena); se compara con ConsoleModel.clientId. */
    readonly undoClient: number;
    readonly redoClient: number;
    /** > 0: el paso es la recuperacion de esa escena. */
    readonly undoScene: number;
    readonly redoScene: number;
}
/** Orden rechazada por el motor (revision 03-11: la consola la anuncia de forma visible). */
export interface Rejection {
    readonly at: number;
    readonly code: string;
    readonly message: string;
    /** Parametros de la orden rechazada. */
    readonly paths: string[];
    /** Parametro que otro cliente cambio (STALE_REVISION), si el motor lo dice. */
    readonly conflict?: string;
}
/** Escena tal como la lista el motor (P2). damaged: archivo danado (no se puede recuperar). */
export interface SceneInfo {
    readonly number: number;
    readonly name?: string;
    readonly scope?: string[];
    readonly edition?: number;
    readonly compatible?: boolean;
    readonly stored_revision?: number;
    readonly stored_ms?: number;
    readonly from_prev?: boolean;
    readonly damaged?: string;
    /** Generacion de la ranura (sube al guardar, renombrar, cambiar alcance o borrar). */
    readonly gen?: number;
}
export interface SceneList {
    readonly scenes: SceneInfo[];
    readonly count_max: number;
    readonly current: number | null;
    readonly current_modified: boolean;
    readonly families: Array<{
        id: string;
        label_es: string;
        default_scope: boolean;
    }>;
    readonly persistent: boolean;
}
export interface SceneDiffEntry {
    readonly path: string;
    readonly family: string;
    readonly scene: ParamValue;
    readonly current: ParamValue;
    /** recall: se aplicaria; scope: fuera del alcance; safe: canal en safe; safety: regla de seguridad. */
    readonly reason: "recall" | "scope" | "safe" | "safety";
}
export interface SceneDiff {
    readonly number: number;
    readonly revision: number;
    readonly total: number;
    readonly would_apply: number;
    readonly differences: SceneDiffEntry[];
}
export interface ControlView {
    readonly path: string;
    readonly engineValue: ParamValue;
    readonly requestedValue: ParamValue;
    readonly phase: ControlPhase;
    readonly error?: string;
}
export declare class EngineClient {
    private readonly t;
    private nextId;
    private pending;
    private eventHandlers;
    private closeHandlers;
    private closed;
    implemented: string[];
    edition: number;
    revision: number;
    /** P6-control (#5): identificador del arranque del motor que dio 'hello' por ESTA conexion. set, undo/redo y
     *  scene.recall lo envian; si el motor se reinicio, responde STALE_BOOT y la consola resincroniza. */
    bootId: string;
    constructor(t: Transport);
    onClosed(cb: () => void): void;
    get isClosed(): boolean;
    /** Cierra la conexion (la interfaz bloquea los controles y reconecta con un 'hello' nuevo). */
    close(): void;
    private onLine;
    onEvent(cb: (e: {
        [k: string]: Json;
    }) => void): void;
    /** Tiempo maximo de respuesta del motor. Un motor que no responde se trata como desconectado. */
    timeoutMs: number;
    /** P6-control (#2): operaciones que escriben en disco. El motor las responde cuando termina el disco (en su hilo de
     *  E/S; nada mas espera): con un disco lento tardan mas que una orden normal sin que el motor este colgado. */
    static readonly DISK_OPS: Set<string>;
    diskTimeoutMs: number;
    request(op: string, args?: {
        [k: string]: Json;
    }): Promise<Json>;
    hello(): Promise<{
        [k: string]: Json;
    }>;
    private implCache;
    private implCacheOf;
    isImplemented(path: string): boolean;
}
/**
 * Modelo de estado de la consola. Mantiene la verdad del MOTOR y, aparte, las peticiones del
 * operador en curso. La vista nunca mezcla ambas cosas.
 */
export declare class ConsoleModel {
    private readonly client;
    private controls;
    private queue;
    private inflight;
    private panicToken;
    meters: MeterView | null;
    connected: boolean;
    rate: number;
    recoveryNote: string;
    /** Recuperaciones del dispositivo vistas (identifica la retencion que el operador confirma). */
    recoveries: number;
    /** El motor declara en 'hello' si usa el backend de banco (sin dispositivo ni audio). */
    benchBackend: boolean;
    /** Backend del motor tal como lo declara ('bench', 'wasapi-sim', 'wasapi', 'uacm'). */
    backend: string;
    /** Rampa con la que el motor reabre las salidas al liberar PANIC o STOP (ms). La informa el motor en la
     *  respuesta (reopen_ramp_ms); hasta la primera, la del motor de esta entrega (2 s, rampa de reanudacion). */
    reopenRampMs: number;
    /** Episodios de PANIC y STOP del motor (identifican lo que el operador confirma). */
    panicEpoch: number;
    stopEpoch: number;
    /** Problema del dispositivo informado por el motor (vacio = ninguno). */
    deviceProblem: string;
    /** P2: historial de edicion del motor (evento 'history'). */
    history: HistoryView;
    /** Identificador de esta conexion en el motor (hello.client_id); -2 si el motor no lo da. */
    clientId: number;
    /** Ordenes rechazadas por el motor (las ultimas 50), de la mas antigua a la mas reciente. */
    rejections: Rejection[];
    private rejectListeners;
    /** P2: escena actual (ultima recuperada o guardada) y si el show cambio desde entonces. */
    currentScene: number | null;
    currentSceneModified: boolean;
    /** P2: sube cada vez que el motor anuncia un cambio en las escenas (evento 'scenes'). */
    scenesVersion: number;
    private gesture;
    private gestureSeq;
    forcedClosed: string[] | null;
    private outputs;
    flags: {
        [k: string]: boolean;
    };
    private appliedRevision;
    private listeners;
    constructor(client: EngineClient);
    connect(opts?: {
        meters?: boolean;
    }): Promise<void>;
    get edition(): number;
    /** Valor del motor de un parametro, o undefined si no existe en esta edicion o no esta implementado. */
    value(path: string): ParamValue | undefined;
    has(path: string): boolean;
    /** PANIC: silencio inmediato de todas las salidas. El rearme exige el token devuelto.
     *  seenEpoch: episodio de PANIC que el operador estaba viendo al confirmar el rearme. Si el motor ya
     *  esta en otro (se rearmo o se activo uno nuevo mientras tanto), responde STALE_PANIC y nada cambia. */
    panic(engage: boolean, seenEpoch?: number): Promise<void>;
    private panicTokenEpoch;
    stop(): Promise<void>;
    /** seenEpoch: episodio de STOP confirmado; STALE_STOP si el motor ya esta en otro. */
    start(seenEpoch?: number): Promise<void>;
    private noteRamp;
    /** Confirmacion del operador tras una retencion de recuperacion (rampa de 2 s). */
    /** expectedRecoveries: numero de recuperaciones del dispositivo cuando el operador vio la retencion. */
    resume(expectedRecoveries?: number): Promise<void>;
    releaseForced(output: string): Promise<void>;
    status(): Promise<{
        [k: string]: Json;
    }>;
    private applyStatus;
    private applyHistory;
    /** Empieza un gesto continuo (arrastre): hasta endGesture, los cambios son UN paso de deshacer. */
    beginGesture(): void;
    endGesture(): void;
    /** Deshacer/rehacer el paso que el operador VIO (step; por defecto el de arriba segun este modelo).
     *  Revision 03-11: el motor exige expected_revision y step; si otra consola anadio un paso entretanto
     *  responde STALE_HISTORY y nada cambia. El motor lo rechaza tambien con PANIC activo. */
    undo(step?: number): Promise<{
        [k: string]: Json;
    }>;
    redo(step?: number): Promise<{
        [k: string]: Json;
    }>;
    private history_op;
    /** P6-control (#5): el motor se reinicio (los numeros de revision de antes ya no valen). Nada se aplico; la
     *  consola cierra la conexion: al reconectar lee de nuevo hello + get (resincronizacion completa). */
    private staleBoot;
    /** Suscripcion a los rechazos del motor (para anunciarlos de forma visible). */
    onReject(cb: (r: Rejection) => void): void;
    private reject;
    sceneList(): Promise<SceneList>;
    sceneStore(number: number, opts?: {
        name?: string;
        scope?: string[];
        overwrite?: boolean;
    }): Promise<SceneInfo>;
    /** Recupera una escena como UN lote atomico del motor. Revision 03-11: expectedRevision es la revision
     *  del diff que el operador confirmo (STALE_REVISION si cambio algo de su alcance despues) y sceneGen la
     *  generacion de la ranura que vio (STALE_SCENE si se guardo/renombro/cambio de alcance). */
    sceneRecall(number: number, opts?: {
        scope?: string[];
        expectedRevision?: number;
        sceneGen?: number;
    }): Promise<{
        [k: string]: Json;
    }>;
    sceneRename(number: number, name: string): Promise<void>;
    sceneSetScope(number: number, scope: string[]): Promise<void>;
    sceneDelete(number: number): Promise<void>;
    sceneDiff(number: number, scope?: string[]): Promise<SceneDiff>;
    /** Un control solo existe si el motor lo implementa. */
    control(path: string): ControlView;
    output(name: string): OutputState;
    onChange(cb: () => void): void;
    /** Pide un cambio. El valor del motor NO cambia hasta que el motor lo acepta. */
    set(path: string, value: ParamValue): Promise<void>;
    /** Pide varios cambios que viajan en UN mismo lote atomico (el motor los acepta todos o ninguno). */
    setMany(changes: ReadonlyArray<readonly [string, ParamValue]>): Promise<void>;
    private enqueue;
    private pump;
    private resync;
    private onEvent;
    private changed;
}
