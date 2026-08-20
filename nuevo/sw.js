/* =====================================================================
   Este archivo no guarda nada: se borra a sí mismo.

   En esta carpeta vivió antes otra versión de la app, con un service
   worker que guardaba la página en el equipo. Los celulares y las
   computadoras que la abrieron siguen con ese trabajador registrado, y
   sin señal servirían la página vieja de su caché aunque en el servidor
   ya esté la nueva.

   Borrar el archivo del servidor no alcanza: el navegador conserva el
   que ya tenía. Hay que darle uno nuevo que se dé de baja, y eso es
   esto. Cuando el navegador lo recoja —lo busca solo al abrir la
   página—, tira su caché, se desregistra y recarga las pestañas
   abiertas. Después de eso la carpeta queda sin service worker.
   ===================================================================== */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for(const k of await caches.keys()){
      if(k.indexOf("almacen-nuevo-") === 0) await caches.delete(k);
    }
    await self.registration.unregister();
    for(const c of await self.clients.matchAll({type:"window"})) c.navigate(c.url);
  })());
});
