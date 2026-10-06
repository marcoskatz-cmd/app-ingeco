/**
 * Code.js — doGet / doPost, enrutador RPC.
 *
 * Contrato: POST body JSON {accion, token?, payload?}  →  JSON {ok, ...}
 * El shell manda Content-Type text/plain para evitar el preflight CORS.
 *
 * Acciones públicas (sin token):  login, validar_token, notificar (con clave_sistema), vapid, ping
 * Acciones de usuario (token):    perfil, cambiar_pin, cerrar_sesion, bandeja, marcar_leido, suscribir_push,
 *                                 desuscribir_push, ayuda, valorar_ayuda, saludo_ayuda
 * Acciones ADMIN (token+ADMIN):   admin_usuarios, admin_alta, admin_set_permiso, admin_editar, admin_reset_pin,
 *                                 admin_cerrar_sesiones, admin_baja, admin_ficha, admin_importar, admin_modulos,
 *                                 admin_guardar_modulo, admin_instructivos, admin_guardar_instructivo,
 *                                 admin_stats_bot, admin_aviso, admin_diagnostico
 */

const PUBLICAS = {
  ping: () => ({ ok: true, hora: new Date(), version: VERSION }),
  vapid: () => ({ ok: true, clave: vapidPublica_() }),
  login: p => login_(p),
  validar_token: p => validarToken_(p),
  notificar: p => notificar_(p)
};

const USUARIO = {
  perfil: ctx => Object.assign({ ok: true, pin_provisorio: si_(ctx.usuario.pin_provisorio) }, perfil_(ctx.usuario)),
  cambiar_pin: (ctx, p) => cambiarPin_(ctx, p),
  cerrar_sesion: ctx => cerrarSesion_(ctx),
  bandeja: (ctx, p) => bandeja_(ctx, p),
  marcar_leido: (ctx, p) => marcarLeido_(ctx, p),
  suscribir_push: (ctx, p) => suscribirPush_(ctx, p),
  desuscribir_push: (ctx, p) => desuscribirPush_(ctx, p),
  ayuda: (ctx, p) => ayuda_(ctx, p),
  valorar_ayuda: (ctx, p) => valorarAyuda_(ctx, p),
  saludo_ayuda: (ctx, p) => saludoAyuda_(ctx, p)
};

const ADMIN = {
  admin_usuarios: ctx => listarUsuarios_(ctx),
  admin_alta: (ctx, p) => altaUsuario_(ctx, p),
  admin_set_permiso: (ctx, p) => setPermiso_(ctx, p),
  admin_editar: (ctx, p) => editarUsuario_(ctx, p),
  admin_reset_pin: (ctx, p) => resetPin_(ctx, p),
  admin_cerrar_sesiones: (ctx, p) => cerrarSesionesUsuario_(ctx, p),
  admin_baja: (ctx, p) => bajaUsuario_(ctx, p),
  admin_ficha: (ctx, p) => fichaUsuario_(ctx, p),
  admin_importar: (ctx, p) => importarUsuarios_(ctx, p),
  admin_modulos: ctx => listarModulosAdmin_(ctx),
  admin_guardar_modulo: (ctx, p) => guardarModulo_(ctx, p),
  admin_instructivos: (ctx, p) => listarInstructivos_(ctx, p),
  admin_guardar_instructivo: (ctx, p) => guardarInstructivo_(ctx, p),
  admin_stats_bot: (ctx, p) => estadisticasBot_(ctx, p),
  admin_aviso: (ctx, p) => enviarAvisoManual_(ctx, p),
  admin_diagnostico: ctx => { requiereAdmin_(ctx); return Object.assign({ ok: true }, diagnostico_()); }
};

