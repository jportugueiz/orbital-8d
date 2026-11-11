/** Deterministic local assistance. This module only returns proposals; it never edits state. */
import {retrieveEngineeringKnowledge,SCHOOL_VERSION} from './engineer-school.js';
const METHOD = 'Análisis local basado en reglas';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const db = value => value === -Infinity ? -120 : finite(value) ? clamp(value, -120, 24) : null;
const valueOr = (value, fallback) => finite(value) ? value : fallback;
const normalized = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const label = (channel, index) => typeof channel?.name === 'string' && channel.name.trim() ? channel.name.trim() : `Canal ${index + 1}`;
const decibels = value => value === null ? 'sin medición' : `${value.toFixed(1)} dBFS`;
const channelMeter = (telemetry, index) => {
  const item = telemetry?.channels?.[index];
  return { peak: db(item?.peak), rms: db(item?.rms), gr: finite(item?.gr) ? Math.max(0, item.gr) : null, signalActive: item?.signalActive, tap: item?.tap };
};
const activeMeter = meter => meter.peak !== null && meter.peak > -80 && meter.signalActive !== false;
const hasSource = channel => channel?.source !== null && typeof channel?.source === 'object';
const sendLevel = send => finite(send) ? send : finite(send?.level) ? send.level : -90;
const routeCritical = path => ['master', 'buses', 'matrices', 'dcas'].includes(path[0]) ||
  (path[0] === 'channels' && ['sends', 'main', 'mute', 'solo', 'source'].includes(path[2]));
const measurementEvidence = meter => `Pico de muestra ${decibels(meter.peak)}; RMS ${decibels(meter.rms)}. ${meter.tap === 'orbital-input' ? 'Lectura de entrada de voz, antes del render espacial y del fader.' : 'Medidor de canal después del proceso y antes del fader.'}`;
const BUS_NUMBERS = { un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, 'treinta y uno': 31, 'treinta y dos': 32 };
const BUS_PATTERN = new RegExp(`\\b(?:aux(?:iliar)?|bus|monitor)\\s*(?:numero\\s*)?(\\d+|${Object.keys(BUS_NUMBERS).sort((a, b) => b.length - a.length).map(word => word.replace(/ /g, '\\s+')).join('|')})\\b`);

export function stereoWindow(left,right){
  if(!left?.length||left.length!==right?.length)return null;
  let l=0,r=0,cross=0;
  for(let i=0;i<left.length;i++){
    if(!finite(left[i])||!finite(right[i]))return null;
    l+=left[i]**2;
    r+=right[i]**2;
    cross+=left[i]*right[i];
  }
  const power=(l+r)/left.length/2;
  if(power<1e-8||Math.min(l,r)/left.length<1e-8)return null;
  return {correlation:clamp(cross/Math.sqrt(l*r),-1,1),
    monoLossDb:10*Math.log10(Math.max(1e-12,(l+r+2*cross)/(2*(l+r))))};
}

function instrumentIntent(query) {
  if (/\b(voz|voces|vocal|vocales|cantante)\b/.test(query)) return { kind: 'vocal', match: /vocal|voz|voces|cantante/ };
  if (/guitarr|\bguitar\b/.test(query)) return { kind: 'guitar', match: /guitarr|guitar/ };
  if (/\bbombo\b|\bkick\b/.test(query)) return { kind: 'kick', match: /bombo|kick/ };
  return null;
}

function resolveTargets(channels, index, query) {
  const explicit = query.match(/\b(?:canal|channel|ch)\s*(\d+)\b/);
  if (explicit) {
    const requested = Number(explicit[1]) - 1;
    return requested >= 0 && requested < channels.length ? [requested] : [];
  }
  if (Number.isInteger(index) && index >= 0 && index < channels.length) return [index];
  const intent = instrumentIntent(query);
  if (intent) return channels.flatMap((channel, at) => intent.match.test(normalized(channel.name)) ? [at] : []).slice(0, 4);
  return channels.flatMap((channel, at) => hasSource(channel) ? [at] : []);
}

