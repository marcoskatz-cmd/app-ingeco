/**
 * permisos.js — lectura de PERMISOS y MODULOS.
 * El shell solo mira si la fila existe; el rol lo lee cada módulo si le interesa.
 */

function modulosActivos_() {
  return leer_('MODULOS')
    .filter(m => si_(m.activo) && m.codigo)
    .map(m => ({
      codigo: String(m.codigo).toUpperCase(),
      nombre: m.nombre,
      descripcion_corta: m.descripcion_corta,
      url: m.url,
      tipo: (m.tipo || 'iframe').toLowerCase(),
      icono: m.icono || '📋',
      orden: Number(m.orden || 99),
      responsable_legajo: m.responsable_legajo,
      responsable_celular: String(m.responsable_celular || '')
    }))
    .sort((a, b) => a.orden - b.orden);
}

function moduloPorCodigo_(codigo) {
  return modulosActivos_().find(m => m.codigo === String(codigo).toUpperCase()) || null;
}

function permisosDe_(legajo) {
  return leer_('PERMISOS').filter(p => String(p.legajo) === String(legajo));
}

function tienePermiso_(legajo, modulo) {
  const cod = String(modulo).toUpperCase();
  return permisosDe_(legajo).some(p => String(p.modulo).toUpperCase() === cod);
}

function rolEn_(legajo, modulo) {
  const cod = String(modulo).toUpperCase();
  const p = permisosDe_(legajo).find(x => String(x.modulo).toUpperCase() === cod);
  return p ? (p.rol || 'USUARIO') : null;
}

/** Módulos permitidos para una persona, ordenados, con rol. Excluye ADMIN de las tarjetas si no lo tiene. */
function modulosDe_(legajo) {
  const perms = permisosDe_(legajo);
  const codigos = {};
  perms.forEach(p => { codigos[String(p.modulo).toUpperCase()] = p.rol || 'USUARIO'; });
  return modulosActivos_()
    .filter(m => codigos[m.codigo])
    .map(m => Object.assign({}, m, { rol: codigos[m.codigo] }));
}

/** Legajos con un rol dado en un módulo ("todos los AUTORIZANTE de COMPRAS"). */
function legajosConRol_(modulo, rol) {
  const cod = String(modulo).toUpperCase();
  return leer_('PERMISOS')
    .filter(p => String(p.modulo).toUpperCase() === cod && (!rol || String(p.rol).toUpperCase() === String(rol).toUpperCase()))
    .map(p => String(p.legajo));
}

function legajosDeSector_(sector) {
  const s = normalizar_(sector);
  return leer_('USUARIOS').filter(u => si_(u.activo) && normalizar_(u.sector) === s).map(u => String(u.legajo));
}

function legajosAdmin_() { return legajosConRol_('ADMIN', null); }
