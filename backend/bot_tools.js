/**
 * bot_tools.js — herramientas de IngeBot: definición para Claude y ejecución con permiso.
 *
 * Son genéricas (no una por sistema). Cada ejecución recibe el legajo desde el backend,
 * nunca desde Claude, y verifica que la fuente pedida esté habilitada para esa persona
 * ANTES de abrir ninguna planilla. Si no lo está, devuelve is_error y el loop sigue.
 */

const TOOL_LIMITE_MAX = 300;
const TOOL_LIMITE_DEF = 50;
const TOOL_BUSCAR_POR_FUENTE = 20;
const TOOL_FICHA_POR_FUENTE = 20;

// Nota (5-nov-2026): la API rechazó la primera versión con "compiled grammar is too large": demasiadas
// uniones de tipos con strict:true. Ahora strict solo en las dos herramientas simples; en las demás los
// opcionales van fuera de `required` y sin uniones (Claude respeta el esquema igual).
const ESQUEMA_FILTROS = {
  type: 'array',
  description: 'Condiciones que deben cumplirse todas. op: =, !=, contiene, >, <, >=, <=, entre, en. Fechas AAAA-MM-DD. valor es texto o número; para "entre" y "en" es una lista. Ejemplo: [{"col":"FECHA","op":">=","valor":"2026-10-01"},{"col":"DESTINO","op":"contiene","valor":"autov"}]',
  items: {
    type: 'object',
    properties: {
      col: { type: 'string' },
      op: { type: 'string', enum: ['=', '!=', 'contiene', '>', '<', '>=', '<=', 'entre', 'en'] },
      valor: { description: 'texto, número o lista (para entre/en)' }
    },
    required: ['col', 'op', 'valor']
  }
};
const ESQUEMA_METRICA = {
  type: 'object',
  description: 'Qué calcular por grupo. fn: sum, count, avg, min, max; col es la columna numérica (omitir para count).',
  properties: { col: { type: 'string' }, fn: { type: 'string', enum: ['sum', 'count', 'avg', 'min', 'max'] } },
  required: ['fn']
};

const BOT_TOOLS = [
  {
    name: 'listar_fuentes', strict: true,
    description: 'Lista las tablas que podés consultar para esta persona, con sus columnas reales y cantidad de filas. Usala cuando no estés seguro de qué columnas tiene una tabla o cómo se llaman.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false }
  },
  {
    name: 'leer_tabla',
    description: 'Lee filas de una tabla (fuente) con filtros estructurados. Devuelve como máximo 300 filas (por defecto 50) más total_coincidencias. Siempre filtrá por fecha o clave antes de leer tablas grandes; para totales usá resumir_tabla.',
    input_schema: {
      type: 'object',
      properties: {
        fuente: { type: 'string', description: 'id de la fuente (ej. asfalto_diario)' },
        filtros: ESQUEMA_FILTROS,
        columnas: { type: 'array', items: { type: 'string' }, description: 'Columnas a devolver; omitir = todas' },
        orden: { type: 'object', properties: { col: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } }, required: ['col', 'dir'] },
        limite: { type: 'integer', description: 'Máx. 300' }
      },
      required: ['fuente']
    }
  },
  {
    name: 'resumir_tabla',
    description: 'Agrupa y calcula (suma, conteo, promedio, mínimo, máximo) sobre una tabla sin traer las filas. Ideal para "cuánto por mes", "total por obra", "cuántas por estado".',
    input_schema: {
      type: 'object',
      properties: {
        fuente: { type: 'string' },
        agrupar_por: { type: 'array', items: { type: 'string' }, description: 'Columnas de agrupación (vacía = total general)' },
        metrica: ESQUEMA_METRICA,
        filtros: ESQUEMA_FILTROS
      },
      required: ['fuente', 'agrupar_por', 'metrica']
    }
  },
  {
    name: 'buscar_texto',
    description: 'Busca un texto (nombre de obra, código de equipo, proveedor) en todas las columnas de texto de las fuentes habilitadas. Devuelve hasta 20 filas por fuente. Útil cuando no sabés en qué tabla está algo.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string' },
        fuentes: { type: 'array', items: { type: 'string' }, description: 'ids de fuentes a recorrer; omitir = todas las habilitadas (menos las remotas)' }
      },
      required: ['texto']
    }
  },
  {
    name: 'ficha_equipo', strict: true,
    description: 'Junta todo lo que hay de un equipo (por código, en cualquier formato: "RN-03", "rn03") en las fuentes habilitadas que tengan clave de equipo: últimas tarjas, pendientes, combustible, alquiler, repuestos. Hasta 20 filas por fuente, las más recientes.',
    input_schema: { type: 'object', properties: { codigo: { type: 'string' } }, required: ['codigo'], additionalProperties: false }
  },
  {
    name: 'pedidos_compra',
    description: 'Consulta el sistema Pedidos de compra (órdenes de compra, pedidos e ítems del circuito de aprobación). tabla: ordenes, solicitudes o items. Misma gramática de filtros que leer_tabla; con agrupar_por y metrica devuelve agregados. Requiere permiso COMPRAS.',
    input_schema: {
      type: 'object',
      properties: {
        tabla: { type: 'string', enum: ['ordenes', 'solicitudes', 'items'] },
        filtros: ESQUEMA_FILTROS,
        agrupar_por: { type: 'array', items: { type: 'string' } },
        metrica: ESQUEMA_METRICA,
        limite: { type: 'integer' }
      },
      required: ['tabla']
    }
  }
];

