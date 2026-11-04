/**
 * bot_fuentes.js — catálogo de fuentes de datos de IngeBot y lectura con permisos.
 *
 * Cada fuente es una tabla (hoja de una planilla) que pertenece a un módulo de la app.
 * El bot solo puede leer las fuentes de los módulos que la persona tiene en PERMISOS.
 * Agregar un sistema = agregar entradas acá (ver docs/integracion-modulos.md, "IngeBot").
 *
 * planilla: {id} fijo, o {prop, id_defecto}: Script Property que pisa el ID por defecto (para
 *           planillas que pueden cambiar sin redeploy).
 * hoja:     nombre exacto, o RegExp para unir varias pestañas (se agrega columna _hoja).
 * columnas: [{col, desc}] documentación para el diccionario; si falta, se listan al leer.
 * claves:   columnas que sirven para cruzar con otras fuentes (equipo, obra, nro_orden).
 */

// Encabezados que nunca llegan a Claude, en ninguna fuente.
const VEDADAS_RE = /sueldo|haber|jornal|remuner|liquidac|cuil|dni|\bpin\b|hash|celular|tel[eé]fono|password|clave/i;
const SINONIMOS_MODULO = { TARJA: 'TARJAS', TARJAS: 'TARJA' };
const FUENTE_CACHE_SEG = 600;
const FUENTE_TROZO = 90 * 1024;

