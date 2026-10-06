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
  const s = leer_('SESIONES').find(x => x.token === token);
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
  return { legajo: u.legajo, nombre_visible: u.nombre_visible, email: u.email, sector: u.sector, modulos: modulosDe_(u.legajo), es_admin: tienePermiso_(u.legajo, 'ADMIN') };
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
  const ahora = Date.now();
  leer_('SESIONES').filter(s => s.expira && new Date(s.expira).getTime() < ahora).sort((a, b) => b._fila - a._fila).forEach(s => hoja_('SESIONES').deleteRow(s._fila));
  invalidar_('SESIONES');
}
