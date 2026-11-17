// Pase firmado: el backend lo emite dentro de `perfil` y guard.js lo valida en el navegador SIN consultar
// al servidor. Estas pruebas corren el guard.js real (en un navegador simulado) contra pases emitidos por
// el auth.js real, para asegurar que los dos lados hablan el mismo formato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { cargar, stubs, appIngeco } from './_cargar.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const GUARD = fs.readFileSync(path.join(AQUI, '..', 'shell', 'guard.js'), 'utf8');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const N_HEX = Buffer.from(publicKey.export({ format: 'jwk' }).n, 'base64url').toString('hex');
const OTRA = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 });

const aBytes = x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255)));
const firmados = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));   // Apps Script devuelve bytes con signo

function backend(opts) {
  opts = opts || {};
  const g = appIngeco(stubs(), {
    USUARIOS: [
      { legajo: 7, nombre_visible: 'José Núñez', email: 'jose@grupoingeco.com.ar', sector: 'Ingeniería', activo: 'sí' },
      { legajo: 8, nombre_visible: 'Ana Baja', email: 'ana@grupoingeco.com.ar', sector: 'Taller', activo: 'no' },
      { legajo: 1, nombre_visible: 'Marcos Katz', email: 'marcos@grupoingeco.com.ar', sector: 'Ingeniería', activo: 'sí' }
    ],
    MODULOS: [
      { codigo: 'INGECOV', nombre: 'Flota', url: 'https://ingecov.ingecosa.com.ar/', tipo: 'iframe', orden: 1, activo: 'sí' },
      { codigo: 'COMPRAS', nombre: 'Compras', url: 'https://compras.ingecosa.com.ar/', tipo: 'link', orden: 2, activo: 'sí' },
      { codigo: 'AVISOS', nombre: 'Avisos', url: '#avisos', tipo: 'interno', orden: 0, activo: 'sí' },
      { codigo: 'PAVIMAX', nombre: 'PAVIMAX', url: 'https://pavimax.ingecosa.com.ar/', tipo: 'iframe', orden: 3, activo: 'sí' },
      { codigo: 'ADMIN', nombre: 'Admin', url: '#admin', tipo: 'interno', orden: 99, activo: 'sí' }
    ],
    PERMISOS: [
      { legajo: 7, modulo: 'INGECOV', rol: 'TALLER' },
      { legajo: 7, modulo: 'COMPRAS', rol: 'USUARIO' },
      { legajo: 7, modulo: 'AVISOS', rol: 'EMISOR' },
      { legajo: 8, modulo: 'INGECOV', rol: 'USUARIO' },
      { legajo: 1, modulo: 'ADMIN', rol: 'ADMIN' }
    ]
  });
  g.Utilities.Charset = { UTF_8: 'utf8' };
  g.Utilities.base64EncodeWebSafe = x => aBytes(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  g.Utilities.computeRsaSha256Signature = (valor, clave) => firmados(crypto.sign('sha256', Buffer.from(valor, 'utf8'), clave));
  g.Utilities.computeHmacSha256Signature = (valor, clave) => firmados(crypto.createHmac('sha256', clave).update(valor, 'utf8').digest());
  if (!opts.sinClaves) { g.__props.PASE_PRIV = opts.priv || PRIV_PEM; g.__props.PASE_HMAC = 'secreto-de-prueba'; }
  return cargar(['sheets.js', 'permisos.js', 'auth.js'], g);
}
const usuario = (b, legajo) => b.leer_('USUARIOS').find(u => String(u.legajo) === String(legajo));

/** Corre guard.js como lo haría el navegador al cargar `url` en un sistema con data-modulo=`modulo`. */
function correrGuard(o) {
  const u = new URL(o.url);
  const ses = new Map(Object.entries(o.sesion || {}));
  const xhr = [];
  const eventos = [];
  const g = {
    location: { get search() { return u.search; }, get pathname() { return u.pathname; }, get hash() { return u.hash; } },
    history: { replaceState: (a, b, nueva) => { u.href = new URL(nueva, u.href).href; } },
    sessionStorage: { getItem: k => (ses.has(k) ? ses.get(k) : null), setItem: (k, v) => { ses.set(k, String(v)); } },
    document: { currentScript: { getAttribute: () => o.modulo }, dispatchEvent: e => { eventos.push(e); } },
    CustomEvent: function (tipo, init) { this.type = tipo; this.detail = init && init.detail; },
    XMLHttpRequest: function () {
      this.open = () => { }; this.setRequestHeader = () => { };
      this.send = cuerpo => { xhr.push(JSON.parse(cuerpo)); this.responseText = JSON.stringify(o.respuestaTicket || { ok: false, error: 'ticket inválido' }); };
    },
    URLSearchParams, atob, TextDecoder, console
  };
  g.window = g;
  const ctx = vm.createContext(g);
  if (o.sinBigInt) vm.runInContext('BigInt = undefined;', ctx);
  const fuente = GUARD.replace(/var PASE_N = '[0-9a-f]*';/, "var PASE_N = '" + (o.n || N_HEX) + "';");
  assert.notEqual(fuente, GUARD.replace('PASE_N', 'X'), 'guard.js tiene que declarar var PASE_N');
  vm.runInContext(fuente, ctx, { filename: 'guard.js' });
  return { usuario: g.INGECO_USUARIO, sesion: g.INGECO_SESION, motivo: g.INGECO_MOTIVO, url: u.href, xhr, eventos, guardado: ses.get('ingeco_guard') };
}

test('perfil_ trae un pase que guard.js acepta sin consultar al servidor', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  assert.ok(p.pase, 'perfil_ debe traer pase');
  assert.ok(p.pase_exp > Date.now() + 11 * 3600000);
  const r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#ig=' + p.pase, modulo: 'INGECOV' });
  assert.equal(r.xhr.length, 0, 'no debe consultar al servidor');
  assert.equal(r.usuario.legajo, 7);
  assert.equal(r.usuario.nombre_visible, 'José Núñez');
  assert.equal(r.usuario.email, 'jose@grupoingeco.com.ar');
  assert.equal(r.usuario.sector, 'Ingeniería');
  assert.equal(r.usuario.rol_en_modulo, 'TALLER');
  assert.deepEqual(Array.from(r.usuario.modulos).sort(), ['AVISOS', 'COMPRAS', 'INGECOV']);
  assert.equal(r.usuario.es_admin, false);
  assert.ok(r.sesion.indexOf('u1.') === 0);
  assert.equal(r.url, 'https://ingecov.ingecosa.com.ar/', 'la URL queda limpia');
  assert.equal(r.eventos.length, 1);
  const g = JSON.parse(r.guardado);
  assert.equal(g.legajo, 7);
  assert.ok(g.exp <= p.pase_exp, 'la identidad guardada no dura más que el pase');
});