const VERSION = '1.0.0';

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const accion = e && e.parameter && e.parameter.accion;
  if (accion === 'ping') return json_(PUBLICAS.ping());
  if (accion === 'vapid') return json_(PUBLICAS.vapid());
  return json_({ ok: true, app: 'INGECO backend', version: VERSION, uso: 'POST JSON {accion, token, payload}' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Cuerpo inválido' }); }

  const accion = String(req.accion || '');
  const payload = req.payload || req;  // Acepta {accion, payload:{...}} o campos planos.

  try {
    if (PUBLICAS[accion]) return json_(PUBLICAS[accion](payload));

    const ctx = sesionDe_(req.token);
    if (!ctx) return json_({ ok: false, error: 'Tu sesión venció. Volvé a entrar con tu nombre y PIN.', relogin: true });

    // Con PIN provisorio solo se puede cambiar el PIN o salir.
    if (si_(ctx.usuario.pin_provisorio) && ['cambiar_pin', 'cerrar_sesion', 'perfil'].indexOf(accion) < 0) {
      return json_({ ok: false, error: 'Primero elegí tu PIN definitivo', pin_provisorio: true });
    }

    if (USUARIO[accion]) return json_(USUARIO[accion](ctx, payload));
    if (ADMIN[accion]) {
      if (!tienePermiso_(ctx.usuario.legajo, 'ADMIN')) return json_({ ok: false, error: 'Solo administradores' });
      return json_(ADMIN[accion](ctx, payload));
    }
    return json_({ ok: false, error: 'Acción desconocida: ' + accion });
  } catch (err) {
    console.error(accion + ': ' + err + '\n' + (err.stack || ''));
    return json_({ ok: false, error: 'Algo falló del lado del servidor. Si sigue pasando, avisale a Marcos.', detalle: String(err.message || err) });
  }
}

// ───────────────────────── Setup inicial (correr una vez desde el editor o con clasp run) ─────────────────────────

/**
 * 1) Crea la planilla APP_INGECO (o usa SPREADSHEET_ID si ya está), las 8 hojas y los módulos iniciales.
 * 2) Crea el primer ADMIN. Editá NOMBRE/APELLIDO/CELULAR antes de correrlo. Loguea el PIN provisorio.
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SPREADSHEET_ID')) {
    const ss = SpreadsheetApp.create('APP_INGECO');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    console.log('Planilla creada: ' + ss.getUrl());
  }
  Object.keys(HOJAS).forEach(h => hoja_(h));
  const hoja1 = ss_().getSheetByName('Hoja 1') || ss_().getSheetByName('Sheet1');
  if (hoja1 && ss_().getSheets().length > 1) ss_().deleteSheet(hoja1);

  if (!leer_('MODULOS').length) {
    agregarVarias_('MODULOS', [
      { codigo: 'INGECOV', nombre: 'Mantenimiento de flota', descripcion_corta: 'Services, repuestos, documentación de equipos', url: 'https://marcoskatz-cmd.github.io/ingecov/', tipo: 'iframe', icono: '🚜', orden: 1, activo: 'sí' },
      { codigo: 'COMPRAS', nombre: 'Pedidos de compra', descripcion_corta: 'Pedidos, órdenes de compra y autorizaciones', url: 'https://pedidos-ingeco.vercel.app/', tipo: 'link', icono: '🧾', orden: 2, activo: 'sí' },
      { codigo: 'COMBUSTIBLE', nombre: 'Combustible', descripcion_corta: 'Cargas de gasoil por equipo', url: '', tipo: 'iframe', icono: '⛽', orden: 3, activo: 'sí' },
      { codigo: 'TARJA', nombre: 'Tarja diaria', descripcion_corta: 'Horas y checklist de máquinas en obra', url: '', tipo: 'iframe', icono: '🕒', orden: 4, activo: 'sí' },
      { codigo: 'ROPA', nombre: 'Ropa de trabajo', descripcion_corta: 'Talles, compras y entregas de ropa', url: '', tipo: 'iframe', icono: '👷', orden: 5, activo: 'sí' },
      { codigo: 'ADMIN', nombre: 'Administración de la app', descripcion_corta: 'Usuarios, permisos y avisos', url: '#admin', tipo: 'interno', icono: '⚙️', orden: 99, activo: 'sí' }
    ]);
  }

  if (!leer_('INSTRUCTIVOS').length) seedInstructivos_();

  if (!leer_('USUARIOS').length) {
    // ⇩ EDITAR antes de correr ⇩
    const NOMBRE = 'Marcos', APELLIDO = 'Katz', CELULAR = '', SECTOR = 'Ingeniería';
    const legajo = '1';
    const pin = pinAleatorio_();
    const visible = NOMBRE + ' ' + APELLIDO;
    agregar_('USUARIOS', {
      legajo, nombre_visible: visible, nombre_norm: normalizar_(visible), alias_norm: normalizar_(NOMBRE) + '|' + normalizar_(APELLIDO + ' ' + NOMBRE),
      sector: SECTOR, celular: CELULAR, pin_hash: hashPin_(pin, legajo), pin_provisorio: 'sí', activo: 'sí',
      intentos_fallidos: 0, bloqueado_hasta: '', creado_por: 'setup', fecha_alta: ahora_()
    });
    agregarVarias_('PERMISOS', ['ADMIN', 'INGECOV', 'COMPRAS', 'COMBUSTIBLE', 'TARJA', 'ROPA'].map(m => ({ legajo, modulo: m, rol: 'ADMIN', otorgado_por: 'setup', fecha: ahora_() })));
    console.log('ADMIN creado: ' + visible + ' — PIN provisorio: ' + pin);
  }
  console.log('Diagnóstico: ' + JSON.stringify(diagnostico_()));
  console.log('Planilla: ' + ss_().getUrl());
}

function seedInstructivos_() {
  agregarVarias_('INSTRUCTIVOS', [
    { modulo: 'APP', seccion: 'Entrar', texto: 'Escribís tu nombre y tu PIN de 4 números. La app queda abierta en ese celular; solo vuelve a pedir el PIN si cambiás de teléfono o pasan 60 días sin usarla.', actualizado: new Date() },
    { modulo: 'APP', seccion: 'Olvidé mi PIN', texto: 'Pedile a Marcos que te lo resetee. Te llega un PIN provisorio por WhatsApp y al entrar elegís uno nuevo.', actualizado: new Date() },
    { modulo: 'APP', seccion: 'Avisos', texto: 'La campana de arriba muestra tus avisos. Tocás uno y te lleva al lugar exacto del módulo. "Marcar todo leído" limpia la lista. Si no te llegan notificaciones, tocá la campana y activá los avisos.', actualizado: new Date() },
    { modulo: 'APP', seccion: 'Instalar en el celular', texto: 'Android: menú del navegador (tres puntos) → "Agregar a la pantalla de inicio". iPhone: botón Compartir → "Agregar a inicio".', actualizado: new Date() },
    { modulo: 'INGECOV', seccion: 'Qué es', texto: 'Panel de mantenimiento de la flota: services por horas, repuestos entregados, trabajos realizados y documentación (VTV, seguro, RTO) de cada equipo.', actualizado: new Date() },
    { modulo: 'INGECOV', seccion: 'Buscar un equipo', texto: 'En la pantalla principal tocá el buscador y escribí el número interno o la patente. La ficha muestra horas, próximo service y documentos.', actualizado: new Date() },
    { modulo: 'COMPRAS', seccion: 'Cargar un pedido', texto: 'Botón "Nuevo pedido": elegís la obra, cargás los ítems con cantidad y descripción, y firmás con el dedo. El pedido pasa a Compras, que arma la orden de compra.', actualizado: new Date() },
    { modulo: 'COMPRAS', seccion: 'Estados', texto: 'Una orden de compra pasa por: pendiente de autorización → autorizada → pagada. Quien autoriza depende del monto. Si está rechazada, el solicitante ve el motivo en la ficha.', actualizado: new Date() },
    { modulo: 'COMBUSTIBLE', seccion: 'Cargar gasoil', texto: 'Elegís el equipo de la lista, ponés los litros y el horómetro, y guardás. Si la carga queda fuera de lo normal para ese equipo, la app avisa a Marcos.', actualizado: new Date() },
    { modulo: 'TARJA', seccion: 'Tarja diaria', texto: 'Cada día, por cada máquina: horas de inicio y fin, el checklist de estado y una foto. Se usa para certificar la obra, así que no se puede saltear el checklist.', actualizado: new Date() },
    { modulo: 'ROPA', seccion: 'Entregas', texto: 'Cuando hay ropa para retirar te llega un aviso. Al retirar, firmás en la pantalla o en la planilla; si no estás en la lista, consultá con tu capataz.', actualizado: new Date() },
    { modulo: 'ADMIN', seccion: 'Dar de alta a alguien', texto: 'Admin → "Nueva persona": nombre, apellido, sector, celular y los módulos tildados. Al guardar aparece el PIN provisorio y el botón para mandarle el acceso por WhatsApp.', actualizado: new Date() }
  ]);
}

/** Instala los disparadores: resumen diario 7:30 y limpieza de sesiones 3:00. Correr una vez. */
function instalarTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (['resumenDiario', 'limpiarSesiones'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('resumenDiario').timeBased().atHour(7).nearMinute(30).everyDays(1).inTimezone('America/Argentina/Tucuman').create();
  ScriptApp.newTrigger('limpiarSesiones').timeBased().atHour(3).everyDays(1).inTimezone('America/Argentina/Tucuman').create();
  console.log('Triggers instalados');
}

/** Guarda secretos sin pasar por la UI. Editar y correr una vez; después borrar los valores de acá. */
function configurarSecretos() {
  PropertiesService.getScriptProperties().setProperties({
    // CLAUDE_API_KEY: 'sk-ant-...',
    // PUSH_RELAY_URL: 'https://app-ingeco-push.vercel.app/api/push',
    // PUSH_RELAY_SECRET: '...',
    // VAPID_PUBLIC_KEY: '...',
    // WA_TOKEN: '...', WA_PHONE_ID: '...',
    // CLAVE_INGECOV: '...', CLAVE_COMPRAS: '...', CLAVE_COMBUSTIBLE: '...', CLAVE_TARJA: '...', CLAVE_ROPA: '...',
    // SHELL_URL: 'https://marcoskatz-cmd.github.io/app-ingeco/',
    // ADMIN_NOMBRE: 'Marcos', ADMIN_CELULAR: '549381...'
  }, false);
  console.log(Object.keys(PropertiesService.getScriptProperties().getProperties()).join(', '));
}

/** Prueba rápida de push a un legajo (correr desde el editor). */
function probarPush() {
  const r = notificarInterno_({ destinatarios: ['1'], modulo: 'APP', tipo: 'aviso_general', titulo: 'Prueba de push', cuerpo: 'Si leés esto, el push funciona.', url_destino: '#bandeja', prioridad: 'normal' });
  console.log(JSON.stringify(r));
}
