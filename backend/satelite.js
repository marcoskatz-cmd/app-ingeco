/**
 * Satélite de Google (Apps Script). Corre con la cuenta de Marcos y hace lo que la plataforma no puede hacer
 * sola del lado de Google:
 *   - espejar(): copia a cada planilla de Google las pestañas que cambiaron en la plataforma, para que el
 *     tablero de María y cualquiera que mire la planilla sigan viendo los datos al día. La planilla pasa a ser
 *     una copia: lo que se escriba a mano en ella se pisa en la próxima copia.
 *   - refrescarExternos(): al revés, trae a la plataforma las planillas de otras personas (mantenimiento,
 *     combustible) que los sistemas leen. Solo manda lo que cambió.
 *   - latido(): avisa a la plataforma que corra sus tareas programadas (mientras no haya Vercel Pro).
 *
 * Script Properties: PLATAFORMA_URL (ej. https://ingeco-plataforma.vercel.app) y PLATAFORMA_CLAVE.
 * Triggers: los instala sateliteInstalar_ (espejar cada 5 minutos; los otros dos solo si se piden).
 * Este archivo vive en el proyecto de Apps Script de App INGECO porque ya tiene los permisos necesarios.
 */
var ESPEJO_TOPE_MS = 4.5 * 60 * 1000;   // una ejecución de Apps Script dura como mucho 6 minutos
var ESPEJO_TRAMO = 1000;
var EXTERNO_MAX_BYTES = 3500000;        // Vercel no acepta pedidos de más de 4,5 MB

function plataforma_(servicio, cuerpo) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('PLATAFORMA_URL'), clave = props.getProperty('PLATAFORMA_CLAVE');
  if (!url || !clave) throw new Error('Faltan PLATAFORMA_URL o PLATAFORMA_CLAVE');
  var r = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/api/' + servicio, {
    method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ clave: clave }, cuerpo || {}))
  });
  var j;
  try { j = JSON.parse(r.getContentText()); } catch (e) { throw new Error('La plataforma respondió algo que no es JSON (' + r.getResponseCode() + ')'); }
  if (!j.ok) throw new Error('La plataforma rechazó ' + servicio + ': ' + (j.error || r.getResponseCode()));
  return j;
}

function latido() { return plataforma_('_tareas', {}).corridas; }

// ───────────── Plataforma → planilla de Google ─────────────

function espejar() {
  var t0 = Date.now(), hechas = [], salteadas = [];
  var pendientes = plataforma_('_espejo', { accion: 'pendientes' }).pendientes;
  for (var i = 0; i < pendientes.length; i++) {
    if (Date.now() - t0 > ESPEJO_TOPE_MS) { salteadas.push(pendientes[i].libro + '/' + pendientes[i].hoja + ' (sin tiempo)'); continue; }
    try {
      if (espejarHoja_(pendientes[i], true)) hechas.push(pendientes[i].libro + '/' + pendientes[i].hoja);
      else salteadas.push(pendientes[i].libro + '/' + pendientes[i].hoja + ' (cambió mientras se copiaba)');
    } catch (e) { salteadas.push(pendientes[i].libro + '/' + pendientes[i].hoja + ' (' + e.message + ')'); }
  }
  return { hechas: hechas, salteadas: salteadas };
}

/** Copia una pestaña entera. Devuelve false si cambió mientras se leía (se reintenta en la próxima pasada). */
function espejarHoja_(p, confirmar) {
  var filas = [], version = null, desde = 1;
  while (true) {
    var r = plataforma_('_espejo', { accion: 'leer', libro: p.libro, hoja: p.hoja, desde: desde, cuantas: ESPEJO_TRAMO });
    if (r.version === null) return true;            // la pestaña ya no existe en la plataforma: nada que copiar
    if (version === null) version = r.version; else if (r.version !== version) return false;
    for (var k = 0; k < r.filas.length; k++) filas.push(JSON.parse(r.filas[k]));
    desde += r.filas.length;
    if (!r.filas.length || filas.length >= r.total) break;
  }
  var ancho = 0;
  filas.forEach(function (f) { if (f.length > ancho) ancho = f.length; });
  var ss = SpreadsheetApp.openById(p.idGoogle);
  var sh = ss.getSheetByName(p.hoja) || ss.insertSheet(p.hoja);
  if (filas.length && ancho) {
    var datos = filas.map(function (f) {
      var fila = [];
      for (var j = 0; j < ancho; j++) fila.push(celdaGoogle_(f[j]));
      return fila;
    });
    sh.getRange(1, 1, datos.length, ancho).setValues(datos);
  }
  // Lo que sobra respecto de la plataforma se vacía (no se borran filas ni columnas: se conserva el formato).
  var ultFila = sh.getLastRow(), ultCol = sh.getLastColumn();
  if (ultFila > filas.length && ultCol > 0) sh.getRange(filas.length + 1, 1, ultFila - filas.length, ultCol).clearContent();
  if (ultCol > ancho && filas.length) sh.getRange(1, ancho + 1, filas.length, ultCol - ancho).clearContent();
  if (confirmar) plataforma_('_espejo', { accion: 'confirmar', libro: p.libro, hoja: p.hoja, version: version });
  return true;
}

