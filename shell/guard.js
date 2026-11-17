/**
 * guard.js — guardián de acceso para los sistemas de INGECO.
 *
 * Uso: en el <head> de cada sistema estático (GitHub Pages):
 *   <script src="https://app.ingecosa.com.ar/guard.js" data-modulo="INGECOV"></script>
 *
 * Qué hace:
 *  - Si la URL trae ?tk=<ticket> (la app INGECO lo pone al abrir el sistema), lo canjea UNA vez contra el backend
 *    común y guarda la identidad en sessionStorage. Después limpia el parámetro de la URL.
 *  - Si ya hay identidad guardada en esta pestaña y la persona tiene permiso para este módulo, deja pasar.
 *  - Si no hay nada (link copiado, ticket usado o vencido), NO bloquea: el sistema queda como era (abierto, o con su PIN).
 *
 * Expone window.INGECO_USUARIO = {legajo, nombre_visible, email, sector, rol_en_modulo, modulos, es_admin, sesion}
 * y window.INGECO_SESION (token de sesión de módulo, 12 h) para que el backend del sistema lo verifique.
 * y dispara el evento 'ingeco:usuario' en document cuando queda resuelto. Los sistemas pueden usarlo para
 * saber quién está operando sin pedir nada.
 */
(function () {
  var BACKEND = 'https://script.google.com/macros/s/AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0/exec';
  var APP = 'https://app.ingecosa.com.ar/';
  var HORAS = 12;
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var MODULO = String((script && script.getAttribute('data-modulo')) || '').toUpperCase();
  var CLAVE = 'ingeco_guard';

  function leer() {
    try { var s = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) { }
    return null;
  }
  function guardar(u, vence) {
    var exp = Date.now() + HORAS * 3600000;
    if (vence && vence < exp) exp = vence;
    try { sessionStorage.setItem(CLAVE, JSON.stringify(Object.assign({}, u, { exp: exp }))); } catch (e) { }
  }

  // ───────────── Pase firmado (17-nov-2026) ─────────────
  // La app INGECO abre el sistema con #ig=<pase>: la identidad de la persona firmada por el backend común
  // con una llave privada RSA. Acá está la llave pública: el pase se verifica en el navegador, al instante,
  // sin la consulta bloqueante a Google que dejaba la pantalla en blanco 2–4 segundos en cada apertura.
  // Nadie puede fabricar un pase sin la llave privada; un pase adulterado o vencido se ignora.
  var PASE_N = 'b2e05349f5358cd349ce31dc25964ee99a1c8bc52364ec8d54c9e1ae658065846490477b1517b085c9ce4019e9781745406ced561e96c948ac1ace59fdd63a36a079fbace0ba3ed4044ce2691669de4d39a88be62ea2a6fdabd28f7f4c05f89851dcb9e768e99349f5bf4bc3df6f0ded415024193d121834b97f58bd6b989658e2f09cc236abdcdc27515932e13fc9f7ea17efc48230e8b28030f90edd4b93c02bc7c9b0b11ff13234acfe9a6c2e611a59be6b842aaf08579b8e9e31969e751320f98ccaaf8c58b1f746c2961dcd6a8a1e411f0a59ec6b261014024fedb78f85306f15630eebaf0368565615403a22e954336aa8b99b701cf0326e47a124e67b';

  function bytesDeB64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var b = atob(s), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function hexDe(bytes) {
    var h = '';
    for (var i = 0; i < bytes.length; i++) h += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return h;
  }
  /** SHA-256 de un texto ASCII, en hexadecimal. Síncrono a propósito (crypto.subtle es asíncrono). */
  function sha256Hex(texto) {
    var K = [], H = [], primos = 0, c = 2, i, j;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    while (primos < 64) {
      var esPrimo = true;
      for (i = 2; i * i <= c; i++) if (c % i === 0) { esPrimo = false; break; }
      if (esPrimo) { if (primos < 8) H[primos] = frac(Math.pow(c, 1 / 2)); K[primos++] = frac(Math.pow(c, 1 / 3)); }
      c++;
    }
    var largo = texto.length, total = ((largo + 8) >> 6 << 6) + 64, m = new Uint8Array(total);
    for (i = 0; i < largo; i++) m[i] = texto.charCodeAt(i) & 255;
    m[largo] = 128;
    var bits = largo * 8;
    m[total - 4] = bits >>> 24; m[total - 3] = bits >>> 16 & 255; m[total - 2] = bits >>> 8 & 255; m[total - 1] = bits & 255;
    var w = new Int32Array(64);
    function rot(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var o = 0; o < total; o += 64) {
      for (i = 0; i < 16; i++) w[i] = m[o + i * 4] << 24 | m[o + i * 4 + 1] << 16 | m[o + i * 4 + 2] << 8 | m[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var hex = '';
    for (j = 0; j < 8; j++) hex += ('00000000' + (H[j] >>> 0).toString(16)).slice(-8);
    return hex;
  }
  /** Verifica la firma RSA (PKCS#1 v1.5, SHA-256, exponente 65537) de `texto`. */
  function firmaValida(texto, firma) {
    if (typeof BigInt !== 'function' || !PASE_N) return false;
    var n = BigInt('0x' + PASE_N), s = BigInt('0x' + (hexDe(firma) || '0'));
    if (s >= n) return false;
    var r = s;
    for (var i = 0; i < 16; i++) r = (r * r) % n;   // s^(2^16)
    r = (r * s) % n;                                // s^65537
    var obtenido = r.toString(16);
    while (obtenido.length < PASE_N.length) obtenido = '0' + obtenido;
    var relleno = '';
    for (var k = 0; k < PASE_N.length / 2 - 54; k++) relleno += 'ff';
    return obtenido === '0001' + relleno + '00' + '3031300d060960864801650304020105000420' + sha256Hex(texto);
  }
  /** Devuelve la identidad que trae el pase, o null si no es auténtico o ya venció. */
  function leerPase(pase) {
    try {
      var corte = pase.indexOf('.');
      if (corte < 1) return null;
      var cuerpo = pase.slice(0, corte);
      if (!firmaValida(cuerpo, bytesDeB64u(pase.slice(corte + 1)))) return null;
      var bytes = bytesDeB64u(cuerpo), txt;
      if (typeof TextDecoder === 'function') txt = new TextDecoder('utf-8').decode(bytes);
      else { txt = ''; for (var i = 0; i < bytes.length; i++) txt += String.fromCharCode(bytes[i]); txt = decodeURIComponent(escape(txt)); }
      var p = JSON.parse(txt);
      if (!p || p.v !== 1 || !(p.x > Date.now())) return null;
      var roles = p.r || {};
      return {
        legajo: p.l, nombre_visible: p.n, email: p.e, sector: p.s,
        rol_en_modulo: roles[MODULO] || null, modulos: Object.keys(roles), es_admin: !!p.a, sesion: p.ss || '', vence: p.x
      };
    } catch (e) { return null; }
  }
  function permitido(u) { return !!u && (u.es_admin || !MODULO || (u.modulos || []).indexOf(MODULO) >= 0); }

  // NO bloquea: los sistemas que eran abiertos siguen abiertos. Si no viene de la app, simplemente no hay identidad
  // y cada sistema aplica su propio control (PIN) como siempre.
  function bloquear(msg) { window.INGECO_USUARIO = null; window.INGECO_SESION = ''; window.INGECO_MOTIVO = msg; }

  function listo(u) {
    window.INGECO_USUARIO = u;
    // Token de sesión de módulo (12 h, no consumible): el backend del sistema puede verificarlo con
    // {accion:'validar_sesion_modulo', payload:{sesion, modulo}} contra el backend común.
    window.INGECO_SESION = u.sesion || '';
    try { document.dispatchEvent(new CustomEvent('ingeco:usuario', { detail: u })); } catch (e) { }
  }

  function canjear(ticket) {
    var x = new XMLHttpRequest();
    // Síncrono a propósito: así el sistema no alcanza a mostrar nada antes de saber si puede.
    x.open('POST', BACKEND, false);
    x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
    try { x.send(JSON.stringify({ accion: 'validar_ticket', payload: { ticket: ticket, modulo: MODULO } })); } catch (e) { return { ok: false, error: 'Sin conexión. Volvé a abrir desde la app.' }; }
    try { return JSON.parse(x.responseText); } catch (e) { return { ok: false, error: 'No se pudo validar el acceso.' }; }
  }

  var params = new URLSearchParams(location.search);
  var tk = params.get('tk');
  // El pase viene al final del hash: "#ig=<pase>", o "#<hash propio del sistema>~ig=<pase>".
  var hash = location.hash || '';
  var mp = /(^#|~)ig=([A-Za-z0-9_.\-]+)$/.exec(hash);
  if (mp) hash = mp[1] === '#' ? '' : hash.slice(0, mp.index);
  if (tk || mp) {
    params.delete('tk'); params.delete('t'); params.delete('legajo');
    var limpia = location.pathname + (params.toString() ? '?' + params.toString() : '') + hash;
    try { history.replaceState(null, '', limpia); } catch (e) { }
  }
  if (mp) {
    var up = leerPase(mp[2]);
    if (up) {
      var vence = up.vence; delete up.vence;
      if (permitido(up)) { guardar(up, vence); listo(up); return; }
      if (!tk) { bloquear('No tenés acceso a este sistema'); return; }
    }
  }
  if (tk) {
    var r = canjear(tk);
    if (r && r.ok) {
      var u = { legajo: r.legajo, nombre_visible: r.nombre_visible, email: r.email, sector: r.sector, rol_en_modulo: r.rol_en_modulo, modulos: r.modulos || [], es_admin: !!r.es_admin, sesion: r.sesion || '' };
      if (permitido(u)) { guardar(u); listo(u); return; }
      bloquear('No tenés acceso a este sistema');
      return;
    }
    bloquear((r && r.error) || 'Abrí este sistema desde la app INGECO');
    return;
  }
  var ses = leer();
  if (permitido(ses)) { listo(ses); return; }
  bloquear('Abrí este sistema desde la app INGECO');
})();
