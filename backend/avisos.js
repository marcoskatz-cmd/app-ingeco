/**
 * avisos.js — motor de notificaciones: notificar(), bandeja, Web Push (vía relay), WhatsApp, resumen diario.
 *
 * Un aviso se escribe UNA vez en AVISOS (una fila por legajo) y de ahí sale por los canales.
 * La bandeja es la fuente de verdad; push y WhatsApp solo llaman la atención sobre ella.
 *
 * Web Push: Apps Script no puede firmar VAPID (ECDSA P-256) ni cifrar el payload (AES-GCM / ECDH),
 * así que el envío real lo hace el relay en Vercel (carpeta push-relay/). El backend le pasa
 * suscripción + mensaje con un secreto compartido (PUSH_RELAY_URL / PUSH_RELAY_SECRET).
 */

const TIPOS_AVISO = ['stock_critico', 'vencimiento_doc', 'pedido_pendiente', 'aviso_general', 'seguridad'];

/** Valida la clave_sistema de un módulo externo. Propiedad: CLAVE_<MODULO>. */
function validarClaveSistema_(modulo, clave) {
  if (!modulo || !clave) return false;
  const esperada = prop_('CLAVE_' + String(modulo).toUpperCase(), false);
  return !!esperada && esperada === String(clave);
}

/** destinatarios: ["123", "456"] | {rol:"AUTORIZANTE", modulo:"COMPRAS"} | {sector:"Taller"} | {legajos:[...]} | mezcla en array. */
function resolverDestinatarios_(dest, moduloDefault) {
  const set = {};
  const agregar = l => { if (l !== undefined && l !== null && l !== '') set[String(l)] = true; };
  const procesar = d => {
    if (d === null || d === undefined) return;
    if (Array.isArray(d)) { d.forEach(procesar); return; }
    if (typeof d === 'object') {
      if (d.legajos) d.legajos.forEach(agregar);
      if (d.legajo) agregar(d.legajo);
      if (d.rol) legajosConRol_(d.modulo || moduloDefault, d.rol).forEach(agregar);
      if (d.sector) legajosDeSector_(d.sector).forEach(agregar);
      if (d.area) legajosDeArea_(d.area).forEach(agregar);
      if (d.areas) d.areas.forEach(a => legajosDeArea_(a).forEach(agregar));
      if (d.obra) legajosDeObra_(d.obra).forEach(agregar);
      if (d.obras) d.obras.forEach(o => legajosDeObra_(o).forEach(agregar));
      if (d.admin) legajosAdmin_().forEach(agregar);
      if (d.todos) leer_('USUARIOS').forEach(u => agregar(u.legajo));
      return;
    }
    agregar(d);
  };
  procesar(dest);
  // Solo usuarios activos
  const activos = {};
  leer_('USUARIOS').forEach(u => { if (si_(u.activo)) activos[String(u.legajo)] = u; });
  return Object.keys(set).filter(l => activos[l]).map(l => activos[l]);
}

/**
 * Contrato: POST {accion:"notificar", clave_sistema, destinatarios, modulo, tipo, titulo, cuerpo, url_destino, prioridad}
 * Uso interno: notificarInterno_({...}) sin clave.
 */
function notificar_(payload) {
  if (!validarClaveSistema_(payload.modulo, payload.clave_sistema)) return { ok: false, error: 'clave_sistema inválida' };
  return notificarInterno_(payload);
}

function notificarInterno_(p) {
  const modulo = String(p.modulo || 'APP').toUpperCase();
  const tipo = TIPOS_AVISO.indexOf(p.tipo) >= 0 ? p.tipo : 'aviso_general';
  const prioridad = p.prioridad === 'critica' ? 'critica' : 'normal';
  const titulo = String(p.titulo || '').slice(0, 120);
  const cuerpo = String(p.cuerpo || '').slice(0, 600);
  if (!titulo) return { ok: false, error: 'Falta titulo' };

  const usuarios = resolverDestinatarios_(p.destinatarios, modulo);
  if (!usuarios.length) return { ok: false, error: 'Ningún destinatario válido' };

  const fecha = ahora_();
  const filas = [];
  const resultados = [];
  usuarios.forEach(u => {
    const id = uuid_();
    const canales = ['bandeja'];
    const push = enviarPush_(u.legajo, { id, titulo, cuerpo, url: p.url_destino || '', modulo, prioridad });
    if (push.enviados > 0) canales.push('push:' + push.enviados);
    if (prioridad === 'critica' && u.celular) {
      const wa = enviarWhatsApp_(u.celular, tipo, titulo, cuerpo);
      if (wa.ok) canales.push('whatsapp'); else canales.push('whatsapp_fallo');
    }
    filas.push({
      id, fecha, legajo: u.legajo, modulo, tipo, titulo, cuerpo, url_destino: p.url_destino || '',
      prioridad, canales_enviados: canales.join(','), leido: 'no', fecha_leido: '', comunicado_id: p.comunicado_id || ''
    });
    resultados.push({ legajo: u.legajo, id, canales });
  });
  agregarVarias_('AVISOS', filas);
  return { ok: true, avisos: resultados };
}

