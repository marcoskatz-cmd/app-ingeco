import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, stubs, valor, appIngeco } from './_cargar.mjs';
const plano = x => JSON.parse(JSON.stringify(x));

const ARCHIVOS = ['sheets.js', 'permisos.js', 'bot_fuentes.js'];

function ctxCon(permisos, hojasExtra) {
  const g = appIngeco(stubs(), { PERMISOS: permisos });
  Object.assign(g.__hojas, hojasExtra || {});
  return cargar(ARCHIVOS, g);
}

test('fuentesDe_ filtra por permiso de módulo', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO', rol: 'USUARIO' }]);
  const ids = c.fuentesDe_('7').map(f => f.modulo);
  assert.ok(ids.length > 0);
  assert.ok(ids.every(m => m === 'ASFALTO'));
});

test('TARJA (código del seed) habilita las fuentes TARJAS', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'TARJA', rol: 'OPERARIO' }]);
  const ids = c.fuentesDe_('7').map(f => f.id);
  assert.ok(ids.includes('tarjas_equipos'), ids.join(','));
});

test('esVedada_ detecta encabezados sensibles', () => {
  const c = ctxCon([]);
  assert.equal(c.esVedada_('Nro. DNI'), true);
  assert.equal(c.esVedada_('Sueldo básico'), true);
  assert.equal(c.esVedada_('OBRA'), false);
  assert.equal(c.esVedada_('HORAS'), false);
});

test('leerFuente_ descarta columnas vedadas y devuelve filas como objetos', () => {
  const c = ctxCon([], { PLAN1: { DATOS: [['EQUIPO', 'SUELDO', 'CUIL', 'HORAS'], ['RN-03', 100, '20-1', 8], ['RN-04', 200, '20-2', 6]] } });
  const r = c.leerFuente_({ id: 'x', modulo: 'ASFALTO', planilla: { id: 'PLAN1' }, hoja: 'DATOS' });
  assert.deepEqual(plano(r.columnas), ['EQUIPO', 'HORAS']);
  assert.equal(r.filas.length, 2);
  assert.deepEqual(plano(r.filas[0]), { EQUIPO: 'RN-03', HORAS: 8 });
});

test('leerFuente_ une hojas por patrón y agrega _hoja', () => {
  const c = ctxCon([], { PLAN2: { TARJAS_2025: [['id', 'equipo'], ['a', 'RN-01']], TARJAS_2026: [['id', 'equipo'], ['b', 'RN-02'], ['c', 'RN-03']], EQUIPOS: [['codigo'], ['RN-01']] } });
  const r = c.leerFuente_({ id: 'y', modulo: 'TARJAS', planilla: { id: 'PLAN2' }, hoja: /^TARJAS_\d{4}$/ });
  assert.equal(r.filas.length, 3);
  assert.deepEqual(plano(r.filas.map(f => f._hoja)), ['TARJAS_2025', 'TARJAS_2026', 'TARJAS_2026']);
});

test('leerFuente_ convierte fechas a ISO y usa caché la segunda vez', () => {
  const c = ctxCon([], { PLAN3: { DIARIO: [['FECHA', 'STOCK_T'], [new Date(2026, 9, 31), 120.5]] } });
  const f = { id: 'z', modulo: 'ASFALTO', planilla: { id: 'PLAN3' }, hoja: 'DIARIO' };
  const r1 = c.leerFuente_(f);
  assert.equal(r1.filas[0].FECHA, '2026-10-31');
  assert.equal(r1.filas[0].STOCK_T, 120.5);
  const abiertas = c.__abiertas.length;
  const r2 = c.leerFuente_(f);
  assert.equal(c.__abiertas.length, abiertas, 'la segunda lectura no abre la planilla');
  assert.deepEqual(r2.filas, r1.filas);
});

test('planilla por Property faltante y sin defecto no rompe: devuelve error_fuente', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'AUTOVIAS' }]);
  const f = Object.assign({}, c.fuentesDe_('7').find(x => x.id === 'autovias_produccion'), { planilla: { prop: 'NO_EXISTE' } });
  const r = c.leerFuente_(f);
  assert.equal(r.error_fuente !== undefined, true);
  assert.deepEqual(plano(r.filas), []);
});

test('planilla por Property usa el id por defecto y la Property lo pisa', () => {
  const c = ctxCon([], { DEF: { PRODUCCION: [['FECHA'], ['2026-10-01']] }, OTRA: { PRODUCCION: [['FECHA'], ['2026-10-02'], ['2026-10-03']] } });
  const f = { id: 'p', modulo: 'AUTOVIAS', planilla: { prop: 'X_ID', id_defecto: 'DEF' }, hoja: 'PRODUCCION' };
  assert.equal(c.leerFuente_(f).filas.length, 1);
  c.__props.X_ID = 'OTRA';
  assert.equal(c.leerFuente_(f).filas.length, 2);
});

test('diccionarioFuentes_ nombra id, módulo y columnas', () => {
  const c = ctxCon([]);
  const F = valor(c, 'FUENTES');
  const d = c.diccionarioFuentes_(F);
  assert.match(d, /asfalto_diario/);
  assert.match(d, /ASFALTO/);
  assert.match(d, /STOCK_T/);
});

test('asfalto_config devuelve las claves útiles (la columna "clave" no es vedada)', () => {
  const c = ctxCon([], { CFG: { CONFIG: [['clave', 'valor', 'desc'], ['PIN', '1234', 'pin'], ['STOCK_MINIMO', 40, 't'], ['PORC_TEORICO', 5.2, '%']] } });
  const f = Object.assign({}, c.fuentePorId_('asfalto_config'), { planilla: { id: 'CFG' } });
  const r = c.leerFuente_(f);
  assert.deepEqual(plano(r.filas.map(x => x.clave)).sort(), ['PORC_TEORICO', 'STOCK_MINIMO']);
  assert.equal(c.esVedada_('CLAVE OBRA'), false);
  assert.equal(c.esVedada_('clave_api'), true);
});
