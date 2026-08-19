/* Service worker de la versión nueva. Caché propia: no toca la de la app en uso. */
const CACHE = "almacen-nuevo-v1";
const ARCHIVOS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).catch(()=>{}));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(x => x !== CACHE && x.indexOf("almacen-nuevo-") === 0).map(x => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if(e.request.method !== "GET") return;
  e.respondWith(fetch(e.request)
    .then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)).catch(()=>{}); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
