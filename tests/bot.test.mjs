import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargar, stubs, appIngeco } from './_cargar.mjs';
const plano = x => JSON.parse(JSON.stringify(x));
const ARCHIVOS = ['sheets.js', 'permisos.js', 'bot_fuentes.js', 'bot_tabla.js', 'bot_tools.js', 'bot.js'];
const ASF = '1rqS_raTVSxjLpWxxhZU9SKVi5BBvfA7SAb27vSBhRco';

// Respuestas simuladas de la API, en orden. Captura los bodies enviados.
function conApi(g, respuestas) {
  const bodies = [];
  g.UrlFetchApp = {
    fetch: (url, opts) => {
      bodies.push(JSON.parse(opts.payload));
      const r = respuestas.shift() || { status: 500, json: { error: { message: 'sin respuesta programada' } } };
      return { getResponseCode: () => r.status || 200, getContentText: () => JSON.stringify(r.json) };
    }
  };
  g.__bodies = bodies;
  return g;
}
function ctxCon(permisos, consultas, hojasExtra, props) {
  const g = appIngeco(stubs(), {
    USUARIOS: [{ legajo: '7', nombre_visible: 'Ana Pérez', sector: 'Ingeniería', activo: 'sí', email: 'a@x' }],
    PERMISOS: permisos, CONSULTAS_BOT: consultas || [],
    MODULOS: [{ codigo: 'ASFALTO', nombre: 'Stock de asfalto', activo: 'sí', orden: 1 }, { codigo: 'BOT', nombre: 'IngeBot', activo: 'sí', orden: 50, tipo: 'interno' }],
    INSTRUCTIVOS: [{ modulo: 'ASFALTO', seccion: 'Cargar', texto: 'Botón guardar día.' }]
  });
  Object.assign(g.__hojas, hojasExtra || {});
  Object.assign(g.__props, Object.assign({ CLAUDE_API_KEY: 'sk-test' }, props || {}));
  return g;
}
function contexto(g, respuestas) {
  conApi(g, respuestas);
  return cargar(ARCHIVOS, g);
}
const ctxUsuario = { usuario: { legajo: '7', nombre_visible: 'Ana Pérez', sector: 'Ingeniería' }, sesion: { _fila: 2 } };
const BOT_OK = [{ legajo: '7', modulo: 'BOT' }, { legajo: '7', modulo: 'ASFALTO' }];
const hojaAsf = { [ASF]: { DIARIO: [['FECHA', 'STOCK_T'], ['2026-10-31', 120]], SALIDAS: [['FECHA', 'DESTINO', 'MEZCLA_T']], CONFIG: [['clave', 'valor', 'desc']] } };
const textoFinal = t => ({ json: { content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } } });
const pideTool = (name, input) => ({ json: { content: [{ type: 'tool_use', id: 'tu_1', name, input }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } } });

test('sin módulo BOT no llama a la API', () => {
  const c = contexto(ctxCon([{ legajo: '7', modulo: 'ASFALTO' }]), []);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'hola' });
  assert.equal(r.ok, false);
  assert.equal(c.__bodies.length, 0);
});

test('loop: tool_use → ejecuta → segunda llamada lleva tool_result → texto final con fuentes', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [pideTool('leer_tabla', { fuente: 'asfalto_diario', filtros: null, columnas: null, orden: null, limite: null }), textoFinal('Hay 120 t en tanque.')]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: '¿cuánto asfalto hay?', conversacion: [] });
  assert.equal(r.ok, true);
  assert.equal(r.texto, 'Hay 120 t en tanque.');
  assert.deepEqual(plano(r.fuentes.map(f => f.modulo)), ['ASFALTO']);
  const b2 = c.__bodies[1];
  const ultimo = b2.messages[b2.messages.length - 1];
  assert.equal(ultimo.role, 'user');
  assert.equal(ultimo.content[0].type, 'tool_result');
  assert.equal(ultimo.content[0].tool_use_id, 'tu_1');
  assert.equal(ultimo.content[0].is_error, false);
  assert.equal(b2.model, 'claude-opus-5-5');
  assert.equal(b2.output_config.effort, 'medium');
  assert.equal(b2.fallbacks, 'default');
  assert.equal(b2.thinking, undefined);
  assert.ok(Array.isArray(b2.tools) && b2.tools.length === 6);
  assert.equal(b2.system[0].cache_control.type, 'ephemeral');
});

