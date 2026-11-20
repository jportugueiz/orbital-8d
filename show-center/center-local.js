(()=>{
// BENZAI · reproducción de cues con tiempos y tracking (15/11, auditoría «a la altura de una MA / Martin»).
// Lógica pura (sin DOM ni three): se prueba en tests/test_cue_playback.mjs.
//  · Tracking: un cue grabado con tracking guarda SOLO lo que cambió respecto del estado acumulado del cue anterior;
//    al reproducirlo se hereda todo lo demás (como en grandMA / Martin M-series).
//  · Tiempos: delay (espera antes de empezar) y fade (cruce). Intensidad, color, posición y ópticas cruzan suave;
//    gobo, relación y movimiento automático cambian al inicio. Un equipo que se apaga baja a 0 y recién al final queda apagado.
const NUMERIC_KEYS = ['level', 'pan', 'tilt', 'iris', 'zoom', 'focus', 'frost', 'speed', 'parAngle', 'parBearing'];
const TIMING_LIMITS = Object.freeze({ fade: [0, 600], delay: [0, 600] });

const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function clampTiming(t = {}) {
  const f = Number(t.fade), d = Number(t.delay);
  return { fade: Number.isFinite(f) ? Math.min(600, Math.max(0, f)) : 0, delay: Number.isFinite(d) ? Math.min(600, Math.max(0, d)) : 0 };
}
// Estado completo (por equipo) de cada cue de la lista, resolviendo el tracking en orden.
function trackedStates(cues) {
  const out = []; let acc = { fixtures: {}, master: 1, environment: undefined };
  for (const cue of cues) {
    const s = cue.state || {};
    const fixtures = s.tracked ? { ...acc.fixtures, ...clone(s.fixtures || {}) } : clone(s.fixtures || {});
    acc = { fixtures, master: typeof s.master === 'number' ? s.master : acc.master, environment: s.environment ? clone(s.environment) : acc.environment };
    out.push(clone(acc));
  }
  return out;
}
// Lo que cambió entre dos estados completos (solo equipos distintos).
function deltaFixtures(prev, now) {
  const d = {}; for (const [id, v] of Object.entries(now || {})) if (!prev || !same(prev[id], v)) d[id] = clone(v); return d;
}
const hex = (c) => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0xffffff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('');
function mixColor(a, b, k) { const A = hex(a), B = hex(b); return toHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k); }
// Valor de un equipo en la fracción k (0..1) del cruce.
function mixFixture(from, to, k) {
  if (!to) return from ? clone(from) : undefined;
  const a = from || { ...to, enabled: false, level: 0 };
  const out = { ...clone(to) };
  // «enabled» ausente = encendido (los estados del programador no siempre lo guardan; solo false apaga).
  const aOn = a.enabled !== false, bOn = to.enabled !== false;
  const aLevel = aOn ? (a.level ?? 0) : 0, bLevel = bOn ? (to.level ?? 0) : 0;
  for (const key of NUMERIC_KEYS) if (typeof to[key] === 'number') out[key] = typeof a[key] === 'number' ? a[key] + (to[key] - a[key]) * k : to[key];
  out.level = aLevel + (bLevel - aLevel) * k;
  if ('enabled' in to || 'enabled' in a) out.enabled = k >= 1 ? bOn : (bOn || aOn);
  if (k >= 1 && !bOn) out.level = to.level ?? 0;
  if (!bOn && k < 1) out.color = a.color || to.color; // apagándose: conserva su color hasta el negro
  else out.color = (aOn && a.color && to.color) ? mixColor(a.color, to.color, k) : (to.color ?? a.color);
  return out;
}
class CuePlayer {
  constructor() { this.active = false; this.paused = false; }
  // from: Map/obj de valores actuales; target: estado completo {fixtures, master, environment}; ahora en segundos.
  go({ from, fromMaster, fromEnvironment, target, timing, now, index }) {
    const t = clampTiming(timing);
    this.from = clone(from || {}); this.fromMaster = fromMaster; this.fromEnv = fromEnvironment ? clone(fromEnvironment) : null;
    this.target = clone(target); this.timing = t; this.start = now; this.pausedAt = null; this.pausedTotal = 0;
    this.active = true; this.paused = false; this.index = index; this.progress = 0;
  }
  pause(now) { if (!this.active) return; if (this.paused) { this.pausedTotal += now - this.pausedAt; this.pausedAt = null; this.paused = false; } else { this.pausedAt = now; this.paused = true; } }
  fraction(now) {
    const t = (this.paused ? this.pausedAt : now) - this.start - this.pausedTotal - this.timing.delay;
    if (t < 0) return 0; return this.timing.fade <= 0 ? 1 : Math.min(1, t / this.timing.fade);
  }
  // Devuelve {fixtures, master, environment, done} o null si no hay cruce activo.
  tick(now) {
    if (!this.active) return null;
    const k = this.fraction(now); this.progress = k;
    const ids = new Set([...Object.keys(this.from), ...Object.keys(this.target.fixtures || {})]);
    const fixtures = {};
    for (const id of ids) { const v = mixFixture(this.from[id], (this.target.fixtures || {})[id], k); if (v) fixtures[id] = v; }
    const master = typeof this.target.master === 'number' ? (typeof this.fromMaster === 'number' ? this.fromMaster + (this.target.master - this.fromMaster) * k : this.target.master) : this.fromMaster;
    let environment = this.target.environment;
    if (environment && this.fromEnv) environment = { haze: this.fromEnv.haze + (environment.haze - this.fromEnv.haze) * k, smoke: this.fromEnv.smoke + (environment.smoke - this.fromEnv.smoke) * k, house: environment.house };
    const done = k >= 1; if (done) this.active = false;
    return { fixtures, master, environment, done, k };
  }
}


const $ = selector => document.querySelector(selector);
const titles = {center:'Show Center',video:'Orbital Video',cam:'Orbital Cam',luces:'Orbital Luces'};
const labels = {video:'Video',cam:'Cámara',luces:'Luces'};
const clips = {portal:'Portal Orbital',impulso:'Impulso',cabina:'Cabina · ensayo',escenario:'Escenario · ensayo'};
const scenes = {
  ambiente:{name:'Ambiente',color:'#3fd8ff',level:.48,pan:-16,tilt:22,fade:2},
  subida:{name:'Subida',color:'#bd68ff',level:.70,pan:8,tilt:36,fade:1},
  drop:{name:'Drop',color:'#73fff0',level:1,pan:23,tilt:58,fade:.45},
  cierre:{name:'Cierre',color:'#ffae65',level:.40,pan:-8,tilt:18,fade:2}
};
const score = [
  {video:'portal',cam:'cabina',luces:'ambiente'},
  {video:'impulso',cam:'escenario',luces:'subida'},
  {video:'portal',cam:'escenario',luces:'drop'},
  {video:'impulso',cam:'cabina',luces:'cierre'}
];
const state = {
  draft:{...score[1]},live:{...score[0]},moment:'bar',following:false,pending:null,blackout:false,
  intensity:.76,transport:null,cueBeat:null,notice:'',native:false
};
const session = new URLSearchParams(location.search).get('session');
const validSession=/^[a-f\d-]{36}$/i.test(session||'');
const receiveLocal=event=>{
  if(event.source===window.opener&&event.origin==="null"&&event.data?.orbitalSession===session)
    channel.onmessage?.({data:event.data.payload});
};
const channel=!validSession?null:location.protocol==="file:"?(window.opener?{
  postMessage(payload){window.opener.postMessage({orbitalSession:session,payload},"*")},
  close(){removeEventListener("message",receiveLocal)}
}:null):new BroadcastChannel('orbital-show:'+session);
if(channel&&location.protocol==="file:")addEventListener("message",receiveLocal);
const send = data => channel?.postMessage(data);
const now = () => performance.timeOrigin + performance.now();
const safe = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const connected = () => !!state.transport && now()-state.transport.at<950;
const beatsAt = () => {
  const t=state.transport;
  return connected()&&t.playing?t.beats+(now()-t.at)*t.bpm/60000:null;
};
const media = new Map();
const localCameras = new Map();
const player = new CuePlayer();
let lights = scenes.ambiente;
let route, observedBeat=null, drawn = [], transportRequest=false, lastPaint=-Infinity;

function videoSource(id) {
  if(media.has(id))return media.get(id);
  const el=document.createElement('video');
  el.muted=true;el.loop=true;el.playsInline=true;el.preload='auto';
  if(localCameras.has(id))el.srcObject=localCameras.get(id).stream;
  else if(Object.hasOwn(clips,id))el.src='media/'+id+'.mp4';
  else return null;
  media.set(id,el);
  return el;
}
for(const id of Object.keys(clips))videoSource(id);
function updateSources() {
  const visible=state.native||document.hidden?new Set():new Set(drawn.flatMap(([canvas])=>{
    const {screen,bus}=canvas.dataset;
    return screen==='luces'?[]:[state[bus][screen]];
  }));
  for(const [id,source] of media){
    if(visible.has(id)&&source.paused)void source.play().catch(()=>{});
    else if(!visible.has(id)&&!source.paused)source.pause();
  }
}

function options(kind) {
  if(kind==='luces')return Object.entries(scenes).map(([id,o])=>[id,o.name]);
  if(state.native&&kind==='video')return (state.transport?.video?.media||[]).map(id=>[id,id]);
  if(state.native&&kind==='cam')return (state.transport?.cameras||[]).map(id=>[String(id),'Cámara '+id]);
  return kind==='video' ? [['portal',clips.portal],['impulso',clips.impulso]]
    : [['cabina',clips.cabina],['escenario',clips.escenario],...[...localCameras].map(([id,dev])=>[id,dev.name])];
}
const nameOf = (kind,id) => options(kind).find(([key])=>key===id)?.[1] || 'Sin señal';
function selectField(kind) {
  const items=options(kind),active=state.draft[kind];
  return `<label class="field">${labels[kind]}<select data-kind="${kind}">${items.some(([id])=>id===active)?'':'<option value="">Sin señal</option>'}
    ${items.map(([id,label])=>`<option value="${safe(id)}" ${id===active?'selected':''}>${safe(label)}</option>`).join('')}</select></label>`;
}
function monitor(kind,isLive,combined=false) {
  const set=isLive?state.live:state.draft;
  const status=isLive?'Programa':'Preview';
  const title=kind==='luces'&&isLive&&state.blackout?'Luces apagadas':nameOf(kind,set[kind]);
  const subtitle=combined?`${nameOf('cam',set.cam)} · ${state.blackout&&isLive?'Luces apagadas':nameOf('luces',set.luces)}`
    :state.native&&kind!=='luces'?'Salida del motor':kind==='cam'&&!localCameras.has(set.cam)?'Fuente de ensayo':'';
  return `<article class="monitor">
    <header class="line"><span class="${isLive?'live':'preview'}">${status}</span><small>${combined?'Show':labels[kind]}</small></header>
    <div class="stage"><canvas width="640" height="360" class="art" data-screen="${kind}" data-bus="${isLive?'live':'draft'}" aria-label="${status} ${labels[kind]}"></canvas>
      ${combined?`<canvas width="192" height="108" class="cam-inset" data-screen="cam" data-bus="${isLive?'live':'draft'}" aria-label="${status} Cámara"></canvas>`:''}
    </div>
    <footer class="line"><strong>${safe(title)}</strong><small>${safe(subtitle)}</small></footer>
  </article>`;
}
function transportControls(kind) {
  const moments=[['bar','Próximo compás'],['beat','Próximo tiempo'],['now','Ahora']];
  const name={all:'Ejecutar cue',video:'Enviar a Programa',cam:'Cortar a Programa',luces:'Activar escena'}[kind];
  return `<label class="field" for="moment">Ejecutar<select id="moment">${moments.map(([id,label])=>`<option value="${id}" ${state.moment===id?'selected':''}>${label}</option>`).join('')}</select></label>
  <button class="primary full" data-take="${kind}">${name}</button>
  <p class="notice" role="status">${safe(state.notice)} ${state.pending?'<button data-action="cancel">Cancelar cue</button>':''}</p>`;
}
function center() {
  return `<div class="grid">
   <div class="monitors">${monitor('video',false,true)}${monitor('video',true,true)}</div>
   <section class="panel"><h2>Próximo cue</h2>
     ${Object.keys(labels).map(selectField).join('')}
     <button class="full follow" data-action="follow" aria-pressed="${state.following}">${state.following?'Seguir música activo':'Seguir música'}</button>
     ${transportControls('all')}
   </section></div>
   <div class="cards">${Object.keys(labels).map(kind=>`<article class="card">
     <div class="line"><strong>${labels[kind]}</strong><a class="link" href="#${kind}">Abrir →</a></div>
     <p>${safe(nameOf(kind,state.live[kind]))}</p>
   </article>`).join('')}</div>`;
}
function station(kind) {
  const names={video:'Biblioteca de visuales',cam:'Fuentes de cámara',luces:'Escenas de luces'};
  return `<div class="grid">
    <div><div class="monitors">${monitor(kind,false)}${monitor(kind,true)}</div>
    ${kind==='luces'?'<p class="muted section-note">Escenario virtual · transiciones Benzai Lights R3</p>':''}</div>
    <section class="panel"><h2>${names[kind]}</h2>
    <div class="sources">${options(kind).map(([id,name])=>`<button class="scene" data-source="${safe(id)}" aria-pressed="${state.draft[kind]===id}">${safe(name)}</button>`).join('')}</div>
    ${kind==='cam'&&!state.native?`<label class="field controls" for="camera-device">Dispositivo<select id="camera-device"><option value="">Cámara predeterminada</option></select></label>
      <button class="full" data-action="camera">Conectar cámara local</button>`:''}
    ${kind==='luces'?`<label class="intensity" for="intensity">Intensidad <output id="level">${Math.round(state.intensity*100)}%</output></label>
      <input class="track" id="intensity" type="range" value="${Math.round(state.intensity*100)}" min="0" max="100">
      <button class="danger full controls" data-action="blackout" aria-pressed="${state.blackout}">${state.blackout?'Restaurar luces':'Apagar luces'}</button>`:''}
    ${kind!=='luces'&&state.transport?.native?`<button class="full controls" data-action="native" aria-pressed="${state.native}">${state.native?'Usar fuentes de ensayo':'Conectar salida Orbital'}</button>`:''}
    <div class="controls">${transportControls(kind)}</div></section></div>`;
}
function render() {
  const hash=location.hash.slice(1);
  route=Object.hasOwn(titles,hash)?hash:'center';
  document.title='Orbital · '+titles[route];
  for(const link of document.querySelectorAll('nav a')){
    if(link.hash==='#'+route)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  $('#stage').innerHTML=`<h1>${titles[route]}</h1>${route==='center'?center():station(route)}`;
  drawn=[...document.querySelectorAll('canvas[data-screen]')].map(canvas=>[canvas,canvas.getContext('2d')]);
  updateSources();
  if(route==='cam'&&!state.native)void devices();
}

function prepare(kind,id) {
  if(!options(kind).some(([valid])=>valid===id))return;
  state.draft[kind]=id;
  if(kind==='video'&&state.native)send({op:'native-preview',clip:id});
  render();
}
function commit(values,beat) {
  if(values.luces){
    const target=scenes[values.luces];
    const seconds=60/(state.transport?.bpm||125);
    player.go({from:{rig:lights},fromMaster:1,target:{fixtures:{rig:target},master:1},
      timing:{delay:0,fade:target.fade*seconds},now:performance.now()/1000});
  }
  if(state.native){
    send({op:'native-output',video:!!values.video,camera:values.cam});
    if(values.video)delete values.video;
    if(values.cam)delete values.cam;
  }
  Object.assign(state.live,values);
  state.pending=null;state.cueBeat=beat;
  state.notice=beat==null?'Cue ejecutado.':`Cue ejecutado · compás ${Math.floor(beat/4)+1}, tiempo ${beat%4+1}.`;
  render();
}
function queue(kind) {
  const values=kind==='all'?{...state.draft}:{[kind]:state.draft[kind]};
  if(state.native&&values.video!==undefined&&state.transport?.video?.preview!==values.video){
    state.notice='Prepara el visual y espera la confirmación de Orbital Video.';render();return;
  }
  if(state.moment==='now'){commit(values,null);return}
  const beat=beatsAt();
  if(beat===null||beat<0){state.notice='Pon la mezcla del DJ en Play para cuantizar.';render();return}
  const step=state.moment==='bar'?4:1;
  const target=(Math.floor(beat/step)+1)*step;
  state.pending={values,target};
  state.notice='Cue en cola · compás '+(Math.floor(target/4)+1)+', tiempo '+(target%4+1)+'.';
  render();
}

async function devices() {
  const select=$('#camera-device');
  if(!select||!navigator.mediaDevices)return;
  const list=await navigator.mediaDevices.enumerateDevices().catch(()=>[]);
  if(!select.isConnected)return;
  const saved=select.value;
  for(const item of list.filter(item=>item.kind==='videoinput'&&item.deviceId)){
    select.append(new Option(item.label||'Cámara '+select.options.length,item.deviceId));
  }
  if([...select.options].some(o=>o.value===saved))select.value=saved;
}
async function localCamera() {
  if(!navigator.mediaDevices)throw Error('La captura de cámara necesita el servidor local.');
  const device=$('#camera-device')?.value;
  const stream=await navigator.mediaDevices.getUserMedia({video:device?{deviceId:{exact:device}}:true,audio:false});
  const track=stream.getVideoTracks()[0],id='local-'+track.getSettings().deviceId;
  localCameras.get(id)?.stream.getTracks().forEach(t=>t.stop());
  media.delete(id);
  localCameras.set(id,{stream,name:track.label||'Cámara local'});
  videoSource(id);prepare('cam',id);
}

$('#stage').addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.dataset.take){queue(button.dataset.take);return}
  if(button.dataset.source){prepare(route,button.dataset.source);return}
  switch(button.dataset.action){
    case 'cancel': state.pending=null;state.notice='Cue cancelado.';render();break;
    case 'follow':
      state.following=!state.following;state.pending=null;
      state.notice=state.following?'Escenas cada dos compases de la mezcla.':'Seguimiento apagado.';
      render();break;
    case 'blackout': state.blackout=!state.blackout;render();break;
    case 'camera':
      button.disabled=true;
      void localCamera().catch(()=>{state.notice='Cámara sin acceso o sin señal.';render()});break;
    case 'native':
      state.native=!state.native;state.following=false;state.pending=null;
      if(state.native){
        send({op:'native-connect'});
        state.draft.video=state.transport?.video?.preview||'';
        state.live.video=state.transport?.video?.program||'';
        state.draft.cam=state.live.cam='';
        state.notice='Para fuentes Orbital Cam, abre su puente desde la consola DJ.';
      }else{
        Object.assign(state.draft,score[1]);Object.assign(state.live,score[0]);state.notice='';
      }
      render();break;
  }
});
$('#stage').addEventListener('change',event=>{
  if(event.target.id==='moment')state.moment=event.target.value;
  else if(event.target.dataset.kind)prepare(event.target.dataset.kind,event.target.value);
});
$('#stage').addEventListener('input',event=>{
  if(event.target.id!=='intensity')return;
  state.intensity=Number(event.target.value)/100;
  $('#level').value=event.target.value+'%';
});
$('#prepare-demo').onclick=()=>{
  transportRequest=true;$('#prepare-demo').disabled=true;
  send({op:'demo'});
};
$('#transport').onclick=()=>send({op:'play'});
if(channel){
  channel.onmessage=({data})=>{
    if(data?.op==='notice'){
      transportRequest=false;state.notice=data.text;render();return;
    }
    if(data?.op!=='transport')return;
    const previous=state.transport;
    const jumped=previous?.playing&&data.playing&&(
      previous.source!==data.source||previous.bpm!==data.bpm||
      Math.abs(data.beats-previous.beats-(data.at-previous.at)*data.bpm/60000)>.7);
    if(jumped||previous?.playing&&!data.playing){
      observedBeat=null;
      if(state.pending){state.pending=null;state.notice='Cue cancelado por cambio en el transporte.';render()}
    }
    state.transport=data;
    if(state.native){
      const before=JSON.stringify([previous?.video,previous?.cameras,previous?.cameraProgram]);
      if(before!==JSON.stringify([data.video,data.cameras,data.cameraProgram])){
        state.live.video=data.video?.program||'';
        state.live.cam=data.cameraProgram?String(data.cameraProgram):'';
        render();
      }
    }else if(data.native!==previous?.native)render();
    if(data.loaded)transportRequest=false;
  };
  send({op:'hello'});
  setInterval(()=>send({op:'hello'}),1500);
}

