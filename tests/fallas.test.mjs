import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, stubs, appIngeco } from './_cargar.mjs';

const AHORA = Date.UTC(2026, 10, 12, 15, 0, 0);

function ctxBackend() {
  const g = appIngeco(stubs());
  return cargar(['sheets.js', 'permisos.js', 'admin.js', 'fallas.js'], g);
}

test('normalizarFallas_ recorta, valida tipo y descarta fechas absurdas', () => {
  const b = ctxBackend();
  const r = b.normalizarFallas_([
    { t: AHORA - 60000, accion: 'bandeja', tipo: 'timeout', ms: 25000.4, online: true, internet: false, google: false, conexion: '4g' },
    { t: AHORA - 8 * 86400000, accion: 'perfil', tipo: 'red' },            // más de 7 días: fuera
    { t: AHORA + 3600000, accion: 'perfil', tipo: 'red' },                 // en el futuro: fuera
    { t: AHORA, accion: 'x'.repeat(100), tipo: 'cualquiera', detalle: 'a\nb' },
    null
  ], AHORA);
  assert.equal(r.length, 2);
  assert.equal(r[0].tipo, 'timeout');
  assert.equal(r[0].ms, 25000);
  assert.equal(r[0].online, 'sí');
  assert.equal(r[0].internet, 'no');
  assert.equal(r[0].google, 'no');
  assert.equal(r[1].tipo, 'red');
  assert.equal(r[1].accion.length, 40);
  assert.equal(r[1].detalle, 'a b');
  assert.equal(r[1].internet, '');
});

test('normalizarFallas_ tolera basura y limita el lote', () => {
  const b = ctxBackend();
  assert.equal(b.normalizarFallas_('nada', AHORA).length, 0);
  const muchas = Array.from({ length: 80 }, () => ({ t: AHORA, tipo: 'red' }));
  assert.equal(b.normalizarFallas_(muchas, AHORA).length, 50);
});

test('reportarFallas_ guarda una fila por falla en FALLAS_RED con el legajo de la sesión', () => {
  const b = ctxBackend();
  const r = b.reportarFallas_({ usuario: { legajo: '7' } }, { dispositivo: 'Android', fallas: [{ t: Date.now(), accion: 'bandeja', tipo: 'timeout', ms: 25000 }] });
  assert.equal(r.ok, true);
  assert.equal(r.guardadas, 1);
  const hoja = b.__hojas.APP.FALLAS_RED;
  assert.equal(hoja.length, 2);  // encabezado + 1
  const enc = hoja[0];
  assert.equal(hoja[1][enc.indexOf('legajo')], '7');
  assert.equal(hoja[1][enc.indexOf('accion')], 'bandeja');
  assert.equal(hoja[1][enc.indexOf('dispositivo')], 'Android');
});
