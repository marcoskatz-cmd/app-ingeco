/**
 * admin.js — alta de usuarios, permisos, importación masiva, instructivos, diagnóstico.
 * Todas las acciones exigen permiso ADMIN (lo chequea el enrutador).
 */

function requiereAdmin_(ctx) {
  if (!tienePermiso_(ctx.usuario.legajo, 'ADMIN')) throw new Error('Solo administradores');
}

function siguienteLegajo_() {
  const nums = leer_('USUARIOS').map(u => Number(u.legajo)).filter(n => !isNaN(n));
  return nums.length ? Math.max.apply(null, nums) + 1 : 1000;
}

function mensajeAcceso_(nombre, pin) {
  const url = prop_('SHELL_URL', false) || '(URL de la app)';
  return 'Hola ' + nombre.split(' ')[0] + '! Te doy acceso a la app INGECO.\n\n' +
    '1) Abrí este link en tu celular: ' + url + '\n' +
    '2) Tocá el menú del navegador y elegí "Agregar a la pantalla de inicio" (en iPhone: Compartir → Agregar a inicio).\n' +
    '3) Entrá con tu nombre y este PIN provisorio: *' + pin + '*\n' +
    '4) La app te va a pedir que elijas tu PIN definitivo.\n\n' +
    'Cualquier duda, el botón de ayuda dentro de la app te responde.';
}

function listarUsuarios_(ctx) {
  requiereAdmin_(ctx);
  const perms = leer_('PERMISOS');
  const ses = leer_('SESIONES');
  const usuarios = leer_('USUARIOS').map(u => ({
    legajo: u.legajo, nombre_visible: u.nombre_visible, alias: u.alias_norm, sector: u.sector, celular: u.celular,
    activo: si_(u.activo), pin_provisorio: si_(u.pin_provisorio), bloqueado_min: bloqueado_(u),
    fecha_alta: u.fecha_alta,
    modulos: perms.filter(p => String(p.legajo) === String(u.legajo)).map(p => ({ modulo: String(p.modulo).toUpperCase(), rol: p.rol || 'USUARIO' })),
    sesiones: ses.filter(s => String(s.legajo) === String(u.legajo)).length
  })).sort((a, b) => String(a.nombre_visible).localeCompare(String(b.nombre_visible)));
  const sectores = {};
  usuarios.forEach(u => { if (u.sector) sectores[u.sector] = true; });
  return { ok: true, usuarios, modulos: modulosActivos_(), sectores: Object.keys(sectores).sort(), diagnostico: diagnostico_() };
}

/** payload: {nombre, apellido, sector, celular, modulos:[{modulo, rol}] | ["COD",...]} */
function altaUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const nombre = String(payload.nombre || '').trim();
  const apellido = String(payload.apellido || '').trim();
  if (!nombre || !apellido) return { ok: false, error: 'Falta nombre o apellido' };
  const visible = nombre + ' ' + apellido;
  const norm = normalizar_(visible);
  if (leer_('USUARIOS').some(u => normalizar_(u.nombre_norm) === norm && si_(u.activo))) {
    return { ok: false, error: 'Ya existe una persona activa con ese nombre. Agregale un alias o revisá la ficha.' };
  }
  const legajo = payload.legajo ? String(payload.legajo).trim() : String(siguienteLegajo_());
  if (leer_('USUARIOS').some(u => String(u.legajo) === legajo)) return { ok: false, error: 'El legajo ' + legajo + ' ya existe' };
  const pin = pinAleatorio_();
  agregar_('USUARIOS', {
    legajo, nombre_visible: visible, nombre_norm: norm, alias_norm: normalizar_(apellido + ' ' + nombre),
    sector: String(payload.sector || '').trim(), celular: String(payload.celular || '').replace(/\D/g, ''),
    pin_hash: hashPin_(pin, legajo), pin_provisorio: 'sí', activo: 'sí', intentos_fallidos: 0, bloqueado_hasta: '',
    creado_por: ctx.usuario.legajo, fecha_alta: ahora_()
  });
  guardarPermisos_(ctx, legajo, payload.modulos || []);
  const cel = celularWA_(payload.celular);
  return {
    ok: true, legajo, nombre_visible: visible, pin,
    wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeAcceso_(visible, pin)) : ''
  };
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