function normEquipo_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function limite_(n) {
  const v = Number(n);
  if (!v || v < 1) return TOOL_LIMITE_DEF;
  return Math.min(Math.floor(v), TOOL_LIMITE_MAX);
}

function fuenteHabilitada_(legajo, id) {
  const f = fuentePorId_(id);
  if (!f) return { error: 'No existe la fuente "' + id + '". Usá listar_fuentes para ver las disponibles.' };
  if (!fuentesDe_(legajo).some(x => x.id === f.id)) return { error: 'Fuente no habilitada para esta persona: ' + id + ' (módulo ' + f.modulo + '). No la leas; decile que pida acceso.' };
  return { fuente: f };
}

function registroFuente_(f, datos) {
  let tabla = f.remota ? 'ordenes' : (f.hoja || 'principal');
  if (!f.remota && esRegExp_(f.hoja)) {
    const hojas = []; ((datos && datos.filas) || []).forEach(r => { if (r._hoja && hojas.indexOf(r._hoja) < 0) hojas.push(r._hoja); });
    tabla = hojas.length ? hojas.sort().slice(-1)[0] + (hojas.length > 1 ? ' (+' + (hojas.length - 1) + ')' : '') : f.nombre;
  }
  return { modulo: f.modulo, tabla, fuente: f.id, filas: datos ? datos.filas.length : 0 };
}
function vencido_(opts) { return !!(opts && opts.deadline && Date.now() > opts.deadline); }

function proyectar_(filas, columnas) {
  if (!columnas || !columnas.length) return filas;
  return filas.map(f => { const o = {}; columnas.forEach(c => { if (c in f) o[c] = f[c]; }); return o; });
}

// ── Ejecutores ──

function toolListarFuentes_(legajo, input, opts) {
  const fuentes = [];
  let parcial = false;
  fuentesDe_(legajo).forEach(f => {
    if (f.remota) { fuentes.push({ id: f.id, modulo: f.modulo, nombre: f.nombre, remota: true, tablas: f.tablas, descripcion: f.descripcion }); return; }
    if (vencido_(opts)) { parcial = true; fuentes.push({ id: f.id, modulo: f.modulo, nombre: f.nombre, descripcion: f.descripcion, claves: f.claves }); return; }
    const d = resumenFuente_(f);
    fuentes.push({ id: f.id, modulo: f.modulo, nombre: f.nombre, columnas: d.columnas, filas: d.filas, claves: f.claves, descripcion: f.descripcion, error: d.error_fuente });
  });
  return { resultado: { fuentes, parcial }, fuentes: [] };
}

