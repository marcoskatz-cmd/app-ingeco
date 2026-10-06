/**
 * sheets.js — acceso a la planilla APP_INGECO con verificación de columnas.
 *
 * Ninguna hoja se edita a mano: todo pasa por acá. Si una columna cambia de nombre
 * o falta, diagnostico() lo detecta y Admin lo muestra (auto-diagnóstico tipo META de INGECOV).
 */

const HOJAS = {
  USUARIOS: ['legajo', 'nombre_visible', 'nombre_norm', 'alias_norm', 'sector', 'celular', 'pin_hash',
    'pin_provisorio', 'activo', 'intentos_fallidos', 'bloqueado_hasta', 'creado_por', 'fecha_alta'],
  MODULOS: ['codigo', 'nombre', 'descripcion_corta', 'url', 'tipo', 'icono', 'orden', 'activo',
    'responsable_legajo', 'responsable_celular'],
  PERMISOS: ['legajo', 'modulo', 'rol', 'otorgado_por', 'fecha'],
  SESIONES: ['token', 'legajo', 'dispositivo', 'creada', 'ultimo_uso', 'expira'],
  AVISOS: ['id', 'fecha', 'legajo', 'modulo', 'tipo', 'titulo', 'cuerpo', 'url_destino', 'prioridad',
    'canales_enviados', 'leido', 'fecha_leido'],
  SUSCRIPCIONES: ['legajo', 'endpoint', 'p256dh', 'auth', 'dispositivo', 'creada', 'ultimo_envio_ok', 'fallos'],
  INSTRUCTIVOS: ['modulo', 'seccion', 'texto', 'actualizado'],
  CONSULTAS_BOT: ['fecha', 'legajo', 'modulo_contexto', 'pregunta', 'respuesta', 'tokens', 'util']
};

// Memo por request: cada hoja se lee una sola vez por ejecución.
const _memo = {};

function prop_(clave, obligatoria) {
  const v = PropertiesService.getScriptProperties().getProperty(clave);
  if (!v && obligatoria) throw new Error('Falta la propiedad ' + clave + ' en PropertiesService');
  return v || '';
}

function ss_() {
  if (_memo.__ss) return _memo.__ss;
  const id = prop_('SPREADSHEET_ID', true);
  _memo.__ss = SpreadsheetApp.openById(id);
  return _memo.__ss;
}

function hoja_(nombre) {
  if (!HOJAS[nombre]) throw new Error('Hoja desconocida: ' + nombre);
  let sh = ss_().getSheetByName(nombre);
  if (!sh) {
    sh = ss_().insertSheet(nombre);
    sh.appendRow(HOJAS[nombre]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function encabezados_(nombre) {
  const sh = hoja_(nombre);
  const ancho = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, ancho).getValues()[0].map(h => String(h).trim());
}

/** Devuelve [{...campos, _fila}] con _fila = número de fila real (base 1). */
function leer_(nombre) {
  if (_memo[nombre]) return _memo[nombre];
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  const n = sh.getLastRow();
  const filas = [];
  if (n > 1) {
    const vals = sh.getRange(2, 1, n - 1, enc.length).getValues();
    vals.forEach((v, i) => {
      const o = { _fila: i + 2 };
      enc.forEach((h, j) => { if (h) o[h] = v[j]; });
      filas.push(o);
    });
  }
  _memo[nombre] = filas;
  return filas;
}

function invalidar_(nombre) { delete _memo[nombre]; }

function agregar_(nombre, obj) {
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  const fila = enc.map(h => (obj[h] === undefined || obj[h] === null) ? '' : obj[h]);
  sh.appendRow(fila);
  invalidar_(nombre);
  return sh.getLastRow();
}

function agregarVarias_(nombre, objs) {
  if (!objs.length) return;
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  const filas = objs.map(o => enc.map(h => (o[h] === undefined || o[h] === null) ? '' : o[h]));
  sh.getRange(sh.getLastRow() + 1, 1, filas.length, enc.length).setValues(filas);
  invalidar_(nombre);
}

function actualizar_(nombre, fila, cambios) {
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  Object.keys(cambios).forEach(k => {
    const col = enc.indexOf(k);
    if (col < 0) throw new Error('Columna ' + k + ' no existe en ' + nombre);
    sh.getRange(fila, col + 1).setValue(cambios[k]);
  });
  invalidar_(nombre);
}

function borrarFila_(nombre, fila) {
  hoja_(nombre).deleteRow(fila);
  invalidar_(nombre);
}

/** Reporta columnas faltantes o sobrantes por hoja. Lo muestra Admin. */
function diagnostico_() {
  const problemas = [];
  Object.keys(HOJAS).forEach(nombre => {
    const sh = ss_().getSheetByName(nombre);
    if (!sh) { problemas.push({ hoja: nombre, problema: 'La hoja no existe (se crea sola al primer uso)' }); return; }
    const enc = encabezados_(nombre).filter(Boolean);
    HOJAS[nombre].forEach(c => { if (enc.indexOf(c) < 0) problemas.push({ hoja: nombre, problema: 'Falta la columna "' + c + '"' }); });
    enc.forEach(c => { if (HOJAS[nombre].indexOf(c) < 0) problemas.push({ hoja: nombre, problema: 'Columna desconocida "' + c + '" (¿se renombró?)' }); });
  });
  return { ok: problemas.length === 0, problemas, planilla: ss_().getName(), fecha: new Date() };
}

function ahora_() { return new Date(); }
function si_(v) { return v === true || String(v).toLowerCase() === 'sí' || String(v).toLowerCase() === 'si' || String(v).toLowerCase() === 'true'; }
function uuid_() { return Utilities.getUuid(); }
