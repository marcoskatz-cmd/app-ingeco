import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, stubs } from './_cargar.mjs';
const plano = x => JSON.parse(JSON.stringify(x));
const c = cargar(['bot_tabla.js'], stubs());

test('numero_ entiende formatos argentinos', () => {
  assert.equal(c.numero_('1.234,5'), 1234.5);
  assert.equal(c.numero_('1234.5'), 1234.5);
  assert.equal(c.numero_(12), 12);
  assert.equal(c.numero_(''), null);
  assert.equal(c.numero_('$ 2.500'), 2500);
  assert.equal(c.numero_('abc'), null);
});

test('filtro >= con fechas ISO compara como fecha y descarta vacíos', () => {
  const filas = [{ FECHA: '2026-10-01' }, { FECHA: '2026-09-30' }, { FECHA: '' }];
  const r = c.aplicarFiltros_(filas, [{ col: 'FECHA', op: '>=', valor: '2026-10-01' }]);
  assert.deepEqual(plano(r), [{ FECHA: '2026-10-01' }]);
});

test('filtro contiene ignora acentos y mayúsculas', () => {
  const r = c.aplicarFiltros_([{ OBRA: 'Canal Margaritas' }, { OBRA: 'Autovía' }], [{ col: 'OBRA', op: 'contiene', valor: 'MARGARITAS' }]);
  assert.equal(r.length, 1);
  const r2 = c.aplicarFiltros_([{ OBRA: 'Autovía Norte' }], [{ col: 'OBRA', op: 'contiene', valor: 'autovia' }]);
  assert.equal(r2.length, 1);
});

test('filtro en, entre, != y =', () => {
  const filas = [{ E: 'A', T: 1, F: '2026-10-05' }, { E: 'B', T: 2, F: '2026-10-31' }, { E: 'C', T: 3, F: '2026-11-01' }];
  assert.equal(c.aplicarFiltros_(filas, [{ col: 'E', op: 'en', valor: ['A', 'B'] }]).length, 2);
  assert.equal(c.aplicarFiltros_(filas, [{ col: 'F', op: 'entre', valor: ['2026-10-01', '2026-10-31'] }]).length, 2);
  assert.equal(c.aplicarFiltros_(filas, [{ col: 'E', op: '!=', valor: 'a' }]).length, 2);
  assert.equal(c.aplicarFiltros_(filas, [{ col: 'T', op: '=', valor: '2' }]).length, 1);
  assert.equal(c.aplicarFiltros_(filas, [{ col: 'T', op: '>', valor: 1 }, { col: 'T', op: '<', valor: 3 }]).length, 1);
});

test('filtro sobre columna inexistente no matchea nada', () => {
  assert.equal(c.aplicarFiltros_([{ A: 1 }], [{ col: 'B', op: '=', valor: 1 }]).length, 0);
});

test('resumir_ sum por grupo con números formateados', () => {
  const filas = [{ D: 'Autovías', T: '1.000,5' }, { D: 'Autovías', T: 2 }, { D: 'Bacheo', T: 1 }];
  const r = c.resumir_(filas, ['D'], { col: 'T', fn: 'sum' });
  assert.deepEqual(plano(r), [{ D: 'Autovías', valor: 1002.5, n: 2 }, { D: 'Bacheo', valor: 1, n: 1 }]);
});

test('resumir_ count sin columna y avg/min/max', () => {
  const filas = [{ D: 'x', T: 2 }, { D: 'x', T: 4 }];
  assert.deepEqual(plano(c.resumir_(filas, ['D'], { fn: 'count' })), [{ D: 'x', valor: 2, n: 2 }]);
  assert.equal(c.resumir_(filas, [], { col: 'T', fn: 'avg' })[0].valor, 3);
  assert.equal(c.resumir_(filas, [], { col: 'T', fn: 'min' })[0].valor, 2);
  assert.equal(c.resumir_(filas, [], { col: 'T', fn: 'max' })[0].valor, 4);
});

test('resumir_ por dos columnas', () => {
  const filas = [{ A: 1, B: 'p', T: 1 }, { A: 1, B: 'q', T: 1 }, { A: 1, B: 'p', T: 5 }];
  const r = c.resumir_(filas, ['A', 'B'], { col: 'T', fn: 'sum' });
  assert.equal(r.length, 2);
  assert.equal(r.find(x => x.B === 'p').valor, 6);
});

test('ordenarFilas_ por fecha desc y por número', () => {
  const filas = [{ F: '2026-01-02', N: '10' }, { F: '2026-01-10', N: '9' }];
  assert.equal(c.ordenarFilas_(filas, { col: 'F', dir: 'desc' })[0].F, '2026-01-10');
  assert.equal(c.ordenarFilas_(filas, { col: 'N', dir: 'desc' })[0].N, '10');
});

test('buscarTexto_ encuentra en cualquier columna sin acentos', () => {
  const filas = [{ A: 'x', B: 'Canal MARGARITAS' }, { A: 'margarita flor', B: '' }, { A: 'nada', B: 'nada' }];
  assert.equal(c.buscarTexto_(filas, 'margaritas').length, 1);
  assert.equal(c.buscarTexto_(filas, 'margarita').length, 2);
});
