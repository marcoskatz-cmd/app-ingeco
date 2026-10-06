/**
 * comunicados.js — avisos redactados por personas (módulo AVISOS).
 *
 * Flujo: EMISOR redacta → pendiente → APROBADOR aprueba/rechaza → (programado) → enviado (una fila en AVISOS por destinatario).
 * Si quien redacta es APROBADOR (o ADMIN), sale sin pasar por aprobación.
 * Roles (PERMISOS, modulo AVISOS): EMISOR (sus áreas), EMISOR_GLOBAL (toda la empresa), APROBADOR.
 * Adjuntos: se suben a una carpeta de Drive del Workspace, compartidos solo con el dominio.
 */

const ESTADOS_COM = ['pendiente', 'programado', 'enviado', 'rechazado'];
const ADJUNTO_MAX_BYTES = 8 * 1024 * 1024;

function requiereEmisor_(ctx) {
  const rol = rolAvisos_(ctx.usuario.legajo);
  if (!rol) throw new Error('No tenés permiso para enviar avisos');
  return rol;
}

/** Alcance de un emisor: áreas que puede usar (null = todas). */
function alcance_(ctx) {
  const rol = requiereEmisor_(ctx);
  if (rol === 'EMISOR_GLOBAL' || rol === 'APROBADOR') return { rol, areas: null };
  return { rol, areas: areasDe_(ctx.usuario) };
}