function toolLeerTabla_(legajo, input) {
  const h = fuenteHabilitada_(legajo, input.fuente);
  if (h.error) return { resultado: { error: h.error }, is_error: true, fuentes: [] };
  if (h.fuente.remota) return { resultado: { error: 'Esa fuente se consulta con pedidos_compra.' }, is_error: true, fuentes: [] };
  const d = leerFuente_(h.fuente);
  if (d.error_fuente) return { resultado: { error: d.error_fuente }, is_error: true, fuentes: [] };
  let filas = aplicarFiltros_(d.filas, input.filtros || []);
  filas = ordenarFilas_(filas, input.orden);
  const lim = limite_(input.limite);
  const total = filas.length;
  const out = proyectar_(filas.slice(0, lim), input.columnas);
  return {
    resultado: { fuente: h.fuente.id, columnas: input.columnas && input.columnas.length ? input.columnas : d.columnas, filas: out, total_coincidencias: total, truncado: total > out.length },
    fuentes: [registroFuente_(h.fuente, d)]
  };
}

function toolResumirTabla_(legajo, input) {
  const h = fuenteHabilitada_(legajo, input.fuente);
  if (h.error) return { resultado: { error: h.error }, is_error: true, fuentes: [] };
  if (h.fuente.remota) return { resultado: { error: 'Esa fuente se consulta con pedidos_compra.' }, is_error: true, fuentes: [] };
  const d = leerFuente_(h.fuente);
  if (d.error_fuente) return { resultado: { error: d.error_fuente }, is_error: true, fuentes: [] };
  const filas = aplicarFiltros_(d.filas, input.filtros || []);
  const grupos = resumir_(filas, input.agrupar_por || [], input.metrica || { fn: 'count' });
  return { resultado: { fuente: h.fuente.id, filas_consideradas: filas.length, grupos: grupos.slice(0, TOOL_LIMITE_MAX), truncado: grupos.length > TOOL_LIMITE_MAX }, fuentes: [registroFuente_(h.fuente, d)] };
}

function toolBuscarTexto_(legajo, input, opts) {
  const texto = String(input.texto || '').trim();
  if (texto.length < 2) return { resultado: { error: 'Texto demasiado corto' }, is_error: true, fuentes: [] };
  let fuentes = fuentesDe_(legajo).filter(f => !f.remota);
  if (input.fuentes && input.fuentes.length) fuentes = fuentes.filter(f => input.fuentes.indexOf(f.id) >= 0);
  const coincidencias = [], usadas = [];
  let parcial = false;
  fuentes.forEach(f => {
    if (vencido_(opts)) { parcial = true; return; }
    const d = leerFuente_(f);
    if (d.error_fuente) return;
    const hit = buscarTexto_(d.filas, texto);
    if (!hit.length) return;
    coincidencias.push({ fuente: f.id, modulo: f.modulo, total: hit.length, filas: hit.slice(-TOOL_BUSCAR_POR_FUENTE) });
    usadas.push(registroFuente_(f, d));
  });
  return { resultado: { texto, coincidencias, parcial }, fuentes: usadas };
}

function toolFichaEquipo_(legajo, input, opts) {
  const cod = normEquipo_(input.codigo);
  if (!cod) return { resultado: { error: 'Falta el código' }, is_error: true, fuentes: [] };
  const porFuente = [], usadas = [];
  let parcial = false;
  fuentesDe_(legajo).filter(f => !f.remota && (f.claves || []).some(k => /equipo|codigo|vehiculo/i.test(k))).forEach(f => {
    if (vencido_(opts)) { parcial = true; return; }
    const d = leerFuente_(f);
    if (d.error_fuente) return;
    const cols = d.columnas.filter(c => /equipo|codigo|vehiculo|maquina|interno|patente/i.test(c));
    if (!cols.length) return;
    const hit = d.filas.filter(r => cols.some(c => normEquipo_(r[c]) === cod || (normEquipo_(r[c]).length >= 3 && normEquipo_(r[c]).indexOf(cod) >= 0 && cod.length >= 3)));
    if (!hit.length) return;
    porFuente.push({ fuente: f.id, modulo: f.modulo, total: hit.length, filas: hit.slice(-TOOL_FICHA_POR_FUENTE) });
    usadas.push(registroFuente_(f, d));
  });
  return { resultado: { codigo: input.codigo, por_fuente: porFuente, parcial }, fuentes: usadas };
}

