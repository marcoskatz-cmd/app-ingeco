/**
 * guard.js — guardián de acceso para los sistemas de INGECO.
 *
 * Uso: en el <head> de cada sistema estático (GitHub Pages):
 *   <script src="https://marcoskatz-cmd.github.io/app-ingeco/guard.js" data-modulo="INGECOV"></script>
 *
 * Qué hace:
 *  - Si la URL trae ?tk=<ticket> (la app INGECO lo pone al abrir el sistema), lo canjea UNA vez contra el backend
 *    común y guarda la identidad en sessionStorage. Después limpia el parámetro de la URL.
 *  - Si ya hay identidad guardada en esta pestaña y la persona tiene permiso para este módulo, deja pasar.
 *  - Si no hay nada (link copiado, ticket usado o vencido), tapa la página con un aviso y un botón a la app.
 *
 * Expone window.INGECO_USUARIO = {legajo, nombre_visible, email, sector, rol_en_modulo, modulos, es_admin, sesion}
 * y window.INGECO_SESION (token de sesión de módulo, 12 h) para que el backend del sistema lo verifique.
 * y dispara el evento 'ingeco:usuario' en document cuando queda resuelto. Los sistemas pueden usarlo para
 * saber quién está operando sin pedir nada.
 */
(function () {
  var BACKEND = 'https://script.google.com/macros/s/AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0/exec';
  var APP = 'https://marcoskatz-cmd.github.io/app-ingeco/';
  var HORAS = 12;
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var MODULO = String((script && script.getAttribute('data-modulo')) || '').toUpperCase();
  var CLAVE = 'ingeco_guard';

  function leer() {
    try { var s = JSON.parse(sessionStorage.getItem(CLAVE) || 'null'); if (s && s.exp > Date.now()) return s; } catch (e) { }
    return null;
  }
  function guardar(u) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(Object.assign({}, u, { exp: Date.now() + HORAS * 3600000 }))); } catch (e) { }
  }
  function permitido(u) { return !!u && (u.es_admin || !MODULO || (u.modulos || []).indexOf(MODULO) >= 0); }

  function bloquear(msg) {
    var pintar = function () {
      document.documentElement.style.overflow = 'hidden';
      var d = document.createElement('div');
      d.id = 'ingeco-guard';
      d.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;background:#0f1f4d;color:#fff;display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;text-align:center');
      d.innerHTML = '<div style="max-width:380px"><div style="font-size:3rem">🔒</div><h1 style="font-size:1.4rem;margin:8px 0">' + msg + '</h1>' +
        '<p style="opacity:.8;margin:0 0 20px">Este sistema se abre desde la app INGECO, con tu cuenta.</p>' +
        '<a href="' + APP + '" style="display:inline-block;background:#fff;color:#1f3a8a;padding:14px 24px;border-radius:999px;font-weight:700;text-decoration:none">Ir a la app INGECO</a></div>';
      (document.body || document.documentElement).appendChild(d);
    };
    if (document.body) pintar(); else document.addEventListener('DOMContentLoaded', pintar);
  }

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
  if (tk) {
    params.delete('tk'); params.delete('t'); params.delete('legajo');
    var limpia = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
    try { history.replaceState(null, '', limpia); } catch (e) { }
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
