/**
 * fallas.js — registro de fallas de conexión que reportan los navegadores.
 *
 * Por qué: el 12-nov-2026 la app "se trabó" ~30 min y el registro de ejecuciones solo mostraba
 * silencio (los pedidos no llegaban). Desde el servidor no se puede distinguir si fue el internet
 * de la oficina, Google o GitHub. El shell anota cada pedido que no obtuvo respuesta, prueba en
 * ese momento si hay internet en general (gstatic) y si Google responde, y manda el lote
 * cuando vuelve la conexión. Acá se guarda en la hoja FALLAS_RED.
 */

const FALLAS_MAX_POR_ENVIO = 50;
const FALLAS_TIPOS = ['timeout', 'red', 'respuesta', 'shell_cache'];

function textoCorto_(v, max) { return String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').slice(0, max); }

/** Valida y recorta lo que manda el navegador. Pura (testeable). */
function normalizarFallas_(lista, ahoraMs) {
  if (!Array.isArray(lista)) return [];
  const ahora = ahoraMs || Date.now();
  const tri = v => (v === true ? 'sí' : v === false ? 'no' : '');
  return lista.slice(0, FALLAS_MAX_POR_ENVIO).map(f => {
    f = f || {};
    const t = Number(f.t);
    // Fechas absurdas (reloj del celular mal, o más de 7 días) se descartan.
    if (!isFinite(t) || t > ahora + 5 * 60000 || t < ahora - 7 * 86400000) return null;
    const tipo = FALLAS_TIPOS.indexOf(f.tipo) >= 0 ? f.tipo : 'red';
    return {
      fecha: new Date(t), accion: textoCorto_(f.accion, 40), tipo, ms: Math.max(0, Math.min(600000, Math.round(Number(f.ms) || 0))),
      online: tri(f.online), internet: tri(f.internet), google: tri(f.google),
      conexion: textoCorto_(f.conexion, 20), detalle: textoCorto_(f.detalle, 200)
    };
  }).filter(Boolean);
}

function reportarFallas_(ctx, p) {
  const filas = normalizarFallas_(p && p.fallas);
  if (!filas.length) return { ok: true, guardadas: 0 };
  const disp = textoCorto_(p.dispositivo, 80);
  const recibido = ahora_();
  agregarVarias_('FALLAS_RED', filas.map(f => Object.assign({ recibido, legajo: ctx.usuario.legajo, dispositivo: disp }, f)));
  return { ok: true, guardadas: filas.length };
}

/** Admin: últimas fallas, para diagnosticar después de una caída. */
function listarFallas_(ctx, p) {
  requiereAdmin_(ctx);
  const n = Math.min(Number(p && p.limite) || 300, 2000);
  const nombres = {};
  leer_('USUARIOS').forEach(u => { nombres[String(u.legajo)] = u.nombre_visible; });
  const filas = leerCola_('FALLAS_RED', n).map(f => Object.assign({}, f, { nombre: nombres[String(f.legajo)] || f.legajo }));
  return { ok: true, fallas: filas };
}