test('fuente no habilitada: tool_result con is_error y el loop termina bien', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [pideTool('leer_tabla', { fuente: 'tarjas_diarias', filtros: null, columnas: null, orden: null, limite: null }), textoFinal('No tenés acceso a Tarja.')]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'equipos en margaritas' });
  assert.equal(r.ok, true);
  assert.equal(c.__bodies[1].messages.at(-1).content[0].is_error, true);
  assert.equal(r.texto, 'No tenés acceso a Tarja.');
});

test('cupo por persona: con BOT_CUPO_DIA=2 y 2 consultas de hoy devuelve limite sin llamar a la API', () => {
  const hoy = new Date();
  const c = contexto(ctxCon(BOT_OK, [{ fecha: hoy, legajo: '7', pregunta: 'a' }, { fecha: hoy, legajo: '7', pregunta: 'b' }], hojaAsf, { BOT_CUPO_DIA: '2' }), [textoFinal('x')]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'otra' });
  assert.equal(r.ok, true);
  assert.equal(r.limite, true);
  assert.equal(c.__bodies.length, 0);
});

test('BOT_SIN_TOPE exime del cupo', () => {
  const hoy = new Date();
  const c = contexto(ctxCon(BOT_OK, [{ fecha: hoy, legajo: '7' }, { fecha: hoy, legajo: '7' }], hojaAsf, { BOT_CUPO_DIA: '2', BOT_SIN_TOPE: '3,7' }), [textoFinal('ok')]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'otra' });
  assert.equal(r.texto, 'ok');
});

test('refusal devuelve texto fijo', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [{ json: { content: [], stop_reason: 'refusal', stop_details: { explanation: 'x' } } }]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'algo' });
  assert.match(r.texto, /No puedo responder esa consulta/);
});

test('más de 8 vueltas de herramientas corta y pide acotar', () => {
  const resp = Array.from({ length: 10 }, () => pideTool('listar_fuentes', {}));
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), resp);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'todo' });
  assert.equal(r.ok, true);
  assert.match(r.texto, /acotar/i);
  assert.equal(c.__bodies.length, 9);
});

test('conversación: se mandan los últimos 12 mensajes y el primero es user', () => {
  const conv = Array.from({ length: 14 }, (_, i) => ({ rol: i % 2 ? 'bot' : 'usuario', texto: 'm' + i }));
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [textoFinal('fin')]);
  c.botPreguntar_(ctxUsuario, { pregunta: 'nueva', conversacion: conv });
  const msgs = c.__bodies[0].messages;
  assert.equal(msgs[0].role, 'user');
  assert.ok(msgs.length <= 13 && msgs.length >= 12);
  assert.equal(msgs.at(-1).content, 'nueva');
});

test('error de API devuelve ok:false con mensaje legible', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [{ status: 529, json: { error: { message: 'overloaded' } } }]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'x' });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('bot_saludo no llama a la API y nombra a la persona', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), []);
  const r = c.botSaludo_(ctxUsuario, {});
  assert.equal(r.ok, true);
  assert.match(r.texto, /Ana/);
  assert.equal(c.__bodies.length, 0);
});

test('cupoDe_ informa usadas y máximo', () => {
  const hoy = new Date();
  const c = contexto(ctxCon(BOT_OK, [{ fecha: hoy, legajo: '7' }], hojaAsf), []);
  assert.deepEqual(plano(c.cupoDe_('7')), { usadas: 1, max: 30, sin_tope: false });
});

test('system prompt: estable trae diccionario completo; variable solo las fuentes habilitadas', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), []);
  const u = { legajo: '7', nombre_visible: 'Ana Pérez', sector: 'Ingeniería' };
  const s = c.armarSystemBot_(u, c.fuentesDe_('7'), '');
  assert.match(s.estable, /tarjas_diarias/);
  assert.match(s.estable, /Cargar/);
  assert.match(s.variable, /asfalto_diario/);
  assert.doesNotMatch(s.variable, /tarjas_diarias/);
  assert.match(s.variable, /Ana Pérez/);
});

test('alias viejo "ayuda" devuelve también "respuesta" para el shell en caché', () => {
  const c = contexto(ctxCon(BOT_OK, [], hojaAsf), [textoFinal('ok viejo')]);
  const r = c.botPreguntar_(ctxUsuario, { pregunta: 'x', historial: [] });
  assert.equal(r.respuesta, 'ok viejo');
});
