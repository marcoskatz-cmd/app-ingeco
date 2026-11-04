/**
 * bot.js — IngeBot: asistente de datos de App INGECO.
 *
 * Reemplaza a ayuda.js (bot de instructivos). Responde preguntas sobre los datos de atrás de los
 * sistemas (planillas y Pedidos de compra) con herramientas (bot_tools.js) que corren ACÁ, en el
 * backend, con la cuenta del servidor y verificando el permiso de la persona por cada fuente.
 *
 * Acceso: módulo BOT en PERMISOS. Cupo: BOT_CUPO_DIA preguntas por persona por día (ADMIN y
 * legajos en BOT_SIN_TOPE sin tope). Fusible global: BOT_FUSIBLE_DIA llamadas HTTP a Anthropic por día.
 * Clave: Script Property CLAUDE_API_KEY. Modelo y parámetros fijos abajo (spec §4.1).
 */

const BOT_MODELO = 'claude-opus-5-5';
const BOT_EFFORT = 'medium';
const BOT_MAX_TOKENS = 4000;
const BOT_MAX_VUELTAS = 8;
const BOT_HISTORIAL_MAX = 12;
const BOT_TIEMPO_MAX_MS = 60000;
const BOT_CUPO_DEF = 30;
const BOT_FUSIBLE_DIA = 400;
const BOT_TZ = 'America/Argentina/Tucuman';

// ── Instructivos (antes en ayuda.js) ──

function instructivosPor_() {
  const por = {};
  leer_('INSTRUCTIVOS').forEach(i => {
    const m = String(i.modulo || '').toUpperCase();
    if (!m || !i.texto) return;
    por[m] = por[m] || [];
    por[m].push({ seccion: String(i.seccion || ''), texto: String(i.texto) });
  });
  return por;
}

function waAdmin_() {
  const cel = prop_('ADMIN_CELULAR', false);
  return cel ? 'https://wa.me/' + celularWA_(cel) : '';
}

/** Guías de lectura: instructivos de APP + módulos permitidos (ADMIN incluido si es admin). */
function instructivosMios_(ctx, payload) {
  const mods = ['APP'].concat(modulosDe_(ctx.usuario.legajo).map(m => m.codigo));
  if (tienePermiso_(ctx.usuario.legajo, 'ADMIN') && mods.indexOf('ADMIN') < 0) mods.push('ADMIN');
  const nombres = {}; modulosActivos_().forEach(m => { nombres[m.codigo] = m.nombre; }); nombres.APP = 'La app INGECO';
  const items = leer_('INSTRUCTIVOS').filter(i => mods.indexOf(String(i.modulo || '').toUpperCase()) >= 0 && i.texto)
    .map(i => ({ modulo: String(i.modulo).toUpperCase(), modulo_nombre: nombres[String(i.modulo).toUpperCase()] || i.modulo, seccion: String(i.seccion || ''), texto: String(i.texto) }));
  return { ok: true, items, orden: mods };
}

// ── Cupo ──

function hoyTexto_() { return Utilities.formatDate(new Date(), BOT_TZ, 'yyyy-MM-dd'); }

function sinTope_(legajo) {
  if (tienePermiso_(legajo, 'ADMIN')) return true;
  const lista = String(prop_('BOT_SIN_TOPE', false) || '').split(/[,\s]+/).filter(Boolean);
  return lista.indexOf(String(legajo)) >= 0;
}

function cupoDe_(legajo) {
  const hoy = hoyTexto_();
  const usadas = leer_('CONSULTAS_BOT').filter(c => String(c.legajo) === String(legajo) && c.fecha &&
    Utilities.formatDate(new Date(c.fecha), BOT_TZ, 'yyyy-MM-dd') === hoy).length;
  const max = Number(prop_('BOT_CUPO_DIA', false)) || BOT_CUPO_DEF;
  return { usadas, max, sin_tope: sinTope_(legajo) };
}

/** Fusible global de llamadas HTTP a Anthropic (Property BOT_FUSIBLE = {fecha, calls}). true si se puede llamar. */
function fusibleConsumir_() {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(5000); } catch (e) { return true; }
  try {
    const props = PropertiesService.getScriptProperties();
    let st = {};
    try { st = JSON.parse(props.getProperty('BOT_FUSIBLE') || '{}'); } catch (e) { st = {}; }
    const hoy = hoyTexto_();
    if (st.fecha !== hoy) st = { fecha: hoy, calls: 0 };
    if (st.calls >= BOT_FUSIBLE_DIA) return false;
    st.calls++;
    props.setProperty('BOT_FUSIBLE', JSON.stringify(st));
    return true;
  } finally { try { lock.releaseLock(); } catch (e) { } }
}

