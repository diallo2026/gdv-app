// AGV Service Worker v9 - Pass-through, no cache for HTML
const CACHE_NAME = 'agv-cache-v9';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Supprimer TOUS les anciens caches
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(key => {
        console.log('SW: suppression cache', key);
        return caches.delete(key);
      }));
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Ne rien mettre en cache - toujours aller sur le réseau
  // Cela garantit que le dernier fichier déployé est toujours servi
  event.respondWith(
    fetch(event.request).catch(() => {
      // Fallback offline seulement si réseau indisponible
      return new Response('App hors ligne', { status: 503 });
    })
  );
});
