// AGV SW v29
const C='agv-v29';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./index.html','./manifest.json'])));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==C).map(n=>caches.delete(n)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  if(e.request.url.includes('firebase')||e.request.url.includes('googleapis'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){caches.open(C).then(ca=>ca.put(e.request,r.clone()));}return r;}).catch(()=>caches.match(e.request)));
});
