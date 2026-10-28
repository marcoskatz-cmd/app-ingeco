/**
 * sheets.js — acceso a la planilla APP_INGECO con verificación de columnas.
 *
 * Ninguna hoja se edita a mano: todo pasa por acá. Si una columna cambia de nombre
 * o falta, diagnostico() lo detecta y Admin lo muestra (auto-diagnóstico tipo META de INGECOV).
 */

const HOJAS = {
  USUARIOS: ['legajo', 'nombre_visible', 'email', 'sector', 'celular', 'activo', 'creado_por', 'fecha_alta', 'ultimo_ingreso',
    'tipo', 'areas', 'obra', 'token_lector'],
  AREAS: ['codigo', 'nombre', 'orden', 'activo'],
  OBRAS: ['codigo', 'nombre', 'activo'],
  COMUNICADOS: ['id', 'fecha', 'emisor_legajo', 'titulo', 'cuerpo', 'url', 'adjunto_url', 'adjunto_nombre', 'prioridad',
    'destinatarios', 'estado', 'programado_para', 'aprobado_por', 'fecha_aprobacion', 'motivo_rechazo', 'fecha_envio',
    'total_destinatarios', 'reenvios'],
  MODULOS: ['codigo', 'nombre', 'descripcion_corta', 'url', 'tipo', 'icono', 'orden', 'activo',
    'responsable_legajo', 'responsable_celular'],
  PERMISOS: ['legajo', 'modulo', 'rol', 'otorgado_por', 'fecha'],
  SESIONES: ['token', 'legajo', 'dispositivo', 'creada', 'ultimo_uso', 'expira'],
  AVISOS: ['id', 'fecha', 'legajo', 'modulo', 'tipo', 'titulo', 'cuerpo', 'url_destino', 'prioridad',
    'canales_enviados', 'leido', 'fecha_leido', 'comunicado_id', 'clave_unica'],
  SUSCRIPCIONES: ['legajo', 'endpoint', 'p256dh', 'auth', 'dispositivo', 'creada', 'ultimo_envio_ok', 'fallos'],
  INSTRUCTIVOS: ['modulo', 'seccion', 'texto', 'actualizado'],
  TICKETS: ['ticket', 'legajo', 'modulo', 'creado', 'usado', 'sesion'],
  CONSULTAS_BOT: ['fecha', 'legajo', 'modulo_contexto', 'pregunta', 'respuesta', 'tokens', 'util']
};

// Memo por request: cada hoja se lee una sola vez por ejecución.
const _memo = {};

function prop_(clave, obligatoria) {
  let v = PropertiesService.getScriptProperties().getProperty(clave);
  if (clave === 'SHELL_URL' && v && urlNueva_(v) !== v) {
    v = urlNueva_(v);
    PropertiesService.getScriptProperties().setProperty(clave, v);
  }
  if (!v && obligatoria) throw new Error('Falta la propiedad ' + clave + ' en PropertiesService');
  return v || '';
}