/** Celda de la plataforma → valor para Sheets. Los textos que Sheets convertiría solo se fuerzan a texto. */
function celdaGoogle_(c) {
  if (c === null || c === undefined) return '';
  if (typeof c === 'object') {
    if (c.d) return new Date(c.d);
    if (c.fx) return c.fx;
    return '';
  }
  if (typeof c === 'string' && c !== '' && /^\s*([+-]?\d+([.,]\d+)?|\d{4}-\d{1,2}-\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{4}.*|true|false|=.*|'.*)\s*$/i.test(c)) return "'" + c;
  return c;
}

/**
 * Prueba sin riesgo: duplica la planilla de un libro, copia sobre el DUPLICADO todo lo que hay en la plataforma y
 * compara celda por celda el duplicado contra la planilla original. No toca la original. Devuelve las diferencias.
 */
function sateliteProbarCopia_(libro) {
  var info = plataforma_('_espejo', { accion: 'hojas', libro: libro });
  if (!info.idGoogle) throw new Error('El libro ' + libro + ' no tiene planilla de Google asociada');
  var original = SpreadsheetApp.openById(info.idGoogle);
  var nombres = info.hojas.map(function (h) { return h.hoja; });
  var idCopia = typeof DUPLICADOR_DE_PRUEBA === 'function' ? DUPLICADOR_DE_PRUEBA(info.idGoogle, nombres) : duplicarParaPrueba_(original, nombres);
  var out = { libro: libro, hojas: [], diferencias: [], copia: idCopia };
  {
    info.hojas.forEach(function (h) { espejarHoja_({ libro: libro, hoja: h.hoja, idGoogle: idCopia }, false); });
    SpreadsheetApp.flush();
    var dup = SpreadsheetApp.openById(idCopia);
    info.hojas.forEach(function (h) {
      var a = original.getSheetByName(h.hoja), b = dup.getSheetByName(h.hoja);
      if (!a || !b) { out.diferencias.push(h.hoja + ': falta la pestaña en ' + (a ? 'la copia' : 'la original')); return; }
      var fa = a.getLastRow(), fb = b.getLastRow(), ca = a.getLastColumn(), cb = b.getLastColumn();
      out.hojas.push(h.hoja + ' ' + fa + 'x' + ca);
      if (fa !== fb || ca !== cb) out.diferencias.push(h.hoja + ': tamaño ' + fa + 'x' + ca + ' en la original y ' + fb + 'x' + cb + ' en la copia');
      var n = Math.min(fa, fb), m = Math.min(ca, cb);
      if (!n || !m) return;
      var va = a.getRange(1, 1, n, m).getValues(), vb = b.getRange(1, 1, n, m).getValues();
      var fxa = a.getRange(1, 1, n, m).getFormulas(), fxb = b.getRange(1, 1, n, m).getFormulas();
      for (var i = 0; i < n && out.diferencias.length < 25; i++) for (var j = 0; j < m; j++) {
        var x = va[i][j], y = vb[i][j];
        var igual = (x instanceof Date && y instanceof Date) ? x.getTime() === y.getTime() : (typeof x === typeof y && x === y);
        if (!igual || fxa[i][j] !== fxb[i][j]) out.diferencias.push(h.hoja + ' fila ' + (i + 1) + ' col ' + (j + 1) + ': ' + typeof x + ' ' + String(x).slice(0, 30) + ' ≠ ' + typeof y + ' ' + String(y).slice(0, 30));
      }
    });
  }
  return out;
}

/**
 * Deja en la planilla de pruebas (una sola, se reutiliza; su ID queda en la property ESPEJO_PRUEBA_ID) una copia
 * de las pestañas pedidas de la planilla original. Solo necesita el permiso de planillas.
 */
function duplicarParaPrueba_(original, nombres) {
  var props = PropertiesService.getScriptProperties(), dup = null;
  var id = props.getProperty('ESPEJO_PRUEBA_ID');
  if (id) { try { dup = SpreadsheetApp.openById(id); } catch (e) { dup = null; } }
  if (!dup) { dup = SpreadsheetApp.create('PRUEBAS del espejo — plataforma INGECO (se puede borrar)'); props.setProperty('ESPEJO_PRUEBA_ID', dup.getId()); }
  var tmp = dup.insertSheet('tmp-' + Date.now());
  dup.getSheets().forEach(function (s) { if (s.getSheetId() !== tmp.getSheetId()) dup.deleteSheet(s); });
  // Se copia la pestaña (para conservar sus formatos) y se le vacía el contenido: así, lo que se compare después
  // contra la original lo escribió todo el espejo.
  nombres.forEach(function (n) { var o = original.getSheetByName(n); if (o) o.copyTo(dup).setName(n).clearContents(); });
  dup.deleteSheet(tmp);
  SpreadsheetApp.flush();
  return dup.getId();
}

// ───────────── Planillas de otros → plataforma ─────────────

function refrescarExternos() {
  var t0 = Date.now(), props = PropertiesService.getScriptProperties();
  var lista = plataforma_('_espejo', { accion: 'externos' }).externos;
  var hechas = [], iguales = 0, fallas = [];
  for (var i = 0; i < lista.length; i++) {
    var x = lista[i], ss;
    if (Date.now() - t0 > ESPEJO_TOPE_MS) { fallas.push(x.libro + ' (sin tiempo)'); continue; }
    try { ss = SpreadsheetApp.openById(x.idGoogle); } catch (e) { fallas.push(x.libro + ' (no se pudo abrir: ' + e.message + ')'); continue; }
    var hojas = ss.getSheets();
    for (var k = 0; k < hojas.length; k++) {
      var sh = hojas[k], nombre = sh.getName();
      if (x.hojas && x.hojas.indexOf(nombre) < 0) continue;
      try {
        var t = leerHojaTipada_(sh);
        var cuerpo = JSON.stringify(t.filas);
        var huella = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, cuerpo, Utilities.Charset.UTF_8));
        var clave = 'ext:' + x.libro + ':' + nombre;
        if (props.getProperty(clave) === huella) { iguales++; continue; }
        if (cuerpo.length > EXTERNO_MAX_BYTES) { fallas.push(x.libro + '/' + nombre + ' (demasiado grande: ' + cuerpo.length + ' bytes)'); continue; }
        plataforma_('_espejo', { accion: 'cargar_externo', libro: x.libro, hoja: nombre, filas: t.filas, meta: t.meta, orden: k + 1 });
        props.setProperty(clave, huella);
        hechas.push(x.libro + '/' + nombre + ' (' + t.filas.length + ' filas)');
      } catch (e) { fallas.push(x.libro + '/' + nombre + ' (' + e.message + ')'); }
    }
  }
  return { hechas: hechas, sin_cambios: iguales, fallas: fallas };
}

