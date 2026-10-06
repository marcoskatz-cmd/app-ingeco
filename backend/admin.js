/**
 * admin.js — alta de usuarios, permisos, importación masiva, instructivos, diagnóstico.
 * Todas las acciones exigen permiso ADMIN (lo chequea el enrutador).
 */

function requiereAdmin_(ctx) {
  if (!tienePermiso_(ctx.usuario.legajo, 'ADMIN')) throw new Error('Solo administradores');
}

function mensajeAcceso_(nombre, email) {
  const url = prop_('SHELL_URL', false) || '(URL de la app)';
  return 'Hola ' + nombre.split(' ')[0] + '! Te doy acceso a la app INGECO.\n\n' +
    '1) Abrí este link en tu celular: ' + url + '\n' +
    '2) Tocá el menú del navegador y elegí "Agregar a la pantalla de inicio" (en iPhone: Compartir → Agregar a inicio).\n' +
    '3) Tocá "Iniciar sesión con Google" y elegí tu cuenta ' + email + '.\n\n' +
    'Cualquier duda, el botón de ayuda dentro de la app te responde.';
}

function listarUsuarios_(ctx) {
  requiereAdmin_(ctx);
  const perms = leer_('PERMISOS');
  const ses = leer_('SESIONES');
  const usuarios = leer_('USUARIOS').map(u => ({
    legajo: u.legajo, nombre_visible: u.nombre_visible, email: u.email, sector: u.sector, celular: u.celular,
    activo: si_(u.activo), fecha_alta: u.fecha_alta, ultimo_ingreso: u.ultimo_ingreso,
    tipo: u.tipo === 'lector' ? 'lector' : 'cuenta', areas: areasDe_(u), obra: String(u.obra || '').toUpperCase(), tiene_link: !!u.token_lector,
    modulos: perms.filter(p => String(p.legajo) === String(u.legajo)).map(p => ({ modulo: String(p.modulo).toUpperCase(), rol: p.rol || 'USUARIO' })),
    sesiones: ses.filter(s => String(s.legajo) === String(u.legajo)).length
  })).sort((a, b) => String(a.nombre_visible).localeCompare(String(b.nombre_visible)));
  const sectores = {};
  usuarios.forEach(u => { if (u.sector) sectores[u.sector] = true; });
  return { ok: true, usuarios, modulos: modulosActivos_(), sectores: Object.keys(sectores).sort(), areas: areasActivas_(), obras: obrasActivas_(), diagnostico: diagnostico_() };
}

function emailValido_(email) {
  const e = emailNorm_(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return 'Email inválido';
  if (dominiosPermitidos_().indexOf(e.split('@')[1]) < 0) return 'Tiene que ser una cuenta de INGECO (@' + dominiosPermitidos_()[0] + ')';
  return '';
}

/** payload: {nombre, email, sector, celular, modulos:[{modulo, rol}] | ["COD",...]} */
function altaUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const visible = String(payload.nombre || '').trim();
  const email = emailNorm_(payload.email);
  if (!visible) return { ok: false, error: 'Falta el nombre' };
  const err = emailValido_(email); if (err) return { ok: false, error: err };
  if (usuarioPorEmail_(email)) return { ok: false, error: 'Ya existe una persona con ese email. Buscala en la grilla.' };
  const legajo = payload.legajo ? String(payload.legajo).trim() : String(siguienteLegajo_());
  if (leer_('USUARIOS').some(u => String(u.legajo) === legajo)) return { ok: false, error: 'El legajo ' + legajo + ' ya existe' };
  agregar_('USUARIOS', {
    legajo, nombre_visible: visible, email, sector: String(payload.sector || '').trim(), celular: String(payload.celular || '').replace(/\D/g, ''),
    activo: 'sí', creado_por: ctx.usuario.legajo, fecha_alta: ahora_(), ultimo_ingreso: '',
    tipo: 'cuenta', areas: areasTexto_(payload.areas), obra: String(payload.obra || '').toUpperCase(), token_lector: ''
  });
  guardarPermisos_(ctx, legajo, payload.modulos || []);
  const cel = celularWA_(payload.celular);
  return { ok: true, legajo, nombre_visible: visible, email, wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeAcceso_(visible, email)) : '' };
}

