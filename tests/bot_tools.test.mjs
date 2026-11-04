import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, stubs, valor, appIngeco } from './_cargar.mjs';
const plano = x => JSON.parse(JSON.stringify(x));
const ARCHIVOS = ['sheets.js', 'permisos.js', 'bot_fuentes.js', 'bot_tabla.js', 'bot_tools.js'];

function ctxCon(permisos, hojasExtra, props) {
  const g = appIngeco(stubs(), { PERMISOS: permisos });
  Object.assign(g.__hojas, hojasExtra || {});
  Object.assign(g.__props, props || {});
  return cargar(ARCHIVOS, g);
}
const ASF = '1rqS_raTVSxjLpWxxhZU9SKVi5BBvfA7SAb27vSBhRco';
const filasAsfalto = n => [['FECHA', 'STOCK_T', 'RECIBIDO_T']].concat(Array.from({ length: n }, (_, i) => ['2026-10-' + String((i % 28) + 1).padStart(2, '0'), 100 + i, i % 3 ? 0 : 30]));

test('BOT_TOOLS define las 6 herramientas con esquemas estrictos', () => {
  const c = ctxCon([]);
  const T = valor(c, 'BOT_TOOLS');
  assert.deepEqual(plano(T.map(t => t.name)).sort(), ['buscar_texto', 'ficha_equipo', 'leer_tabla', 'listar_fuentes', 'pedidos_compra', 'resumir_tabla']);
  T.forEach(t => {
    assert.equal(t.strict, true, t.name);
    assert.equal(t.input_schema.additionalProperties, false, t.name);
    assert.ok(Array.isArray(t.input_schema.required), t.name);
  });
});

test('ejecutarTool_ rechaza una fuente no habilitada sin abrir la planilla', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'TARJAS' }], { [ASF]: { DIARIO: filasAsfalto(3) } });
  const r = c.ejecutarTool_('7', 'leer_tabla', { fuente: 'asfalto_diario' });
  assert.equal(r.is_error, true);
  assert.match(JSON.stringify(r.resultado), /no habilitada/);
  assert.ok(!c.__abiertas.includes(ASF), 'no abre la planilla de la fuente');
});

test('leer_tabla devuelve filas, total y truncado con límite 300', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: filasAsfalto(400) } });
  const r = c.ejecutarTool_('7', 'leer_tabla', { fuente: 'asfalto_diario', limite: 1000 });
  assert.equal(r.is_error, false);
  assert.equal(r.resultado.filas.length, 300);
  assert.equal(r.resultado.total_coincidencias, 400);
  assert.equal(r.resultado.truncado, true);
  assert.deepEqual(plano(r.fuentes), [{ modulo: 'ASFALTO', tabla: 'DIARIO', fuente: 'asfalto_diario', filas: 400 }]);
});

test('leer_tabla aplica filtros, columnas, orden y límite por defecto 50', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: filasAsfalto(100) } });
  const r = c.ejecutarTool_('7', 'leer_tabla', { fuente: 'asfalto_diario', filtros: [{ col: 'RECIBIDO_T', op: '>', valor: 0 }], columnas: ['FECHA', 'RECIBIDO_T'], orden: { col: 'FECHA', dir: 'desc' } });
  assert.equal(r.resultado.total_coincidencias, 34);
  assert.equal(r.resultado.filas.length, 34);
  assert.deepEqual(Object.keys(r.resultado.filas[0]), ['FECHA', 'RECIBIDO_T']);
  assert.equal(r.resultado.filas[0].FECHA, '2026-10-28');
  const r2 = c.ejecutarTool_('7', 'leer_tabla', { fuente: 'asfalto_diario' });
  assert.equal(r2.resultado.filas.length, 50);
});

test('resumir_tabla agrupa server-side', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { SALIDAS: [['FECHA', 'DESTINO', 'MEZCLA_T'], ['2026-10-01', 'Autovías', 100], ['2026-10-02', 'Autovías', 50], ['2026-10-02', 'Bacheo', 10]] } });
  const r = c.ejecutarTool_('7', 'resumir_tabla', { fuente: 'asfalto_salidas', agrupar_por: ['DESTINO'], metrica: { col: 'MEZCLA_T', fn: 'sum' } });
  assert.deepEqual(plano(r.resultado.grupos), [{ DESTINO: 'Autovías', valor: 150, n: 2 }, { DESTINO: 'Bacheo', valor: 10, n: 1 }]);
});

test('listar_fuentes solo muestra las habilitadas con sus columnas', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: filasAsfalto(2), SALIDAS: [['FECHA', 'DESTINO', 'MEZCLA_T']], CONFIG: [['clave', 'valor', 'desc']] } });
  const r = c.ejecutarTool_('7', 'listar_fuentes', {});
  const ids = r.resultado.fuentes.map(f => f.id);
  assert.ok(ids.includes('asfalto_diario') && !ids.includes('tarjas_diarias'));
  const d = r.resultado.fuentes.find(f => f.id === 'asfalto_diario');
  assert.deepEqual(plano(d.columnas), ['FECHA', 'STOCK_T', 'RECIBIDO_T']);
  assert.equal(d.filas, 2);
});