function toolPedidosCompra_(legajo, input) {
  const h = fuenteHabilitada_(legajo, 'compras_ordenes');
  if (h.error) return { resultado: { error: h.error }, is_error: true, fuentes: [] };
  const r = consultarCompras_(input);
  if (r.error) return { resultado: r, is_error: true, fuentes: [] };
  return { resultado: r, fuentes: [{ modulo: 'COMPRAS', tabla: input.tabla, fuente: 'compras_ordenes', filas: (r.filas || r.grupos || []).length }] };
}

/** Puente a Pedidos de compra: POST {method:'botConsultar', args:[consulta]} con header X-Bot-Clave. Caché 10 min por consulta. */
function consultarCompras_(input) {
  const url = prop_('COMPRAS_RPC_URL', false), clave = prop_('COMPRAS_BOT_CLAVE', false);
  if (!url || !clave) return { error: 'El puente a Pedidos de compra no está configurado (COMPRAS_RPC_URL / COMPRAS_BOT_CLAVE).' };
  const agrupar = Array.isArray(input.agrupar_por) && input.agrupar_por.length ? input.agrupar_por : null;
  const metrica = (agrupar || (input.metrica && input.metrica.fn && input.metrica.fn !== 'count')) ? (input.metrica || null) : null;
  const consulta = { tabla: input.tabla, filtros: input.filtros || [], agrupar_por: agrupar, metrica, limite: limite_(input.limite) };
  const k = 'compras:' + Utilities.base64Encode(JSON.stringify(consulta)).slice(0, 200);
  const c = cache_().get(k);
  if (c) { try { return JSON.parse(c); } catch (e) { } }
  let r;
  try {
    r = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'X-Bot-Clave': clave }, payload: JSON.stringify({ method: 'botConsultar', args: [consulta] }) });
  } catch (e) { return { error: 'No se pudo consultar Pedidos de compra: ' + (e.message || e) }; }
  let json;
  try { json = JSON.parse(r.getContentText()); } catch (e) { return { error: 'Respuesta inválida de Pedidos de compra (' + r.getResponseCode() + ')' }; }
  if (r.getResponseCode() !== 200 || !json.ok) return { error: (json && json.error) || ('Pedidos de compra respondió ' + r.getResponseCode()) };
  const out = { tabla: consulta.tabla, columnas: json.columnas, filas: json.filas, grupos: json.grupos, total_coincidencias: json.total, truncado: json.truncado };
  try { cache_().put(k, JSON.stringify(out), 600); } catch (e) { }
  return out;
}

/** Punto de entrada del loop. opts.deadline (ms epoch) corta los recorridos de varias fuentes. Devuelve {resultado, is_error, fuentes:[...]}. */
function ejecutarTool_(legajo, name, input, opts) {
  const EJ = { listar_fuentes: toolListarFuentes_, leer_tabla: toolLeerTabla_, resumir_tabla: toolResumirTabla_, buscar_texto: toolBuscarTexto_, ficha_equipo: toolFichaEquipo_, pedidos_compra: toolPedidosCompra_ };
  if (!EJ[name]) return { resultado: { error: 'Herramienta desconocida: ' + name }, is_error: true, fuentes: [] };
  try {
    const r = EJ[name](legajo, input || {}, opts || {});
    return { resultado: r.resultado, is_error: !!r.is_error, fuentes: r.fuentes || [] };
  } catch (e) {
    console.warn('tool ' + name + ': ' + e + '\n' + (e.stack || ''));
    return { resultado: { error: 'La herramienta falló: ' + (e.message || e) }, is_error: true, fuentes: [] };
  }
}