const FUENTES = [
  // ── ASFALTO (planta) ──
  { id: 'asfalto_diario', modulo: 'ASFALTO', nombre: 'Stock de asfalto — lectura diaria', planilla: { id: '1rqS_raTVSxjLpWxxhZU9SKVi5BBvfA7SAb27vSBhRco' }, hoja: 'DIARIO',
    descripcion: 'Una fila por día de planta: asfalto en tanque (t), asfalto recibido (t), observaciones, cantidad de arranques. El consumo real entre dos mediciones = stock anterior + recibido − stock actual.',
    columnas: [{ col: 'FECHA', desc: 'día' }, { col: 'STOCK_T', desc: 'asfalto en tanque, toneladas' }, { col: 'RECIBIDO_T', desc: 'asfalto recibido ese día, toneladas' }, { col: 'OBS', desc: 'observaciones' }, { col: 'CARGADO POR', desc: 'quién cargó' }, { col: 'ARRANQUES', desc: 'arranques de planta' }], claves: ['FECHA'] },
  { id: 'asfalto_salidas', modulo: 'ASFALTO', nombre: 'Mezcla asfáltica despachada por destino', planilla: { id: '1rqS_raTVSxjLpWxxhZU9SKVi5BBvfA7SAb27vSBhRco' }, hoja: 'SALIDAS',
    descripcion: 'Una fila por día y destino (Autovías, Bacheo, etc.) con toneladas de mezcla que salieron de planta. La mezcla de Autovías se lee de acá.',
    columnas: [{ col: 'FECHA', desc: 'día' }, { col: 'DESTINO', desc: 'obra destino' }, { col: 'MEZCLA_T', desc: 'toneladas de mezcla' }, { col: 'CARGADO POR', desc: '' }], claves: ['FECHA', 'DESTINO'] },
  { id: 'asfalto_config', modulo: 'ASFALTO', nombre: 'Parámetros de planta', planilla: { id: '1rqS_raTVSxjLpWxxhZU9SKVi5BBvfA7SAb27vSBhRco' }, hoja: 'CONFIG',
    descripcion: 'Parámetros: PORC_TEORICO (% de asfalto en la mezcla), TOLERANCIA, STOCK_MINIMO, CAPACIDAD_TANQUE. Solo esas claves son útiles.', soloClaves: ['PORC_TEORICO', 'TOLERANCIA', 'STOCK_MINIMO', 'CAPACIDAD_TANQUE', 'DESTINOS', 'DESTINO_AUTOVIAS'],
    columnas: [{ col: 'clave', desc: '' }, { col: 'valor', desc: '' }, { col: 'desc', desc: '' }], claves: [] },

  // ── AUTOVIAS (bacheo) ──
  { id: 'autovias_produccion', modulo: 'AUTOVIAS', nombre: 'Producción diaria de Autovías', planilla: { prop: 'AUTOVIAS_SHEET_ID', id_defecto: '1oXBh5DDSIeCPsNxv9agst84b5KSOTdTpb3vNDIxKOl4' }, hoja: 'PRODUCCION',
    descripcion: 'Una fila por jornada: toneladas colocadas, viajes, combustible en pesos, observaciones.',
    columnas: [{ col: 'FECHA', desc: '' }, { col: 'TONELADAS', desc: 'mezcla colocada, t' }, { col: 'VIAJES', desc: 'viajes de camión' }, { col: 'OBSERVACIONES', desc: '' }, { col: 'CARGADO POR', desc: '' }, { col: 'JORNADA', desc: 'tipo de jornada' }, { col: 'COMBUSTIBLE_ARS', desc: 'gasoil del día en pesos' }], claves: ['FECHA'] },
  { id: 'autovias_puntas', modulo: 'AUTOVIAS', nombre: 'Juegos de puntas de fresadora', planilla: { prop: 'AUTOVIAS_SHEET_ID', id_defecto: '1oXBh5DDSIeCPsNxv9agst84b5KSOTdTpb3vNDIxKOl4' }, hoja: 'PUNTAS',
    descripcion: 'Cambios de juegos de puntas (consumible de la fresadora). Referencia: 1400 t por juego.',
    columnas: [{ col: 'FECHA', desc: '' }, { col: 'JUEGOS', desc: 'juegos cambiados' }, { col: 'OBSERVACIONES', desc: '' }], claves: ['FECHA'] },
  { id: 'autovias_equipos', modulo: 'AUTOVIAS', nombre: 'Equipos alquilados en Autovías', planilla: { prop: 'AUTOVIAS_SHEET_ID', id_defecto: '1oXBh5DDSIeCPsNxv9agst84b5KSOTdTpb3vNDIxKOl4' }, hoja: 'EQUIPOS',
    descripcion: 'Equipos afectados a la obra con su precio mensual de alquiler.',
    columnas: [{ col: 'EQUIPO', desc: 'código o nombre' }, { col: 'PRECIO MES', desc: '' }, { col: 'MONEDA', desc: 'ARS/USD' }, { col: 'CON IVA', desc: '' }, { col: 'OBS', desc: '' }, { col: 'DESDE', desc: 'fecha de inicio' }], claves: ['EQUIPO'] },
  { id: 'autovias_combustible', modulo: 'AUTOVIAS', nombre: 'Entregas de combustible (tanque Leandro Casares)', planilla: { id: '19eyY8MImPM_-Gyzj8QcqA_yR5KDrkuu-1faJUU48N1A' }, hoja: 'ENTREGAS',
    descripcion: 'Todas las cargas de gasoil del tanque propio a equipos y camiones, con fecha, equipo, litros, operario y obra. Filtrar por obra "autovia" para la obra Autovías.',
    claves: ['EQUIPO', 'FECHA', 'OBRA'] },

  // ── EXPEDIENTES (Municipio SMT) ──
  { id: 'expedientes_estado', modulo: 'EXPEDIENTES', nombre: 'Expedientes a cobrar — estado actual', planilla: { id: '1XhsRoR6sAiZN5VE0IH3kk-WvihCM-IyvP5bxi06lYHA' }, hoja: 'ESTADO_ACTUAL',
    descripcion: 'Un expediente por fila con la oficina donde está, días quieto, etapa del circuito y fecha estimada de cobro.',
    claves: ['expediente', 'nombre_obra'] },
  { id: 'expedientes_movimientos', modulo: 'EXPEDIENTES', nombre: 'Expedientes — historial de movimientos', planilla: { id: '1XhsRoR6sAiZN5VE0IH3kk-WvihCM-IyvP5bxi06lYHA' }, hoja: 'MOVIMIENTOS',
    descripcion: 'Cada pase de un expediente entre oficinas del municipio, con fecha. Sirve para ver cuánto tardó en cada oficina.', claves: ['expediente'] },
  { id: 'expedientes_gestiones', modulo: 'EXPEDIENTES', nombre: 'Expedientes — gestiones hechas', planilla: { id: '1XhsRoR6sAiZN5VE0IH3kk-WvihCM-IyvP5bxi06lYHA' }, hoja: 'GESTIONES',
    descripcion: 'Llamados, visitas y notas registradas por el equipo para empujar un expediente.', claves: ['expediente'] },
  { id: 'expedientes_oficinas', modulo: 'EXPEDIENTES', nombre: 'Oficinas del municipio', planilla: { id: '1XhsRoR6sAiZN5VE0IH3kk-WvihCM-IyvP5bxi06lYHA' }, hoja: 'OFICINAS',
    descripcion: 'Catálogo de oficinas con responsable y tiempos típicos.', claves: [] },
  { id: 'expedientes_obras', modulo: 'EXPEDIENTES', nombre: 'Obras INGECO — detalle municipio', planilla: { id: '1Hl8HZqrH6lMwnAGpitA37ZGLg4szTcFGK7vmv92qkBA' }, hoja: 'Detalle Municipio',
    descripcion: 'Maestro de obras con expediente, estado de cobro, monto y tipo de contrato.', claves: ['Expediente', 'Nombre Obra'] },

  // ── TARJAS (flota pesada) ──
  { id: 'tarjas_equipos', modulo: 'TARJAS', nombre: 'Equipos de la flota (tarja)', planilla: { prop: 'TARJA_SHEET_ID', id_defecto: '1rO_6uisxlLTzcJepRy5uMBvQpxvvMIwm8d708TwgEMo' }, hoja: 'EQUIPOS',
    descripcion: 'Un equipo por fila: código, descripción, horómetro según última tarja, último operador, fecha de última tarja y posición GPS. "Dónde está el equipo" = su última tarja.', claves: ['codigo'] },
  { id: 'tarjas_diarias', modulo: 'TARJAS', nombre: 'Tarjas diarias (todos los años)', planilla: { prop: 'TARJA_SHEET_ID', id_defecto: '1rO_6uisxlLTzcJepRy5uMBvQpxvvMIwm8d708TwgEMo' }, hoja: /^TARJAS_\d{4}$/,
    descripcion: 'Una tarja por equipo y día: operador, obra, horómetro inicio/fin, horas trabajadas, checklist, combustible y aceites cargados, GPS. Columna _hoja indica el año. Es la fuente para "qué equipos están en tal obra" (últimas tarjas por equipo).', claves: ['equipo', 'obra', 'fecha', 'legajo'] },
  { id: 'tarjas_pendientes', modulo: 'TARJAS', nombre: 'Novedades pendientes de tarja', planilla: { prop: 'TARJA_SHEET_ID', id_defecto: '1rO_6uisxlLTzcJepRy5uMBvQpxvvMIwm8d708TwgEMo' }, hoja: 'PENDIENTES',
    descripcion: 'Ítems del checklist marcados mal por el operario, abiertos o cerrados por taller.', claves: ['equipo'] },
  { id: 'tarjas_abiertas', modulo: 'TARJAS', nombre: 'Tarjas abiertas ahora', planilla: { prop: 'TARJA_SHEET_ID', id_defecto: '1rO_6uisxlLTzcJepRy5uMBvQpxvvMIwm8d708TwgEMo' }, hoja: 'ABIERTAS',
    descripcion: 'Tarjas iniciadas y todavía no cerradas (equipos trabajando en este momento).', claves: ['equipo'] },
  { id: 'tarjas_personal', modulo: 'TARJAS', nombre: 'Operadores (nómina de tarja)', planilla: { prop: 'TARJA_SHEET_ID', id_defecto: '1rO_6uisxlLTzcJepRy5uMBvQpxvvMIwm8d708TwgEMo' }, hoja: 'PERSONAL',
    descripcion: 'Legajo, nombre y obra de cada operador. Sin datos personales.', soloColumnas: ['legajo', 'nombre', 'apellido', 'obra', 'activo', 'puesto', 'centro'], claves: ['legajo'] },

  // ── DASHBOARD (planillas que lee el Dashboard Ejecutivo) ──
  { id: 'dash_oc_insumos', modulo: 'DASHBOARD', nombre: 'Órdenes de compra de insumos (Guillermo)', planilla: { id: '1UWUIW4sNtRBa90nYoGg88ghGK8SyyjKe9UdZLRcHMEE' }, hoja: 'ÓRDENES',
    descripcion: 'Todas las OC emitidas con fecha, proveedor, obra, importe y estado. Es la planilla que alimenta el Dashboard; para el circuito de aprobación usar pedidos_compra.', claves: ['obra', 'proveedor', 'nro_orden'] },
  { id: 'dash_maestro_obras', modulo: 'DASHBOARD', nombre: 'Maestro de obras', planilla: { id: '1VbG7DPqaOSlYkvQxbxag-4P2sOoRJQwWGccbx9OMyBM' }, hoja: null,
    descripcion: 'Obras con COD_OBRA, nombre, cliente y estado. Clave para cruzar con tarjas (por nombre de obra).', claves: ['COD_OBRA', 'obra'] },
  { id: 'dash_obras_cobrar', modulo: 'DASHBOARD', nombre: 'Obras a cobrar (Agustín)', planilla: { id: '1YldZRtbLh17Xqczl-omI0zjHcgvrhvp3QOsjWffEm_s' }, hoja: null,
    descripcion: 'Por obra: monto total, anticipo, monto a certificar y certificado.', claves: ['obra'] },
  { id: 'dash_cobros', modulo: 'DASHBOARD', nombre: 'Cobros reales (Esteban), una pestaña por mes', planilla: { id: '1EwrHdUkCBER10vBZyrQBodJOrfEr2p94QlfYZ7ewSmY' }, hoja: /.+/,
    descripcion: 'Cobros efectivamente recibidos. Columna _hoja = mes de la pestaña.', claves: ['obra'] },
  { id: 'dash_equipos_flota', modulo: 'DASHBOARD', nombre: 'Equipos y precio mensual de flota (Adrián)', planilla: { id: '1PEcPzwrQ8kE2evmUlrFq9wPbgWOR92MPl3LEqcSYbIk' }, hoja: null,
    descripcion: 'Listado de equipos de la flota con su valor mensual (PF) asignado.', claves: ['equipo'] },
  { id: 'dash_partes_diarios', modulo: 'DASHBOARD', nombre: 'Partes diarios de equipos (Nico)', planilla: { id: '1e_emRVEUxTaNtLxeC0wXIWKzcKuoulZkFSS9O1e0XHo' }, hoja: null,
    descripcion: 'Parte diario por equipo: fecha, obra, horas. Fuente histórica de uso de equipos (la tarja importa de acá).', claves: ['equipo', 'obra', 'fecha'] },
  { id: 'dash_repuestos', modulo: 'DASHBOARD', nombre: 'Pedidos y entregas de repuestos (Nico)', planilla: { id: '1JpXjGTJwlvMuEI-rFTd4KeKvzd708-yuSLAhIRuCFC0' }, hoja: 'ENTREGAS',
    descripcion: 'Repuestos pedidos/entregados por equipo. Es la planilla que importa Pedidos de compra.', claves: ['equipo'] },
  { id: 'dash_remitos_asfalto', modulo: 'DASHBOARD', nombre: 'Remitos oficiales de asfalto (Roberto)', planilla: { id: '1_c6El5XDWoy84J7UAe8xlA1WC03IdklQyraMZEbQiEs' }, hoja: null,
    descripcion: 'Remitos de asfalto recibido en planta con fecha, proveedor y toneladas.', claves: ['fecha'] },
  { id: 'dash_remitos_amaicha', modulo: 'DASHBOARD', nombre: 'Mezcla despachada desde Amaicha (Ruta 357)', planilla: { id: '1k5tUEAHh_ecCY81Y7oGAcxMz6hQ0A0Fna4ewLWPIuUg' }, hoja: null,
    descripcion: 'Fecha, obra, cantidad y unidad de mezcla despachada desde la planta de Amaicha.', claves: ['obra', 'fecha'] },
  { id: 'dash_precio_asfalto', modulo: 'DASHBOARD', nombre: 'Precio de mercado del asfalto ($/t por mes)', planilla: { id: '1lqKTXtDLT2FxyXurxjU1uE4epDOKs5SP8AXu5wAUsJ4' }, hoja: null,
    descripcion: 'Precio de referencia mensual del asfalto.', claves: ['mes'] },
  { id: 'dash_gastos_estructura', modulo: 'DASHBOARD', nombre: 'Gastos de estructura (libro mayor)', planilla: { id: '1beFIrKD6ljPKjjssuWP-_TmTH8vr1TktBnVDuX9nxyM' }, hoja: null,
    descripcion: 'Gastos administrativos por mes y categoría. Se excluyen filas de sueldos y cargas sociales.', filasVedadasRe: /sueldo|haber|cargas sociales/i, claves: ['mes', 'categoria'] },
  { id: 'dash_comb_tiburcio', modulo: 'DASHBOARD', nombre: 'Combustible estación Tiburcio Sanz', planilla: { id: '1DD8BVoF6jX-CcakbbVO6fNJKYF82qBIK1YwyVLQcDJ8' }, hoja: 'ENTREGAS',
    descripcion: 'Cargas de combustible de camionetas y vehículos en la estación Tiburcio Sanz.', claves: ['fecha', 'vehiculo'] },
  { id: 'dash_comb_herrero', modulo: 'DASHBOARD', nombre: 'Combustible estación Carlos Herrero (Quilmes)', planilla: { id: '1GB_oiL40fEXHXzhmor3ztnnriiikX1xp3fG-F5Uuw5E' }, hoja: 'ENTREGAS',
    descripcion: 'Cargas de combustible de camionetas y bidones en Quilmes.', claves: ['fecha', 'vehiculo'] },

  // ── COMPRAS (Postgres, vía puente botConsultar) ──
  { id: 'compras_ordenes', modulo: 'COMPRAS', nombre: 'Pedidos de compra — órdenes de compra (circuito de aprobación)', remota: true, tablas: ['ordenes', 'solicitudes', 'items'],
    descripcion: 'Sistema Pedidos de compra INGECO. Tabla ordenes: nro_orden, fecha, proveedor, descripcion, importe, obra, estado (PENDIENTE/APROBADA/RECHAZADA), esperando_a, autorizada_por, pagada_por, ts_pagada. Tabla solicitudes: pedidos (solicitud_id, solicitante_id, destino, descripcion_libre, estado, monto_total, proveedor). Tabla items: renglones de cada pedido (descripcion, cantidad, unidad, codigo_repuesto). Se consulta con la herramienta pedidos_compra, no con leer_tabla.',
    claves: ['obra', 'proveedor', 'nro_orden'] }
];

