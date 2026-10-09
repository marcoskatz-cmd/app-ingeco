/* Service worker INGECO: caché del shell + recepción de push. */
const CACHE = 'ingeco-shell-v9';
const SHELL = ['./', './index.html', './app.js', './styles.css', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' salta la caché HTTP del navegador (GitHub Pages manda max-age=600) para precachear lo último.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Shell: red primero (para que los cambios lleguen), caché si no hay señal. Nunca se cachea el backend.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

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
