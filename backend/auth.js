/**
 * auth.js — login con Google (cuentas del Workspace de INGECO), tokens de sesión.
 *
 * El shell obtiene un ID token de Google Identity Services y lo manda en `login_google`.
 * El backend lo verifica contra Google (tokeninfo), exige el dominio GOOGLE_HD y el
 * client id GOOGLE_CLIENT_ID, busca la persona por email en USUARIOS y, si no existe,
 * la crea sin permisos (ve "Pedile acceso a Marcos" hasta que Admin le tilde módulos).
 */

const SESION_DIAS = 60;

function normalizar_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,\-_'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function generarToken_() {
  const bytes = [];
  for (let i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256) - 128);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function emailNorm_(e) { return String(e || '').trim().toLowerCase(); }

function dominiosPermitidos_() {
  return (prop_('GOOGLE_HD', false) || 'grupoingeco.com.ar').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

/** Verifica el ID token con Google. Devuelve el payload o null. */
function verificarIdToken_(credential) {
  if (!credential) return null;
  let r;
  try {
    r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), { muteHttpExceptions: true });
  } catch (e) { return null; }
  if (r.getResponseCode() !== 200) return null;
  const p = JSON.parse(r.getContentText());
  const clientId = prop_('GOOGLE_CLIENT_ID', true);
  if (p.aud !== clientId) return null;
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(p.iss) < 0) return null;
  if (Number(p.exp) * 1000 < Date.now()) return null;
  if (String(p.email_verified) !== 'true') return null;
  const dominio = emailNorm_(p.email).split('@')[1];
  if (dominiosPermitidos_().indexOf(dominio) < 0) return null;
  return p;
}

function usuarioPorEmail_(email) {
  const e = emailNorm_(email);
  return leer_('USUARIOS').find(u => emailNorm_(u.email) === e) || null;
}

function siguienteLegajo_() {
  const nums = leer_('USUARIOS').map(u => Number(u.legajo)).filter(n => !isNaN(n));
  return nums.length ? Math.max.apply(null, nums) + 1 : 1000;
}

/** POST {accion:"login_google", credential, dispositivo} */
function loginGoogle_(payload) {
  const p = verificarIdToken_(payload.credential);
  if (!p) return { ok: false, error: 'Entrá con tu cuenta de INGECO (@' + dominiosPermitidos_()[0] + ').' };
  let u = usuarioPorEmail_(p.email);
  if (u && !si_(u.activo)) return { ok: false, error: 'Tu usuario está dado de baja. Hablá con Marcos.' };
  if (!u) {
    const legajo = String(siguienteLegajo_());
    const visible = (p.name || p.email.split('@')[0]).trim();
    agregar_('USUARIOS', {
      legajo, nombre_visible: visible, email: emailNorm_(p.email), sector: '', celular: '', activo: 'sí',
      creado_por: 'google', fecha_alta: ahora_(), ultimo_ingreso: ahora_()
    });
    u = usuarioPorEmail_(p.email);
    avisarAdmin_('Nueva persona sin permisos', visible + ' (' + p.email + ') entró por primera vez y no tiene módulos. Asignale permisos en Admin.');
  } else {
    actualizar_('USUARIOS', u._fila, { ultimo_ingreso: ahora_() });
  }
  const token = crearSesion_(u.legajo, String(payload.dispositivo || '').slice(0, 80));
  return Object.assign({ ok: true, token }, perfil_(u));
}

function crearSesion_(legajo, dispositivo) {
  const token = generarToken_();
  const ahora = ahora_();
  agregar_('SESIONES', { token, legajo, dispositivo, creada: ahora, ultimo_uso: ahora, expira: new Date(ahora.getTime() + SESION_DIAS * 86400000) });
  return token;
}

/** Devuelve {usuario, sesion} o null. Renueva ultimo_uso/expira (como máximo una vez por hora). */
function sesionDe_(token) {
  if (!token) return null;
  const s = buscar_('SESIONES', 'token', token);
  if (!s) return null;
  if (s.expira && new Date(s.expira).getTime() < Date.now()) { borrarFila_('SESIONES', s._fila); return null; }
  const u = leer_('USUARIOS').find(x => String(x.legajo) === String(s.legajo));
  if (!u || !si_(u.activo)) return null;
  const ahora = ahora_();
  if (!s.ultimo_uso || ahora.getTime() - new Date(s.ultimo_uso).getTime() > 3600000) {
    actualizar_('SESIONES', s._fila, { ultimo_uso: ahora, expira: new Date(ahora.getTime() + SESION_DIAS * 86400000) });
  }
  return { usuario: u, sesion: s };
}