function esRegExp_(x) { return Object.prototype.toString.call(x) === '[object RegExp]'; }
function esFecha_(x) { return Object.prototype.toString.call(x) === '[object Date]'; }

function esVedada_(encabezado) { return VEDADAS_RE.test(String(encabezado || '')); }

function fuentePorId_(id) { return FUENTES.find(f => f.id === String(id || '')) || null; }

/** Fuentes habilitadas para una persona: su módulo o el sinónimo (TARJA↔TARJAS) está en PERMISOS. */
function fuentesDe_(legajo) {
  const mods = {};
  permisosDe_(legajo).forEach(p => {
    const m = String(p.modulo || '').toUpperCase();
    mods[m] = 1;
    if (SINONIMOS_MODULO[m]) mods[SINONIMOS_MODULO[m]] = 1;
  });
  return FUENTES.filter(f => mods[f.modulo] && f.activa !== false);
}

/** ID de la planilla: fijo, o Script Property (si existe) con un valor por defecto conocido. */
function idPlanilla_(fuente) {
  if (fuente.planilla.id) return fuente.planilla.id;
  return prop_(fuente.planilla.prop, false) || fuente.planilla.id_defecto || '';
}

function valorCelda_(v) {
  if (esFecha_(v)) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, 'America/Argentina/Tucuman', 'yyyy-MM-dd');
  return v;
}