function avisarAdmin_(titulo, cuerpo) {
  try {
    const admins = legajosAdmin_();
    if (!admins.length) return;
    notificarInterno_({ destinatarios: admins, modulo: 'ADMIN', tipo: 'seguridad', titulo, cuerpo, url_destino: '#admin', prioridad: 'normal' });
  } catch (e) { console.warn('avisarAdmin_ falló: ' + e); }
}

// ───────────────────────── Bandeja ─────────────────────────

function bandeja_(ctx, payload) { return bandejaDe_(ctx.usuario.legajo, payload); }

function bandejaDe_(legajoRaw, payload) {
  const legajo = String(legajoRaw);
  const limite = Number((payload || {}).limite || 100);
  const avisos = leer_('AVISOS')
    .filter(a => String(a.legajo) === legajo)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, limite)
    .map(a => ({
      id: a.id, fecha: a.fecha, modulo: a.modulo, tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo,
      url_destino: a.url_destino, prioridad: a.prioridad, leido: si_(a.leido)
    }));
  const sinLeer = {};
  leer_('AVISOS').forEach(a => { if (String(a.legajo) === legajo && !si_(a.leido)) sinLeer[a.modulo] = (sinLeer[a.modulo] || 0) + 1; });
  return { ok: true, avisos, sin_leer: sinLeer, total_sin_leer: Object.keys(sinLeer).reduce((s, k) => s + sinLeer[k], 0) };
}

function marcarLeido_(ctx, payload) { return marcarLeidoDe_(ctx.usuario.legajo, payload); }

function marcarLeidoDe_(legajoRaw, payload) {
  const legajo = String(legajoRaw);
  const ids = payload.todos ? null : (payload.ids || [payload.id]).map(String);
  const ahora = ahora_();
  const sh = hoja_('AVISOS');
  const enc = encabezados_('AVISOS');
  const cLeido = enc.indexOf('leido') + 1, cFecha = enc.indexOf('fecha_leido') + 1;
  let n = 0;
  leer_('AVISOS').forEach(a => {
    if (String(a.legajo) !== legajo || si_(a.leido)) return;
    if (ids && ids.indexOf(String(a.id)) < 0) return;
    sh.getRange(a._fila, cLeido).setValue('sí');
    sh.getRange(a._fila, cFecha).setValue(ahora);
    n++;
  });
  invalidar_('AVISOS');
  return { ok: true, marcados: n };
}

// ───────────────────────── Lectores sin cuenta (link personal) ─────────────────────────

function lectorPorToken_(token) {
  if (!token || String(token).length < 20) return null;
  const u = leer_('USUARIOS').find(x => x.token_lector && x.token_lector === token);
  return (u && si_(u.activo)) ? u : null;
}

function lectorBandeja_(payload) {
  const u = lectorPorToken_(payload.token_lector);
  if (!u) return { ok: false, error: 'Este link ya no es válido. Pedí uno nuevo a Marcos.', revocado: true };
  const r = bandejaDe_(u.legajo, payload);
  actualizar_('USUARIOS', u._fila, { ultimo_ingreso: ahora_() });
  return Object.assign(r, { nombre_visible: u.nombre_visible, legajo: u.legajo });
}

function lectorMarcarLeido_(payload) {
  const u = lectorPorToken_(payload.token_lector);
  if (!u) return { ok: false, error: 'Link inválido', revocado: true };
  return marcarLeidoDe_(u.legajo, payload);
}

function lectorSuscribirPush_(payload) {
  const u = lectorPorToken_(payload.token_lector);
  if (!u) return { ok: false, error: 'Link inválido', revocado: true };
  return suscribirPushDe_(u.legajo, '', payload);
}

// ───────────────────────── Web Push (relay) ─────────────────────────

function suscribirPush_(ctx, payload) { return suscribirPushDe_(ctx.usuario.legajo, ctx.sesion.dispositivo, payload); }

function suscribirPushDe_(legajo, dispositivoSesion, payload) {
  const sub = payload.suscripcion || {};
  if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return { ok: false, error: 'Suscripción incompleta' };
  const existente = leer_('SUSCRIPCIONES').find(s => s.endpoint === sub.endpoint);
  const datos = {
    legajo, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
    dispositivo: String(payload.dispositivo || dispositivoSesion || '').slice(0, 80), fallos: 0
  };
  if (existente) actualizar_('SUSCRIPCIONES', existente._fila, datos);
  else agregar_('SUSCRIPCIONES', Object.assign(datos, { creada: ahora_(), ultimo_envio_ok: '' }));
  return { ok: true };
}

function desuscribirPush_(ctx, payload) {
  const s = leer_('SUSCRIPCIONES').find(x => x.endpoint === payload.endpoint && String(x.legajo) === String(ctx.usuario.legajo));
  if (s) borrarFila_('SUSCRIPCIONES', s._fila);
  return { ok: true };
}