function perfil_(u) {
  const bot = tienePermiso_(u.legajo, 'BOT') ? Object.assign({ habilitado: true }, cupoDe_(u.legajo)) : { habilitado: false };
  const mods = modulosDe_(u.legajo);
  const p = { legajo: u.legajo, nombre_visible: u.nombre_visible, email: u.email, sector: u.sector, modulos: mods, es_admin: tienePermiso_(u.legajo, 'ADMIN'), bot };
  // Para abrir un sistema sin esperar al servidor (17-nov-2026): el perfil ya trae el pase firmado y un
  // ticket listo por módulo. Si algo de esto falla, el perfil sale igual y el shell pide el ticket como antes.
  try {
    const pase = pase_(u, mods);
    if (pase) { p.pase = pase.pase; p.pase_exp = pase.exp; }
    p.tickets = ticketsPara_(u, mods);
    marca_('pase');
  } catch (e) { console.warn('pase: ' + e); }
  return p;
}

// ───────────── Pase firmado: identidad que el sistema valida sin consultar al backend ─────────────
// Antes, cada apertura de un sistema hacía dos viajes a este backend (pedir ticket + canjearlo), y el canje
// era una consulta bloqueante con la pantalla en blanco. El pase es la identidad de la persona firmada con
// una llave privada RSA (Script Property PASE_PRIV); guard.js trae la llave pública y lo verifica en el
// navegador. Nadie puede fabricar un pase sin la llave privada, y vence a las PASE_H horas.
// Adentro viaja la "sesión de módulo" (la que los backends de cada sistema verifican con
// validar_sesion_modulo): también firmada (HMAC con PASE_HMAC), así que no ocupa planilla ni caché.
const PASE_H = 12;