function narrowMasterPeak(telemetry) {
  const master = telemetry?.master;
  const spectrum = master?.spectrum;
  if (!(Array.isArray(spectrum) || ArrayBuffer.isView(spectrum)) || spectrum.length < 32 || spectrum.length > 8192) return null;
  const sampleRate = telemetry?.sampleRate;
  const fftSize = master?.fftSize;
  if (!finite(sampleRate) || sampleRate <= 0 || !finite(fftSize) || fftSize < spectrum.length * 2) return null;
  let best = null;
  for (let index = 6; index < spectrum.length - 6; index++) {
    const level = spectrum[index];
    const frequency = index * sampleRate / fftSize;
    if (!finite(level) || level < -65 || frequency < 80 || frequency > 12000 || level < spectrum[index - 1] || level < spectrum[index + 1]) continue;
    const neighbours = [-6, -5, -4, 4, 5, 6].map(offset => spectrum[index + offset]).filter(finite).sort((a, b) => a - b);
    if (neighbours.length !== 6) continue;
    const contrast = level - (neighbours[2] + neighbours[3]) / 2;
    if (contrast >= 15 && (!best || contrast > best.contrast)) best = { frequency, level, contrast };
  }
  return best;
}

/**
 * Input meters use dBFS, floor -120. Channel meter tap: post-processing/pre-fader.
 * Output shape is deliberately simple so the UI can review and validate each change.
 */