test('con pase y ticket juntos usa el pase y no gasta el ticket', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  const r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/?tk=abc&aprobar=12#ig=' + p.pase, modulo: 'INGECOV' });
  assert.equal(r.xhr.length, 0);
  assert.equal(r.usuario.legajo, 7);
  assert.equal(r.url, 'https://ingecov.ingecosa.com.ar/?aprobar=12');
});

test('respeta el hash propio del sistema', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  const r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#equipo/12~ig=' + p.pase, modulo: 'INGECOV' });
  assert.equal(r.usuario.legajo, 7);
  assert.equal(r.url, 'https://ingecov.ingecosa.com.ar/#equipo/12');
});

test('un pase adulterado o firmado con otra llave no da identidad', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  const [cuerpo, firma] = p.pase.split('.');
  const datos = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  datos.a = true; datos.l = 1;
  const trucho = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64url') + '.' + firma;
  let r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#ig=' + trucho, modulo: 'INGECOV' });
  assert.equal(r.usuario, null);
  assert.equal(r.guardado, undefined);
  assert.equal(r.url, 'https://ingecov.ingecosa.com.ar/', 'igual limpia la URL');

  const b2 = backend({ priv: OTRA.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#ig=' + b2.perfil_(usuario(b2, 7)).pase, modulo: 'INGECOV' });
  assert.equal(r.usuario, null);

  r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#ig=basura.basura', modulo: 'INGECOV' });
  assert.equal(r.usuario, null);
});

test('si el pase no sirve pero hay ticket, cae al canje de siempre', () => {
  const r = correrGuard({
    url: 'https://ingecov.ingecosa.com.ar/?tk=T1#ig=basura.basura', modulo: 'INGECOV',
    respuestaTicket: { ok: true, legajo: 7, nombre_visible: 'José Núñez', modulos: ['INGECOV'], sesion: 'S' }
  });
  assert.equal(r.xhr.length, 1);
  assert.equal(r.xhr[0].accion, 'validar_ticket');
  assert.equal(r.xhr[0].payload.ticket, 'T1');
  assert.equal(r.usuario.legajo, 7);
  assert.equal(r.sesion, 'S');
});

test('sin BigInt (navegador viejo) usa el ticket', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  const r = correrGuard({
    url: 'https://ingecov.ingecosa.com.ar/?tk=T2#ig=' + p.pase, modulo: 'INGECOV', sinBigInt: true,
    respuestaTicket: { ok: true, legajo: 7, nombre_visible: 'José Núñez', modulos: ['INGECOV'], sesion: 'S' }
  });
  assert.equal(r.xhr.length, 1);
  assert.equal(r.usuario.legajo, 7);
});