/** Reemplaza el set de permisos de un legajo por el indicado. */
function guardarPermisos_(ctx, legajo, modulos) {
  const deseados = {};
  (modulos || []).forEach(m => {
    const cod = String(typeof m === 'string' ? m : m.modulo).toUpperCase();
    if (cod) deseados[cod] = (typeof m === 'object' && m.rol) ? String(m.rol).toUpperCase() : 'USUARIO';
  });
  const actuales = leer_('PERMISOS').filter(p => String(p.legajo) === String(legajo));
  // Borrar los que ya no están (de abajo hacia arriba) o cuyo rol cambió.
  actuales.slice().sort((a, b) => b._fila - a._fila).forEach(p => {
    const cod = String(p.modulo).toUpperCase();
    if (!deseados[cod]) { hoja_('PERMISOS').deleteRow(p._fila); }
    else if ((p.rol || 'USUARIO') !== deseados[cod]) { hoja_('PERMISOS').getRange(p._fila, encabezados_('PERMISOS').indexOf('rol') + 1).setValue(deseados[cod]); }
  });
  invalidar_('PERMISOS');
  const existentes = {};
  leer_('PERMISOS').filter(p => String(p.legajo) === String(legajo)).forEach(p => { existentes[String(p.modulo).toUpperCase()] = true; });
  const nuevos = Object.keys(deseados).filter(c => !existentes[c]).map(c => ({
    legajo, modulo: c, rol: deseados[c], otorgado_por: ctx.usuario.legajo, fecha: ahora_()
  }));
  agregarVarias_('PERMISOS', nuevos);
}

/** payload: {legajo, modulo, rol?, activo:true|false} — una casilla de la grilla. */
function setPermiso_(ctx, payload) {
  requiereAdmin_(ctx);
  const legajo = String(payload.legajo), cod = String(payload.modulo).toUpperCase();
  if (cod === 'ADMIN' && legajo === String(ctx.usuario.legajo) && !payload.activo) return { ok: false, error: 'No podés sacarte ADMIN a vos mismo' };
  const actuales = leer_('PERMISOS').filter(p => String(p.legajo) === legajo && String(p.modulo).toUpperCase() !== cod)
    .map(p => ({ modulo: String(p.modulo).toUpperCase(), rol: p.rol || 'USUARIO' }));
  if (payload.activo) actuales.push({ modulo: cod, rol: String(payload.rol || 'USUARIO').toUpperCase() });
  guardarPermisos_(ctx, legajo, actuales);
  return { ok: true };
}

function usuarioPorLegajo_(legajo) {
  return leer_('USUARIOS').find(u => String(u.legajo) === String(legajo)) || null;
}

/** payload: {legajo, sector?, celular?, email?, nombre_visible?} */
function editarUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  const cambios = {};
  if (payload.sector !== undefined) cambios.sector = String(payload.sector).trim();
  if (payload.celular !== undefined) cambios.celular = String(payload.celular).replace(/\D/g, '');
  if (payload.email !== undefined) {
    const err = emailValido_(payload.email); if (err) return { ok: false, error: err };
    const otro = usuarioPorEmail_(payload.email); if (otro && String(otro.legajo) !== String(u.legajo)) return { ok: false, error: 'Ese email ya lo tiene ' + otro.nombre_visible };
    cambios.email = emailNorm_(payload.email);
  }
  if (payload.nombre_visible) cambios.nombre_visible = String(payload.nombre_visible).trim();
  if (payload.areas !== undefined) cambios.areas = areasTexto_(payload.areas);
  if (payload.obra !== undefined) cambios.obra = String(payload.obra || '').toUpperCase();
  actualizar_('USUARIOS', u._fila, cambios);
  return { ok: true };
}

function cerrarSesionesUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  cerrarSesionesDe_(payload.legajo);
  return { ok: true };
}

function bajaUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  if (String(u.legajo) === String(ctx.usuario.legajo)) return { ok: false, error: 'No podés darte de baja a vos mismo' };
  actualizar_('USUARIOS', u._fila, { activo: payload.reactivar ? 'sí' : 'no' });
  if (!payload.reactivar) cerrarSesionesDe_(u.legajo);
  return { ok: true };
}

function fichaUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  return {
    ok: true,
    usuario: {
      legajo: u.legajo, nombre_visible: u.nombre_visible, email: u.email, sector: u.sector, celular: u.celular,
      activo: si_(u.activo), fecha_alta: u.fecha_alta, ultimo_ingreso: u.ultimo_ingreso,
      tipo: u.tipo === 'lector' ? 'lector' : 'cuenta', areas: areasDe_(u), obra: String(u.obra || '').toUpperCase(),
      rol_avisos: rolEn_(u.legajo, 'AVISOS') || '',
      link_lector: u.token_lector ? linkLector_(u.token_lector) : '',
      wa_link: u.celular ? 'https://wa.me/' + celularWA_(u.celular) + '?text=' + encodeURIComponent(u.tipo === 'lector' ? mensajeLector_(u.nombre_visible, u.token_lector) : mensajeAcceso_(u.nombre_visible, u.email)) : ''
    },
    modulos: modulosDe_(u.legajo),
    sesiones: sesionesDe_(u.legajo),
    suscripciones: leer_('SUSCRIPCIONES').filter(s => String(s.legajo) === String(u.legajo)).length
  };
}

/**
 * Importación masiva. payload: {texto} con filas "nombre<TAB|;>email<TAB|;>sector<TAB|;>celular"
 * (pegado desde una planilla). Crea sin permisos; devuelve lista con link de WhatsApp.
 */
function importarUsuarios_(ctx, payload) {
  requiereAdmin_(ctx);
  const lineas = String(payload.texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const creados = [], errores = [];
  const existentes = {};
  leer_('USUARIOS').forEach(u => { existentes[emailNorm_(u.email)] = true; });
  let legajo = siguienteLegajo_();
  const filas = [];
  lineas.forEach((l, i) => {
    const partes = l.split(/\t|;/).map(s => s.trim());
    if (partes.length < 2) { errores.push({ linea: i + 1, error: 'Faltan columnas (nombre, email, sector, celular)' }); return; }
    const visible = partes[0], email = emailNorm_(partes[1]);
    const err = emailValido_(email); if (err) { errores.push({ linea: i + 1, error: visible + ': ' + err }); return; }
    if (existentes[email]) { errores.push({ linea: i + 1, error: email + ' ya existe' }); return; }
    existentes[email] = true;
    const lg = String(legajo++);
    filas.push({ legajo: lg, nombre_visible: visible, email, sector: partes[2] || '', celular: (partes[3] || '').replace(/\D/g, ''), activo: 'sí', creado_por: ctx.usuario.legajo, fecha_alta: ahora_(), ultimo_ingreso: '' });
    const cel = celularWA_(partes[3]);
    creados.push({ legajo: lg, nombre_visible: visible, email, wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeAcceso_(visible, email)) : '' });
  });
  agregarVarias_('USUARIOS', filas);
  return { ok: true, creados, errores };
}

// ───────────── Módulos e instructivos ─────────────

function listarModulosAdmin_(ctx) {
  requiereAdmin_(ctx);
  return { ok: true, modulos: leer_('MODULOS').map(m => Object.assign({}, m)) };
}

/** payload: {codigo, nombre, descripcion_corta, url, tipo, icono, orden, activo, responsable_legajo, responsable_celular} */
function guardarModulo_(ctx, payload) {
  requiereAdmin_(ctx);
  const cod = String(payload.codigo || '').toUpperCase().trim();
  if (!/^[A-Z0-9_]{2,20}$/.test(cod)) return { ok: false, error: 'Código inválido (letras, números y guión bajo)' };
  const datos = {
    codigo: cod, nombre: payload.nombre, descripcion_corta: payload.descripcion_corta, url: payload.url,
    tipo: payload.tipo === 'link' ? 'link' : 'iframe', icono: payload.icono || '📋', orden: Number(payload.orden || 99),
    activo: payload.activo === false ? 'no' : 'sí', responsable_legajo: payload.responsable_legajo || '', responsable_celular: payload.responsable_celular || ''
  };
  const ex = leer_('MODULOS').find(m => String(m.codigo).toUpperCase() === cod);
  if (ex) actualizar_('MODULOS', ex._fila, datos); else agregar_('MODULOS', datos);
  return { ok: true };
}

function listarInstructivos_(ctx, payload) {
  requiereAdmin_(ctx);
  const mod = payload.modulo ? String(payload.modulo).toUpperCase() : null;
  return { ok: true, instructivos: leer_('INSTRUCTIVOS').filter(i => !mod || String(i.modulo).toUpperCase() === mod).map(i => ({ fila: i._fila, modulo: i.modulo, seccion: i.seccion, texto: i.texto, actualizado: i.actualizado })) };
}