/** Lee una pestaña con sus tipos: una cadena JSON por fila, como las guarda la plataforma. */
function leerHojaTipada_(sh) {
  var ultima = sh.getLastRow(), cols = sh.getLastColumn(), filas = [], meta = {};
  if (ultima > 0 && cols > 0) {
    var rg = sh.getRange(1, 1, ultima, cols), v = rg.getValues(), f = rg.getFormulas();
    for (var i = 0; i < v.length; i++) {
      var fila = [];
      for (var j = 0; j < cols; j++) {
        var c = v[i][j];
        var val = c instanceof Date ? (isNaN(c.getTime()) ? '' : { d: c.toISOString() }) : c;
        fila.push(f[i][j] ? { fx: f[i][j], v: val } : val);
      }
      var n = fila.length;
      while (n > 0 && (fila[n - 1] === '' || fila[n - 1] === null)) n--;
      filas.push(JSON.stringify(fila.slice(0, n)));
    }
    while (filas.length && filas[filas.length - 1] === '[]') filas.pop();
    var fmt = sh.getRange(Math.min(2, ultima), 1, 1, cols).getNumberFormats()[0], texto = [];
    for (var k = 0; k < fmt.length; k++) if (fmt[k] === '@') texto.push(k);
    if (texto.length) meta.texto = texto;
    if (sh.getFrozenRows()) meta.congeladas = sh.getFrozenRows();
  }
  return { filas: filas, meta: meta };
}

// ───────────── Instalación ─────────────

/** Guarda la dirección y la clave de la plataforma y deja los triggers pedidos. Se llama una vez desde un despliegue temporal. */
function sateliteInstalar_(url, clave, opciones) {
  var o = opciones || {};
  if (url && clave) PropertiesService.getScriptProperties().setProperties({ PLATAFORMA_URL: url, PLATAFORMA_CLAVE: clave }, false);
  var propias = ['espejar', 'refrescarExternos', 'latido'];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (propias.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('espejar').timeBased().everyMinutes(5).create();
  if (o.externos) ScriptApp.newTrigger('refrescarExternos').timeBased().everyMinutes(15).create();
  if (o.latido) ScriptApp.newTrigger('latido').timeBased().everyMinutes(1).create();
  return ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
}
