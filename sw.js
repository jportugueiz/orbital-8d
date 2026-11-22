/* ORBITAL · service worker para uso sin conexión. Versión 7c7b95f9c71c (la pone build.py).
   - La página se pide primero a la red (así GitHub Pages actualiza normal); sin red, usa la copia guardada.
   - Canciones y sonidos ya escuchados se guardan para volver a sonar sin conexión. */
const V="7c7b95f9c71c",SHELL="orbital-shell-"+V,MEDIA="orbital-media-v1";
const CORE=["./","index.html","benzai-strip.js","orbital-spatial-worklet.js","orbital-spatial.wasm"];
const MEDIA_RE=/\/(audio-web|musica|sonidos[^/]*|fonts|inst|visuales|fondos_8d)\//;
self.addEventListener("install",e=>{e.waitUntil(caches.open(SHELL).then(c=>Promise.all(CORE.map(u=>c.add(u).catch(()=>null)))))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("orbital-shell-")&&k!==SHELL).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("message",e=>{if(e.data==="orbital-sw-skip")self.skipWaiting();
  else if(e.data&&e.data.type==="orbital-cache-media"&&Array.isArray(e.data.urls))e.waitUntil(keepMedia(e.data.urls))});
// Canción de Sound Healing ya escuchada: la página manda la lista de sus trozos y aquí se guardan los que falten (2 a la vez).
async function keepMedia(urls){
  const c=await caches.open(MEDIA),todo=[];
  for(const u of urls.slice(0,4000)){try{const url=new URL(u,self.registration.scope);if(url.origin===location.origin&&MEDIA_RE.test(url.pathname))todo.push(url.href)}catch(_){}}
  let i=0;const worker=async()=>{while(i<todo.length){const u=todo[i++];try{if(await c.match(u))continue;const r=await fetch(u);if(r.ok&&r.status===200&&!r.headers.get("content-type")?.includes("text/html"))await c.put(u,r)}catch(_){}}};
  await Promise.all([worker(),worker()]);
}
async function networkFirst(req){
  const c=await caches.open(SHELL);
  try{const r=await fetch(req);if(r.ok&&r.status===200)c.put(req,r.clone());return r}
  catch(err){const hit=await c.match(req,{ignoreSearch:true})||await c.match("index.html");if(hit)return hit;throw err}
}
async function cacheFirst(req){
  const c=await caches.open(MEDIA),hit=await c.match(req);if(hit)return hit;
  const r=await fetch(req);if(r.ok&&r.status===200&&!r.headers.get("content-type")?.includes("text/html"))c.put(req,r.clone()).catch(()=>{});return r;
}
async function stale(req){
  const c=await caches.open(SHELL),hit=await c.match(req);
  const net=fetch(req).then(r=>{if(r.ok&&r.status===200)c.put(req,r.clone()).catch(()=>{});return r}).catch(()=>hit);
  return hit||net;
}
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET"||req.headers.has("range"))return;
  const url=new URL(req.url);if(url.origin!==location.origin)return;
  if(req.mode==="navigate"||/\/(index\.html)?$/.test(url.pathname))return e.respondWith(networkFirst(req));
  if(MEDIA_RE.test(url.pathname))return e.respondWith(cacheFirst(req));
  e.respondWith(stale(req));
});