function ss_() {
  if (_memo.__ss) return _memo.__ss;
  const id = prop_('SPREADSHEET_ID', true);
  _memo.__ss = SpreadsheetApp.openById(id);
  marca_('abrir');
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

// Cada lectura a la planilla cuesta 0,3–0,6 s aunque la hoja sea chica, y un pedido leía 4 o 5.
// Las tablas chicas que se leen en TODOS los pedidos se guardan en la caché del script; cualquier
// escritura hecha por este código las invalida. Si alguien edita la planilla a mano, se ve en ≤ 2 min.
const CACHEABLES = { USUARIOS: 1, PERMISOS: 1, MODULOS: 1, SESIONES: 1 };
const CACHE_SEG = 120;
function cache_() { return CacheService.getScriptCache(); }

function encabezados_(nombre) {
  const k = 'enc:' + nombre;
  if (_memo[k]) return _memo[k];
  const c = cache_().get(k);
  if (c) return (_memo[k] = JSON.parse(c));
  const sh = hoja_(nombre);
  const ancho = Math.max(sh.getLastColumn(), 1);
  const enc = sh.getRange(1, 1, 1, ancho).getValues()[0].map(h => String(h).trim());
  try { cache_().put(k, JSON.stringify(enc), 21600); } catch (e) { }
  return (_memo[k] = enc);
}

/** Devuelve [{...campos, _fila}] con _fila = número de fila real (base 1). */
function leer_(nombre) {
  if (_memo[nombre]) return _memo[nombre];
  if (CACHEABLES[nombre]) {
    const c = cache_().get('tab:' + nombre);
    if (c) { marca_(nombre + '(caché)'); return (_memo[nombre] = JSON.parse(c)); }
  }
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
  if (CACHEABLES[nombre]) { try { cache_().put('tab:' + nombre, JSON.stringify(filas), CACHE_SEG); } catch (e) { } }
  marca_(nombre + '(' + filas.length + ')');
  return filas;
}

function invalidar_(nombre) {
  delete _memo[nombre]; delete _memo['cola:' + nombre];
  if (CACHEABLES[nombre]) cache_().remove('tab:' + nombre);
}

/** Busca UNA fila por valor exacto de una columna sin leer la hoja entera (TextFinder). Para hojas que crecen. */
function buscar_(nombre, campo, valor) {
  if (!valor) return null;
  if (CACHEABLES[nombre]) return leer_(nombre).find(x => String(x[campo]) === String(valor)) || null;
  if (_memo[nombre]) return _memo[nombre].find(x => String(x[campo]) === String(valor)) || null;
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  const col = enc.indexOf(campo);
  const n = sh.getLastRow();
  if (col < 0 || n < 2) return null;
  const celda = sh.getRange(2, col + 1, n - 1, 1).createTextFinder(String(valor)).matchEntireCell(true).findNext();
  marca_('buscar ' + nombre + '(' + n + ')');
  if (!celda) return null;
  const fila = celda.getRow();
  const v = sh.getRange(fila, 1, 1, enc.length).getValues()[0];
  const o = { _fila: fila };
  enc.forEach((h, j) => { if (h) o[h] = v[j]; });
  return o;
}

/** Últimas `max` filas (las hojas de avisos crecen todo el año; lo viejo no hace falta para la bandeja). */
function leerCola_(nombre, max) {
  const k = 'cola:' + nombre;
  if (_memo[nombre]) return _memo[nombre].slice(-max);
  if (_memo[k]) return _memo[k];
  const sh = hoja_(nombre);
  const enc = encabezados_(nombre);
  const n = sh.getLastRow();
  const filas = [];
  if (n > 1) {
    const desde = Math.max(2, n - max + 1);
    sh.getRange(desde, 1, n - desde + 1, enc.length).getValues().forEach((v, i) => {
      const o = { _fila: desde + i };
      enc.forEach((h, j) => { if (h) o[h] = v[j]; });
      filas.push(o);
    });
  }
  _memo[k] = filas;
  marca_('cola ' + nombre + '(' + filas.length + ')');
  return filas;
}

/** Si el objeto trae columnas del esquema que la hoja todavía no tiene (migración), las agrega. */
function asegurarColumnasDe_(nombre, obj) {
  const enc = encabezados_(nombre);
  if (Object.keys(obj).some(k => enc.indexOf(k) < 0 && (HOJAS[nombre] || []).indexOf(k) >= 0)) asegurarColumnas_();
}

function agregar_(nombre, obj) {
  asegurarColumnasDe_(nombre, obj);
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
  asegurarColumnasDe_(nombre, cambios);
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

/** Agrega al final las columnas que falten en cada hoja (migraciones). No borra ni mueve nada. */
function asegurarColumnas_() {
  const agregadas = [];
  Object.keys(HOJAS).forEach(nombre => {
    const sh = hoja_(nombre);
    const enc = encabezados_(nombre).filter(Boolean);
    const faltan = HOJAS[nombre].filter(c => enc.indexOf(c) < 0);
    if (faltan.length) {
      sh.getRange(1, enc.length + 1, 1, faltan.length).setValues([faltan]);
      agregadas.push(nombre + ': ' + faltan.join(', '));
    }
  });
  Object.keys(_memo).forEach(k => delete _memo[k]);
  if (agregadas.length) cache_().removeAll(Object.keys(HOJAS).map(h => 'enc:' + h).concat(Object.keys(CACHEABLES).map(h => 'tab:' + h)));
  return agregadas;
}

/** Reporta columnas faltantes o sobrantes por hoja. Lo muestra Admin. */
function diagnostico_() {
  const problemas = [];
  // Primero se agregan solas las columnas nuevas del esquema (migración automática); después se revisa lo que no se puede arreglar solo.
  let agregadas = [];
  try { agregadas = asegurarColumnas_(); } catch (e) { problemas.push({ hoja: '-', problema: 'No se pudieron agregar columnas: ' + e }); }
  Object.keys(HOJAS).forEach(nombre => {
    const sh = ss_().getSheetByName(nombre);
    if (!sh) { problemas.push({ hoja: nombre, problema: 'La hoja no existe (se crea sola al primer uso)' }); return; }
    const enc = encabezados_(nombre).filter(Boolean);
    HOJAS[nombre].forEach(c => { if (enc.indexOf(c) < 0) problemas.push({ hoja: nombre, problema: 'Falta la columna "' + c + '"' }); });
    enc.forEach(c => { if (HOJAS[nombre].indexOf(c) < 0) problemas.push({ hoja: nombre, problema: 'Columna desconocida "' + c + '" (¿se renombró?)' }); });
  });
  return { ok: problemas.length === 0, problemas, agregadas, planilla: ss_().getName(), fecha: new Date() };
}

function ahora_() { return new Date(); }
function si_(v) { return v === true || String(v).toLowerCase() === 'sí' || String(v).toLowerCase() === 'si' || String(v).toLowerCase() === 'true'; }
function uuid_() { return Utilities.getUuid(); }