function vapidPublica_() { return prop_('VAPID_PUBLIC_KEY', false); }

/** Envía a todas las suscripciones de un legajo. Devuelve {enviados, fallidos}. */
function enviarPush_(legajo, mensaje) {
  const url = prop_('PUSH_RELAY_URL', false);
  const secreto = prop_('PUSH_RELAY_SECRET', false);
  const subs = leer_('SUSCRIPCIONES').filter(s => String(s.legajo) === String(legajo));
  if (!url || !secreto || !subs.length) return { enviados: 0, fallidos: 0 };

  let enviados = 0, fallidos = 0;
  const peticiones = subs.map(s => ({
    url, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-relay-secret': secreto },
    payload: JSON.stringify({
      suscripcion: { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      mensaje
    })
  }));
  let respuestas;
  try { respuestas = UrlFetchApp.fetchAll(peticiones); }
  catch (e) { console.warn('Relay push inaccesible: ' + e); return { enviados: 0, fallidos: subs.length }; }

  respuestas.forEach((r, i) => {
    const s = subs[i];
    const code = r.getResponseCode();
    let body = {};
    try { body = JSON.parse(r.getContentText()); } catch (e) { }
    if (code === 200 && body.ok) {
      enviados++;
      actualizar_('SUSCRIPCIONES', s._fila, { ultimo_envio_ok: ahora_(), fallos: 0 });
    } else {
      fallidos++;
      const caida = body.status === 404 || body.status === 410;
      const fallos = Number(s.fallos || 0) + 1;
      if (caida || fallos >= 3) borrarFila_('SUSCRIPCIONES', s._fila);
      else actualizar_('SUSCRIPCIONES', s._fila, { fallos });
    }
  });
  // Las filas pueden haberse movido por borrados: invalidar memo.
  invalidar_('SUSCRIPCIONES');
  return { enviados, fallidos };
}

// ───────────────────────── WhatsApp Cloud API ─────────────────────────

const WA_PLANTILLAS = {
  stock_critico: 'ingeco_stock_critico',
  vencimiento_doc: 'ingeco_vencimiento_doc',
  pedido_pendiente: 'ingeco_pedido_pendiente',
  aviso_general: 'ingeco_aviso_general',
  seguridad: 'ingeco_aviso_general'
};

function celularWA_(cel) {
  let d = String(cel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('549')) return d;
  if (d.startsWith('54')) return '549' + d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('15')) d = d.slice(2);
  return '549' + d;
}

function enviarWhatsApp_(celular, tipo, titulo, cuerpo) {
  const token = prop_('WA_TOKEN', false);
  const phoneId = prop_('WA_PHONE_ID', false);
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp no configurado' };
  const plantilla = WA_PLANTILLAS[tipo] || WA_PLANTILLAS.aviso_general;
  const body = {
    messaging_product: 'whatsapp',
    to: celularWA_(celular),
    type: 'template',
    template: {
      name: plantilla, language: { code: 'es_AR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: (titulo + '. ' + cuerpo).slice(0, 1000) }] }]
    }
  };
  try {
    const r = UrlFetchApp.fetch('https://graph.facebook.com/v20.0/' + phoneId + '/messages', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(body)
    });
    const ok = r.getResponseCode() >= 200 && r.getResponseCode() < 300;
    if (!ok) console.warn('WhatsApp falló: ' + r.getContentText());
    return { ok };
  } catch (e) { return { ok: false, error: String(e) }; }
}

// ───────────────────────── Resumen diario (trigger 7:30) ─────────────────────────

function resumenDiario() {
  const porLegajo = {};
  leer_('AVISOS').forEach(a => {
    if (si_(a.leido) || a.tipo === 'resumen') return;
    const l = String(a.legajo);
    porLegajo[l] = porLegajo[l] || { n: 0, criticos: 0, modulos: {} };
    porLegajo[l].n++;
    if (a.prioridad === 'critica') porLegajo[l].criticos++;
    porLegajo[l].modulos[a.modulo] = (porLegajo[l].modulos[a.modulo] || 0) + 1;
  });
  Object.keys(porLegajo).forEach(l => {
    const r = porLegajo[l];
    const detalle = Object.keys(r.modulos).map(m => m + ': ' + r.modulos[m]).join(' · ');
    const titulo = 'Tenés ' + r.n + ' aviso' + (r.n > 1 ? 's' : '') + ' sin leer' + (r.criticos ? ' (' + r.criticos + ' crítico' + (r.criticos > 1 ? 's' : '') + ')' : '');
    // Solo push, no otra fila en la bandeja (para no fragmentar).
    enviarPush_(l, { id: 'resumen-' + Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyyMMdd'), titulo, cuerpo: detalle, url: '#bandeja', modulo: 'APP', prioridad: r.criticos ? 'critica' : 'normal' });
  });
}
