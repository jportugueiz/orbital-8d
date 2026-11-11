const CTRL = "__benzai_transport";
let wvListening = false;
let wvPending = null;
let wvCurrent = null;
class HostTransport {
    sendFn;
    closeFn;
    lineCbs = [];
    closeCbs = [];
    dead = false;
    constructor(sendFn, closeFn = () => { }) {
        this.sendFn = sendFn;
        this.closeFn = closeFn;
    }
    send(line) {
        if (!this.dead)
            this.sendFn(line);
    }
    onLine(cb) {
        this.lineCbs.push(cb);
    }
    onClose(cb) {
        this.closeCbs.push(cb);
    }
    close() {
        // Cierre pedido por la consola (p. ej. el motor no respondio a tiempo): tambien se cierra la
        // conexion del host con el motor, para que nada de lo enviado por ella pueda aplicarse despues.
        if (!this.dead) {
            try {
                this.closeFn();
            }
            catch {
                /* el host ya no existe */
            }
        }
        this.closed();
    }
    deliver(line) {
        if (!this.dead)
            for (const cb of this.lineCbs)
                cb(line);
    }
    closed() {
        if (this.dead)
            return;
        this.dead = true;
        for (const cb of this.closeCbs)
            cb();
    }
}
/** Intenta abrir un transporte hacia el motor. Devuelve null si no hay host o el motor no responde. */
export async function connectTransport() {
    const w = window;
    if (typeof w.benzaiHostConnect === "function" && typeof w.benzaiHostSend === "function") {
        const ok = await w.benzaiHostConnect();
        if (!ok)
            return null;
        const send = w.benzaiHostSend;
        const hostClose = w.benzaiHostClose;
        const t = new HostTransport((l) => send(l), () => hostClose?.());
        w.__benzaiLine = (l) => t.deliver(l);
        w.__benzaiClosed = () => t.closed();
        return t;
    }
    const wv = w.chrome?.webview;
    if (wv) {
        if (!wvListening) {
            // Un unico receptor para toda la vida de la pagina (las reconexiones no acumulan receptores).
            wvListening = true;
            wv.addEventListener("message", (e) => {
                const d = e.data;
                if (typeof d !== "string")
                    return;
                if (d === `${CTRL}:open` || d === `${CTRL}:fail`) {
                    const r = wvPending;
                    wvPending = null;
                    if (r)
                        r(d === `${CTRL}:open`);
                }
                else if (d === `${CTRL}:closed`) {
                    wvCurrent?.closed();
                    wvCurrent = null;
                }
                else {
                    wvCurrent?.deliver(d);
                }
            });
        }
        const t = new HostTransport((l) => wv.postMessage(l), () => {
            if (wvCurrent === t)
                wvCurrent = null;
            wv.postMessage(`${CTRL}:disconnect`);
        });
        const ok = await new Promise((resolve) => {
            wvPending = resolve;
            setTimeout(() => {
                if (wvPending === resolve) {
                    wvPending = null;
                    resolve(false);
                }
            }, 3000);
            wv.postMessage(`${CTRL}:connect`);
        });
        if (!ok)
            return null;
        wvCurrent = t;
        return t;
    }
    return null;
}