// ── System prompt ──

const BOT_REGLAS = [
  'Sos IngeBot, el asistente de datos de la app INGECO (INGECO S.A., empresa vial de Tucumán, Argentina). Respondés en español rioplatense, tono neutral y directo.',
  '',
  'REGLAS',
  '1. Respondé corto: una o dos oraciones con el dato y su fecha. Si piden más detalle, una tabla o una serie, ahí sí ampliá (markdown simple: negritas, listas con "- ", tablas con "|"; sin títulos grandes).',
  '2. Todo dato sale de las herramientas. Nunca inventes un número, una fecha ni un nombre. Si una búsqueda no trae nada, decilo y sugerí dónde mirar.',
  '3. Decí de qué fuente salió cada dato (módulo y tabla) en una frase corta al final, por ejemplo "Fuente: Asfalto · DIARIO". Si cruzaste fuentes, nombrá las dos.',
  '4. Solo podés leer las fuentes listadas en "FUENTES HABILITADAS". Si la pregunta toca un módulo que la persona no tiene, decí que ese dato vive en tal sistema y que pida acceso a ' + '{ADMIN}' + '. No intentes leerlo.',
  '5. Antes de leer una tabla grande filtrá por fecha o por clave; para totales usá resumir_tabla. Podés llamar varias herramientas a la vez cuando son independientes.',
  '6. Para "dónde está un equipo" o "qué equipos hay en una obra", usá las últimas tarjas por equipo (tarjas_diarias ordenadas por fecha desc) o tarjas_equipos.',
  '7. Si la pregunta es sobre cómo usar la app o un módulo, respondé con los INSTRUCTIVOS de los módulos que la persona tiene. Si pregunta qué módulos tiene, respondé con su lista.',
  '8. Fechas y horas en horario de Tucumán. Montos en pesos con separador de miles (1.234.567). Toneladas con una decimal.',
  '9. Sin disculpas largas, sin emojis, sin repetir la pregunta, sin explicar qué herramienta usaste, sin ofrecer ayuda adicional al final.',
  '10. No ejecutás acciones: no cargás, borrás ni modificás nada.'
].join('\n');

/** Bloque estable (cacheable): reglas + catálogo de módulos + instructivos + diccionario completo de fuentes. Bloque variable: la persona. */
function armarSystemBot_(usuario, fuentesHabilitadas, moduloContexto) {
  const admin = prop_('ADMIN_NOMBRE', false) || 'Marcos';
  const todos = modulosActivos_();
  const instr = instructivosPor_();
  let estable = BOT_REGLAS.replace('{ADMIN}', admin) + '\n\nCATÁLOGO DE MÓDULOS DE LA APP:\n' +
    todos.map(m => '- ' + m.codigo + ' — ' + m.nombre + ': ' + (m.descripcion_corta || '')).join('\n') +
    '\n\nINSTRUCTIVOS POR MÓDULO:\n';
  Object.keys(instr).sort().forEach(m => {
    estable += '\n### ' + m + '\n';
    instr[m].forEach(s => { estable += (s.seccion ? '[' + s.seccion + '] ' : '') + s.texto + '\n'; });
  });
  estable += '\nDICCIONARIO DE FUENTES (todas las que existen; cuáles puede leer esta persona está en el bloque siguiente):\n' + diccionarioFuentes_(FUENTES);

  const permitidos = modulosDe_(usuario.legajo);
  let variable = 'QUIÉN PREGUNTA: ' + usuario.nombre_visible + (usuario.sector ? ', sector ' + usuario.sector : '') + ' (legajo ' + usuario.legajo + ').\n';
  variable += 'Fecha y hora: ' + Utilities.formatDate(new Date(), BOT_TZ, 'yyyy-MM-dd HH:mm') + ' (Tucumán).\n\n';
  variable += 'MÓDULOS AUTORIZADOS:\n' + (permitidos.length ? permitidos.map(m => '- ' + m.codigo + ' — ' + m.nombre + ' (rol: ' + m.rol + ')').join('\n') : '(ninguno)') + '\n\n';
  variable += 'FUENTES HABILITADAS (ids que podés pasar a las herramientas):\n' + (fuentesHabilitadas.length ? fuentesHabilitadas.map(f => '- ' + f.id + ' [' + f.modulo + ']').join('\n') : '(ninguna)') + '\n';
  if (moduloContexto) variable += '\nCONTEXTO: la persona preguntó desde el módulo ' + String(moduloContexto).toUpperCase() + '. Priorizá sus fuentes.\n';
  return { estable, variable };
}

