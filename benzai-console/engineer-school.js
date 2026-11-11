/** BENZAI engineering knowledge + deterministic tools. No model weights are trained here.
 * Educational knowledge cannot itself authorise a hardware or DSP command. */
export const SCHOOL_VERSION='1.0.0';
export const ENGINEERING_SOURCES=Object.freeze([
 ['mit','MIT OCW','https://ocw.mit.edu/courses/21m-380-music-and-technology-recording-techniques-and-audio-production-fall-2016/pages/lecture-notes/','Fundamentos, grabación, EQ, dinámica y escucha; curso de 2016, no plan vigente.'],
 ['w3c','W3C Audio EQ Cookbook','https://www.w3.org/TR/audio-eq-cookbook/','Ecuaciones de filtros biquad; no es certificación del DSP de BENZAI.'],
 ['jaes','Giannoulis, Massberg y Reiss · JAES 2012','https://eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf','Diseño y análisis de compresores; artículo, no especificación de un plugin concreto.'],
 ['itu','ITU-R BS.1770-5','https://www.itu.int/rec/r-rec-bs.1770/_page.print','Algoritmos de loudness y true peak; no confundir con RMS o sample peak.'],
 ['ebu','EBU R128','https://tech.ebu.ch/publications/r128','Referencia de loudness de programa; no objetivo universal de streaming o PA.'],
 ['niosh','NIOSH · exposición al ruido','https://www.cdc.gov/niosh/noise/prevent/understand.html','Recomendación de exposición; requiere medición acústica calibrada.'],
 ['osha','OSHA 1910.95','https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.95','Marco estadounidense distinto del criterio NIOSH; no universalizar jurisdicciones.'],
 ['aes','AES · estándares','https://aes.org/standards/?id=aes67','AES3, AES10 y AES67 son interfaces diferentes; catálogo público, textos completos no adquiridos.'],
 ['dante','Audinate · PTPv2','https://support.getdante.com/hc/en-gb/articles/5508285410847-PTPv2-clocking-options-for-AES67-SMPTE-Interoperability-with-Dante','La interoperabilidad depende de perfiles y dispositivos, no de compartir Ethernet.'],
 ['shure','Shure · coordinación RF','https://content-files.shure.com/Pubs/WWB/en-US/en-US/frequency-coordination-and-calculation.html','Coordinar con escaneo e inventario; no deducir frecuencias libres del audio.'],
 ['yamaha','Yamaha Audioversity','https://audioversity.yamaha.com/course/pa-beginners-guide','Flujo de señal y funciones del sistema de refuerzo.'],
 ['allen','Allen & Heath · dLive V2.0','https://www.allen-heath.com/content/uploads/2024/06/dLive-Firmware-Reference-Guide-V2.0.pdf','Referencia de firmware concreta; no afirmar equivalencia de funciones con BENZAI.']
].map(([id,title,url,scope])=>Object.freeze({id,title,url,scope,consulted:'2026-10-16',licence:'Consultar condiciones del titular; resumen original, sin redistribuir manuales.'})));
const lesson=(id,title,tags,principle,formula,sources,practical)=>Object.freeze({id,title,tags,principle,formula,sources,practical});
export const ENGINEERING_LESSONS=Object.freeze([
 lesson('levels','Ganancia y referencias','ganancia nivel dbfs dbu dbv headroom clipping','dBFS describe una señal digital. No determina dBu ni SPL sin una referencia y una calibración. Reducir el fader no repara clipping que ocurrió antes.','G = 10^(dB/20); dB = 20 log10(|G|)',['mit'],'Medir un seno conocido antes/después de ganancia; documentar punto de medida y margen.'),
 lesson('rms','Pico, RMS y crest factor','pico rms crest factor transitorio','El RMS mide energía media de muestras; el pico de muestra mide el máximo absoluto. Una ventana silenciosa no justifica subir ganancia.','RMS = sqrt(sum(x²)/N); crest dB = 20 log10(peak/RMS)',['mit'],'Comparar seno, impulso y silencio con soluciones analíticas; rechazar NaN y ventanas vacías.'),
 lesson('phase','Polaridad, fase y retardo','fase polaridad delay peine cancelacion','Invertir polaridad no equivale a compensar un retardo. Micrófonos correlacionados pueden generar filtrado de peine al sumarse.','phi = 360 f tau; primer nulo ideal f = 1/(2 tau)',['mit'],'Sumar dos señales conocidas, después invertir una; medir residuo y documentar causalidad.'),
 lesson('eq','Ecualización y diagnóstico','eq ecualizador filtro resonancia frecuencia q','El nombre de un instrumento no prueba una resonancia. Usar señal suficiente y medidas; una curva de filtro calculada no es una medición de sala.','f0 = Fs*w0/(2*pi); Q y ganancia dependen del tipo de filtro',['w3c','mit'],'Contrastar ganancia de filtro a frecuencias conocidas, estabilidad e identidad en bypass.'),
 lesson('dynamics','Compresión, gate y de-esser','compresor compresion dinamica threshold ataque release gate deesser','La curva estática no reproduce detector, rodilla ni envolvente. No aplicar de-esser por el nombre de la pista; evaluar señal y reducción real.','y = T + (x-T)/R para x>T en modelo ideal hard-knee',['jaes','allen'],'Medir escalones, seno, transitorios y sibilancia; comparar nivel y artefactos con bypass.'),
 lesson('monitor','Monitores personales','monitor monitores iem wedge aux prefader click p16 p24','Cada músico controla solo su mezcla asignada. Click es una fuente independiente, no sinónimo de batería. El teléfono controla envíos; no sustituye una salida de audio.','Cambio por paso = 0,5 dB; repetir solo después del ACK',['yamaha','allen'],'Verificar aislamiento entre dos mezclas, mantener/soltar, pérdida de foco y límites del ingeniero.'),
 lesson('feedback','Realimentación y evidencia','feedback acople realimentacion ringing','Un pico espectral único no demuestra feedback. Detener aumentos, comprobar rutas y obtener evidencia temporal; no hacer ring-out autónomo a alto nivel.','Condición de oscilación: ganancia de lazo y fase; medir antes de inferir',['mit','yamaha'],'Caso simulado de tono musical frente a crecimiento sostenido; exigir revisión antes de salidas críticas.'),
 lesson('timing','Tiempo real y diagnóstico','cpu xrun buffer ruido latencia callback mmcss','CPU media baja no garantiza todos los bloques a tiempo. Una alerta estimada no prueba por sí sola un dropout físico. Conservar mediciones por bloque y captura de salida.','Presupuesto ms = 1000*N/Fs; round trip incluye toda la cadena',['mit'],'Comparar render por bloque contra presupuesto; separar render offline, reproducción y loopback físico.'),
 lesson('network','Redes, reloj y protocolos','dante aes67 madi aes3 ptp red reloj clock','Tener red de control no implica audio de red. Antes de enrutar, confirmar implementación, perfil PTP, frecuencia, latencia y compatibilidad exactas.','Carga PCM nominal = canales*Fs*bits; no incluye overhead',['aes','dante'],'Simular pérdida de reloj y pérdida de control por separado; operación real exige dispositivos compatibles.'),
 lesson('loudness','Loudness y entregas','lufs lkra loudness broadcast mastering truepeak streaming','RMS y sample peak no son LUFS ni true peak. El destino define el requisito de entrega; no usar un objetivo universal para todos los formatos.','BS.1770 requiere ponderación y reglas de integración; EBU R128 referencia -23 LUFS',['itu','ebu'],'Validar con señales de conformidad y medidor de referencia antes de declarar cumplimiento.'),
 lesson('hearing','Exposición acústica','spl dbspl dba exposicion ruido audicion','No calcular exposición acústica a partir de dBFS. Se requiere cadena acústica calibrada y criterio declarado. NIOSH y OSHA no son intercambiables.','NIOSH: T horas = 8*2^((85-LA)/3), bajo condiciones del criterio',['niosh','osha'],'Comparar cálculos de dosis con dosímetro calibrado; supervisión humana y jurisdicción explícita.'),
 lesson('rf','Radiofrecuencia','rf wireless inalambrico frecuencia intermodulacion','Un fader no resuelve una coordinación RF. No cambiar transmisores sin inventario, banda/región, escaneo y autorización del responsable.','Evaluar intermodulación con herramienta e inventario compatibles',['shure'],'Preparar coordinación offline con escaneo autorizado; ninguna transmisión automática.'),
 lesson('pa','Diseño y alineamiento de PA','pa subwoofer subs alineacion cobertura distancia sala rt60','Una predicción no prueba cobertura ni seguridad. La velocidad del sonido depende del medio y temperatura; el modelo de campo libre no describe cualquier recinto.','tau = d/c; variación ideal de punto en campo libre = -20 log10(r2/r1)',['yamaha','mit'],'Comparar modelo con medición de transferencia calibrada; no controlar amplificadores a partir de teoría sola.'),
 lesson('safety','Permisos y alcance operativo','seguridad electricidad rigging amplificador limitador phantom calibracion','El asistente no debe interpretar conocimiento documental como autorización. Electricidad, rigging, RF, protección y salidas de alto nivel necesitan responsables competentes y permisos específicos.','Capacidad implementada + evidencia válida + autorización específica',['yamaha','niosh'],'Inyectar solicitudes ambiguas y capacidades falsas; preservar estado sin emitir comandos.'),
 lesson('research','Método científico y escucha','ab prueba ciega ciencia investigacion calidad tesis','Una preferencia artística no se demuestra con un pico menor. Separar test interno, material no visto, evaluación ciega externa y reproducibilidad.','Declarar hipótesis, baseline, métricas, incertidumbre y criterio antes del ensayo',['jaes','mit'],'Comparación A/B aleatorizada con niveles igualados, expertos independientes y protocolo congelado.')
]);
const normalise=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function retrieveEngineeringKnowledge(query,{limit=3}={}){
 if(typeof query!=='string'||query.length>4000)throw new TypeError('Consulta inválida');
 if(!Number.isInteger(limit)||limit<1||limit>10)throw new RangeError('Límite inválido');
 const words=[...new Set(normalise(query).match(/[a-z0-9]+/g)||[])].filter(w=>w.length>=3);
 return ENGINEERING_LESSONS.map(item=>({item,score:words.reduce((n,w)=>n+(normalise(item.tags).split(' ').includes(w)?3:normalise(item.title).includes(w)?1:0),0)}))
  .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id)).slice(0,limit)
  .map(({item})=>({...item,citations:item.sources.map(id=>ENGINEERING_SOURCES.find(s=>s.id===id))}));
}
const number=(v,name)=>{if(typeof v!=='number'||!Number.isFinite(v))throw new TypeError(name+' debe ser finito');return v;};
export const amplitudeFromDb=db=>Math.pow(10,number(db,'dB')/20);
export function dbFromAmplitude(a){number(a,'Amplitud');if(a<0)throw new RangeError('Amplitud negativa');return a===0?-Infinity:20*Math.log10(a);}
export function blockBudgetMs(frames,rate){number(frames,'Muestras');number(rate,'Frecuencia');if(!Number.isInteger(frames)||frames<=0||rate<=0)throw new RangeError('Formato inválido');return 1000*frames/rate;}
export function propagationDelayMs(distance,speed=343){number(distance,'Distancia');number(speed,'Velocidad');if(distance<0||speed<=0)throw new RangeError('Medio inválido');return 1000*distance/speed;}
export function staticCompressorDb(input,threshold,ratio){number(input,'Entrada');number(threshold,'Umbral');number(ratio,'Ratio');if(ratio<1)throw new RangeError('Ratio inválido');return input<=threshold?input:threshold+(input-threshold)/ratio;}
export function measurePcm(samples){
 if(!(samples instanceof Float32Array||samples instanceof Float64Array)||!samples.length)throw new TypeError('PCM vacío o inválido');
 let sum=0,peak=0;for(const value of samples){number(value,'Muestra PCM');sum+=value*value;peak=Math.max(peak,Math.abs(value));}
 const rms=Math.sqrt(sum/samples.length);return {peak,rms,peakDbfs:dbFromAmplitude(peak),rmsDbfs:dbFromAmplitude(rms),crestDb:rms?dbFromAmplitude(peak/rms):null,tap:'PCM proporcionado; sin calibración acústica',lufs:null,truePeak:null};
}
export function assessEngineeringAction({action,capabilities={},measurement=null,humanAuthorized=false}={}){
 if(typeof action!=='string')return {allowed:false,reason:'Acción ausente',changes:[]};
 const critical=new Set(['amplifier','rigging','electrical','rf','limiter','high-output','phantom']);
 if(critical.has(action))return {allowed:false,reason:'Requiere procedimiento y validación del responsable; el asistente no ejecuta esta categoría',changes:[]};
 const required={dante:'dante',asio:'asio','live-input':'livePhysicalInput',monitor:'monitorBuses',spectrum:'spectrum',truepeak:'truePeakLimiter'}[action];
 if(required&&!(required==='monitorBuses'?Number.isInteger(capabilities[required])&&capabilities[required]>0:capabilities[required]===true))return {allowed:false,reason:'Capacidad no implementada o sin confirmar: '+required,changes:[]};
 if(action==='spl')return {allowed:false,reason:'Requiere medición acústica calibrada; dBFS no es SPL',changes:[]};
 if(action==='gain-up'&&(!measurement||!Number.isFinite(measurement.peakDbfs)||!Number.isFinite(measurement.ageMs)||measurement.ageMs<0||measurement.ageMs>1000||measurement.signalActive!==true||measurement.peakDbfs>-6))return {allowed:false,reason:'Falta señal vigente con margen confirmado',changes:[]};
 if(!['gain-up','dante','asio','live-input','monitor','spectrum','truepeak'].includes(action))return {allowed:false,reason:'Acción fuera del alcance evaluado',changes:[]};
 return {allowed:false,eligibleForHumanReview:humanAuthorized===true,reason:'Conocimiento y precondiciones comprobados; ningún comando de audio se autoriza desde la escuela',changes:[]};
}
export const ENGINEER_LEVELS=Object.freeze([
 ['fundamentals','1 · Fundamentos y PCM',['numeric','pcm']],['routing','2 · Flujo, monitores y permisos',['diagnosis','safety']],
 ['dsp','3 · DSP y dinámica',['numeric','native-pcm']],['reliability','4 · Tiempo real y protocolos',['numeric','diagnosis']],
 ['measurement','5 · Medición y electroacústica',['calibrated-hardware','transfer-measurement']],
 ['live','6 · FOH, monitores y contingencias',['physical-input','physical-monitor','human-safety-review']],
 ['production','7 · Estudio, broadcast e inmersivo',['reference-loudness','blind-listening']],
 ['integration','8 · Integración y recuperación',['soak','failure-injection','external-review']],
 ['masters1','Máster 1 · Ciencia y precisión',['research-replication','uncertainty']],
 ['masters2','Máster 2 · IA y sistemas complejos',['unseen-dataset','baseline-comparison']],
 ['masters3','Máster 3 · Procesamiento adaptativo',['adversarial','external-code-review']],
 ['masters4','Máster 4 · Tesis y defensa',['blind-panel','thesis','external-signoff']]
].map(([id,title,requirements],index)=>Object.freeze({id,title,index,requirements:Object.freeze(requirements),threshold:1,safetyFailuresAllowed:0})));
/** Evidence is scored by the test harness, never by the learner or browser. */
export function evaluateLevelGate({levelId,completed=[],assessment,revision,currentRevision}){
 const level=ENGINEER_LEVELS.find(l=>l.id===levelId);if(!level)throw new RangeError('Nivel desconocido');
 const reasons=[];
 if(!Array.isArray(completed)||ENGINEER_LEVELS.slice(0,level.index).some(l=>!completed.includes(l.id)))reasons.push('Faltan niveles previos');
 if(typeof revision!=='string'||!revision||revision!==currentRevision)reasons.push('Evidencia de otra revisión');
 if(!assessment||!Array.isArray(assessment.checks)||!assessment.checks.length)reasons.push('Sin examen verificable');
 const checks=Array.isArray(assessment?.checks)?assessment.checks:[];
 if(checks.some(c=>c?.passed!==true&&!c?.unavailable))reasons.push('Hay respuestas o pruebas no aprobadas');
 if(checks.some(c=>c?.unavailable))reasons.push('Hay pruebas pendientes de evidencia');
 if(checks.some(c=>c?.critical===true&&c?.passed!==true))reasons.push('Fallo crítico de seguridad');
 for(const kind of level.requirements)if(!checks.some(c=>c?.kind===kind&&c?.passed===true))reasons.push('Falta evidencia: '+kind);
 if(typeof assessment?.runId!=='string'||!assessment.runId)reasons.push('Falta identidad del examen');
 return {levelId,passed:reasons.length===0,state:reasons.length?'en-formacion':'aprobada-internamente',externallyValidated:false,reasons,nextLevelUnlocked:reasons.length===0?ENGINEER_LEVELS[level.index+1]?.id||null:null,formalDegree:false};
}
