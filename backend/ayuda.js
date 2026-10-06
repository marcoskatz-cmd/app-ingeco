/**
 * ayuda.js — bot de ayuda con Claude.
 *
 * Responde "cómo hago X" leyendo INSTRUCTIVOS de los módulos que la persona tiene,
 * en el contexto del módulo desde el que abrió la ayuda. También responde preguntas sobre
 * los módulos que esa persona tiene autorizados: cuáles son, para qué sirve cada uno,
 * qué rol tiene y a quién consultar. No ejecuta acciones ni consulta datos de negocio.
 *
 * La API key vive en PropertiesService (CLAUDE_API_KEY). El celular nunca la ve.
 */

const BOT_MODELO = 'claude-haiku-4-5-20251001';
const BOT_MAX_TOKENS = 400;
const BOT_CONSULTAS_DIA = 30;
const BOT_HISTORIAL_MAX = 8;

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

function consultasHoy_(legajo) {
  const hoy = Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyy-MM-dd');
  return leer_('CONSULTAS_BOT').filter(c =>
    String(c.legajo) === String(legajo) && c.fecha &&
    Utilities.formatDate(new Date(c.fecha), 'America/Argentina/Tucuman', 'yyyy-MM-dd') === hoy).length;
}

function waAdmin_() {
  const cel = prop_('ADMIN_CELULAR', false);
  return cel ? 'https://wa.me/' + celularWA_(cel) : '';
}

/** Arma el system prompt. Bloque 1 (estable, cacheable): rol + reglas + catálogo. Bloque 2: quién pregunta + contexto. */
function armarSystem_(usuario, moduloContexto) {
  const permitidos = modulosDe_(usuario.legajo);
  const codigosPermitidos = permitidos.map(m => m.codigo);
  const todos = modulosActivos_();
  const noPermitidos = todos.filter(m => codigosPermitidos.indexOf(m.codigo) < 0);
  const instr = instructivosPor_();
  const ctx = moduloContexto ? String(moduloContexto).toUpperCase() : '';
  const admin = prop_('ADMIN_NOMBRE', false) || 'Marcos';

  // ── Bloque estable: reglas + catálogo completo de módulos + instructivos (cacheable, igual para todos) ──
  let estable = 'Sos el asistente de ayuda de la app INGECO (INGECO S.A., Tucumán). Respondés en español rioplatense llano, ' +
    'en no más de 4 oraciones, sin jerga técnica, sin markdown complejo (podés usar guiones para pasos).\n\n' +
    'REGLAS:\n' +
    '1. Solo explicás CÓMO usar los módulos que la persona tiene autorizados, con los instructivos de abajo. Nunca inventes pasos ni botones que no figuren en los instructivos.\n' +
    '2. Si te preguntan qué módulos tiene, qué puede hacer, para qué sirve un módulo, qué rol tiene, o a quién consultar, respondé con la lista de "MÓDULOS AUTORIZADOS" de la persona. Esa información es exacta y podés darla completa.\n' +
    '3. Si preguntan por un módulo que existe pero NO tienen autorizado, decí que ese módulo existe, para qué sirve en una frase, y que le pidan acceso a ' + admin + '. No expliques cómo se usa.\n' +
    '4. Si preguntan por un dato concreto del negocio (cuánto stock hay, qué pedidos tengo, si pagaron algo), decí que eso se ve dentro del módulo correspondiente o que lo consulten con el responsable, y que pueden usar el botón "Consultar por WhatsApp".\n' +
    '5. Si no sabés, decilo y ofrecé hablar con ' + admin + '. Nunca inventes.\n' +
    '6. No ejecutás acciones: no podés cargar, borrar ni modificar nada.\n\n' +
    'CATÁLOGO DE MÓDULOS DE LA APP (todos los que existen):\n' +
    todos.map(m => '- ' + m.codigo + ' — ' + m.nombre + ': ' + (m.descripcion_corta || '')).join('\n') + '\n\n' +
    'INSTRUCTIVOS POR MÓDULO:\n';
  Object.keys(instr).sort().forEach(m => {
    estable += '\n### ' + m + '\n';
    instr[m].forEach(s => { estable += (s.seccion ? '[' + s.seccion + '] ' : '') + s.texto + '\n'; });
  });
  estable += '\nIMPORTANTE: de los instructivos de arriba, usá SOLO los de los módulos autorizados que figuran en el bloque siguiente. Los demás existen para que sepas qué hace cada módulo, no para explicar su uso a quien no tiene acceso.';

  // ── Bloque variable: quién pregunta ──
  let variable = 'QUIÉN PREGUNTA: ' + usuario.nombre_visible + (usuario.sector ? ', sector ' + usuario.sector : '') + ' (legajo ' + usuario.legajo + ').\n\n';
  variable += 'MÓDULOS AUTORIZADOS para esta persona:\n';
  if (!permitidos.length) variable += '(ninguno todavía; indicale que le pida acceso a ' + admin + ')\n';
  permitidos.forEach(m => {
    const resp = m.responsable_legajo ? (leer_('USUARIOS').find(u => String(u.legajo) === String(m.responsable_legajo)) || {}).nombre_visible : '';
    variable += '- ' + m.codigo + ' — ' + m.nombre + ' (rol: ' + m.rol + ')' + (m.descripcion_corta ? ': ' + m.descripcion_corta : '') + (resp ? '. Responsable: ' + resp : '') + '\n';
  });
  if (noPermitidos.length) variable += '\nMÓDULOS QUE EXISTEN PERO NO TIENE AUTORIZADOS: ' + noPermitidos.map(m => m.codigo).join(', ') + '\n';
  if (ctx) {
    const mod = moduloPorCodigo_(ctx);
    variable += '\nCONTEXTO: la persona abrió la ayuda desde el módulo ' + ctx + (mod ? ' (' + mod.nombre + ')' : '') +
      (codigosPermitidos.indexOf(ctx) >= 0 ? '. Priorizá los instructivos de ese módulo.' : ', que NO tiene autorizado.') + '\n';
  }
  return { estable, variable };
}

