/* =============================================================================
   App AGV — service worker  (AGV-55 : ouverture independante d'Internet)
   -----------------------------------------------------------------------------
   - page (index.html) : la COPIE DE L'APPAREIL d'abord, tout de suite, avec ou
     sans Internet ; la copie est rafraichie en arriere-plan (au plus toutes les
     10 minutes) et la nouvelle version sert a l'ouverture suivante. Avant, la
     page etait retelechargee (environ 1 Mo) a chaque ouverture et a chaque
     changement de bloc : avec une connexion faible, l'ouverture trainait.
   - scripts Firebase / EmailJS / polices : copie de l'appareil d'abord ;
   - base de donnees Firebase : jamais interceptee (temps reel + base locale).
   La version change a chaque livraison pour que les telephones deja
   installes recoivent la mise a jour.
   ============================================================================= */
var VERSION = 'agv-v36-20261127-en-ligne-seulement';
var COQUILLE = ['./', './index.html', './manifest.json',
                './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
var EXTERNES = ['https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
                'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
                'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js'];
var DELAI_RESEAU = 3500;
var RAFRAICHIR = 10 * 60 * 1000;      /* la copie de la page est revue au plus toutes les 10 minutes */
var CLE_REVUE = './__agv_page_revue__';

self.addEventListener('install', function(ev){
  ev.waitUntil(caches.open(VERSION).then(function(c){
    return Promise.all(COQUILLE.concat(EXTERNES).map(function(u){
      var externe = /^https?:/.test(u);
      return fetch(new Request(u, externe ? { mode: 'cors', credentials: 'omit' } : { cache: 'reload' }))
        .then(function(r){ if (r && (r.ok || r.type === 'opaque')) return c.put(u, r); })
        .catch(function(){});                 /* un fichier absent ne bloque pas l'installation */
    })).then(function(){ return noterRevue(c); });   /* la page vient d'etre copiee : pas de nouveau telechargement tout de suite */
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


/* premiere ouverture (aucune copie) : le reseau, avec repli */
function depuisReseau(req){
  return fetch(req).then(function(rep){
    if (rep && rep.ok){ var c = rep.clone(); caches.open(VERSION).then(function(x){ x.put('./index.html', c); noterRevue(x); }); }
    return rep;
  }).catch(function(){
    return caches.match(req, { ignoreSearch: true }).then(function(r){
      return r || new Response('<h3 style="font-family:sans-serif">App AGV : hors ligne et page non encore copiée sur cet appareil. Ouvrez l\'application une fois avec Internet.</h3>',
                               { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    });
  });
}
function noterRevue(cache){
  return cache.put(CLE_REVUE, new Response(String(Date.now()), { headers: { 'Content-Type': 'text/plain' } })).catch(function(){});
}
/* mise a jour de la copie en arriere-plan : n'attend rien, ne bloque rien */
function rafraichirPage(req){
  return caches.open(VERSION).then(function(cache){
    return cache.match(CLE_REVUE).then(function(r){ return r ? r.text() : '0'; }).then(function(t){
      if (Date.now() - (Number(t) || 0) < RAFRAICHIR) return;
      return noterRevue(cache).then(function(){
        return fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })).then(function(rep){
          if (rep && rep.ok && /text\/html/.test(rep.headers.get('Content-Type') || 'text/html')) return cache.put('./index.html', rep);
        });
      });
    });
  }).catch(function(){});
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

  /* la page : la copie de l'appareil tout de suite ; le reseau seulement s'il n'y en a pas encore */
  if (estPage){
    ev.respondWith(caches.match('./index.html').then(function(copie){
      if (copie){
        ev.waitUntil(rafraichirPage(req));
        return copie;
      }
      return depuisReseau(req);
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
