/* Service worker — Almacén CPQ (Mina Columbito)
   Guarda la app en el celular y la abre SIN señal, pero SIEMPRE trae la
   version mas nueva cuando hay internet. Cambiar CACHE en cada despliegue
   para que nadie se quede con una version vieja. */
const CACHE = 'almacen-cpq-v20260812u';
const SHELL = ['./', './index.html', './computadora.html', './celular.html', './estilos.css', './pantallas.js', './app.js', './computadora.js', './celular.js', './config.js', './sync.js', './fotos.js', './heic2any.min.js', './manifest.json',
               './icon-192.png', './icon-512.png', './formatos/FORMATO DE REQUERIMIENTO.xlsx'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  /* CacheStorage se comparte por DOMINIO con las otras paginas de
     luisfc-collab.github.io. Solo se borran los caches propios. */
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (k) { return k !== CACHE && k.indexOf('almacen-cpq-') === 0; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var url = e.request.url;

  /* Lo que va a Supabase NUNCA se cachea: es data viva. */
  if (url.indexOf('supabase.co') >= 0 || e.request.method !== 'GET') return;

  /* La app y sus piezas: primero la red (para traer la version nueva),
     el cache solo como red de seguridad cuando no hay señal. */
  e.respondWith(
    fetch(e.request)
      .then(function (r) {
        if (r && r.ok) {
          var copia = r.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copia); });
        }
        return r;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
