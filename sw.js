/* ============================================================
   App AGV — Service Worker
   Version : incrementer AGV_VERSION a chaque redeploiement.

   [CORRECTIF] La version n'avait jamais ete incrementee depuis la
   toute premiere installation de ce service worker, alors que
   index.html a ete redeploye de nombreuses fois entre-temps.
   Consequence : le navigateur compare le SW installe octet par
   octet a chaque verification, et comme sw.js lui-meme n'avait
   pas change, AUCUNE mise a jour du service worker n'a jamais ete
   detectee — meme quand index.html changeait cote serveur. Le
   telephone restait donc controle par un service worker installe
   il y a longtemps, avec sa propre copie de la page mise en cache
   au tout premier lancement.

   [14/08/2026] Version passee a agv-v3-20260814 pour le
   deploiement du nouvel espace concepteur (module v4). Le
   changement de AGV_VERSION suffit : sw.js differe octet par
   octet, le nouveau service worker s'installe, les caches des
   versions precedentes sont effaces a l'activation.

   Regles importantes :
   - Firebase (base de donnees) n'est JAMAIS mis en cache ni intercepte.
     Les donnees des boutiques passent toujours par le reseau reel.
   - Les requetes non-GET ne sont jamais interceptees.
   - La page est servie "reseau d'abord" : en ligne = toujours la
     derniere version deployee ; hors ligne = derniere version connue.
   - index.html n'est PLUS precache a l'installation (voir plus bas) :
     ainsi, meme si cette version du fichier n'est jamais re-editee,
     aucune copie figee de la page ne peut plus jamais s'installer
     "pour de bon" au premier lancement puis y rester bloquee.
   ============================================================ */

var AGV_VERSION = 'agv-v16-20260816';
var SHELL_CACHE = AGV_VERSION + '-shell';
var RUNTIME_CACHE = AGV_VERSION + '-runtime';

/* [CORRECTIF] index.html retire de la precache d'installation.
   Il est desormais mis en cache UNIQUEMENT par le gestionnaire de
   navigation ci-dessous, a chaque chargement reussi — jamais figé
   a une version unique datant de l'installation du service worker. */
var SHELL = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* Domaines a ne JAMAIS intercepter (temps reel / API) */
var BYPASS = [
  'firebasedatabase.app',
  'firebaseio.com',
  'googleapis.com',
  'gstatic.com/firebasejs',
  'api.emailjs.com',
  'api.callmebot.com',
  'firebaseinstallations',
  'google-analytics.com'
];

function shouldBypass(url) {
  for (var i = 0; i < BYPASS.length; i++) {
    if (url.indexOf(BYPASS[i]) !== -1) return true;
  }
  return false;
}

/* ---------- INSTALLATION ---------- */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll echoue en bloc si un seul fichier manque : on tolere les absents
      return Promise.all(SHELL.map(function (u) {
        return cache.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

/* ---------- ACTIVATION : menage des anciennes versions ---------- */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // [CORRECTIF] Supprime TOUT cache d'une version differente,
        // y compris les tres anciennes copies figees d'index.html.
        if (k.indexOf(AGV_VERSION) !== 0) return caches.delete(k);
        return null;
      }));
    }).then(function () {
      if (self.registration.navigationPreload) {
        return self.registration.navigationPreload.enable().catch(function () {});
      }
    }).then(function () { return self.clients.claim(); })
  );
});

/* ---------- MESSAGES depuis la page ---------- */
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

/* ---------- INTERCEPTION RESEAU ---------- */
self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Jamais les ecritures / lectures Firebase, jamais les non-GET
  if (req.method !== 'GET') return;
  if (shouldBypass(req.url)) return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* Une requete de document HTML peut arriver soit en mode
     "navigate" (ouverture normale de l'appli), soit — plus
     rarement, selon le navigateur ou le lanceur PWA — en mode
     "same-origin" avec un en-tete Accept text/html. On traite les
     deux de la meme facon : reseau d'abord, jamais de version figee. */
  var accept = req.headers.get('accept') || '';
  var estDocumentHTML = (req.mode === 'navigate') ||
    (req.destination === 'document') ||
    (accept.indexOf('text/html') !== -1 && url.origin === self.location.origin);

  /* 1. Document HTML (ouverture / actualisation de l'application) :
        reseau d'abord, SANS AUCUNE EXCEPTION. */
  if (estDocumentHTML) {
    event.respondWith(
      (function () {
        return Promise.resolve(event.preloadResponse)
          .then(function (preload) { return preload || fetch(req, { cache: 'no-store' }); })
          .then(function (res) {
            var copyPourRequete = res.clone();
            var copyGenerique = res.clone();
            caches.open(SHELL_CACHE).then(function (c) {
              c.put(req, copyPourRequete);              // sous la cle exacte demandee
              c.put('./index.html', copyGenerique);       // + cle generique pour le mode hors-ligne
            }).catch(function(){});
            return res;
          })
          .catch(function () {
            // Hors connexion : on rend la DERNIERE version reellement
            // chargee avec succes (jamais une precache figee du jour
            // de l'installation, puisqu'elle n'existe plus).
            return caches.match(req).then(function (m) {
              return m || caches.match('./index.html') || offlinePage();
            });
          });
      })()
    );
    return;
  }

  /* 2. Meme origine (icones, manifest...) : cache d'abord, rafraichi
        en arriere-plan. Jamais utilise pour le document HTML lui-meme
        (deja intercepte et traite ci-dessus en priorite). */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.status === 200 && res.type === 'basic') {
            var copy = res.clone();
            caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  /* 3. Polices et CDN externes : cache d'abord */
  if (url.href.indexOf('fonts.googleapis.com') !== -1 ||
      url.href.indexOf('fonts.gstatic.com') !== -1 ||
      url.href.indexOf('cdn.jsdelivr.net') !== -1) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return cached; });
      })
    );
  }
});

/* ---------- Page de secours hors ligne ---------- */
function offlinePage() {
  var html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Hors connexion</title></head>'
    + '<body style="margin:0;font-family:sans-serif;background:#060d24;color:#e2e8f0;'
    + 'min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center">'
    + '<div style="padding:24px"><div style="font-size:46px;margin-bottom:14px">&#128246;</div>'
    + '<h2 style="font-size:18px;margin-bottom:8px">Pas de connexion</h2>'
    + '<p style="color:#64748b;font-size:14px">Reconnectez-vous a Internet puis rouvrez l\'application.<br>'
    + 'Vos donnees enregistrees ne sont pas perdues.</p></div></body></html>';
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
