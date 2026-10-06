/**
 * auth.js — login nombre + PIN, tokens de sesión, normalización y hash.
 */

const SESION_DIAS = 60;
const INTENTOS_MAX = 3;
const BLOQUEO_MIN = 10;

/** Misma función en alta y login: minúsculas → sin tildes → sin puntuación → espacios colapsados. */
function normalizar_(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,\-_'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashPin_(pin, legajo) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin) + String(legajo), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function generarToken_() {
  const bytes = [];
  for (let i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256) - 128);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function pinAleatorio_() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function pinValido_(pin) { return /^\d{4}$/.test(String(pin || '')); }

/** Busca usuarios cuyo nombre_norm o algún alias coincida con el nombre tipeado. */
function candidatos_(nombreTipeado) {
  const n = normalizar_(nombreTipeado);
  if (!n) return [];
  return leer_('USUARIOS').filter(u => {
    if (!si_(u.activo)) return false;
    if (normalizar_(u.nombre_norm) === n) return true;
    const alias = String(u.alias_norm || '').split('|').map(a => normalizar_(a)).filter(Boolean);
    return alias.indexOf(n) >= 0;
  });
}

function bloqueado_(u) {
  if (!u.bloqueado_hasta) return 0;
  const hasta = new Date(u.bloqueado_hasta).getTime();
  const resta = hasta - Date.now();
  return resta > 0 ? Math.ceil(resta / 60000) : 0;
}

function login_(payload) {
  const nombre = payload.nombre;
  const pin = String(payload.pin || '');
  const dispositivo = String(payload.dispositivo || '').slice(0, 80);
  const errorGenerico = { ok: false, error: 'Nombre o PIN incorrecto' };

  if (!pinValido_(pin)) return errorGenerico;
  const cands = candidatos_(nombre);
  if (!cands.length) return errorGenerico;

  // Si alguna candidata está bloqueada, avisamos el tiempo (sin revelar cuál).
  const bloq = cands.map(bloqueado_).filter(m => m > 0);
  if (bloq.length) return { ok: false, error: 'Demasiados intentos. Probá de nuevo en ' + Math.max.apply(null, bloq) + ' minutos.', bloqueado_min: Math.max.apply(null, bloq) };

  const coinciden = cands.filter(u => u.pin_hash === hashPin_(pin, u.legajo));
  if (coinciden.length !== 1) {
    // Fallo: sumar intentos a todas las candidatas (mismo nombre).
    cands.forEach(u => {
      const intentos = Number(u.intentos_fallidos || 0) + 1;
      const cambios = { intentos_fallidos: intentos };
      if (intentos >= INTENTOS_MAX) {
        cambios.bloqueado_hasta = new Date(Date.now() + BLOQUEO_MIN * 60000);
        cambios.intentos_fallidos = 0;
        avisarAdmin_('Intentos fallidos de login', 'Se bloqueó 10 min a ' + u.nombre_visible + ' (legajo ' + u.legajo + ') tras 3 intentos fallidos.');
      }
      actualizar_('USUARIOS', u._fila, cambios);
    });
    return errorGenerico;
  }

  const u = coinciden[0];
  actualizar_('USUARIOS', u._fila, { intentos_fallidos: 0, bloqueado_hasta: '' });
  const token = crearSesion_(u.legajo, dispositivo);
  return Object.assign({ ok: true, token, pin_provisorio: si_(u.pin_provisorio) }, perfil_(u));
}

function crearSesion_(legajo, dispositivo) {
  const token = generarToken_();
  const ahora = ahora_();
  agregar_('SESIONES', {
    token, legajo, dispositivo, creada: ahora, ultimo_uso: ahora,
    expira: new Date(ahora.getTime() + SESION_DIAS * 86400000)
  });
  return token;
}

/** Devuelve {usuario, sesion} o null. Renueva ultimo_uso/expira. */
function sesionDe_(token) {
  if (!token) return null;
  const s = leer_('SESIONES').find(x => x.token === token);
  if (!s) return null;
  if (s.expira && new Date(s.expira).getTime() < Date.now()) { borrarFila_('SESIONES', s._fila); return null; }
  const u = leer_('USUARIOS').find(x => String(x.legajo) === String(s.legajo));
  if (!u || !si_(u.activo)) return null;
  const ahora = ahora_();
  // Renovar como máximo una vez por hora para no escribir en cada llamada.
  if (!s.ultimo_uso || ahora.getTime() - new Date(s.ultimo_uso).getTime() > 3600000) {
    actualizar_('SESIONES', s._fila, { ultimo_uso: ahora, expira: new Date(ahora.getTime() + SESION_DIAS * 86400000) });
  }
  return { usuario: u, sesion: s };
}

function perfil_(u) {
  return {
    legajo: u.legajo,
    nombre_visible: u.nombre_visible,
    sector: u.sector,
    modulos: modulosDe_(u.legajo),
    es_admin: tienePermiso_(u.legajo, 'ADMIN')
  };
}

function cambiarPin_(ctx, payload) {
  const pin = String(payload.pin_nuevo || '');
  if (!pinValido_(pin)) return { ok: false, error: 'El PIN tiene que ser de 4 números' };
  if (/^(\d)\1{3}$/.test(pin) || pin === '1234' || pin === '0000') return { ok: false, error: 'Elegí un PIN menos obvio' };
  actualizar_('USUARIOS', ctx.usuario._fila, { pin_hash: hashPin_(pin, ctx.usuario.legajo), pin_provisorio: 'no' });
  return { ok: true };
}

/** Contrato para módulos: POST {accion:"validar_token", token, modulo?} */
function validarToken_(payload) {
  const s = sesionDe_(payload.token);
  if (!s) return { ok: false, error: 'Sesión inválida o vencida' };
  const modulo = payload.modulo ? String(payload.modulo).toUpperCase() : null;
  if (modulo && !tienePermiso_(s.usuario.legajo, modulo)) return { ok: false, error: 'Sin permiso para ' + modulo };
  return {
    ok: true,
    legajo: s.usuario.legajo,
    nombre_visible: s.usuario.nombre_visible,
    sector: s.usuario.sector,
    rol_en_modulo: modulo ? rolEn_(s.usuario.legajo, modulo) : null,
    modulos: modulosDe_(s.usuario.legajo).map(m => m.codigo)
  };
}

function cerrarSesion_(ctx) {
  borrarFila_('SESIONES', ctx.sesion._fila);
  return { ok: true };
}

function sesionesDe_(legajo) {
  return leer_('SESIONES').filter(s => String(s.legajo) === String(legajo))
    .map(s => ({ token_corto: String(s.token).slice(0, 6) + '…', dispositivo: s.dispositivo, creada: s.creada, ultimo_uso: s.ultimo_uso }));
}

function cerrarSesionesDe_(legajo) {
  // Borrar de abajo hacia arriba para que no se corran las filas.
  leer_('SESIONES').filter(s => String(s.legajo) === String(legajo))
    .sort((a, b) => b._fila - a._fila)
    .forEach(s => hoja_('SESIONES').deleteRow(s._fila));
  invalidar_('SESIONES');
}

/** Limpieza nocturna de sesiones vencidas (trigger). */
function limpiarSesiones() {
  const ahora = Date.now();
  leer_('SESIONES').filter(s => s.expira && new Date(s.expira).getTime() < ahora)
    .sort((a, b) => b._fila - a._fila)
    .forEach(s => hoja_('SESIONES').deleteRow(s._fila));
  invalidar_('SESIONES');
}
