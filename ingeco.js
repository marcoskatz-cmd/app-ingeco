/* INGECO — comportamiento común de los sistemas. Se carga desde
 *   https://app.ingecosa.com.ar/ingeco.js (sin ?v=, siempre la última)
 * - Marca <html data-ig-contexto="iframe|pestana|directo"> según cómo se abrió el sistema.
 * - Maneja los botones [data-ig-volver]: en el iframe le avisa a la App, en pestaña navega a la App.
 * - IG.color('azul') / IG.paleta() leen los tokens de ingeco.css (para Chart.js, Leaflet, etc.).
 * Nunca bloquea ni tira errores hacia afuera.
 */
(function () {
  var APP_URL = 'https://app.ingecosa.com.ar/';

  function contexto(env) {
    if (env.enIframe) return 'iframe';
    if (env.marcaPestana || env.ticketEnUrl || env.sesionGuard || String(env.referrer || '').indexOf(APP_URL) === 0) return 'pestana';
    return 'directo';
  }

  function color(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + nombre).trim();
  }

  function paleta() {
    return [1, 2, 3, 4, 5, 6].map(function (n) { return color('g' + n); });
  }

  function volver() {
    if (document.documentElement.dataset.igContexto === 'iframe') {
      try { parent.postMessage({ tipo: 'ingeco_volver' }, '*'); } catch (e) { }
    } else {
      location.href = APP_URL;
    }
  }

  var enIframe;
  try { enIframe = window.self !== window.top; } catch (e) { enIframe = true; }
  var sesionGuard = false, marcaPestana = false;
  try { sesionGuard = !!sessionStorage.getItem('ingeco_guard'); marcaPestana = !!sessionStorage.getItem('ig_pestana'); } catch (e) { }

  window.IG = { APP_URL: APP_URL, contexto: contexto, color: color, paleta: paleta, volver: volver };
  var ctx = contexto({
    enIframe: enIframe,
    referrer: document.referrer,
    sesionGuard: sesionGuard,
    ticketEnUrl: /[?&]tk=/.test(location.search),
    marcaPestana: marcaPestana
  });
  document.documentElement.dataset.igContexto = ctx;
  // Recordar que esta pestaña vino de la App: al recargar ya no está el tk en la URL.
  if (ctx === 'pestana') { try { sessionStorage.setItem('ig_pestana', '1'); } catch (e) { } }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-ig-volver]');
    if (b) { e.preventDefault(); volver(); }
  });
})();
