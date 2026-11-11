import {PARAMS, SCHEMA_VERSION} from "./dist/generated/params.js";

const orbital = window.parent === window ? null : window.parent.ORBITAL_BENZAI;
const CHANNEL_COUNT = 32;
const BOOT = "orbital-benzai";
const patterns = new Set(["ch.{i}.name", "ch.{i}.fader_db", "ch.{i}.comp.on", "ch.{i}.fx.1.level_db", "main.level_db"]);
const supported = PARAMS.filter(p => patterns.has(p.pattern) || p.pattern === "ch.{i}.fx.{f}.level_db")
  .map(({pattern,min,max})=>({pattern,min,max}));
let revision = 0, previous = {}, timer = null, page = 0, pager;
const send = value => window.__benzaiLine?.(JSON.stringify(value));
const output = snapshot => snapshot.playing ? "open" : "silent";
const flags = snapshot => ({stop: !snapshot.playing});
const reverbDb = amount => amount > 0 ? Math.max(-144, 20 * Math.log10(amount)) : -144;

function parameters(snapshot) {
  page=Math.min(page,Math.max(0,Math.ceil(snapshot.channels.length/CHANNEL_COUNT)-1));
  const params = {"main.level_db":snapshot.master};
  for(let i=0;i<CHANNEL_COUNT;i++){
    const source=snapshot.channels[page*CHANNEL_COUNT+i], prefix="ch."+(i+1)+".";
    params[prefix+"name"]=source?.name||"";
    params[prefix+"fader_db"]=source?.volume??-144;
    params[prefix+"comp.on"]=(source?.compression??0)>0;
    params[prefix+"fx.1.level_db"]=reverbDb(source?.reverb??0);
  }
  return params;
}

function publish(snapshot) {
  const params=parameters(snapshot);
  if(pager){
    const pages=Math.max(1,Math.ceil(snapshot.channels.length/CHANNEL_COUNT));
    pager.root.hidden=pages<2;
    pager.prev.disabled=page===0;
    pager.next.disabled=page+1>=pages;
    const label=`Pistas ${page*CHANNEL_COUNT+1}–${Math.min((page+1)*CHANNEL_COUNT,snapshot.channels.length)} · ${page+1}/${pages}`;
    if(pager.label.textContent!==label)pager.label.textContent=label;
  }
  const changes=Object.entries(params).filter(([path,value])=>previous[path]!==value)
    .map(([path,value])=>({path,value}));
  if(changes.length){
    previous=params;
    revision++;
    send({event:"changed",revision,changes});
    send({event:"applied",revision});
  }
  send({event:"flags",...flags(snapshot)});
  for(const name of ["main_l","main_r"])send({event:"effective",output:name,state:output(snapshot)});
  send({event:"meters",frame:Math.round(snapshot.time*snapshot.rate),
    peak_dbfs:{main_l:snapshot.peaks[0],main_r:snapshot.peaks[1]},
    ch_peak_dbfs:snapshot.channels.slice(page*CHANNEL_COUNT,(page+1)*CHANNEL_COUNT).map(s=>s.meter.peak)});
  const show=document.getElementById("show-name");
  if(show&&show.textContent!==snapshot.name)show.textContent=snapshot.name;
  showGenius(snapshot.genius,snapshot.geniusAction);
}

function command(change){
  if(change.path==="main.level_db"&&Number.isFinite(change.value))
    return {property:"master",value:change.value};
  const match=/^ch\.(\d+)\.(fader_db|comp\.on|fx\.1\.level_db)$/.exec(change.path);
  if(!match)throw new Error("Ese control queda a cargo de ORBITAL.");
  const slot=Number(match[1]);
  if(slot<1||slot>CHANNEL_COUNT)throw new Error("Número de pista inválido.");
  const channel=page*CHANNEL_COUNT+slot-1, key=match[2], value=change.value;
  if(key==="comp.on"&&typeof value==="boolean")return {channel,property:"comp",value:value?.5:0};
  if(typeof value!=="number"||!Number.isFinite(value))throw new Error("Valor de pista inválido.");
  if(key==="fx.1.level_db")return {channel,property:"reverb",value:value<=-144?0:Math.pow(10,value/20)};
  if(key==="fader_db")return {channel,property:"fader",value};
  throw new Error("Valor de compresión inválido.");
}

