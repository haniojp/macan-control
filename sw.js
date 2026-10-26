'use strict';
// Limit cleanup to this app: other GitHub Pages projects share the origin.
const PREFIX='macan-control-';
const CACHE=PREFIX+'v8';
const FILES=['./','./index.html','./styles.css','./app.js','./session.js','./api.js','./manifest.webmanifest','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
 const asset=FILES.includes('./'+url.pathname.slice(new URL(self.registration.scope).pathname.length));
 if(event.request.mode!=='navigate'&&!asset)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
  return response;
 }).catch(async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request);if(cached)return cached;if(event.request.mode==='navigate')return cache.match('./index.html');throw Error('Offline');}));
});