/** payload: {legajo, sector?, celular?, alias?, nombre_visible?} */
function editarUsuario_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  const cambios = {};
  if (payload.sector !== undefined) cambios.sector = String(payload.sector).trim();
  if (payload.celular !== undefined) cambios.celular = String(payload.celular).replace(/\D/g, '');
  if (payload.alias !== undefined) cambios.alias_norm = String(payload.alias).split(/[|,\n]/).map(normalizar_).filter(Boolean).join('|');
  if (payload.nombre_visible) { cambios.nombre_visible = String(payload.nombre_visible).trim(); cambios.nombre_norm = normalizar_(payload.nombre_visible); }
  actualizar_('USUARIOS', u._fila, cambios);
  return { ok: true };
}

function resetPin_(ctx, payload) {
  requiereAdmin_(ctx);
  const u = usuarioPorLegajo_(payload.legajo);
  if (!u) return { ok: false, error: 'Legajo no encontrado' };
  const pin = pinAleatorio_();
  actualizar_('USUARIOS', u._fila, { pin_hash: hashPin_(pin, u.legajo), pin_provisorio: 'sí', intentos_fallidos: 0, bloqueado_hasta: '' });
  cerrarSesionesDe_(u.legajo);
  const cel = celularWA_(u.celular);
  return { ok: true, pin, wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeAcceso_(u.nombre_visible, pin)) : '' };
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
      legajo: u.legajo, nombre_visible: u.nombre_visible, alias: u.alias_norm, sector: u.sector, celular: u.celular,
      activo: si_(u.activo), pin_provisorio: si_(u.pin_provisorio), bloqueado_min: bloqueado_(u), fecha_alta: u.fecha_alta
    },
    modulos: modulosDe_(u.legajo),
    sesiones: sesionesDe_(u.legajo),
    suscripciones: leer_('SUSCRIPCIONES').filter(s => String(s.legajo) === String(u.legajo)).length
  };
}

/**
 * Importación masiva. payload: {texto} con filas "nombre<TAB|;>apellido<TAB|;>sector<TAB|;>celular"
 * (pegado desde una planilla). Crea sin permisos y con PIN provisorio; devuelve lista con PIN y link.
 */
function importarUsuarios_(ctx, payload) {
  requiereAdmin_(ctx);
  const lineas = String(payload.texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const creados = [], errores = [];
  const existentes = {};
  leer_('USUARIOS').forEach(u => { existentes[normalizar_(u.nombre_norm)] = true; });
  let legajo = siguienteLegajo_();
  const filas = [];
  lineas.forEach((l, i) => {
    const partes = l.split(/\t|;/).map(s => s.trim());
    if (partes.length < 2) { errores.push({ linea: i + 1, error: 'Faltan columnas (nombre, apellido, sector, celular)' }); return; }
    const visible = partes[0] + ' ' + partes[1];
    const norm = normalizar_(visible);
    if (existentes[norm]) { errores.push({ linea: i + 1, error: visible + ' ya existe' }); return; }
    existentes[norm] = true;
    const pin = pinAleatorio_();
    const lg = String(legajo++);
    filas.push({
      legajo: lg, nombre_visible: visible, nombre_norm: norm, alias_norm: normalizar_(partes[1] + ' ' + partes[0]),
      sector: partes[2] || '', celular: (partes[3] || '').replace(/\D/g, ''),
      pin_hash: hashPin_(pin, lg), pin_provisorio: 'sí', activo: 'sí', intentos_fallidos: 0, bloqueado_hasta: '',
      creado_por: ctx.usuario.legajo, fecha_alta: ahora_()
    });
    const cel = celularWA_(partes[3]);
    creados.push({ legajo: lg, nombre_visible: visible, pin, wa_link: cel ? 'https://wa.me/' + cel + '?text=' + encodeURIComponent(mensajeAcceso_(visible, pin)) : '' });
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