function drawLights(canvas,g,set,bus,beat) {
  const {width:w,height:h}=canvas;
  const newLook=bus==='live'?lights:scenes[set.luces];
  const pulse=bus==='live'&&beat!=null?Math.exp(-((beat%1+1)%1)*7):0;
  const power=bus==='live'&&state.blackout?0:state.intensity*newLook.level*(.72+.28*pulse);
  if(!power){g.fillStyle='#03070a';g.fillRect(0,0,w,h);return}
  if(stagePhoto.complete&&stagePhoto.naturalWidth){
    g.globalAlpha=.55;g.drawImage(stagePhoto,0,0,w,h);g.globalAlpha=1;
  }
  g.globalCompositeOperation='screen';
  for(let i=0;i<7;i++){
    const x=w*(.12+i*.126),y=h*.87;
    const center=x+(newLook.pan-10*(i-3)+25*Math.sin((beat??0)*.25+i*.9))*w/130;
    const top=h*(.18-newLook.tilt/400),spread=w*(.02+.028*power);
    const beam=g.createLinearGradient(x,y,center,top);
    beam.addColorStop(0,newLook.color);beam.addColorStop(1,'transparent');
    g.fillStyle=beam;g.globalAlpha=.58*power;
    g.beginPath();g.moveTo(x-3,y);g.lineTo(center-spread,top);g.lineTo(center+spread,top);g.lineTo(x+3,y);g.closePath();g.fill();
    g.globalAlpha=power;g.fillStyle=newLook.color;g.fillRect(x-4,y,8,3);
  }
  g.globalAlpha=1;g.globalCompositeOperation='source-over';
}
const stagePhoto=new Image();stagePhoto.src='media/escenario-r03.jpg';
function frame() {
  const beat=beatsAt(),whole=beat===null?null:Math.floor(beat);
  if(whole!==null&&whole>=0&&whole!==observedBeat){
    const advanced=observedBeat===null||whole>observedBeat;
    observedBeat=whole;
    if(advanced&&state.pending&&whole>=state.pending.target)commit(state.pending.values,state.pending.target);
    else if(advanced&&state.following&&whole%8===0){
      const look={...score[Math.floor(whole/8)%score.length]};
      if(state.native){delete look.video;delete look.cam;}
      commit(look,whole);
    }
  }
  requestAnimationFrame(frame);
  const ms=performance.now();
  if(ms-lastPaint<32)return;
  lastPaint=ms;
  const result=player.tick(ms/1000);
  if(result)lights=result.fixtures.rig;
  for(const [canvas,g] of drawn){
    const {screen,bus}=canvas.dataset, set=state[bus];
    g.fillStyle='#060c13';g.fillRect(0,0,canvas.width,canvas.height);
    if(screen==='luces'){drawLights(canvas,g,set,bus,beat);continue}
    const source=state.native?null:videoSource(set[screen]);
    if(source?.readyState>=2){g.drawImage(source,0,0,canvas.width,canvas.height);continue}
    g.fillStyle='#adc0cc';g.textAlign='center';g.font='14px system-ui';
    g.fillText(state.native?'Retorno del motor no disponible':'Sin señal',canvas.width/2,canvas.height/2);
  }
  const ready=connected(),t=state.transport;
  $('#connection').textContent=ready?'DJ conectado':channel?'Esperando DJ':'Abre desde DJ';
  $('#transport-source').textContent=ready&&t.source!=='dj-8d'?'Deck '+t.source:'Transporte DJ';
  $('#prepare-demo').hidden=!ready||!t.canDemo||t.loaded||t.playing;
  $('#prepare-demo').disabled=transportRequest||!!t?.loading;
  $('#transport').hidden=!ready||!t.canDemo||!t.loaded;
  $('#transport').textContent=t?.playing?'Pausa DJ':'Play DJ';
  $('#bpm').textContent=ready?`${Number(t.bpm.toFixed(2))} BPM`:'';
  $('#position').textContent=whole!==null&&whole>=0?`Compás ${Math.floor(whole/4)+1} · Tiempo ${whole%4+1}`:ready?'En pausa':'Sin reloj';
  document.querySelectorAll('.beats i').forEach((el,i)=>el.classList.toggle('on',whole!==null&&whole%4===i));
}
window.addEventListener('hashchange',render);
document.addEventListener('visibilitychange',updateSources);
window.addEventListener('pagehide',()=>{channel?.close();for(const item of localCameras.values())item.stream.getTracks().forEach(track=>track.stop())});
if(!channel)state.notice='Abre Show Center desde la consola DJ para recibir su reloj.';
render();requestAnimationFrame(frame);

})();