function b64u_(x) { return Utilities.base64EncodeWebSafe(x, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function b64uBytes_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }

/** Sesión de módulo sin estado: u1.<legajo>.<vence en base 36>.<firma>. '' si falta el secreto. */
function sesionFirmada_(legajo, exp) {
  const secreto = prop_('PASE_HMAC', false);
  if (!secreto) return '';
  const cuerpo = 'u1.' + encodeURIComponent(String(legajo)).replace(/\./g, '%2E') + '.' + Number(exp).toString(36);
  return cuerpo + '.' + b64uBytes_(Utilities.computeHmacSha256Signature(cuerpo, secreto));
}

/** Devuelve {legajo, exp} si la firma es buena (no mira el vencimiento), o null. */
function leerSesionFirmada_(s) {
  const partes = String(s || '').split('.');
  if (partes.length !== 4 || partes[0] !== 'u1') return null;
  const secreto = prop_('PASE_HMAC', false);
  if (!secreto) return null;
  const cuerpo = partes.slice(0, 3).join('.');
  if (b64uBytes_(Utilities.computeHmacSha256Signature(cuerpo, secreto)) !== partes[3]) return null;
  const exp = parseInt(partes[2], 36);
  if (!exp) return null;
  return { legajo: decodeURIComponent(partes[1]), exp };
}

/** {pase, exp} para la persona, o null si las claves no están cargadas. */
function pase_(u, mods) {
  const priv = prop_('PASE_PRIV', false);
  if (!priv) return null;
  const exp = Date.now() + PASE_H * 3600000;
  const sesion = sesionFirmada_(u.legajo, exp);
  if (!sesion) return null;
  const roles = {};
  mods.forEach(m => { roles[m.codigo] = m.rol || 'USUARIO'; });
  const cuerpo = b64u_(JSON.stringify({
    v: 1, l: u.legajo, n: u.nombre_visible, e: u.email, s: u.sector,
    a: tienePermiso_(u.legajo, 'ADMIN'), r: roles, x: exp, ss: sesion
  }));
  return { pase: cuerpo + '.' + b64uBytes_(Utilities.computeRsaSha256Signature(cuerpo, priv)), exp };
}

/** Un ticket de un solo uso por cada módulo que se abre con URL, todos en una sola escritura a la caché. */
function ticketsPara_(u, mods) {
  const tickets = {}, lote = {};
  mods.forEach(m => {
    const url = String(m.url || '');
    if (!url || url.charAt(0) === '#' || m.tipo === 'interno') return;
    const t = generarToken_();
    tickets[m.codigo] = t;
    lote['tk:' + t] = JSON.stringify({ legajo: u.legajo, modulo: m.codigo, creado: Date.now() });
  });
  if (Object.keys(lote).length) cache_().putAll(lote, TICKET_MIN * 60);
  return tickets;
}

/** Contrato para módulos: POST {accion:"validar_token", token, modulo?} */
function validarToken_(payload) {
  const s = sesionDe_(payload.token);
  if (!s) return { ok: false, error: 'Sesión inválida o vencida' };
  const modulo = payload.modulo ? String(payload.modulo).toUpperCase() : null;
  if (modulo && !tienePermiso_(s.usuario.legajo, modulo)) return { ok: false, error: 'Sin permiso para ' + modulo };
  return {
    ok: true, legajo: s.usuario.legajo, nombre_visible: s.usuario.nombre_visible, email: s.usuario.email, sector: s.usuario.sector,
    rol_en_modulo: modulo ? rolEn_(s.usuario.legajo, modulo) : null, modulos: modulosDe_(s.usuario.legajo).map(m => m.codigo)
  };
}

function cerrarSesion_(ctx) { borrarFila_('SESIONES', ctx.sesion._fila); return { ok: true }; }

function sesionesDe_(legajo) {
  return leer_('SESIONES').filter(s => String(s.legajo) === String(legajo))
    .map(s => ({ dispositivo: s.dispositivo, creada: s.creada, ultimo_uso: s.ultimo_uso }));
}

function cerrarSesionesDe_(legajo) {
  leer_('SESIONES').filter(s => String(s.legajo) === String(legajo)).sort((a, b) => b._fila - a._fila).forEach(s => hoja_('SESIONES').deleteRow(s._fila));
  invalidar_('SESIONES');
}

/** Limpieza nocturna de sesiones vencidas (trigger). */
function limpiarSesiones() {
  try { limpiarTickets(); } catch (e) { console.warn('limpiarTickets: ' + e); }
  const ahora = Date.now();
  leer_('SESIONES').filter(s => s.expira && new Date(s.expira).getTime() < ahora).sort((a, b) => b._fila - a._fila).forEach(s => hoja_('SESIONES').deleteRow(s._fila));
  invalidar_('SESIONES');
}

// ───────────── Tickets de un solo uso para abrir módulos ─────────────
// El shell pide un ticket (con su sesión) y lo pone en la URL del módulo (?tk=…). El módulo lo canjea
// una sola vez y dentro de los 5 minutos. Un link copiado no sirve: el ticket ya fue usado o venció.
const TICKET_MIN = 5;

function crearTicket_(ctx, payload) {
  const modulo = String(payload.modulo || '').toUpperCase();
  if (!modulo) return { ok: false, error: 'Falta módulo' };
  if (!tienePermiso_(ctx.usuario.legajo, modulo) && !tienePermiso_(ctx.usuario.legajo, 'ADMIN')) return { ok: false, error: 'Sin permiso para ' + modulo };
  const ticket = generarToken_();
  // Solo en caché (vive 5 min): escribir en la planilla acá costaba ~1 s en cada apertura.
  // La fila en TICKETS se escribe al canjearlo, cuando nace la sesión de módulo de 12 h.
  cache_().put('tk:' + ticket, JSON.stringify({ legajo: ctx.usuario.legajo, modulo, creado: Date.now() }), TICKET_MIN * 60);
  return { ok: true, ticket };
}

/** Público. POST {accion:"validar_ticket", ticket, modulo?} → identidad del que abrió, una sola vez. */
function validarTicket_(payload) {
  const t = String(payload.ticket || '');
  if (!t) return { ok: false, error: 'Falta ticket' };
  const enCache = cache_().get('tk:' + t);
  if (enCache) {
    cache_().remove('tk:' + t);
    const c = JSON.parse(enCache);
    if (payload.modulo && String(c.modulo).toUpperCase() !== String(payload.modulo).toUpperCase()) return { ok: false, error: 'Este link es de otro sistema.' };
    const uc = leer_('USUARIOS').find(x => String(x.legajo) === String(c.legajo));
    if (!uc || !si_(uc.activo)) return { ok: false, error: 'Usuario inactivo' };
    const sesionC = generarToken_();
    agregar_('TICKETS', { ticket: t, legajo: c.legajo, modulo: c.modulo, creado: new Date(c.creado), usado: ahora_(), sesion: sesionC });
    cache_().put('ses:' + sesionC, JSON.stringify({ legajo: c.legajo, modulo: c.modulo, usado: Date.now() }), 21600);
    return Object.assign(identidadModulo_(uc, c.modulo), { sesion: sesionC });
  }
  const fila = buscar_('TICKETS', 'ticket', t);
  if (!fila) return { ok: false, error: 'Este link ya fue usado o venció. Abrí el sistema desde la app INGECO.' };
  if (fila.usado) return { ok: false, error: 'Este link ya fue usado. Abrí el sistema desde la app INGECO.' };
  if (Date.now() - new Date(fila.creado).getTime() > TICKET_MIN * 60000) return { ok: false, error: 'El link venció. Abrí el sistema desde la app INGECO.' };
  const modulo = payload.modulo ? String(payload.modulo).toUpperCase() : null;
  if (modulo && String(fila.modulo).toUpperCase() !== modulo) return { ok: false, error: 'Este link es de otro sistema.' };
  // Sesión de módulo: token NO consumible, válido SESION_MODULO_H horas, para que el backend del módulo
  // (p. ej. Locales Terminal) verifique cada pedido sin que el usuario vuelva a pasar por la app.
  const sesion = generarToken_();
  actualizar_('TICKETS', fila._fila, { usado: ahora_(), sesion });
  const u = leer_('USUARIOS').find(x => String(x.legajo) === String(fila.legajo));
  if (!u || !si_(u.activo)) return { ok: false, error: 'Usuario inactivo' };
  return Object.assign(identidadModulo_(u, fila.modulo), { sesion });
}

const SESION_MODULO_H = 12;

function identidadModulo_(u, modulo) {
  return {
    ok: true, legajo: u.legajo, nombre_visible: u.nombre_visible, email: u.email, sector: u.sector,
    rol_en_modulo: rolEn_(u.legajo, modulo), modulos: modulosDe_(u.legajo).map(m => m.codigo), es_admin: tienePermiso_(u.legajo, 'ADMIN')
  };
}

/** Público, no consume. POST {accion:"validar_sesion_modulo", sesion, modulo?} → identidad mientras no venza. */
function validarSesionModulo_(payload) {
  const s = String(payload.sesion || '');
  if (!s) return { ok: false, error: 'Falta sesión' };
  // Sesión que vino en un pase firmado: se verifica la firma, no hay nada guardado que buscar.
  if (s.indexOf('u1.') === 0) {
    const f = leerSesionFirmada_(s);
    if (!f) return { ok: false, error: 'Sesión inválida. Abrí el sistema desde la app INGECO.' };
    if (f.exp < Date.now()) return { ok: false, error: 'La sesión venció. Abrí el sistema desde la app INGECO.' };
    const mod = payload.modulo ? String(payload.modulo).toUpperCase() : null;
    const uf = leer_('USUARIOS').find(x => String(x.legajo) === String(f.legajo));
    if (!uf || !si_(uf.activo)) return { ok: false, error: 'Usuario inactivo' };
    if (mod && !tienePermiso_(uf.legajo, mod) && !tienePermiso_(uf.legajo, 'ADMIN')) return { ok: false, error: 'Sin permiso para ' + mod };
    return identidadModulo_(uf, mod);
  }
  // Cada sistema la valida al cargar: primero la caché (6 h), después la planilla.
  const enCache = cache_().get('ses:' + s);
  const fila = enCache ? JSON.parse(enCache) : buscar_('TICKETS', 'sesion', s);
  if (fila && !enCache && fila.usado) { try { cache_().put('ses:' + s, JSON.stringify({ legajo: fila.legajo, modulo: fila.modulo, usado: new Date(fila.usado).getTime() }), 21600); } catch (e) { } }
  if (!fila || !fila.usado) return { ok: false, error: 'Sesión inválida. Abrí el sistema desde la app INGECO.' };
  if (Date.now() - new Date(fila.usado).getTime() > SESION_MODULO_H * 3600000) return { ok: false, error: 'La sesión venció. Abrí el sistema desde la app INGECO.' };
  const modulo = payload.modulo ? String(payload.modulo).toUpperCase() : null;
  const u = leer_('USUARIOS').find(x => String(x.legajo) === String(fila.legajo));
  if (!u || !si_(u.activo)) return { ok: false, error: 'Usuario inactivo' };
  if (modulo && !tienePermiso_(u.legajo, modulo) && !tienePermiso_(u.legajo, 'ADMIN')) return { ok: false, error: 'Sin permiso para ' + modulo };
  return identidadModulo_(u, modulo || fila.modulo);
}

/** Limpieza (trigger nocturno): tickets cuya sesión de módulo ya venció. */
function limpiarTickets() {
  const lim = Date.now() - (SESION_MODULO_H + 1) * 3600000;
  // En bloque: borrar fila por fila con miles de tickets se cortaba por tiempo y la hoja no paraba de crecer.
  const sh = hoja_('TICKETS');
  const enc = encabezados_('TICKETS');
  const quedan = leer_('TICKETS').filter(x => !(x.creado && new Date(x.creado).getTime() < lim));
  const n = sh.getLastRow();
  if (n > 1) sh.getRange(2, 1, n - 1, enc.length).clearContent();
  if (quedan.length) sh.getRange(2, 1, quedan.length, enc.length).setValues(quedan.map(x => enc.map(h => x[h] === undefined ? '' : x[h])));
  if (n > quedan.length + 1) sh.deleteRows(quedan.length + 2, n - quedan.length - 1);
  invalidar_('TICKETS');
}