/** POST {accion:"ayuda", token, modulo_contexto, pregunta, historial:[{rol:"usuario"|"bot", texto}]} */
function ayuda_(ctx, payload) {
  const pregunta = String(payload.pregunta || '').trim().slice(0, 1000);
  if (!pregunta) return { ok: false, error: 'Escribí una pregunta' };
  const u = ctx.usuario;
  const wa = waAdmin_();

  if (consultasHoy_(u.legajo) >= BOT_CONSULTAS_DIA) {
    return { ok: true, respuesta: 'Ya hiciste muchas consultas hoy. Para seguir, escribile directo a ' + (prop_('ADMIN_NOMBRE', false) || 'Marcos') + '.', wa_admin: wa, limite: true };
  }

  const apiKey = prop_('CLAUDE_API_KEY', false);
  if (!apiKey) return { ok: false, error: 'El asistente no está configurado todavía. Consultá por WhatsApp.', wa_admin: wa };

  const sys = armarSystem_(u, payload.modulo_contexto);
  const historial = (payload.historial || []).slice(-BOT_HISTORIAL_MAX).map(h => ({
    role: h.rol === 'bot' ? 'assistant' : 'user', content: String(h.texto || '').slice(0, 1000)
  })).filter(m => m.content);
  // La conversación tiene que empezar con user y alternar.
  while (historial.length && historial[0].role !== 'user') historial.shift();
  const mensajes = historial.concat([{ role: 'user', content: pregunta }]);

  const body = {
    model: BOT_MODELO,
    max_tokens: BOT_MAX_TOKENS,
    system: [
      { type: 'text', text: sys.estable, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: sys.variable }
    ],
    messages: mensajes
  };

  let respuesta = '', tokens = 0;
  try {
    const r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify(body)
    });
    const json = JSON.parse(r.getContentText());
    if (r.getResponseCode() !== 200) {
      console.warn('Claude API: ' + r.getContentText());
      return { ok: false, error: 'El asistente no pudo responder ahora. Probá en un rato o consultá por WhatsApp.', wa_admin: wa };
    }
    respuesta = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const us = json.usage || {};
    tokens = (us.input_tokens || 0) + (us.output_tokens || 0) + (us.cache_read_input_tokens || 0) + (us.cache_creation_input_tokens || 0);
  } catch (e) {
    console.warn('ayuda_ falló: ' + e);
    return { ok: false, error: 'No hay conexión con el asistente. Consultá por WhatsApp.', wa_admin: wa };
  }

  const id = uuid_();
  agregar_('CONSULTAS_BOT', {
    fecha: ahora_(), legajo: u.legajo, modulo_contexto: String(payload.modulo_contexto || '').toUpperCase(),
    pregunta, respuesta, tokens, util: ''
  });
  return { ok: true, respuesta, consulta_id: id, fila: hoja_('CONSULTAS_BOT').getLastRow(), wa_admin: wa };
}

/** Pulgar arriba/abajo: POST {accion:"valorar_ayuda", token, fila, util:true|false} */
function valorarAyuda_(ctx, payload) {
  const fila = Number(payload.fila);
  const c = leer_('CONSULTAS_BOT').find(x => x._fila === fila && String(x.legajo) === String(ctx.usuario.legajo));
  if (!c) return { ok: false, error: 'Consulta no encontrada' };
  actualizar_('CONSULTAS_BOT', fila, { util: payload.util ? 'sí' : 'no' });
  return { ok: true };
}

/** Saludo inicial del chat según contexto, sin gastar tokens. */
function saludoAyuda_(ctx, payload) {
  const mods = modulosDe_(ctx.usuario.legajo);
  const c = payload.modulo_contexto ? moduloPorCodigo_(payload.modulo_contexto) : null;
  const nombre = String(ctx.usuario.nombre_visible || '').split(' ')[0];
  let texto = c ? 'Hola ' + nombre + ', ¿en qué te ayudo con ' + c.nombre + '?'
    : 'Hola ' + nombre + ', ¿en qué te ayudo?';
  if (mods.length) texto += ' Podés preguntarme cómo se usa ' + (mods.length === 1 ? mods[0].nombre : 'cualquiera de tus módulos') + ' o qué módulos tenés.';
  return { ok: true, texto, wa_admin: waAdmin_() };
}