// ── Llamada a Claude ──

function llamarClaude_(body) {
  const apiKey = prop_('CLAUDE_API_KEY', false);
  if (!apiKey) throw new Error('El asistente no está configurado (falta CLAUDE_API_KEY).');
  if (!fusibleConsumir_()) throw new Error('Se agotó el fusible diario de llamadas del asistente. Mañana se renueva.');
  const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(body)
  });
  const code = r.getResponseCode();
  let json = null;
  try { json = JSON.parse(r.getContentText()); } catch (e) { json = null; }
  if (code < 200 || code >= 300) {
    const msg = (json && json.error && json.error.message) || String(r.getContentText()).slice(0, 200);
    console.warn('Claude API ' + code + ': ' + msg);
    throw new Error('El asistente no pudo responder ahora (' + code + '). Probá en un rato.');
  }
  return json;
}

function tokensDe_(usage) {
  const u = usage || {};
  return (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
}

function conversacionAClaude_(conversacion) {
  const h = (conversacion || []).slice(-BOT_HISTORIAL_MAX).map(m => ({
    role: m.rol === 'bot' ? 'assistant' : 'user', content: String(m.texto || '').slice(0, 2000)
  })).filter(m => m.content);
  while (h.length && h[0].role !== 'user') h.shift();
  // Alternancia estricta: si dos seguidos tienen el mismo rol, se funden.
  const out = [];
  h.forEach(m => { if (out.length && out[out.length - 1].role === m.role) out[out.length - 1].content += '\n' + m.content; else out.push(m); });
  return out;
}

// ── Acciones ──

/** POST {accion:'bot_preguntar', token, payload:{pregunta, conversacion:[{rol,texto}], modulo_contexto?}} */
function botPreguntar_(ctx, payload) {
  const t0 = Date.now();
  const u = ctx.usuario;
  const pregunta = String((payload && payload.pregunta) || '').trim().slice(0, 2000);
  if (!pregunta) return { ok: false, error: 'Escribí una pregunta' };
  if (!tienePermiso_(u.legajo, 'BOT')) return { ok: false, error: 'IngeBot no está habilitado para tu usuario. Pedile acceso a ' + (prop_('ADMIN_NOMBRE', false) || 'Marcos') + '.', sin_permiso: true };

  const cupo = cupoDe_(u.legajo);
  if (!cupo.sin_tope && cupo.usadas >= cupo.max) {
    return { ok: true, limite: true, texto: 'Llegaste al máximo de ' + cupo.max + ' preguntas por hoy. Mañana se renueva.', cupo: { usadas: cupo.usadas, max: cupo.max }, fuentes: [] };
  }

  const fuentes = fuentesDe_(u.legajo);
  const sys = armarSystemBot_(u, fuentes, payload.modulo_contexto);
  const messages = conversacionAClaude_(payload.conversacion);
  if (messages.length && messages[messages.length - 1].role === 'user') messages[messages.length - 1].content += '\n' + pregunta;
  else messages.push({ role: 'user', content: pregunta });

  const base = {
    model: BOT_MODELO, max_tokens: BOT_MAX_TOKENS,
    system: [{ type: 'text', text: sys.estable, cache_control: { type: 'ephemeral' } }, { type: 'text', text: sys.variable }],
    tools: BOT_TOOLS,
    output_config: { effort: BOT_EFFORT },
    fallbacks: 'default'
  };

  const usadasFuentes = {};
  let vueltas = 0, tokens = 0, texto = '', corte = '';
  try {
    for (let i = 0; i <= BOT_MAX_VUELTAS; i++) {
      if (Date.now() - t0 > BOT_TIEMPO_MAX_MS) { corte = 'tiempo'; break; }
      const json = llamarClaude_(Object.assign({}, base, { messages }));
      vueltas++;
      tokens += tokensDe_(json.usage);
      const content = json.content || [];
      messages.push({ role: 'assistant', content });
      const toolUses = content.filter(b => b.type === 'tool_use');
      if (json.stop_reason === 'tool_use' && toolUses.length) {
        if (i === BOT_MAX_VUELTAS) { corte = 'vueltas'; break; }
        const results = toolUses.map(tu => {
          const r = ejecutarTool_(u.legajo, tu.name, tu.input);
          (r.fuentes || []).forEach(f => { usadasFuentes[f.fuente] = f; });
          return { type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(r.resultado), is_error: !!r.is_error };
        });
        messages.push({ role: 'user', content: results });
        continue;
      }
      texto = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (json.stop_reason === 'refusal') texto = 'No puedo responder esa consulta.';
      else if (json.stop_reason === 'max_tokens') texto = (texto || '') + '\n\n(respuesta cortada por largo)';
      break;
    }
  } catch (e) {
    console.warn('botPreguntar_: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e), wa_admin: waAdmin_() };
  }
  if (corte === 'vueltas') texto = 'Me quedé sin rondas de consulta para esta pregunta. Probá acotarla (un equipo, una obra, un rango de fechas).';
  if (corte === 'tiempo') texto = 'Me quedé sin tiempo para esta pregunta. Probá acotarla (menos fuentes o un rango de fechas más corto).';
  if (!texto) texto = '(sin respuesta)';

  const fuentesLista = Object.keys(usadasFuentes).map(k => usadasFuentes[k]);
  const fila = agregar_('CONSULTAS_BOT', {
    fecha: ahora_(), legajo: u.legajo, modulo_contexto: String((payload && payload.modulo_contexto) || '').toUpperCase(),
    pregunta, respuesta: texto.slice(0, 500), tokens, util: '',
    fuentes: fuentesLista.map(f => f.fuente).join('|'), vueltas, ms: Date.now() - t0
  });
  return { ok: true, texto, fuentes: fuentesLista, cupo: { usadas: cupo.usadas + 1, max: cupo.max, sin_tope: cupo.sin_tope }, fila, wa_admin: waAdmin_() };
}

/** POST {accion:'bot_valorar', token, payload:{fila, util:true|false}} */
function botValorar_(ctx, payload) {
  const fila = Number(payload.fila);
  const c = leer_('CONSULTAS_BOT').find(x => x._fila === fila && String(x.legajo) === String(ctx.usuario.legajo));
  if (!c) return { ok: false, error: 'Consulta no encontrada' };
  actualizar_('CONSULTAS_BOT', fila, { util: payload.util ? 'sí' : 'no' });
  return { ok: true };
}

/** Saludo armado en el servidor (sin Claude): nombre, avisos sin leer, una sugerencia según módulos. */
function botSaludo_(ctx, payload) {
  const u = ctx.usuario;
  const nombre = String(u.nombre_visible || '').split(' ')[0];
  let sinLeer = 0;
  try { sinLeer = leerCola_('AVISOS', 300).filter(a => String(a.legajo) === String(u.legajo) && !si_(a.leido)).length; } catch (e) { }
  const fuentes = fuentesDe_(u.legajo);
  const mods = {}; fuentes.forEach(f => { mods[f.modulo] = 1; });
  const sugerencias = [];
  if (mods.ASFALTO) sugerencias.push('cuánto asfalto hay en tanque');
  if (mods.TARJAS) sugerencias.push('qué equipos trabajaron hoy');
  if (mods.COMPRAS) sugerencias.push('qué órdenes de compra están pendientes');
  if (mods.AUTOVIAS) sugerencias.push('cuánto se colocó en Autovías este mes');
  if (mods.EXPEDIENTES) sugerencias.push('qué expedientes están quietos');
  if (mods.DASHBOARD) sugerencias.push('cuánto se cobró este mes');
  let texto = 'Hola ' + nombre + '.';
  if (sinLeer) texto += ' Tenés ' + sinLeer + (sinLeer === 1 ? ' aviso sin leer.' : ' avisos sin leer.');
  if (sugerencias.length) texto += ' Preguntame, por ejemplo, ' + sugerencias[0] + '.';
  else texto += ' Todavía no tenés sistemas con datos habilitados; puedo contarte cómo se usa la app.';
  return { ok: true, texto, wa_admin: waAdmin_() };
}

/** Diagnóstico: intenta abrir cada planilla del catálogo con la cuenta del servidor. Correr desde el editor. */
function botDiagnostico() {
  const vistos = {};
  const out = [];
  FUENTES.filter(f => !f.remota).forEach(f => {
    const id = idPlanilla_(f);
    const k = id || ('(prop ' + f.planilla.prop + ')');
    if (vistos[k]) return;
    vistos[k] = 1;
    if (!id) { out.push({ fuente: f.id, id: k, ok: false, error: 'Property vacía' }); return; }
    try { const ss = SpreadsheetApp.openById(id); out.push({ fuente: f.id, id, ok: true, nombre: ss.getName(), hojas: ss.getSheets().map(s => s.getName()).join(', ') }); }
    catch (e) { out.push({ fuente: f.id, id, ok: false, error: String(e.message || e) }); }
  });
  console.log(JSON.stringify(out, null, 1));
  return out;
}
