/* =============================================================================
   App AGV — service worker  (AGV-51 : base locale permanente)
   -----------------------------------------------------------------------------
   Sans ce fichier a jour, l'application ne peut pas s'ouvrir sans Internet :
   la page et les scripts Firebase doivent etre gardes sur l'appareil.
   - page (index.html) : reseau d'abord, copie de l'appareil si le reseau
     ne repond pas en 3,5 s ou s'il n'y a pas d'Internet ;
   - scripts Firebase / EmailJS / polices : copie de l'appareil d'abord ;
   - base de donnees Firebase : jamais interceptee (temps reel + base locale).
   La version change a chaque livraison pour que les telephones deja
   installes recoivent la mise a jour.
   ============================================================================= */
var VERSION = 'agv-v31-20261125-base-locale';
var COQUILLE = ['./', './index.html', './manifest.json',
                './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
var EXTERNES = ['https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
                'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js'];
var DELAI_RESEAU = 3500;

self.addEventListener('install', function(ev){
  ev.waitUntil(caches.open(VERSION).then(function(c){
    return Promise.all(COQUILLE.concat(EXTERNES).map(function(u){
      var externe = /^https?:/.test(u);
      return fetch(new Request(u, externe ? { mode: 'cors', credentials: 'omit' } : { cache: 'reload' }))
        .then(function(r){ if (r && (r.ok || r.type === 'opaque')) return c.put(u, r); })
        .catch(function(){});                 /* un fichier absent ne bloque pas l'installation */
    }));
  }));
});

self.addEventListener('activate', function(ev){
  ev.waitUntil(caches.keys().then(function(noms){
    return Promise.all(noms.map(function(n){
      if (n !== VERSION && /^agv/i.test(n)) return caches.delete(n);
    }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener('message', function(ev){
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function estBaseDeDonnees(url){
  return /firebaseio\.com|firebasedatabase\.app|identitytoolkit|securetoken|googleapis\.com\/(identitytoolkit|v1)/.test(url.hostname + url.pathname)
      || /\.json$/.test(url.pathname) && /firebase/.test(url.hostname);
}
function mettreEnCache(req, rep){
  if (!rep || !(rep.ok || rep.type === 'opaque')) return;
  var copie = rep.clone();
  caches.open(VERSION).then(function(c){ c.put(req, copie); }).catch(function(){});
}

self.addEventListener('fetch', function(ev){
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (estBaseDeDonnees(url)) return;

  var memeOrigine = url.origin === self.location.origin;
  var estPage = req.mode === 'navigate' || (memeOrigine && /\/(index\.html)?$/.test(url.pathname));

  /* la page : reseau d'abord, l'appareil si pas de reponse */
  if (estPage){
    ev.respondWith(new Promise(function(resoudre){
      var fini = false;
      function depuisCache(){
        return caches.match('./index.html').then(function(r){ return r || caches.match(req, { ignoreSearch: true }); });
      }
      var minuteur = setTimeout(function(){
        depuisCache().then(function(r){ if (r && !fini){ fini = true; resoudre(r); } });
      }, DELAI_RESEAU);
      fetch(req).then(function(rep){
        clearTimeout(minuteur);
        if (rep && rep.ok){ var c = rep.clone(); caches.open(VERSION).then(function(x){ x.put('./index.html', c); }); }
        if (!fini){ fini = true; resoudre(rep); }
      }).catch(function(){
        clearTimeout(minuteur);
        depuisCache().then(function(r){
          if (fini) return;
          fini = true;
          resoudre(r || new Response('<h3 style="font-family:sans-serif">App AGV : hors ligne et page non encore copiée sur cet appareil. Ouvrez l\'application une fois avec Internet.</h3>',
                                     { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
        });
      });
    }));
    return;
  }

  /* scripts externes et polices : appareil d'abord */
  if (/gstatic\.com|jsdelivr\.net|fonts\.googleapis\.com/.test(url.hostname)){
    ev.respondWith(caches.match(req).then(function(r){
      return r || fetch(req).then(function(rep){ mettreEnCache(req, rep); return rep; });
    }));
    return;
  }

  /* autres fichiers de l'application : copie immediate, rafraichie en arriere-plan */
  if (memeOrigine){
    ev.respondWith(caches.match(req, { ignoreSearch: true }).then(function(r){
      var reseau = fetch(req).then(function(rep){ mettreEnCache(req, rep); return rep; }).catch(function(){ return r; });
      return r || reseau;
    }));
  }
});