export function analyzeMix(state, telemetry, { channelIndex = null, query = '' } = {}) {
  const channels = Array.isArray(state?.channels) ? state.channels : [];
  const buses = Array.isArray(state?.buses) ? state.buses : [];
  const input = normalized(query).trim().replace(/^genius\b[\s,:]+/, '').slice(0, 2000);
  const lessons=retrieveEngineeringKnowledge(input,{limit:6});
  const creative=lessons.filter(lesson=>lesson.id.startsWith('orbital-')).slice(0,3);
  const findings = [];
  const ids = new Set();
  const add = (id, severity, at, title, evidence, explanation, changes = [], critical = false) => {
    if (ids.has(id)) return;
    ids.add(id);
    findings.push({ id, severity, channelIndex: at, title, evidence, explanation, changes, critical: Boolean(critical || severity === 'critical' || changes.some(change => routeCritical(change.path))) });
  };
  const result = (title = 'Revisión de la mezcla', summary = '') => ({
    title,
    summary: summary || `${findings.length} ${findings.length === 1 ? 'observación' : 'observaciones'}. Las propuestas están pendientes de revisión; no se ha aplicado ningún cambio.`,
    findings,
    method: METHOD,
    education:{version:SCHOOL_VERSION,weightsTrained:false,context:lessons}
  });

  if (/^(que es|explica|explicame|como funciona|que significa|define)\b/.test(input) && !/compres|compress/.test(input)) {
    const lessons=retrieveEngineeringKnowledge(input,{limit:2});
    if(lessons.length){for(const lesson of lessons)add('school-'+lesson.id,'info',null,lesson.title,
      lesson.citations.map(s=>`${s.title}: ${s.url}`).join(' · '),`${lesson.principle} ${lesson.formula}. Práctica requerida: ${lesson.practical}`);
      return result('Conocimiento de ingeniería con fuentes','Respuesta documental de la biblioteca BENZAI. No implica medición, entrenamiento de pesos ni cambios en el audio.');}
  }

  const addCreativeLessons=()=>{
    for(const lesson of creative)add('school-'+lesson.id,'info',null,lesson.title,
      lesson.citations.map(source=>source.url).join(' · '),`${lesson.principle} ${lesson.practical}`);
  };

  const stereo=telemetry?.master?.stereo;
  if (finite(stereo?.correlation) && finite(stereo?.monoLossDb) && stereo.correlation<-.5 && stereo.monoLossDb<-6) {
    add('stereo-fold','warning',null,'Revisar el plegado a mono',
      `Correlación ${stereo.correlation.toFixed(2)}. RMS de la suma mono ${stereo.monoLossDb.toFixed(1)} dB respecto al RMS combinado L/R en esta ventana.`,
      'Comprueba si se pierde el elemento central en varias secciones. No invierto polaridad ni estrecho el estéreo automáticamente. Una ventana breve no evalúa todo el viaje.');
  }
  if (!channels.length) {
    addCreativeLessons();
    add('no-session', 'info', null, 'No hay canales para analizar', 'La sesión no contiene canales.', 'Carga o crea una sesión antes de solicitar ajustes.');
    return result('Esperando una sesión');
  }

  const targets = resolveTargets(channels, channelIndex, input);
  const assigned = channels.flatMap((channel, index) => hasSource(channel) ? [index] : []);
  const anySignal = channels.some((_, index) => activeMeter(channelMeter(telemetry, index)));
  const masterPeak = db(telemetry?.master?.peak);
  const master = state?.master || {};
  const orbital=state?.context==='orbital';
  if(/lufs|loudness|true peak|dbtp/.test(input)&&finite(telemetry?.master?.momentaryLufs)&&telemetry.master.momentaryLufs>-70){
    add('momentary-loudness','info',null,'Sonoridad momentánea de salida',
      `${telemetry.master.momentaryLufs.toFixed(1)} LUFS en la ventana de 400 ms del motor.`,
      'Para juzgar toda la pieza, mide sonoridad integrada y true peak sobre el render completo.');
  }

  if (/explic|como|que hace|que es/.test(input) && /compres|compress/.test(input)) {
    const at = targets[0] ?? 0;
    const comp = channels[at]?.comp || {};
    const meter = channelMeter(telemetry, at);
    const threshold = clamp(valueOr(comp.threshold, -18), -90, 0);
    const ratio = clamp(valueOr(comp.ratio, 3), 1, 20);
    const attack = clamp(valueOr(comp.attack, 10), 0.1, 500);
    const release = clamp(valueOr(comp.release, 100), 5, 5000);
    add('explain-compressor', 'info', at, `Compresor de ${label(channels[at], at)}`,
      `Estado: ${comp.enabled ? 'activo' : 'bypass'}; umbral ${threshold} dBFS; ratio ${ratio}:1; ataque ${attack} ms; release ${release} ms.${meter.gr === null ? '' : ` Reducción medida: ${meter.gr.toFixed(1)} dB.`}`,
      `Por encima del umbral, un ratio ${ratio}:1 reduce el aumento de nivel: idealmente ${ratio} dB de exceso pasan a 1 dB de exceso tras la compresión. El ataque determina cuánto tarda en actuar y el release cuánto tarda en recuperar. Un ataque más lento puede conservar transitorios. El resultado depende de la señal, la rodilla y el detector; no sube el nivel por sí solo. No propongo cambios para una consulta explicativa.`);
    return result('Entender el compresor', 'Explicación de los parámetros actuales. No se han propuesto ni aplicado cambios.');
  }

  if (master.mute === true) add('master-mute', 'critical', null, 'El master está silenciado', 'master.mute = true.', 'Los medidores de canal están antes del fader: pueden mostrar actividad aunque la salida principal esté silenciada. Quitar el mute puede emitir audio; revisa la salida antes de aprobarlo.', [{ path: ['master', 'mute'], value: false }]);
  if (finite(master.fader) && master.fader <= -90) add('master-fader-off', 'critical', null, 'El fader master está abajo', `Fader master: ${master.fader} dB.`, 'No propongo un salto de nivel de salida sin una referencia de escucha. Ajusta gradualmente el master después de revisar destino y niveles.');
  if (masterPeak !== null && masterPeak > -1) {
    const changes = finite(master.fader) ? [{ path: ['master', 'fader'], value: clamp(master.fader - 3, -90, 10) }] : [];
    add('master-headroom', 'critical', null, 'Margen de salida reducido', `Pico real del master: ${decibels(masterPeak)}, después del fader y limitador.`, 'La muestra se aproxima a escala completa. Propongo reducir 3 dB el master como medida revisable; esta instantánea no demuestra saturación del convertidor ni informa de picos intersample.', changes);
  }
  addCreativeLessons();

  if (!assigned.length) add('no-input', 'info', null, 'Todavía no hay fuentes asignadas', `${channels.length} canales lógicos; ninguna fuente asignada.`, 'Asigna un archivo, una señal de prueba o una entrada real. El nombre de un canal no demuestra que exista señal de ese instrumento.');

  for (const at of targets) {
    const channel = channels[at] || {};
    const name = label(channel, at);
    const meter = channelMeter(telemetry, at);
    if (!hasSource(channel)) {
      add(`channel-${at}-no-source`, 'warning', at, `${name}: falta una fuente`, 'source = null; no hay una fuente asignada a este canal.', 'Asigna o vuelve a cargar una fuente antes de ajustar ganancia, tono o dinámica. No se deduce el instrumento de una señal inexistente.');
      continue;
    }
    if (channel.mute === true) add(`channel-${at}-mute`, 'warning', at, `${name} está silenciado`, `Mute activado. ${measurementEvidence(meter)}`, 'El mute explica que este canal no se escuche por sus rutas silenciadas. Su medidor puede seguir activo porque está antes del fader/mute. Desilenciar requiere revisar la escucha.', [{ path: ['channels', at, 'mute'], value: false }], true);
    if (finite(channel.fader) && channel.fader <= -90) add(`channel-${at}-fader-off`, 'warning', at, `${name}: fader abajo`, `Fader: ${channel.fader} dB. ${measurementEvidence(meter)}`, 'Un medidor activo antes del fader no implica nivel en la mezcla. Sube el fader de forma gradual después de comprobar la ruta.');
    const sends = Array.isArray(channel.sends) ? channel.sends : [];
    if (channel.main === false && !sends.some(send => sendLevel(send) > -90)) add(`channel-${at}-unrouted`, 'warning', at, `${name} no tiene una ruta de mezcla abierta`, 'Main desactivado y todos los envíos están a −∞.', 'La fuente puede tener señal y no llegar a ningún bus de mezcla. La propuesta abre su asignación al master; comprueba destino y nivel antes de aprobarla.', [{ path: ['channels', at, 'main'], value: true }], true);
    if (Number.isInteger(channel.dca)) {
      const dca = state?.dcas?.[channel.dca];
      if (dca?.mute === true) add(`dca-${channel.dca}-mute`, 'warning', at, `${name} depende de un DCA silenciado`, `${dca.name || `DCA ${channel.dca + 1}`}: mute activado.`, 'Cambiar este mute afecta a todos los canales asociados al DCA. Revisa el grupo completo antes de aprobarlo.', [{ path: ['dcas', channel.dca, 'mute'], value: false }], true);
    }
    if (!activeMeter(meter)) {
      add(`channel-${at}-no-signal`, 'info', at, `${name}: no hay señal medida utilizable`, measurementEvidence(meter), 'La fuente consta en la sesión, pero esta lectura no demuestra audio activo. Comprueba reproducción, dispositivo, permiso y conexión. No propongo subir nivel ni diagnostico espectro o instrumento con este dato.');
      continue;
    }
    if (meter.peak > -1) {
      const trim = valueOr(channel.trim, 0);
      add(`channel-${at}-headroom`, 'warning', at, `${name}: riesgo de clipping`, measurementEvidence(meter), 'El pico está a menos de 1 dB de escala completa en el punto medido. Propongo reducir 3 dB el trim digital. Eso no puede reparar una entrada analógica ya saturada; revisa también la fuente.', [{ path: ['channels', at, 'trim'], value: clamp(trim - 3, -24, 24) }]);
    } else if (meter.rms !== null && meter.rms < -45 && meter.peak > -80 && !channel.mute) {
      const gain = valueOr(channel.gain, 0);
      const next = clamp(gain + 3, -24, 60);
      const preserve=orbital||creative.length>0;
      add(`channel-${at}-low-level`, 'info', at, `${name}: nivel medio bajo`, measurementEvidence(meter),
        preserve?'Puede ser una pausa, un fundido o una fuente suave. Compara el pasaje con su contexto antes de cambiar la ganancia.':'El RMS está por debajo de −45 dBFS y hay pico medido. La propuesta de ganancia digital necesita revisión.',
        preserve||next===gain?[]:[{ path: ['channels', at, 'gain'], value: next }]);
    }
    if (meter.gr !== null && meter.gr > 10) add(`channel-${at}-compression`, 'info', at, `${name}: compresión intensa en esta lectura`, `Reducción de ganancia medida: ${meter.gr.toFixed(1)} dB.`, 'La lectura es instantánea. Escucha y observa su evolución antes de cambiar el umbral o la relación; no se concluye que haya compresión excesiva durante todo el pasaje.');
  }

  const busMatch = input.match(BUS_PATTERN);
  const busIndex = busMatch ? (BUS_NUMBERS[busMatch[1].replace(/\s+/g, ' ')] ?? Number(busMatch[1])) - 1 : null;
  if (busMatch) {
    const bus = buses[busIndex];
    if (!bus) add('bus-missing', 'warning', null, 'No existe ese bus en la sesión', `Solicitud: ${busMatch[0]}.`, 'Selecciona un bus disponible antes de proponer un envío.');
    else {
      const busName = bus.name || `Aux ${busIndex + 1}`;
      const routed = channels.flatMap((channel, index) => sendLevel(channel?.sends?.[busIndex]) > -90 ? [index] : []);
      if (bus.mute) add(`bus-${busIndex}-mute`, 'warning', null, `${busName} está silenciado`, 'Mute de bus activado.', 'Este cambio afecta a toda la mezcla del bus. Comprueba el destino físico o de escucha antes de desilenciar.', [{ path: ['buses', busIndex, 'mute'], value: false }], true);
      if (finite(bus.fader) && bus.fader <= -90) add(`bus-${busIndex}-fader-off`, 'warning', null, `${busName}: fader abajo`, `Fader del bus: ${bus.fader} dB.`, 'No se propone un salto de nivel de monitor sin referencia de escucha.');
      const focused = targets.length === 1 ? targets[0] : null;
      if (focused !== null && hasSource(channels[focused])) {
        const send = channels[focused]?.sends?.[busIndex];
        const level = sendLevel(send);
        if (level <= -90) {
          const path = finite(send) ? ['channels', focused, 'sends', busIndex] : ['channels', focused, 'sends', busIndex, 'level'];
          add(`channel-${focused}-bus-${busIndex}`, 'info', focused, `${label(channels[focused], focused)} no se envía a ${busName}`, 'Envío a −∞.', 'Puedo proponer un envío inicial bajo de −24 dB. Abrirlo cambia el ruteo y puede emitir audio en un monitor; revisa el bus y su salida antes de aprobarlo.', [{ path, value: -24 }], true);
        } else add(`channel-${focused}-bus-${busIndex}`, 'info', focused, `Envío a ${busName} configurado`, `Nivel de envío: ${level.toFixed(1)} dB; ${send?.pre ? 'pre-fader' : 'post-fader'}.`, 'Este dato confirma la configuración del envío. No confirma que el monitor físico esté conectado, encendido o libre de acople.');
      } else add(`bus-${busIndex}-routing`, 'info', null, `Ruteo de ${busName}`, `${routed.length} canales tienen envíos por encima de −∞; fader de bus ${valueOr(bus.fader, 0)} dB.`, 'Selecciona un canal para revisar su envío concreto. No se crea una ruta desde una consulta ambigua.');
    }
  }

  if (/feedback|realiment|acople|pitido|silbido/.test(input)) {
    const tone = anySignal ? narrowMasterPeak(telemetry) : null;
    const bus = buses[busIndex];
    const changes = anySignal && bus && finite(bus.fader) && bus.fader > -90 ? [{ path: ['buses', busIndex, 'fader'], value: clamp(bus.fader - 3, -90, 10) }] : [];
    add('feedback-review', tone ? 'warning' : 'info', null, tone ? 'Pico estrecho sospechoso en el master' : 'No puedo confirmar realimentación',
      tone ? `FFT real del master: pico cerca de ${Math.round(tone.frequency)} Hz, ${tone.level.toFixed(1)} dBFS, contraste local ${tone.contrast.toFixed(1)} dB.` : anySignal ? 'No hay evidencia espectral individual y temporal suficiente para identificar un acople.' : 'No hay señal activa medida para evaluar la consulta.',
      `Un tono musical también puede producir un pico estrecho. La FFT disponible pertenece al master y una instantánea no identifica persistencia, bucle acústico ni el monitor ${busMatch ? busIndex + 1 : 'de origen'}. No propongo un notch por canal.${changes.length ? ' Puedes revisar una reducción de 3 dB del bus solicitado como prueba controlada de escucha.' : ''}`, changes, changes.length > 0);
  }

  const intent = instrumentIntent(input);
  const styleRequest = intent && (/atras|detras|baj|sub|adelante|presen|brill|agud|oscura|pegada|punch|ataque/.test(input));
  if (styleRequest) {
    if (!targets.length) add('style-target-missing', 'info', null, 'Necesito un canal identificado', 'No encuentro una etiqueta de canal que coincida con tu petición.', 'Selecciona el canal o cambia su etiqueta. No identifico instrumentos a partir del nombre de la consulta.');
    for (const at of targets) {
      const channel = channels[at];
      const meter = channelMeter(telemetry, at);
      if (!hasSource(channel) || !activeMeter(meter) || channel.mute || master.mute || valueOr(channel.fader, -90) <= -90 || meter.peak > -1) continue;
      const name = label(channel, at);
      const identity = `Referencia tomada de la etiqueta «${name}»; no es una clasificación de audio. ${measurementEvidence(meter)}`;
      if (!intent.match.test(normalized(channel.name))) {
        add(`channel-${at}-label-mismatch`, 'info', at, 'La etiqueta seleccionada no coincide con la petición', identity, 'Confirma el canal antes de aplicar una propuesta específica de voz, guitarra o bombo.');
        continue;
      }
      if (intent.kind === 'vocal') {
        const fader = valueOr(channel.fader, -6);
        const amount = Math.max(0, Math.min(1.5, -3 - meter.peak, 10 - fader));
        // A low-level gain proposal is already present: do not stack a second level increase.
        const gainAlreadyProposed = findings.some(finding => finding.id === `channel-${at}-low-level` && finding.changes.length);
        const changes = !gainAlreadyProposed && !creative.length && amount > 0 && (masterPeak === null || masterPeak <= -3) ? [{ path: ['channels', at, 'fader'], value: clamp(fader + amount, -90, 10) }] : [];
        add(`channel-${at}-vocal-presence`, 'info', at, 'Propuesta gradual para la voz', identity,
          changes.length ? 'Según tu descripción de una voz atrás, propongo subir hasta 1.5 dB el fader y comparar escuchando. No he medido inteligibilidad, masking ni distancia de la voz. La suma del resto de canales puede consumir margen adicional.' : gainAlreadyProposed ? 'Ya hay una propuesta de ganancia de hasta 3 dB para este nivel bajo; no acumulo otra subida de fader. Comprueba primero esa lectura y escucha el balance.' : 'El margen observado no justifica aumentar el fader en esta lectura. Revisa el balance con el resto de fuentes antes de elevarla.', changes);
      }
      if (intent.kind === 'guitar') {
        const bands = Array.isArray(channel.eq) ? channel.eq : [];
        const bandIndex = bands.reduce((best, band, index) => finite(band?.freq) && band.freq >= 3000 && (best < 0 || band.freq > bands[best].freq) ? index : best, -1);
        const band = bands[bandIndex];
        const changes = band && finite(band.gain) ? [{ path: ['channels', at, 'eq', bandIndex, 'gain'], value: clamp(band.gain - 1.5, -24, 24) }] : [];
        if (changes.length && band.enabled === false) changes.push({ path: ['channels', at, 'eq', bandIndex, 'enabled'], value: true });
        add(`channel-${at}-guitar-brightness`, 'info', at, 'Ajuste de agudos a partir de tu descripción', identity,
          `No hay espectro individual de este canal para comprobar brillo ni exceso de agudos. ${changes.length ? `Como prueba estilística, propongo reducir 1.5 dB la banda existente en ${Math.round(band.freq)} Hz, conservando frecuencia, tipo y Q. Compara y revierte si pierde definición.` : 'Revisa la EQ escuchando; no hay una banda de agudos válida para proponer un cambio acotado.'}`, changes);
      }
      if (intent.kind === 'kick') {
        const comp = channel.comp || {};
        const changes = comp.enabled ? [{ path: ['channels', at, 'comp', 'attack'], value: clamp(Math.max(valueOr(comp.attack, 10), 20), 0.1, 500) }] : [
          { path: ['channels', at, 'comp', 'enabled'], value: true },
          { path: ['channels', at, 'comp', 'threshold'], value: clamp(meter.peak - 8, -30, -6) },
          { path: ['channels', at, 'comp', 'ratio'], value: 2 },
          { path: ['channels', at, 'comp', 'attack'], value: 25 },
          { path: ['channels', at, 'comp', 'release'], value: 100 }
        ];
        add(`channel-${at}-kick-punch`, 'info', at, 'Prueba de compresión para conservar ataque', identity,
          'Tu petición orienta una prueba de ataque más lento y compresión moderada, sin makeup gain. No he medido la envolvente ni confirmado una falta de pegada. Escucha en contexto y revisa la reducción de ganancia antes de conservar el ajuste.', changes);
      }
    }
  }

  if (!findings.length) add('no-issue', 'info', null, 'Sin incidencias en estas lecturas', `${assigned.length} fuentes asignadas; ${anySignal ? 'hay señal medida' : 'no hay señal activa medida'}.`, 'No se detectan mutes, rutas cerradas ni niveles fuera de los umbrales revisados. Esta revisión no certifica calidad sonora, dispositivos externos ni ausencia de feedback. Selecciona un canal o concreta qué quieres ajustar.');
  return result(input ? 'Análisis de tu consulta' : 'Revisión de la mezcla');
}