test('buscar_texto recorre las fuentes habilitadas y acota a 20 por fuente', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: [['FECHA', 'OBS']].concat(Array.from({ length: 30 }, (_, i) => ['2026-10-01', 'Margaritas ' + i])), SALIDAS: [['FECHA', 'DESTINO'], ['2026-10-01', 'Canal Margaritas']], CONFIG: [['clave', 'valor', 'desc']] } });
  const r = c.ejecutarTool_('7', 'buscar_texto', { texto: 'margaritas' });
  const porFuente = {}; r.resultado.coincidencias.forEach(x => { porFuente[x.fuente] = x.filas.length; });
  assert.equal(porFuente.asfalto_diario, 20);
  assert.equal(porFuente.asfalto_salidas, 1);
});

test('ficha_equipo junta lo de cada fuente con clave de equipo', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'TARJAS' }], { TARJA: { EQUIPOS: [['codigo', 'descripcion'], ['RN-03', 'Retro']], TARJAS_2026: [['equipo', 'fecha', 'obra'], ['RN-03', '2026-10-01', 'Margaritas'], ['RN-04', '2026-10-01', 'Otra']], PENDIENTES: [['equipo', 'item']], ABIERTAS: [['equipo']], PERSONAL: [['legajo', 'nombre']] } }, { TARJA_SHEET_ID: 'TARJA' });
  const r = c.ejecutarTool_('7', 'ficha_equipo', { codigo: 'rn03' });
  const t = r.resultado.por_fuente.find(x => x.fuente === 'tarjas_diarias');
  assert.equal(t.filas.length, 1);
  assert.equal(r.resultado.por_fuente.find(x => x.fuente === 'tarjas_equipos').filas[0].descripcion, 'Retro');
});

test('herramienta desconocida es error', () => {
  const c = ctxCon([]);
  assert.equal(c.ejecutarTool_('7', 'nada', {}).is_error, true);
});

test('pedidos_compra sin permiso COMPRAS es error y no llama a la red', () => {
  let llamadas = 0;
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }]);
  c.UrlFetchApp = { fetch: () => { llamadas++; } };
  const r = c.ejecutarTool_('7', 'pedidos_compra', { tabla: 'ordenes' });
  assert.equal(r.is_error, true);
  assert.equal(llamadas, 0);
});

test('listar_fuentes no lee los datos de las planillas', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: filasAsfalto(2), SALIDAS: [['FECHA', 'DESTINO', 'MEZCLA_T']], CONFIG: [['clave', 'valor', 'desc']] } });
  let lecturas = 0;
  const abierto = c.SpreadsheetApp.openById;
  c.SpreadsheetApp.openById = id => { const ss = abierto(id); const orig = ss.getSheetByName; ss.getSheetByName = n => { const sh = orig(n); if (sh) { const g = sh.getDataRange; sh.getDataRange = () => { lecturas++; return g(); }; } return sh; }; return ss; };
  const r = c.ejecutarTool_('7', 'listar_fuentes', {});
  assert.equal(lecturas, 0, 'getDataRange no debe llamarse');
  const d = r.resultado.fuentes.find(f => f.id === 'asfalto_diario');
  assert.deepEqual(plano(d.columnas), ['FECHA', 'STOCK_T', 'RECIBIDO_T']);
  assert.equal(d.filas, 2);
});

test('buscar_texto y ficha_equipo cortan por deadline y marcan parcial', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'ASFALTO' }], { [ASF]: { DIARIO: [['FECHA', 'OBS'], ['2026-10-01', 'Margaritas']], SALIDAS: [['FECHA', 'DESTINO'], ['2026-10-01', 'Margaritas']], CONFIG: [['clave', 'valor', 'desc']] } });
  const r = c.ejecutarTool_('7', 'buscar_texto', { texto: 'margaritas', fuentes: null }, { deadline: Date.now() - 1 });
  assert.equal(r.resultado.parcial, true);
  assert.ok(r.resultado.coincidencias.length < 2);
});

test('pedidos_compra con agrupar_por [] se trata como listado', () => {
  const c = ctxCon([{ legajo: '7', modulo: 'COMPRAS' }], {}, { COMPRAS_RPC_URL: 'https://x/api/rpc', COMPRAS_BOT_CLAVE: 'k' });
  let enviado = null;
  c.UrlFetchApp = { fetch: (u, o) => { enviado = JSON.parse(o.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, columnas: ['a'], filas: [{ a: 1 }], total: 1 }) }; } };
  c.ejecutarTool_('7', 'pedidos_compra', { tabla: 'ordenes', filtros: null, agrupar_por: [], metrica: null, limite: null });
  assert.equal(enviado.args[0].agrupar_por, null);
});
