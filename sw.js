/* Service worker INGECO: caché del shell + recepción de push. */
const CACHE = 'ingeco-shell-v34';
const DIAG = 'ingeco-diag';      // fallas anotadas por el SW (las levanta app.js y las manda al backend)
const ESPERA_RED = 4000;         // si GitHub Pages no contesta en 4 s, se abre con la copia guardada
const SHELL = ['./', './index.html', './app.js', './ingebot.js', './ingebot.png', './ingebot-128.png', './styles.css', './ingeco.css', './ingeco.js', './manifest.json', './icon-192.png', './icon-512.png', './logo.png', './logo-pavimax.png', './logo-terminal.png'];

self.addEventListener('install', e => {
  // cache:'reload' salta la caché HTTP del navegador (GitHub Pages manda max-age=600) para precachear lo último.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DIAG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Shell: red primero (para que los cambios lleguen), pero con tiempo límite: si GitHub Pages no contesta
// en ESPERA_RED, se abre con la copia guardada y la red, si llega, solo actualiza la caché.
// Antes no había tiempo límite: si Pages se colgaba (en vez de fallar), la App quedaba en blanco.
// Nunca se cachea el backend. ?sondeo pasa directo a la red (lo usa app.js para saber si Pages responde).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.searchParams.has('sondeo')) return;
  e.respondWith(redPrimero(e));
});

function enCache(req) {
  return caches.match(req)
    .then(r => r || caches.match(req, { ignoreSearch: true }))
    .then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : null));
}

// Si la última apertura tuvo que usar la copia, por un minuto los demás archivos salen de la copia al instante
// (la red igual los actualiza por detrás), para no sumar otros ESPERA_RED segundos por cada uno.
let redLentaHasta = 0;

function redPrimero(e) {
  const req = e.request;
  const apurado = Date.now() < redLentaHasta;
  const t0 = Date.now();
  const red = fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.status >= 500) throw new Error('HTTP ' + r.status);   // Pages caído responde 5xx: mejor la copia
    if (r.ok) { const copia = r.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(req, copia))); }
    return r;
  });
  e.waitUntil(red.catch(() => { }));
  return new Promise((resolve, reject) => {
    let hecho = false;
    const dar = r => { if (!hecho) { hecho = true; resolve(r); } };
    const timer = setTimeout(() => enCache(req).then(r => {
      if (r && !hecho) {
        if (!apurado) {   // esperó de verdad ESPERA_RED: abre la ventana de un minuto y lo anota
          redLentaHasta = Date.now() + 60000;
          if (req.mode === 'navigate') anotarFalla('shell lento (>' + ESPERA_RED / 1000 + ' s)');
        }
        dar(r);
      }
    }), apurado ? 0 : ESPERA_RED);
    red.then(r => { clearTimeout(timer); if (Date.now() - t0 < ESPERA_RED) redLentaHasta = 0; dar(r); }).catch(err => {
      clearTimeout(timer);
      if (hecho) return;   // ya se respondió con la copia
      enCache(req).then(r => {
        if (r) { if (req.mode === 'navigate') anotarFalla('shell sin red: ' + String((err && err.message) || err).slice(0, 80)); dar(r); }
        else if (!hecho) { hecho = true; reject(new TypeError('Sin red y sin copia guardada')); }
      });
    });
  });
}

function anotarFalla(detalle) {
  return caches.open(DIAG).then(c => c.match('__fallas')
    .then(r => (r ? r.json() : []))
    .catch(() => [])
    .then(l => {
      l = Array.isArray(l) ? l : [];
      l.push({ t: Date.now(), accion: 'abrir_app', tipo: 'shell_cache', ms: ESPERA_RED, online: self.navigator ? navigator.onLine : '', detalle });
      return c.put('__fallas', new Response(JSON.stringify(l.slice(-50)), { headers: { 'Content-Type': 'application/json' } }));
    })).catch(() => { });
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titulo: 'INGECO', cuerpo: e.data ? e.data.text() : '' }; }
  const opciones = {
    body: d.cuerpo || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: d.id || undefined,
    renotify: !!d.id,
    data: { url: d.url || '#bandeja', modulo: d.modulo },
    vibrate: d.prioridad === 'critica' ? [200, 100, 200, 100, 200] : [100],
    requireInteraction: d.prioridad === 'critica'
  };
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.titulo || 'INGECO', opciones),
    self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ tipo: 'push', aviso: d })))
  ]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const destino = e.notification.data && e.notification.data.url || '#bandeja';
  const base = self.registration.scope;
  // Un link interno (#...) abre la app en esa vista; uno externo abre la app en la bandeja (que lo lleva al ítem).
  const url = destino.startsWith('#') ? base + destino : base + '#bandeja';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const abierta = cs.find(c => c.url.startsWith(base));
    if (abierta) { abierta.navigate(url); return abierta.focus(); }
    return self.clients.openWindow(url);
  }));
});