function hojasDe_(ss, fuente) {
  if (fuente.hoja === null || fuente.hoja === undefined) return [ss.getSheets()[0]];
  if (esRegExp_(fuente.hoja)) return ss.getSheets().filter(s => fuente.hoja.test(s.getName()));
  const s = ss.getSheetByName(fuente.hoja);
  return s ? [s] : [];
}

function leerHoja_(sh, fuente, multi) {
  const vals = sh.getDataRange().getValues();
  if (!vals.length) return { columnas: [], filas: [] };
  const enc = vals[0].map(h => String(h).trim());
  const permitidas = enc.map((h, j) => {
    if (!h || esVedada_(h)) return false;
    if (fuente.soloColumnas && fuente.soloColumnas.map(c => c.toLowerCase()).indexOf(h.toLowerCase()) < 0) return false;
    return true;
  });
  const columnas = enc.filter((h, j) => permitidas[j]);
  const filas = [];
  for (let i = 1; i < vals.length; i++) {
    const v = vals[i];
    if (v.every(c => c === '' || c === null)) continue;
    const o = {};
    enc.forEach((h, j) => { if (permitidas[j]) o[h] = valorCelda_(v[j]); });
    if (fuente.filasVedadasRe && Object.keys(o).some(k => fuente.filasVedadasRe.test(String(o[k])))) continue;
    if (fuente.soloClaves && fuente.soloClaves.indexOf(String(o[columnas[0]])) < 0) continue;
    if (multi) o._hoja = sh.getName();
    filas.push(o);
  }
  return { columnas: multi ? columnas.concat(['_hoja']) : columnas, filas };
}