/** payload: {fila?, modulo, seccion, texto, borrar?} */
function guardarInstructivo_(ctx, payload) {
  requiereAdmin_(ctx);
  if (payload.fila && payload.borrar) { borrarFila_('INSTRUCTIVOS', Number(payload.fila)); return { ok: true }; }
  const datos = { modulo: String(payload.modulo || '').toUpperCase(), seccion: String(payload.seccion || ''), texto: String(payload.texto || ''), actualizado: ahora_() };
  if (!datos.modulo || !datos.texto) return { ok: false, error: 'Falta módulo o texto' };
  if (payload.fila) actualizar_('INSTRUCTIVOS', Number(payload.fila), datos); else agregar_('INSTRUCTIVOS', datos);
  return { ok: true };
}

/** Preguntas más repetidas y peor valoradas del bot (mejora continua). */
function estadisticasBot_(ctx, payload) {
  requiereAdmin_(ctx);
  const dias = Number(payload.dias || 30);
  const desde = Date.now() - dias * 86400000;
  const cs = leer_('CONSULTAS_BOT').filter(c => c.fecha && new Date(c.fecha).getTime() >= desde);
  const porModulo = {}, tokens = cs.reduce((s, c) => s + Number(c.tokens || 0), 0);
  cs.forEach(c => { const m = c.modulo_contexto || '(inicio)'; porModulo[m] = (porModulo[m] || 0) + 1; });
  return {
    ok: true, total: cs.length, tokens, por_modulo: porModulo,
    mal_valoradas: cs.filter(c => String(c.util).toLowerCase() === 'no').slice(-30).map(c => ({ fecha: c.fecha, legajo: c.legajo, modulo: c.modulo_contexto, pregunta: c.pregunta, respuesta: c.respuesta })),
    ultimas: cs.slice(-50).reverse().map(c => ({ fecha: c.fecha, legajo: c.legajo, modulo: c.modulo_contexto, pregunta: c.pregunta, util: c.util }))
  };
}

function enviarAvisoManual_(ctx, payload) {
  requiereAdmin_(ctx);
  return notificarInterno_({
    destinatarios: payload.destinatarios, modulo: payload.modulo || 'APP', tipo: payload.tipo || 'aviso_general',
    titulo: payload.titulo, cuerpo: payload.cuerpo, url_destino: payload.url_destino || '', prioridad: payload.prioridad || 'normal'
  });
}

// ───────────── Áreas, obras, lectores ─────────────

function areasTexto_(areas) {
  const validas = areasActivas_().map(a => a.codigo);
  return (areas || []).map(a => String(a).toUpperCase().trim()).filter(a => validas.indexOf(a) >= 0).join('|');
}