window.benzaiHostConnect=async()=>!!orbital;
window.benzaiHostClose=()=>{clearInterval(timer);timer=null};
window.benzaiHostSend=line=>{
  const request=JSON.parse(line);
  const {id,op}=request;
  try{
    const snapshot=orbital.snapshot();
    let result;
    if(op==="hello")result={protocol:1,schema_version:SCHEMA_VERSION,edition:CHANNEL_COUNT,
      rate:snapshot.rate,revision,boot_id:BOOT,backend:"orbital",flags:flags(snapshot),implemented_params:supported,
      ops:["hello","get","status","subscribe","set","stop"],client_id:1};
    else if(op==="subscribe"){
      clearInterval(timer);
      timer=setInterval(()=>publish(orbital.snapshot()),160);
      result={};
    }else if(op==="get"){
      previous=parameters(snapshot);
      result={revision,params:previous};
    }else if(op==="status")result={revision,flags:flags(snapshot),effective:{main_l:output(snapshot),main_r:output(snapshot)}};
    else if(op==="scene.list")result={scenes:[],current:null};
    else if(op==="set"){
      if(request.boot_id!==BOOT||request.valid_until_ms<Date.now())throw new Error("La orden ya no está vigente.");
      orbital.apply(request.changes.map(command));
      publish(orbital.snapshot());
      result={revision,state:"ACCEPTED"};
    }else if(op==="stop"){orbital.stop();result={}}
    else throw new Error("Operación disponible desde el transporte de ORBITAL.");
    send({id,ok:true,result});
  }catch(error){send({id,ok:false,error:{code:"ORBITAL_CONTROL",message:error.message}})}
};

let reviewList=null,shownReview,shownAction;
function showGenius(review,action){
  if(!reviewList||review===shownReview&&action===shownAction)return;
  shownReview=review;shownAction=action;
  const lines=review?[review.titulo,...review.observaciones.slice(0,6).map(s=>s.title+". "+s.evidence)]:
    ["Pídele a IAH que revise la mezcla. Aquí aparecerá el informe de Genius."];
  if(action)lines.unshift(action);
  reviewList.replaceChildren(...lines.map(line=>{const item=document.createElement("li");item.textContent=line;return item}));
}
if(orbital){
  const root=document.createElement("div"),label=document.createElement("span");
  root.hidden=true;root.setAttribute("aria-label","Páginas de pistas");
  root.style.cssText="position:fixed;right:12px;bottom:12px;z-index:31;padding:6px;background:#161e27;color:#f0f4fa;border:1px solid #657c92;border-radius:8px";
  const button=(text,delta)=>{
    const b=document.createElement("button");b.type="button";b.textContent=text;
    b.onclick=()=>{page=Math.max(0,page+delta);publish(orbital.snapshot())};
    return b;
  };
  const prev=button("Anterior",-1),next=button("Siguiente",1);
  root.append(prev,label,next);document.body.append(root);pager={root,prev,next,label};
  const panel=document.createElement("details");
  panel.style.cssText="position:fixed;left:12px;bottom:12px;z-index:30;width:min(540px,90vw);padding:10px;background:#161e27;color:#f0f4fa;border:1px solid #657c92;border-radius:8px";
  const heading=document.createElement("summary");heading.textContent="Genius · revisión solicitada por IAH";
  reviewList=document.createElement("ul");reviewList.style.cssText="max-height:36vh;overflow:auto";
  panel.append(heading,reviewList);document.body.append(panel);
  const mix=orbital.snapshot();showGenius(mix.genius,mix.geniusAction);
}