function cacheLeer_(k) {
  const c = cache_();
  const meta = c.get(k);
  if (!meta) return null;
  const n = Number(meta);
  const trozos = c.getAll(Array.from({ length: n }, (_, i) => k + ':' + i));
  let s = '';
  for (let i = 0; i < n; i++) { if (trozos[k + ':' + i] === undefined) return null; s += trozos[k + ':' + i]; }
  try { return JSON.parse(s); } catch (e) { return null; }
}

function cacheGuardar_(k, obj) {
  const s = JSON.stringify(obj);
  const trozos = {};
  let n = 0;
  for (let i = 0; i < s.length; i += FUENTE_TROZO) trozos[k + ':' + (n++)] = s.slice(i, i + FUENTE_TROZO);
  try { cache_().putAll(trozos, FUENTE_CACHE_SEG); cache_().put(k, String(n), FUENTE_CACHE_SEG); } catch (e) { }
}

/** Lee una fuente completa: {columnas, filas}. Cacheada 10 min. Si la planilla no se puede abrir, {error_fuente, filas:[]}. */
function leerFuente_(fuente) {
  const id = idPlanilla_(fuente);
  if (!id) return { columnas: [], filas: [], error_fuente: 'La fuente ' + fuente.id + ' no está configurada (falta ' + fuente.planilla.prop + ')' };
  const k = 'fuente:' + fuente.id + ':' + id;
  const c = cacheLeer_(k);
  if (c) return c;
  let ss;
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { columnas: [], filas: [], error_fuente: 'No se pudo abrir la planilla de ' + fuente.id + ': ' + (e.message || e) }; }
  const hojas = hojasDe_(ss, fuente);
  if (!hojas.length) return { columnas: [], filas: [], error_fuente: 'No existe la hoja ' + fuente.hoja + ' en ' + fuente.id };
  const multi = hojas.length > 1 || esRegExp_(fuente.hoja);
  let columnas = [], filas = [];
  hojas.forEach(sh => {
    const r = leerHoja_(sh, fuente, multi);
    r.columnas.forEach(col => { if (columnas.indexOf(col) < 0) columnas.push(col); });
    filas = filas.concat(r.filas);
  });
  const out = { columnas, filas };
  cacheGuardar_(k, out);
  marca_('fuente ' + fuente.id + '(' + filas.length + ')');
  return out;
}

/** Texto para el system prompt: qué fuentes existen, de qué módulo, con columnas y claves. */
function diccionarioFuentes_(fuentes) {
  return (fuentes || FUENTES).map(f => {
    let s = '- ' + f.id + ' [' + f.modulo + '] ' + f.nombre + '. ' + (f.descripcion || '');
    if (f.columnas) s += ' Columnas: ' + f.columnas.map(c => c.col + (c.desc ? ' (' + c.desc + ')' : '')).join(', ') + '.';
    if (f.claves && f.claves.length) s += ' Claves de cruce: ' + f.claves.join(', ') + '.';
    if (f.remota) s += ' (fuente remota: usar pedidos_compra)';
    return s;
  }).join('\n');
}