/** payload: {codigo, nombre, orden, activo} */
function guardarArea_(ctx, payload) {
  requiereAdmin_(ctx);
  const cod = String(payload.codigo || payload.nombre || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
  if (!cod) return { ok: false, error: 'Falta el nombre del área' };
  const datos = { codigo: cod, nombre: String(payload.nombre || cod).trim(), orden: Number(payload.orden || 99), activo: payload.activo === false ? 'no' : 'sí' };
  const ex = leer_('AREAS').find(a => String(a.codigo).toUpperCase() === cod);
  if (ex) actualizar_('AREAS', ex._fila, datos); else agregar_('AREAS', datos);
  return { ok: true, codigo: cod };
}

/** payload: {codigo, nombre, activo} | {texto} (una obra por línea: "codigo;nombre" o solo nombre) */
function guardarObras_(ctx, payload) {
  requiereAdmin_(ctx);
  const lineas = payload.texto !== undefined ? String(payload.texto).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    : [String(payload.codigo || '') + ';' + String(payload.nombre || '')];
  const existentes = {};
  leer_('OBRAS').forEach(o => { existentes[String(o.codigo).toUpperCase()] = o; });
  const nuevas = [];
  let n = 0;
  lineas.forEach(l => {
    const partes = l.split(/\t|;/).map(x => x.trim());
    let cod = partes.length > 1 && partes[0] ? partes[0] : partes[partes.length - 1];
    const nombre = partes.length > 1 ? partes[1] : partes[0];
    cod = String(cod).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (!cod || !nombre) return;
    const datos = { codigo: cod, nombre, activo: payload.activo === false ? 'no' : 'sí' };
    if (existentes[cod]) actualizar_('OBRAS', existentes[cod]._fila, datos); else { nuevas.push(datos); existentes[cod] = datos; }
    n++;
  });
  agregarVarias_('OBRAS', nuevas);
  return { ok: true, procesadas: n, nuevas: nuevas.length };
}

function tokenLector_() { return generarToken_() + generarToken_().slice(0, 11); }

function linkLector_(token) { return (prop_('SHELL_URL', false) || '') + '#ver/' + token; }

function mensajeLector_(nombre, token) {
  return 'Hola ' + String(nombre).split(' ')[0] + '! Este es tu acceso a los avisos de INGECO.\n\n' +
    '1) Abrí este link en tu celular: ' + linkLector_(token) + '\n' +
    '2) Tocá el menú del navegador y elegí "Agregar a la pantalla de inicio" (en iPhone: Compartir → Agregar a inicio).\n' +
    '3) Cuando te pregunte, aceptá las notificaciones.\n\n' +
    'El link es personal: no lo compartas.';
}

/** Alta de lector sin cuenta. payload: {nombre, celular, areas, obra, sector} */
function altaLector_(ctx, payload) {
  requiereAdmin_(ctx);
  const visible = String(payload.nombre || '').trim();
  if (!visible) return { ok: false, error: 'Falta el nombre' };
  const legajo = payload.legajo ? String(payload.legajo).trim() : String(siguienteLegajo_());
  if (leer_('USUARIOS').some(u => String(u.legajo) === legajo)) return { ok: false, error: 'El legajo ' + legajo + ' ya existe' };
  const token = tokenLector_();
  agregar_('USUARIOS', {
    legajo, nombre_visible: visible, email: '', sector: String(payload.sector || '').trim(), celular: String(payload.celular || '').replace(/\D/g, ''),
    activo: 'sí', creado_por: ctx.usuario.legajo, fecha_alta: ahora_(), ultimo_ingreso: '',
    tipo: 'lector', areas: areasTexto_(payload.areas), obra: String(payload.obra || '').toUpperCase(), token_lector: token
  });
  const cel = celularWA_(payload.celular);
  return { ok: true, legajo, nombre_visible: visible, link: linkLector_(token), wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeLector_(visible, token)) : '' };
}

/** Genera un link nuevo (el anterior deja de servir). */
function regenerarLinkLector_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  const token = tokenLector_();
  const cambios = { token_lector: token };
  if (!u.email) cambios.tipo = 'lector';
  actualizar_('USUARIOS', u._fila, cambios);
  const cel = celularWA_(u.celular);
  return { ok: true, link: linkLector_(token), wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeLector_(u.nombre_visible, token)) : '' };
}

/** Revoca el link y borra las suscripciones push del lector. */
function revocarLinkLector_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  actualizar_('USUARIOS', u._fila, { token_lector: '' });
  leer_('SUSCRIPCIONES').filter(s => String(s.legajo) === String(u.legajo)).sort((a, b) => b._fila - a._fila).forEach(s => hoja_('SUSCRIPCIONES').deleteRow(s._fila));
  invalidar_('SUSCRIPCIONES');
  return { ok: true };
}

/** Exporta AVISOS + COMUNICADOS de un año a una planilla nueva en Drive (sin borrar). payload: {anio} */
function exportarAvisos_(ctx, payload) {
  requiereAdmin_(ctx);
  const anio = Number(payload.anio || new Date().getFullYear());
  const destino = SpreadsheetApp.create('APP_INGECO avisos ' + anio + ' (export ' + Utilities.formatDate(new Date(), 'America/Argentina/Tucuman', 'yyyy-MM-dd') + ')');
  ['AVISOS', 'COMUNICADOS'].forEach(h => {
    const filas = leer_(h).filter(r => r.fecha && new Date(r.fecha).getFullYear() === anio);
    const enc = encabezados_(h);
    const sh = destino.insertSheet(h);
    sh.appendRow(enc);
    if (filas.length) sh.getRange(2, 1, filas.length, enc.length).setValues(filas.map(r => enc.map(c => r[c] === undefined ? '' : r[c])));
  });
  const h1 = destino.getSheetByName('Hoja 1') || destino.getSheetByName('Sheet1');
  if (h1) destino.deleteSheet(h1);
  return { ok: true, url: destino.getUrl() };
}