/** Catálogo para el formulario: áreas, obras y personas visibles según alcance, con conteos. */
function catalogoDestinatarios_(ctx) {
  const alc = alcance_(ctx);
  const usuarios = leer_('USUARIOS').filter(u => si_(u.activo));
  const enAlcance = u => alc.areas === null || areasDe_(u).some(a => alc.areas.indexOf(a) >= 0);
  const personas = usuarios.filter(enAlcance).map(u => ({
    legajo: String(u.legajo), nombre: u.nombre_visible, tipo: u.tipo === 'lector' ? 'lector' : 'cuenta', areas: areasDe_(u), obra: String(u.obra || '').toUpperCase()
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const areas = areasActivas_().filter(a => alc.areas === null || alc.areas.indexOf(a.codigo) >= 0)
    .map(a => Object.assign(a, { n: personas.filter(p => p.areas.indexOf(a.codigo) >= 0).length }));
  const obras = obrasActivas_().map(o => Object.assign(o, { n: personas.filter(p => p.obra === o.codigo).length })).filter(o => o.n > 0 || alc.areas === null);
  return { ok: true, rol: alc.rol, global: alc.areas === null, areas, obras, personas, total: personas.length };
}

/** Normaliza y valida la selección: {todos, areas:[], obras:[], legajos:[]} → lista de legajos dentro del alcance. */
function resolverSeleccion_(ctx, sel) {
  const alc = alcance_(ctx);
  sel = sel || {};
  if (sel.todos && alc.areas !== null) throw new Error('Solo un emisor global puede enviar a toda la empresa');
  const areas = (sel.areas || []).map(a => String(a).toUpperCase());
  if (alc.areas !== null && areas.some(a => alc.areas.indexOf(a) < 0)) throw new Error('Elegiste un área fuera de tu alcance');
  const usuarios = resolverDestinatarios_(sel.todos ? { todos: true } : [{ areas }, { obras: (sel.obras || []) }, { legajos: (sel.legajos || []) }], 'AVISOS');
  const filtrados = alc.areas === null ? usuarios : usuarios.filter(u => areasDe_(u).some(a => alc.areas.indexOf(a) >= 0));
  return filtrados;
}

function previewDestinatarios_(ctx, payload) {
  const us = resolverSeleccion_(ctx, payload.seleccion);
  return { ok: true, total: us.length, personas: us.map(u => ({ legajo: String(u.legajo), nombre: u.nombre_visible })).sort((a, b) => a.nombre.localeCompare(b.nombre)) };
}

// ───────────── Adjuntos ─────────────

function carpetaAdjuntos_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DRIVE_CARPETA_ADJUNTOS');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  const f = DriveApp.createFolder('APP INGECO - Adjuntos de avisos');
  props.setProperty('DRIVE_CARPETA_ADJUNTOS', f.getId());
  return f;
}

/** payload.adjunto = {nombre, tipo, base64}. Devuelve {url, nombre} o null. */
function subirAdjunto_(adj) {
  if (!adj || !adj.base64) return null;
  const bytes = Utilities.base64Decode(adj.base64);
  if (bytes.length > ADJUNTO_MAX_BYTES) throw new Error('El adjunto supera los 8 MB');
  const blob = Utilities.newBlob(bytes, adj.tipo || 'application/octet-stream', String(adj.nombre || 'adjunto').slice(0, 100));
  const file = carpetaAdjuntos_().createFile(blob);
  try { file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW); }
  catch (e) { console.warn('No se pudo compartir con el dominio: ' + e); }
  return { url: file.getUrl(), nombre: file.getName() };
}

// ───────────── Crear / aprobar / rechazar ─────────────

function fechaProgramada_(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error('Fecha programada inválida');
  return d.getTime() > Date.now() + 60000 ? d : null;   // en el pasado = enviar ahora
}

/** payload: {titulo, cuerpo, url, prioridad, seleccion:{todos, areas, obras, legajos}, programado_para, adjunto:{nombre,tipo,base64}} */
function crearComunicado_(ctx, payload) {
  const alc = alcance_(ctx);
  const titulo = String(payload.titulo || '').trim().slice(0, 120);
  const cuerpo = String(payload.cuerpo || '').trim().slice(0, 1500);
  if (!titulo) return { ok: false, error: 'Falta el título' };
  const destinatarios = resolverSeleccion_(ctx, payload.seleccion);
  if (!destinatarios.length) return { ok: false, error: 'La selección no incluye a nadie' };
  const programado = fechaProgramada_(payload.programado_para);
  const adj = subirAdjunto_(payload.adjunto);
  const autoAprobado = alc.rol === 'APROBADOR';
  const id = uuid_();
  const c = {
    id, fecha: ahora_(), emisor_legajo: ctx.usuario.legajo, titulo, cuerpo, url: String(payload.url || '').trim(),
    adjunto_url: adj ? adj.url : '', adjunto_nombre: adj ? adj.nombre : '', prioridad: payload.prioridad === 'critica' ? 'critica' : 'normal',
    destinatarios: JSON.stringify(payload.seleccion || {}), estado: autoAprobado ? (programado ? 'programado' : 'enviado') : 'pendiente',
    programado_para: programado || '', aprobado_por: autoAprobado ? ctx.usuario.legajo : '', fecha_aprobacion: autoAprobado ? ahora_() : '',
    motivo_rechazo: '', fecha_envio: '', total_destinatarios: destinatarios.length, reenvios: 0
  };
  agregar_('COMUNICADOS', c);
  if (autoAprobado && !programado) { enviarComunicado_(c.id); }
  if (!autoAprobado) {
    const aprobadores = legajosConRol_('AVISOS', 'APROBADOR').concat(legajosAdmin_());
    notificarInterno_({
      destinatarios: aprobadores, modulo: 'AVISOS', tipo: 'aviso_general', prioridad: 'normal',
      titulo: 'Aviso para aprobar: ' + titulo, cuerpo: ctx.usuario.nombre_visible + ' quiere enviar a ' + destinatarios.length + ' persona' + (destinatarios.length > 1 ? 's' : '') + '.',
      url_destino: '#avisos/' + id
    });
  }
  return { ok: true, id, estado: c.estado, total: destinatarios.length };
}

function comunicadoPorId_(id) { return leer_('COMUNICADOS').find(c => c.id === id) || null; }

function requiereAprobador_(ctx) {
  if (rolAvisos_(ctx.usuario.legajo) !== 'APROBADOR') throw new Error('Solo un aprobador puede hacer esto');
}

function aprobarComunicado_(ctx, payload) {
  requiereAprobador_(ctx);
  const c = comunicadoPorId_(payload.id);
  if (!c) return { ok: false, error: 'Aviso no encontrado' };
  if (c.estado !== 'pendiente') return { ok: false, error: 'Este aviso ya está ' + c.estado };
  const programado = c.programado_para ? fechaProgramada_(c.programado_para) : null;
  actualizar_('COMUNICADOS', c._fila, { estado: programado ? 'programado' : 'enviado', aprobado_por: ctx.usuario.legajo, fecha_aprobacion: ahora_() });
  if (!programado) enviarComunicado_(c.id);
  notificarInterno_({ destinatarios: [c.emisor_legajo], modulo: 'AVISOS', tipo: 'aviso_general', prioridad: 'normal', titulo: 'Aprobado: ' + c.titulo, cuerpo: programado ? 'Sale el ' + Utilities.formatDate(programado, 'America/Argentina/Tucuman', 'dd/MM HH:mm') + '.' : 'Ya se envió.', url_destino: '#avisos/' + c.id });
  return { ok: true, estado: programado ? 'programado' : 'enviado' };
}

function rechazarComunicado_(ctx, payload) {
  requiereAprobador_(ctx);
  const c = comunicadoPorId_(payload.id);
  if (!c) return { ok: false, error: 'Aviso no encontrado' };
  if (c.estado !== 'pendiente') return { ok: false, error: 'Este aviso ya está ' + c.estado };
  const motivo = String(payload.motivo || '').trim().slice(0, 300);
  actualizar_('COMUNICADOS', c._fila, { estado: 'rechazado', aprobado_por: ctx.usuario.legajo, fecha_aprobacion: ahora_(), motivo_rechazo: motivo });
  notificarInterno_({ destinatarios: [c.emisor_legajo], modulo: 'AVISOS', tipo: 'aviso_general', prioridad: 'normal', titulo: 'Rechazado: ' + c.titulo, cuerpo: motivo || 'Sin motivo indicado.', url_destino: '#avisos/' + c.id });
  return { ok: true };
}

/** Escribe una fila en AVISOS por destinatario y manda push. Idempotente por estado. */
function enviarComunicado_(id) {
  const c = comunicadoPorId_(id);
  if (!c || c.fecha_envio) return;
  const emisor = leer_('USUARIOS').find(u => String(u.legajo) === String(c.emisor_legajo)) || {};
  let sel = {};
  try { sel = JSON.parse(c.destinatarios || '{}'); } catch (e) { }
  const destinatarios = resolverDestinatarios_(sel.todos ? { todos: true } : [{ areas: sel.areas || [] }, { obras: sel.obras || [] }, { legajos: sel.legajos || [] }], 'AVISOS');
  const cuerpo = c.cuerpo + (c.adjunto_url ? '\n📎 ' + c.adjunto_nombre : '');
  const r = notificarInterno_({
    destinatarios: destinatarios.map(u => u.legajo), modulo: 'AVISOS', tipo: 'aviso_general', prioridad: c.prioridad,
    titulo: c.titulo, cuerpo, url_destino: c.url || c.adjunto_url || '', comunicado_id: c.id
  });
  actualizar_('COMUNICADOS', c._fila, { estado: 'enviado', fecha_envio: ahora_(), total_destinatarios: r.ok ? r.avisos.length : 0 });
}

/** Trigger cada 5 min: envía los programados cuya hora llegó. */
function enviarProgramados() {
  const ahora = Date.now();
  leer_('COMUNICADOS').filter(c => c.estado === 'programado' && c.programado_para && new Date(c.programado_para).getTime() <= ahora)
    .forEach(c => { try { enviarComunicado_(c.id); } catch (e) { console.error('enviarProgramados ' + c.id + ': ' + e); } });
}

// ───────────── Listado, detalle, reenvío ─────────────

function resumenComunicado_(c, avisosPorCom, nombres) {
  const avs = avisosPorCom[c.id] || [];
  const leidos = avs.filter(a => si_(a.leido)).length;
  return {
    id: c.id, fecha: c.fecha, emisor: nombres[String(c.emisor_legajo)] || c.emisor_legajo, emisor_legajo: String(c.emisor_legajo),
    titulo: c.titulo, cuerpo: c.cuerpo, url: c.url, adjunto_url: c.adjunto_url, adjunto_nombre: c.adjunto_nombre, prioridad: c.prioridad,
    estado: c.estado, programado_para: c.programado_para, aprobado_por: nombres[String(c.aprobado_por)] || c.aprobado_por, fecha_aprobacion: c.fecha_aprobacion,
    motivo_rechazo: c.motivo_rechazo, fecha_envio: c.fecha_envio, total: Number(c.total_destinatarios || avs.length), leidos, reenvios: Number(c.reenvios || 0)
  };
}

function indicesComunicados_() {
  const avisosPorCom = {};
  leer_('AVISOS').forEach(a => { if (a.comunicado_id) { (avisosPorCom[a.comunicado_id] = avisosPorCom[a.comunicado_id] || []).push(a); } });
  const nombres = {};
  leer_('USUARIOS').forEach(u => { nombres[String(u.legajo)] = u.nombre_visible; });
  return { avisosPorCom, nombres };
}

/** Mis avisos (emisor) + pendientes de aprobación (aprobador) + todos (admin). */
function listarComunicados_(ctx) {
  const rol = requiereEmisor_(ctx);
  const legajo = String(ctx.usuario.legajo);
  const { avisosPorCom, nombres } = indicesComunicados_();
  const todos = leer_('COMUNICADOS').sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const mios = todos.filter(c => String(c.emisor_legajo) === legajo).map(c => resumenComunicado_(c, avisosPorCom, nombres));
  const pendientes = rol === 'APROBADOR' ? todos.filter(c => c.estado === 'pendiente' && String(c.emisor_legajo) !== legajo).map(c => resumenComunicado_(c, avisosPorCom, nombres)) : [];
  const otros = rol === 'APROBADOR' ? todos.filter(c => c.estado !== 'pendiente' && String(c.emisor_legajo) !== legajo).slice(0, 50).map(c => resumenComunicado_(c, avisosPorCom, nombres)) : [];
  return { ok: true, rol, mios, pendientes, otros };
}

function detalleComunicado_(ctx, payload) {
  const rol = requiereEmisor_(ctx);
  const c = comunicadoPorId_(payload.id);
  if (!c) return { ok: false, error: 'Aviso no encontrado' };
  if (rol !== 'APROBADOR' && String(c.emisor_legajo) !== String(ctx.usuario.legajo)) return { ok: false, error: 'No es tu aviso' };
  const { avisosPorCom, nombres } = indicesComunicados_();
  const r = resumenComunicado_(c, avisosPorCom, nombres);
  const avs = avisosPorCom[c.id] || [];
  r.leyeron = avs.filter(a => si_(a.leido)).map(a => ({ legajo: String(a.legajo), nombre: nombres[String(a.legajo)] || a.legajo, fecha: a.fecha_leido })).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  r.no_leyeron = avs.filter(a => !si_(a.leido)).map(a => ({ legajo: String(a.legajo), nombre: nombres[String(a.legajo)] || a.legajo })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  let sel = {}; try { sel = JSON.parse(c.destinatarios || '{}'); } catch (e) { }
  r.seleccion = sel;
  if (c.estado !== 'enviado') {
    try { r.destinatarios_previstos = resolverDestinatarios_(sel.todos ? { todos: true } : [{ areas: sel.areas || [] }, { obras: sel.obras || [] }, { legajos: sel.legajos || [] }], 'AVISOS').map(u => ({ legajo: String(u.legajo), nombre: u.nombre_visible })); } catch (e) { r.destinatarios_previstos = []; }
  }
  return r;
}

/** Nuevo push a quienes no leyeron. No crea filas nuevas. */
function reenviarComunicado_(ctx, payload) {
  const rol = requiereEmisor_(ctx);
  const c = comunicadoPorId_(payload.id);
  if (!c) return { ok: false, error: 'Aviso no encontrado' };
  if (rol !== 'APROBADOR' && String(c.emisor_legajo) !== String(ctx.usuario.legajo)) return { ok: false, error: 'No es tu aviso' };
  if (c.estado !== 'enviado') return { ok: false, error: 'Todavía no se envió' };
  const pendientes = leer_('AVISOS').filter(a => a.comunicado_id === c.id && !si_(a.leido));
  let enviados = 0;
  pendientes.forEach(a => { enviados += enviarPush_(a.legajo, { id: a.id, titulo: '🔁 ' + c.titulo, cuerpo: c.cuerpo, url: a.url_destino || '#bandeja', modulo: 'AVISOS', prioridad: c.prioridad }).enviados; });
  actualizar_('COMUNICADOS', c._fila, { reenvios: Number(c.reenvios || 0) + 1 });
  return { ok: true, pendientes: pendientes.length, push_enviados: enviados };
}

// ───────────── Archivo anual ─────────────

/** Trigger 1 de enero 4:00: mueve AVISOS y COMUNICADOS del año anterior a una planilla "APP_INGECO archivo <año>" y los borra de la activa. */
function archivarAnual() {
  const anio = new Date().getFullYear() - 1;
  const esDelAnio = f => f && new Date(f).getFullYear() === anio;
  const nombre = 'APP_INGECO archivo ' + anio;
  const destino = SpreadsheetApp.create(nombre);
  try {
    const carpeta = carpetaAdjuntos_().getParents().hasNext() ? carpetaAdjuntos_().getParents().next() : null;
    if (carpeta) DriveApp.getFileById(destino.getId()).moveTo(carpeta);
  } catch (e) { }
  ['AVISOS', 'COMUNICADOS'].forEach(h => {
    const filas = leer_(h).filter(r => esDelAnio(r.fecha));
    const enc = encabezados_(h);
    const sh = destino.insertSheet(h);
    sh.appendRow(enc);
    if (filas.length) sh.getRange(2, 1, filas.length, enc.length).setValues(filas.map(r => enc.map(c => r[c] === undefined ? '' : r[c])));
    filas.sort((a, b) => b._fila - a._fila).forEach(r => hoja_(h).deleteRow(r._fila));
    invalidar_(h);
  });
  const h1 = destino.getSheetByName('Hoja 1') || destino.getSheetByName('Sheet1');
  if (h1) destino.deleteSheet(h1);
  avisarAdmin_('Archivo anual ' + anio + ' generado', 'Los avisos de ' + anio + ' se movieron a la planilla "' + nombre + '" en Drive: ' + destino.getUrl());
}