test('pase vencido o de alguien sin permiso al módulo: sin identidad', () => {
  const b = backend();
  const D = vm.runInContext('Date', b);   // el backend corre en su propio contexto, con su propio Date
  const real = D.now;
  D.now = () => real() - 13 * 3600000;
  let p; try { p = b.perfil_(usuario(b, 7)); } finally { D.now = real; }
  assert.ok(p.pase_exp < Date.now(), 'el pase de prueba tiene que estar vencido');
  let r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/#ig=' + p.pase, modulo: 'INGECOV' });
  assert.equal(r.usuario, null);

  p = b.perfil_(usuario(b, 7));
  r = correrGuard({ url: 'https://pavimax.ingecosa.com.ar/#ig=' + p.pase, modulo: 'PAVIMAX' });
  assert.equal(r.usuario, null);
  assert.equal(r.motivo, 'No tenés acceso a este sistema');
});

test('un admin entra a cualquier módulo con su pase', () => {
  const b = backend();
  const r = correrGuard({ url: 'https://pavimax.ingecosa.com.ar/#ig=' + b.perfil_(usuario(b, 1)).pase, modulo: 'PAVIMAX' });
  assert.equal(r.usuario.es_admin, true);
  assert.equal(r.usuario.rol_en_modulo, null);
});

test('sin pase ni ticket, la identidad guardada en la pestaña sigue valiendo', () => {
  const guardada = { legajo: 7, nombre_visible: 'José', modulos: ['INGECOV'], es_admin: false, sesion: 'S', exp: Date.now() + 3600000 };
  const r = correrGuard({ url: 'https://ingecov.ingecosa.com.ar/', modulo: 'INGECOV', sesion: { ingeco_guard: JSON.stringify(guardada) } });
  assert.equal(r.usuario.legajo, 7);
  assert.equal(r.xhr.length, 0);
});

test('la sesión del pase se valida en el backend sin tocar la planilla de tickets', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  const datos = JSON.parse(Buffer.from(p.pase.split('.')[0], 'base64url').toString('utf8'));
  const ok = b.validarSesionModulo_({ sesion: datos.ss, modulo: 'INGECOV' });
  assert.equal(ok.ok, true);
  assert.equal(ok.legajo, 7);
  assert.equal(ok.rol_en_modulo, 'TALLER');
  assert.equal(b.validarSesionModulo_({ sesion: datos.ss, modulo: 'PAVIMAX' }).ok, false, 'sin permiso al módulo');
  assert.equal(b.validarSesionModulo_({ sesion: datos.ss.slice(0, -2) + 'xx', modulo: 'INGECOV' }).ok, false, 'firma adulterada');
  const otroLegajo = datos.ss.replace('u1.7.', 'u1.1.');
  assert.equal(b.validarSesionModulo_({ sesion: otroLegajo, modulo: 'INGECOV' }).ok, false, 'legajo cambiado');
  assert.equal(b.__hojas.APP.TICKETS, undefined, 'no escribe ni lee TICKETS');
});

test('la sesión del pase vence y no sirve para un usuario dado de baja', () => {
  const b = backend();
  const real = Date.now;
  Date.now = () => real() - 13 * 3600000;
  let vieja; try { vieja = b.sesionFirmada_(7, Date.now() + 12 * 3600000); } finally { Date.now = real; }
  assert.equal(b.validarSesionModulo_({ sesion: vieja, modulo: 'INGECOV' }).ok, false);
  const deBaja = b.sesionFirmada_(8, Date.now() + 3600000);
  assert.equal(b.validarSesionModulo_({ sesion: deBaja, modulo: 'INGECOV' }).ok, false);
});

test('perfil_ trae tickets listos para los módulos con URL y se pueden canjear', () => {
  const b = backend();
  const p = b.perfil_(usuario(b, 7));
  assert.deepEqual(Object.keys(p.tickets).sort(), ['COMPRAS', 'INGECOV'], 'solo módulos que se abren con URL');
  const r = b.validarTicket_({ ticket: p.tickets.COMPRAS, modulo: 'COMPRAS' });
  assert.equal(r.ok, true);
  assert.equal(r.legajo, 7);
  assert.equal(b.validarTicket_({ ticket: p.tickets.COMPRAS, modulo: 'COMPRAS' }).ok, false, 'un solo uso');
  assert.equal(b.validarTicket_({ ticket: p.tickets.INGECOV, modulo: 'COMPRAS' }).ok, false, 'es de otro sistema');
});

test('sin las claves cargadas, perfil_ funciona igual pero sin pase', () => {
  const b = backend({ sinClaves: true });
  const p = b.perfil_(usuario(b, 7));
  assert.equal(p.pase, undefined);
  assert.equal(p.modulos.length, 3);
  assert.ok(p.tickets.INGECOV);
});
