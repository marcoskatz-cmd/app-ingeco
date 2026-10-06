/* INGECO shell — estado, llamadas al backend, render. Sin frameworks. */
'use strict';

const CONFIG = {
  BACKEND_URL: 'https://script.google.com/macros/s/PEGAR_DEPLOYMENT_ID/exec',
  GOOGLE_CLIENT_ID: 'PEGAR_CLIENT_ID.apps.googleusercontent.com',
  GOOGLE_HD: 'grupoingeco.com.ar',
  REFRESCO_MS: 3 * 60 * 1000,
  VERSION: '1.0.0'
};

// ───────────────────────── Estado ─────────────────────────
const S = {
  token: localStorage.getItem('ingeco_token') || '',
  perfil: null,            // {legajo, nombre_visible, sector, modulos:[...], es_admin}
  avisos: [], sinLeer: {}, totalSinLeer: 0,
  moduloActual: null,
  chat: [],                // [{rol:'usuario'|'bot', texto}]
  admin: { usuarios: [], modulos: [], sectores: [], tab: 'personas' },
  instalarEvt: null,
  timer: null
};

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dispositivo = () => (navigator.userAgent.match(/\(([^)]+)\)/) || [, navigator.userAgent])[1].slice(0, 80);

// ───────────────────────── API ─────────────────────────
async function api(accion, payload, opts) {
  opts = opts || {};
  if (!opts.silencioso) mostrarCargando(true);
  try {
    const r = await fetch(CONFIG.BACKEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, token: S.token, payload: payload || {} })
    });
    const j = await r.json();
    if (j.relogin) { cerrarSesionLocal(); mostrarVista('login'); toast(j.error, 'mal'); }
    return j;
  } catch (e) {
    return { ok: false, error: 'Sin conexión. Fijate la señal y probá de nuevo.', offline: true };
  } finally { if (!opts.silencioso) mostrarCargando(false); }
}

// ───────────────────────── UI básica ─────────────────────────
function mostrarCargando(v) { $('cargando').hidden = !v; }
let toastTimer;
function toast(msg, tipo) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast ' + (tipo || ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
function modal(html, alAbrir) {
  $('modal-contenido').innerHTML = html; $('modal').hidden = false;
  if (alAbrir) alAbrir($('modal-contenido'));
}
function cerrarModal() { $('modal').hidden = true; $('modal-contenido').innerHTML = ''; }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) cerrarModal(); });

function confirmar(titulo, texto, textoBoton, peligro) {
  return new Promise(res => {
    modal(`<h3>${esc(titulo)}</h3><p>${esc(texto)}</p>
      <div class="modal-acciones"><button class="secundario" id="m-no">Cancelar</button><button class="${peligro ? 'peligro' : 'primario'}" id="m-si">${esc(textoBoton || 'Confirmar')}</button></div>`,
      c => { c.querySelector('#m-no').onclick = () => { cerrarModal(); res(false); }; c.querySelector('#m-si').onclick = () => { cerrarModal(); res(true); }; });
  });
}

const VISTAS = ['login', 'inicio', 'modulo', 'bandeja', 'ayuda', 'admin'];
function mostrarVista(v) {
  const enApp = ['inicio', 'modulo', 'bandeja', 'ayuda', 'admin'].includes(v);
  $('app').hidden = !enApp;
  VISTAS.forEach(x => { $('v-' + x).hidden = x !== v; });
  $('btn-volver').hidden = v === 'inicio';
  $('btn-consultar').hidden = true;
  if (v !== 'modulo') { $('modulo-frame').src = 'about:blank'; S.moduloActual = null; }
  const titulos = { inicio: 'INGECO', bandeja: 'Avisos', ayuda: 'Ayuda', admin: 'Administración' };
  if (titulos[v]) $('barra-titulo').textContent = titulos[v];
  if (v === 'login') { $('login-error').textContent = ''; iniciarGoogle(); }
  window.scrollTo(0, 0);
}

// ───────────────────────── Router por hash ─────────────────────────
function irA(hash) { if (location.hash !== hash) location.hash = hash; else enrutar(); }
function enrutar() {
  if (!S.token || !S.perfil) return;
  const [ruta, arg] = location.hash.replace(/^#/, '').split('/');
  switch (ruta) {
    case 'modulo': abrirModulo(decodeURIComponent(arg || '')); break;
    case 'bandeja': verBandeja(); break;
    case 'ayuda': verAyuda(arg ? decodeURIComponent(arg) : (S.moduloActual && S.moduloActual.codigo)); break;
    case 'admin': if (S.perfil.es_admin) verAdmin(); else irA('#inicio'); break;
    default: verInicio();
  }
}
window.addEventListener('hashchange', enrutar);
$('btn-volver').onclick = () => irA('#inicio');
$('btn-campana').onclick = () => irA('#bandeja');
$('btn-ayuda').onclick = () => { const m = S.moduloActual ? '/' + encodeURIComponent(S.moduloActual.codigo) : ''; irA('#ayuda' + m); };

// ───────────────────────── Login con Google ─────────────────────────
let googleListo = false;
function iniciarGoogle() {
  if (!window.google || !google.accounts) { setTimeout(iniciarGoogle, 300); return; }
  if (!googleListo) {
    google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      hd: CONFIG.GOOGLE_HD,
      callback: alCredencialGoogle,
      auto_select: true,
      itp_support: true,
      ux_mode: 'popup'
    });
    googleListo = true;
  }
  google.accounts.id.renderButton($('google-btn'), {
    type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'es', width: 280
  });
}
async function alCredencialGoogle(resp) {
  $('login-error').textContent = '';
  const r = await api('login_google', { credential: resp.credential, dispositivo: dispositivo() });
  if (!r.ok) { $('login-error').textContent = r.error; return; }
  S.token = r.token; localStorage.setItem('ingeco_token', r.token);
  guardarPerfil(r);
  entrar();
}


function guardarPerfil(r) {
  S.perfil = { legajo: r.legajo, nombre_visible: r.nombre_visible, sector: r.sector, modulos: r.modulos || [], es_admin: !!r.es_admin };
  localStorage.setItem('ingeco_perfil', JSON.stringify(S.perfil));
}
function cerrarSesionLocal() {
  S.token = ''; S.perfil = null; S.avisos = [];
  localStorage.removeItem('ingeco_token'); localStorage.removeItem('ingeco_perfil');
  clearInterval(S.timer);
  try { google.accounts.id.disableAutoSelect(); } catch (e) { }
}
$('btn-salir').onclick = async () => {
  if (!await confirmar('Cerrar sesión', 'Vas a tener que volver a poner tu nombre y PIN en este celular.', 'Cerrar sesión')) return;
  await desuscribirPush();
  await api('cerrar_sesion');
  cerrarSesionLocal(); mostrarVista('login'); location.hash = '';
};

function entrar() {
  mostrarVista('inicio');
  enrutar();
  refrescar();
  clearInterval(S.timer);
  S.timer = setInterval(() => { if (document.visibilityState === 'visible') refrescar(true); }, CONFIG.REFRESCO_MS);
  setTimeout(gestionarPush, 1500);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.token && S.perfil) refrescar(true); });

/** Perfil + bandeja en una pasada (dos llamadas en paralelo). */
async function refrescar(silencioso) {
  const [p, b] = await Promise.all([api('perfil', {}, { silencioso: true }), api('bandeja', { limite: 100 }, { silencioso: true })]);
  if (p.ok) guardarPerfil(p);
  if (b.ok) { S.avisos = b.avisos; S.sinLeer = b.sin_leer || {}; S.totalSinLeer = b.total_sin_leer || 0; }
  pintarCampana();
  if (!$('v-inicio').hidden) verInicio();
  if (!$('v-bandeja').hidden) verBandeja();
  if (!silencioso && b.offline) toast(b.error, 'mal');
}

function pintarCampana() {
  const n = S.totalSinLeer;
  $('campana-n').hidden = !n; $('campana-n').textContent = n > 99 ? '99+' : n;
}

// ───────────────────────── Inicio ─────────────────────────
function verInicio() {
  mostrarVista('inicio');
  const p = S.perfil;
  $('saludo').textContent = 'Hola, ' + String(p.nombre_visible).split(' ')[0];
  const mods = p.modulos.filter(m => m.tipo !== 'interno' || m.codigo === 'ADMIN');
  $('tarjetas').innerHTML = mods.map(m => `
    <button class="tarjeta" data-cod="${esc(m.codigo)}">
      <span class="ico">${esc(m.icono)}</span>
      <span class="nom">${esc(m.nombre)}</span>
      <span class="des">${esc(m.descripcion_corta || '')}</span>
      ${S.sinLeer[m.codigo] ? `<span class="badge">${S.sinLeer[m.codigo]}</span>` : ''}
    </button>`).join('');
  $('sin-modulos').hidden = mods.length > 0;
  $('tarjetas').querySelectorAll('.tarjeta').forEach(t => t.onclick = () => {
    const m = p.modulos.find(x => x.codigo === t.dataset.cod);
    if (m.codigo === 'ADMIN' || m.tipo === 'interno') return irA('#admin');
    irA('#modulo/' + encodeURIComponent(m.codigo));
  });
  $('banner-instalar').hidden = !(S.instalarEvt || esIosSinInstalar()) || localStorage.getItem('ingeco_instalar_cerrado') === '1';
  if (esIosSinInstalar()) { $('instalar-texto').textContent = 'En iPhone: tocá Compartir y después "Agregar a inicio".'; $('btn-instalar').hidden = true; }
}

// ───────────────────────── Módulo ─────────────────────────
function urlConToken(url) {
  try {
    const u = new URL(url, location.href);
    u.searchParams.set('t', S.token);
    u.searchParams.set('legajo', S.perfil.legajo);
    return u.toString();
  } catch (e) { return url + (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(S.token); }
}
function abrirModulo(codigo) {
  const m = S.perfil.modulos.find(x => x.codigo === codigo);
  if (!m) { toast('No tenés acceso a ese módulo. Pedíselo a Marcos.', 'mal'); return irA('#inicio'); }
  if (!m.url) { toast('Ese módulo todavía no está conectado.', 'mal'); return irA('#inicio'); }
  if (m.tipo === 'link') { location.href = urlConToken(m.url); return; }
  S.moduloActual = m;
  mostrarVista('modulo');
  $('barra-titulo').textContent = m.nombre;
  $('btn-consultar').hidden = !m.responsable_celular;
  const f = $('modulo-frame');
  f.src = urlConToken(m.url);
  f.onload = () => { try { f.contentWindow.postMessage({ tipo: 'ingeco_token', token: S.token, legajo: S.perfil.legajo, modulo: m.codigo }, '*'); } catch (e) { } };
  // Los avisos de este módulo se consideran vistos al abrirlo.
  if (S.sinLeer[m.codigo]) { const ids = S.avisos.filter(a => a.modulo === m.codigo && !a.leido).map(a => a.id); api('marcar_leido', { ids }, { silencioso: true }).then(() => refrescar(true)); }
}
$('btn-consultar').onclick = () => {
  const m = S.moduloActual; if (!m || !m.responsable_celular) return;
  const txt = `Hola, soy ${S.perfil.nombre_visible}. Tengo una consulta sobre ${m.nombre}: `;
  window.open('https://wa.me/' + m.responsable_celular.replace(/\D/g, '') + '?text=' + encodeURIComponent(txt), '_blank');
};
// Mensajes desde el iframe: pedir token, pedir ayuda, mostrar toast
window.addEventListener('message', e => {
  const d = e.data || {};
  if (d.tipo === 'ingeco_pedir_token' && S.moduloActual) e.source.postMessage({ tipo: 'ingeco_token', token: S.token, legajo: S.perfil.legajo, modulo: S.moduloActual.codigo }, '*');
  if (d.tipo === 'ingeco_ayuda') irA('#ayuda/' + encodeURIComponent(S.moduloActual ? S.moduloActual.codigo : ''));
  if (d.tipo === 'ingeco_volver') irA('#inicio');
});

// ───────────────────────── Bandeja ─────────────────────────
function fechaDia(f) {
  const d = new Date(f), hoy = new Date(); const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const mismo = (a, b) => a.toDateString() === b.toDateString();
  if (mismo(d, hoy)) return 'Hoy'; if (mismo(d, ayer)) return 'Ayer';
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
}
const hora = f => new Date(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

function verBandeja() {
  mostrarVista('bandeja');
  const filtro = $('bandeja-filtro');
  const modulos = [...new Set(S.avisos.map(a => a.modulo))];
  filtro.hidden = S.avisos.length <= 20;
  const sel = filtro.value;
  filtro.innerHTML = '<option value="">Todos los módulos</option>' + modulos.map(m => `<option value="${esc(m)}" ${m === sel ? 'selected' : ''}>${esc(nombreModulo(m))}</option>`).join('');
  const lista = S.avisos.filter(a => !filtro.value || a.modulo === filtro.value)
    .sort((a, b) => (a.leido - b.leido) || (new Date(b.fecha) - new Date(a.fecha)));
  $('bandeja-vacia').hidden = lista.length > 0;
  $('btn-todo-leido').hidden = !S.totalSinLeer;
  let html = '', dia = '';
  lista.forEach(a => {
    const d = (a.leido ? 'Leídos · ' : '') + fechaDia(a.fecha);
    if (d !== dia) { dia = d; html += `<div class="dia">${esc(d)}</div>`; }
    const m = S.perfil.modulos.find(x => x.codigo === a.modulo);
    html += `<div class="aviso ${a.leido ? '' : 'nuevo'} ${a.prioridad === 'critica' ? 'critico' : ''}" data-id="${esc(a.id)}">
      <div class="cuerpo">
        <div class="titulo">${a.prioridad === 'critica' ? '⚠️ ' : ''}${esc(a.titulo)}</div>
        <div class="texto">${esc(a.cuerpo)}</div>
        <div class="meta">${esc(nombreModulo(a.modulo))} · ${hora(a.fecha)}</div>
      </div>
      <div class="acciones">
        ${a.url_destino ? `<button data-abrir="${esc(a.id)}" aria-label="Abrir">↗</button>` : ''}
        ${m && m.responsable_celular ? `<button data-wa="${esc(a.id)}" aria-label="Consultar por WhatsApp">💬</button>` : ''}
      </div></div>`;
  });
  $('bandeja-lista').innerHTML = html;
  $('bandeja-lista').querySelectorAll('.aviso').forEach(el => {
    el.onclick = e => {
      const a = S.avisos.find(x => x.id === el.dataset.id);
      if (e.target.dataset.wa) {
        const m = S.perfil.modulos.find(x => x.codigo === a.modulo);
        window.open('https://wa.me/' + m.responsable_celular.replace(/\D/g, '') + '?text=' + encodeURIComponent(`Hola, soy ${S.perfil.nombre_visible}. Consulta sobre el aviso "${a.titulo}": `), '_blank');
        return;
      }
      marcarLeido(a);
      if (a.url_destino) abrirDestino(a);
    };
  });
}
function nombreModulo(cod) { const m = S.perfil.modulos.find(x => x.codigo === cod); return m ? m.nombre : cod; }
async function marcarLeido(a) {
  if (a.leido) return;
  a.leido = true; S.totalSinLeer = Math.max(0, S.totalSinLeer - 1); S.sinLeer[a.modulo] = Math.max(0, (S.sinLeer[a.modulo] || 1) - 1);
  pintarCampana();
  await api('marcar_leido', { id: a.id }, { silencioso: true });
}
function abrirDestino(a) {
  const u = String(a.url_destino);
  if (u.startsWith('#')) return irA(u);
  const m = S.perfil.modulos.find(x => x.codigo === a.modulo);
  if (m && m.tipo !== 'link') {
    // Abrir el módulo embebido en la URL exacta del ítem.
    S.moduloActual = m; mostrarVista('modulo'); $('barra-titulo').textContent = m.nombre; $('btn-consultar').hidden = !m.responsable_celular;
    $('modulo-frame').src = urlConToken(u); location.hash = '#modulo/' + encodeURIComponent(m.codigo);
  } else location.href = urlConToken(u);
}
$('bandeja-filtro').onchange = verBandeja;
$('btn-todo-leido').onclick = async () => { await api('marcar_leido', { todos: true }); await refrescar(true); toast('Listo', 'ok'); };

// ───────────────────────── Ayuda (bot) ─────────────────────────
let ayudaCtx = '';
async function verAyuda(moduloCtx) {
  mostrarVista('ayuda');
  const nuevoCtx = moduloCtx || '';
  if (nuevoCtx !== ayudaCtx || !S.chat.length) {
    ayudaCtx = nuevoCtx; S.chat = [];
    const r = await api('saludo_ayuda', { modulo_contexto: ayudaCtx }, { silencioso: true });
    S.chat.push({ rol: 'bot', texto: r.ok ? r.texto : '¿En qué te ayudo?' });
    if (r.wa_admin) { $('chat-wa').href = r.wa_admin; $('chat-wa').hidden = false; }
  }
  pintarChat();
  setTimeout(() => $('chat-input').focus(), 100);
}
function pintarChat() {
  $('chat').innerHTML = S.chat.map((m, i) => `
    <div class="burbuja ${m.rol} ${m.error ? 'error' : ''}">${esc(m.texto)}${m.rol === 'bot' && m.fila ? `
      <div class="valorar"><button data-v="1" data-i="${i}" class="${m.util === true ? 'elegido' : ''}" aria-label="Me sirvió">👍</button><button data-v="0" data-i="${i}" class="${m.util === false ? 'elegido' : ''}" aria-label="No me sirvió">👎</button></div>` : ''}</div>`).join('') +
    (S.chatEsperando ? '<div class="burbuja bot escribiendo">Pensando…</div>' : '');
  $('chat').scrollTop = $('chat').scrollHeight;
  $('chat').querySelectorAll('.valorar button').forEach(b => b.onclick = async () => {
    const m = S.chat[+b.dataset.i]; m.util = b.dataset.v === '1';
    pintarChat(); await api('valorar_ayuda', { fila: m.fila, util: m.util }, { silencioso: true });
  });
}
$('chat-form').onsubmit = async e => {
  e.preventDefault();
  const q = $('chat-input').value.trim(); if (!q || S.chatEsperando) return;
  $('chat-input').value = '';
  S.chat.push({ rol: 'usuario', texto: q }); S.chatEsperando = true; pintarChat();
  const historial = S.chat.slice(0, -1).filter(m => !m.error).slice(-8).map(m => ({ rol: m.rol, texto: m.texto }));
  const r = await api('ayuda', { modulo_contexto: ayudaCtx, pregunta: q, historial }, { silencioso: true });
  S.chatEsperando = false;
  if (r.ok) S.chat.push({ rol: 'bot', texto: r.respuesta, fila: r.fila });
  else S.chat.push({ rol: 'bot', texto: r.error || 'No pude responder.', error: true });
  if (r.wa_admin) { $('chat-wa').href = r.wa_admin; $('chat-wa').hidden = false; }
  pintarChat();
};

// ───────────────────────── Push ─────────────────────────
function b64aUint8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
async function gestionarPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  const perm = Notification.permission;
  $('banner-push').hidden = perm === 'granted' || localStorage.getItem('ingeco_push_no') === '1';
  $('campana-punto').hidden = perm === 'granted';
  if (perm === 'granted') await suscribirPush();
}
async function suscribirPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const v = await api('vapid', {}, { silencioso: true });
      if (!v.ok || !v.clave) return;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64aUint8(v.clave) });
    }
    const r = await api('suscribir_push', { suscripcion: sub.toJSON(), dispositivo: dispositivo() }, { silencioso: true });
    if (r.ok) { $('banner-push').hidden = true; $('campana-punto').hidden = true; }
  } catch (e) { console.warn('push', e); }
}
async function desuscribirPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('desuscribir_push', { endpoint: sub.endpoint }, { silencioso: true }); await sub.unsubscribe(); }
  } catch (e) { }
}
$('btn-activar-push').onclick = async () => {
  const p = await Notification.requestPermission();
  if (p === 'granted') { await suscribirPush(); toast('Avisos activados', 'ok'); }
  else { localStorage.setItem('ingeco_push_no', '1'); $('banner-push').hidden = true; toast('Podés activarlos después desde la campana.'); }
};
$('btn-campana').addEventListener('click', () => { if (Notification.permission !== 'granted' && !$('campana-punto').hidden) $('btn-activar-push').click(); });

// ───────────────────────── Instalación PWA ─────────────────────────
function esIosSinInstalar() { return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone; }
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.instalarEvt = e; if (!$('v-inicio').hidden) verInicio(); });
$('btn-instalar').onclick = async () => { if (!S.instalarEvt) return; S.instalarEvt.prompt(); await S.instalarEvt.userChoice; S.instalarEvt = null; $('banner-instalar').hidden = true; };
$('btn-cerrar-instalar').onclick = () => { localStorage.setItem('ingeco_instalar_cerrado', '1'); $('banner-instalar').hidden = true; };

// ───────────────────────── ADMIN ─────────────────────────
async function verAdmin() {
  mostrarVista('admin');
  const r = await api('admin_usuarios');
  if (!r.ok) return toast(r.error, 'mal');
  S.admin.usuarios = r.usuarios; S.admin.modulos = r.modulos; S.admin.sectores = r.sectores;
  const d = r.diagnostico;
  $('admin-diag').hidden = d.ok;
  if (!d.ok) $('admin-diag').innerHTML = '<b>Revisar la planilla:</b> ' + d.problemas.map(p => esc(p.hoja + ': ' + p.problema)).join(' · ');
  pintarTabAdmin();
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { S.admin.tab = b.dataset.tab; pintarTabAdmin(); });
function pintarTabAdmin() {
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('activa', b.dataset.tab === S.admin.tab));
  ['personas', 'modulos', 'instructivos', 'bot', 'aviso'].forEach(t => $('tab-' + t).hidden = t !== S.admin.tab);
  ({ personas: pintarGrilla, modulos: pintarModulosAdmin, instructivos: pintarInstructivos, bot: pintarBot, aviso: pintarFormAviso })[S.admin.tab]();
}

// — Personas: grilla legajo × módulo —
function pintarGrilla() {
  const q = $('admin-buscar').value.trim().toLowerCase();
  const mods = S.admin.modulos;
  const us = S.admin.usuarios.filter(u => !q || String(u.nombre_visible).toLowerCase().includes(q) || String(u.sector).toLowerCase().includes(q));
  $('admin-grilla').innerHTML = `<table class="grilla"><thead><tr><th>Persona</th>${mods.map(m => `<th title="${esc(m.nombre)}">${esc(m.icono)}<br>${esc(m.codigo)}</th>`).join('')}</tr></thead><tbody>
    ${us.map(u => `<tr class="${u.activo ? '' : 'inactivo'}"><td><button class="nombre-btn" data-ficha="${esc(u.legajo)}">${esc(u.nombre_visible)}</button><br><small>${esc(u.sector || '')}${u.ultimo_ingreso ? '' : ' · nunca entró'}</small></td>
      ${mods.map(m => { const p = u.modulos.find(x => x.modulo === m.codigo); return `<td><input type="checkbox" data-legajo="${esc(u.legajo)}" data-mod="${esc(m.codigo)}" ${p ? 'checked' : ''} ${u.activo ? '' : 'disabled'} title="${p ? esc(p.rol) : ''}"></td>`; }).join('')}</tr>`).join('')}
  </tbody></table>`;
  $('admin-grilla').querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = async () => {
    c.disabled = true;
    const r = await api('admin_set_permiso', { legajo: c.dataset.legajo, modulo: c.dataset.mod, activo: c.checked }, { silencioso: true });
    c.disabled = false;
    if (!r.ok) { c.checked = !c.checked; toast(r.error, 'mal'); return; }
    const u = S.admin.usuarios.find(x => String(x.legajo) === c.dataset.legajo);
    if (c.checked) u.modulos.push({ modulo: c.dataset.mod, rol: 'USUARIO' }); else u.modulos = u.modulos.filter(x => x.modulo !== c.dataset.mod);
    toast('Guardado', 'ok');
  });
  $('admin-grilla').querySelectorAll('[data-ficha]').forEach(b => b.onclick = () => verFicha(b.dataset.ficha));
}
$('admin-buscar').oninput = pintarGrilla;

function selectSector(id, valor) {
  return `<select id="${id}"><option value="">Sin sector</option>${S.admin.sectores.map(s => `<option ${s === valor ? 'selected' : ''}>${esc(s)}</option>`).join('')}<option value="__nuevo">+ Otro sector…</option></select>`;
}
function conSectorNuevo(c, id) {
  const sel = c.querySelector('#' + id);
  sel.onchange = () => { if (sel.value === '__nuevo') { const n = prompt('Nombre del sector'); if (n) { sel.add(new Option(n, n, true, true)); } else sel.value = ''; } };
}

$('btn-nueva-persona').onclick = () => {
  modal(`<h3>Nueva persona</h3><form id="f-alta" class="form">
    <label class="campo"><span>Nombre y apellido</span><input id="a-nombre" required autocapitalize="words"></label>
    <label class="campo"><span>Email de INGECO</span><input id="a-email" type="email" required placeholder="nombre@grupoingeco.com.ar" autocapitalize="none"></label>
    <label class="campo"><span>Sector</span>${selectSector('a-sector')}</label>
    <label class="campo"><span>Celular (con característica, sin 0 ni 15)</span><input id="a-celular" type="tel" inputmode="numeric" placeholder="3815551234"></label>
    <div class="campo"><span>Módulos</span><div class="chips">${S.admin.modulos.map(m => `<label><input type="checkbox" value="${esc(m.codigo)}">${esc(m.icono)} ${esc(m.nombre)}</label>`).join('')}</div></div>
    <div class="modal-acciones"><button type="button" class="secundario" id="a-cancelar">Cancelar</button><button type="submit" class="primario">Crear acceso</button></div></form>`,
    c => {
      conSectorNuevo(c, 'a-sector');
      c.querySelector('#a-cancelar').onclick = cerrarModal;
      c.querySelector('#f-alta').onsubmit = async e => {
        e.preventDefault();
        const r = await api('admin_alta', {
          nombre: c.querySelector('#a-nombre').value, email: c.querySelector('#a-email').value, sector: c.querySelector('#a-sector').value,
          celular: c.querySelector('#a-celular').value, modulos: [...c.querySelectorAll('.chips input:checked')].map(i => i.value)
        });
        if (!r.ok) return toast(r.error, 'mal');
        mostrarAcceso(r.nombre_visible, r.email, r.wa_link);
        verAdmin();
      };
    });
};
function mostrarAcceso(nombre, email, waLink) {
  modal(`<h3>Acceso creado para ${esc(nombre)}</h3><p>Entra con su cuenta de Google <b>${esc(email)}</b>. No hace falta PIN ni contraseña nueva.</p>
    <div class="modal-acciones">${waLink ? `<a class="primario" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${esc(waLink)}" target="_blank" rel="noopener">Enviar acceso por WhatsApp</a>` : ''}<button class="secundario" id="p-cerrar">Cerrar</button></div>`,
    c => c.querySelector('#p-cerrar').onclick = cerrarModal);
}

async function verFicha(legajo) {
  const r = await api('admin_ficha', { legajo });
  if (!r.ok) return toast(r.error, 'mal');
  const u = r.usuario;
  modal(`<h3>${esc(u.nombre_visible)}</h3><p class="sub">Legajo ${esc(u.legajo)} · alta ${u.fecha_alta ? new Date(u.fecha_alta).toLocaleDateString('es-AR') : ''}${u.ultimo_ingreso ? ' · último ingreso ' + new Date(u.ultimo_ingreso).toLocaleDateString('es-AR') : ' · nunca entró'} ${u.activo ? '' : '· <b>DADO DE BAJA</b>'}</p>
    <form id="f-ficha" class="form">
      <label class="campo"><span>Sector</span>${selectSector('f-sector', u.sector)}</label>
      <label class="campo"><span>Celular</span><input id="f-celular" type="tel" inputmode="numeric" value="${esc(u.celular)}"></label>
      <label class="campo"><span>Email de INGECO</span><input id="f-email" type="email" value="${esc(u.email || '')}" autocapitalize="none"></label>
      <button type="submit" class="primario">Guardar cambios</button>
    </form>
    <p><b>Módulos:</b> ${r.modulos.map(m => `<span class="chip">${esc(m.icono)} ${esc(m.nombre)} · ${esc(m.rol)}</span>`).join('') || 'ninguno'}</p>
    <p><b>Sesiones activas (${r.sesiones.length}):</b><br>${r.sesiones.map(s => `<small>${esc(s.dispositivo || 'dispositivo')} · último uso ${s.ultimo_uso ? new Date(s.ultimo_uso).toLocaleDateString('es-AR') : '-'}</small>`).join('<br>') || '<small>ninguna</small>'}</p>
    <p><small>Celulares con avisos push: ${r.suscripciones}</small></p>
    <div class="modal-acciones">${u.wa_link ? `<a class="secundario" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="${esc(u.wa_link)}" target="_blank" rel="noopener">Enviar acceso por WhatsApp</a>` : ''}<button class="secundario" id="f-sesiones">Cerrar sesiones</button></div>
    <div class="modal-acciones"><button class="${u.activo ? 'peligro' : 'primario'}" id="f-baja">${u.activo ? 'Dar de baja' : 'Reactivar'}</button><button class="secundario" id="f-cerrar">Cerrar</button></div>`,
    c => {
      conSectorNuevo(c, 'f-sector');
      c.querySelector('#f-cerrar').onclick = cerrarModal;
      c.querySelector('#f-ficha').onsubmit = async e => {
        e.preventDefault();
        const x = await api('admin_editar', { legajo, sector: c.querySelector('#f-sector').value, celular: c.querySelector('#f-celular').value, email: c.querySelector('#f-email').value });
        if (x.ok) { toast('Guardado', 'ok'); cerrarModal(); verAdmin(); } else toast(x.error, 'mal');
      };
      c.querySelector('#f-sesiones').onclick = async () => {
        if (!await confirmar('Cerrar sesiones', 'Va a tener que volver a entrar con nombre y PIN en todos sus celulares.', 'Cerrar sesiones')) return;
        const x = await api('admin_cerrar_sesiones', { legajo }); toast(x.ok ? 'Sesiones cerradas' : x.error, x.ok ? 'ok' : 'mal'); cerrarModal();
      };
      c.querySelector('#f-baja').onclick = async () => {
        const reactivar = !u.activo;
        if (!reactivar && !await confirmar('Dar de baja', 'No va a poder entrar más, aunque tenga cuenta de Google. Se conserva su historial.', 'Dar de baja', true)) return;
        const x = await api('admin_baja', { legajo, reactivar }); toast(x.ok ? 'Listo' : x.error, x.ok ? 'ok' : 'mal'); cerrarModal(); verAdmin();
      };
    });
}

$('btn-importar').onclick = () => {
  modal(`<h3>Importar personas</h3><p class="sub">Pegá filas copiadas de una planilla: <b>nombre y apellido, email de INGECO, sector, celular</b> (separadas por tabulación o punto y coma). Se crean sin módulos; después tildás los permisos en la grilla.</p>
    <textarea id="imp-texto" rows="8" placeholder="Juan Pérez&#9;jperez@grupoingeco.com.ar&#9;Taller&#9;3815551234"></textarea>
    <div class="modal-acciones"><button class="secundario" id="imp-cancelar">Cancelar</button><button class="primario" id="imp-ok">Importar</button></div>`,
    c => {
      c.querySelector('#imp-cancelar').onclick = cerrarModal;
      c.querySelector('#imp-ok').onclick = async () => {
        const r = await api('admin_importar', { texto: c.querySelector('#imp-texto').value });
        if (!r.ok) return toast(r.error, 'mal');
        modal(`<h3>Importación</h3><p>${r.creados.length} personas creadas${r.errores.length ? ', ' + r.errores.length + ' con error' : ''}.</p>
          <div class="lista">${r.creados.map(p => `<div class="item"><div class="t">${esc(p.nombre_visible)} <small>${esc(p.email)}</small></div>${p.wa_link ? `<a href="${esc(p.wa_link)}" target="_blank" rel="noopener">Enviar acceso por WhatsApp</a>` : '<small>sin celular</small>'}</div>`).join('')}
          ${r.errores.map(e => `<div class="item"><div class="d">Línea ${e.linea}: ${esc(e.error)}</div></div>`).join('')}</div>
          <div class="modal-acciones"><button class="primario" id="imp-cerrar">Listo</button></div>`, cc => cc.querySelector('#imp-cerrar').onclick = () => { cerrarModal(); verAdmin(); });
      };
    });
};

// — Módulos —
async function pintarModulosAdmin() {
  const r = await api('admin_modulos'); if (!r.ok) return toast(r.error, 'mal');
  $('admin-modulos').innerHTML = r.modulos.map(m => `<div class="item"><div class="t">${esc(m.icono)} ${esc(m.nombre)} <small>(${esc(m.codigo)} · ${esc(m.tipo)} · orden ${esc(m.orden)}${String(m.activo).toLowerCase().startsWith('s') ? '' : ' · INACTIVO'})</small></div>
    <div class="d">${esc(m.descripcion_corta || '')}<br><small>${esc(m.url || 'sin URL')}</small></div>
    <div class="acciones"><button class="chico" data-edit="${esc(m.codigo)}">Editar</button></div></div>`).join('');
  $('admin-modulos').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => formModulo(r.modulos.find(m => m.codigo === b.dataset.edit)));
}
$('btn-nuevo-modulo').onclick = () => formModulo({});
function formModulo(m) {
  const activo = m.activo === undefined ? true : String(m.activo).toLowerCase().startsWith('s');
  modal(`<h3>${m.codigo ? 'Editar módulo' : 'Nuevo módulo'}</h3><form id="f-mod" class="form">
    <label class="campo"><span>Código (sin espacios)</span><input id="m-codigo" value="${esc(m.codigo || '')}" ${m.codigo ? 'readonly' : ''} required style="text-transform:uppercase"></label>
    <label class="campo"><span>Nombre</span><input id="m-nombre" value="${esc(m.nombre || '')}" required></label>
    <label class="campo"><span>Descripción corta</span><input id="m-desc" value="${esc(m.descripcion_corta || '')}"></label>
    <label class="campo"><span>URL</span><input id="m-url" value="${esc(m.url || '')}" placeholder="https://…"></label>
    <label class="campo"><span>Cómo se abre</span><select id="m-tipo"><option value="iframe" ${m.tipo === 'iframe' ? 'selected' : ''}>Embebido dentro de la app (iframe)</option><option value="link" ${m.tipo === 'link' ? 'selected' : ''}>Link (misma pestaña)</option><option value="interno" ${m.tipo === 'interno' ? 'selected' : ''}>Interno de la app</option></select></label>
    <label class="campo"><span>Ícono (emoji)</span><input id="m-icono" value="${esc(m.icono || '📋')}" maxlength="4"></label>
    <label class="campo"><span>Orden</span><input id="m-orden" type="number" value="${esc(m.orden || 10)}"></label>
    <label class="campo"><span>Responsable (legajo)</span><select id="m-resp"><option value="">Nadie</option>${S.admin.usuarios.filter(u => u.activo).map(u => `<option value="${esc(u.legajo)}" ${String(u.legajo) === String(m.responsable_legajo) ? 'selected' : ''}>${esc(u.nombre_visible)}</option>`).join('')}</select></label>
    <label class="campo"><span>Celular del responsable (para el botón Consultar)</span><input id="m-cel" type="tel" value="${esc(m.responsable_celular || '')}"></label>
    <label class="check"><input id="m-activo" type="checkbox" ${activo ? 'checked' : ''}> Activo (visible en el inicio)</label>
    <div class="modal-acciones"><button type="button" class="secundario" id="m-cancelar">Cancelar</button><button type="submit" class="primario">Guardar</button></div></form>`,
    c => {
      c.querySelector('#m-cancelar').onclick = cerrarModal;
      c.querySelector('#m-resp').onchange = () => { const u = S.admin.usuarios.find(x => String(x.legajo) === c.querySelector('#m-resp').value); if (u && u.celular && !c.querySelector('#m-cel').value) c.querySelector('#m-cel').value = u.celular; };
      c.querySelector('#f-mod').onsubmit = async e => {
        e.preventDefault();
        const r = await api('admin_guardar_modulo', {
          codigo: c.querySelector('#m-codigo').value, nombre: c.querySelector('#m-nombre').value, descripcion_corta: c.querySelector('#m-desc').value,
          url: c.querySelector('#m-url').value, tipo: c.querySelector('#m-tipo').value, icono: c.querySelector('#m-icono').value, orden: c.querySelector('#m-orden').value,
          responsable_legajo: c.querySelector('#m-resp').value, responsable_celular: c.querySelector('#m-cel').value, activo: c.querySelector('#m-activo').checked
        });
        if (!r.ok) return toast(r.error, 'mal');
        toast('Módulo guardado', 'ok'); cerrarModal(); verAdmin();
      };
    });
}

// — Instructivos —
async function pintarInstructivos() {
  const sel = $('instr-modulo');
  const actual = sel.value;
  sel.innerHTML = '<option value="APP">APP (la app en general)</option>' + S.admin.modulos.map(m => `<option value="${esc(m.codigo)}">${esc(m.nombre)}</option>`).join('');
  sel.value = actual || 'APP';
  const r = await api('admin_instructivos', { modulo: sel.value }); if (!r.ok) return toast(r.error, 'mal');
  $('admin-instr').innerHTML = r.instructivos.map(i => `<div class="item"><div class="t">${esc(i.seccion || '(sin título)')}</div><div class="d">${esc(i.texto)}</div>
    <div class="acciones"><button class="chico" data-fila="${i.fila}">Editar</button></div></div>`).join('') || '<p class="vacio">Sin secciones todavía. El bot no va a saber explicar este módulo.</p>';
  $('admin-instr').querySelectorAll('[data-fila]').forEach(b => b.onclick = () => formInstructivo(r.instructivos.find(i => i.fila === +b.dataset.fila)));
}
$('instr-modulo').onchange = pintarInstructivos;
$('btn-nuevo-instr').onclick = () => formInstructivo({ modulo: $('instr-modulo').value });
function formInstructivo(i) {
  modal(`<h3>${i.fila ? 'Editar sección' : 'Nueva sección'} · ${esc(i.modulo)}</h3><form id="f-instr" class="form">
    <label class="campo"><span>Título de la sección</span><input id="i-seccion" value="${esc(i.seccion || '')}" placeholder="Cómo cargar un pedido"></label>
    <label class="campo"><span>Texto (en español llano, pasos concretos)</span><textarea id="i-texto" rows="7" required>${esc(i.texto || '')}</textarea></label>
    <div class="modal-acciones">${i.fila ? '<button type="button" class="peligro" id="i-borrar">Borrar</button>' : ''}<button type="button" class="secundario" id="i-cancelar">Cancelar</button><button type="submit" class="primario">Guardar</button></div></form>`,
    c => {
      c.querySelector('#i-cancelar').onclick = cerrarModal;
      if (i.fila) c.querySelector('#i-borrar').onclick = async () => { if (!await confirmar('Borrar sección', 'El bot deja de conocer este texto.', 'Borrar', true)) return; await api('admin_guardar_instructivo', { fila: i.fila, borrar: true }); cerrarModal(); pintarInstructivos(); };
      c.querySelector('#f-instr').onsubmit = async e => {
        e.preventDefault();
        const r = await api('admin_guardar_instructivo', { fila: i.fila, modulo: i.modulo, seccion: c.querySelector('#i-seccion').value, texto: c.querySelector('#i-texto').value });
        if (!r.ok) return toast(r.error, 'mal');
        toast('Guardado. El bot ya lo usa.', 'ok'); cerrarModal(); pintarInstructivos();
      };
    });
}

// — Bot —
async function pintarBot() {
  const r = await api('admin_stats_bot', { dias: 30 }); if (!r.ok) return toast(r.error, 'mal');
  const nombre = l => { const u = S.admin.usuarios.find(x => String(x.legajo) === String(l)); return u ? u.nombre_visible : l; };
  $('admin-bot').innerHTML = `<div class="kpis"><div class="kpi"><b>${r.total}</b><span>consultas (30 días)</span></div><div class="kpi"><b>${(r.tokens / 1000).toFixed(0)}k</b><span>tokens</span></div><div class="kpi"><b>${r.mal_valoradas.length}</b><span>con pulgar abajo</span></div></div>
    <p><b>Por módulo:</b> ${Object.keys(r.por_modulo).map(m => `<span class="chip">${esc(m)}: ${r.por_modulo[m]}</span>`).join('') || '—'}</p>
    ${r.mal_valoradas.length ? '<h3>Respuestas que no sirvieron</h3><div class="lista">' + r.mal_valoradas.map(c => `<div class="item"><div class="t">${esc(c.pregunta)}</div><div class="d">${esc(c.respuesta)}</div><small>${esc(nombre(c.legajo))} · ${esc(c.modulo || 'inicio')} · ${new Date(c.fecha).toLocaleDateString('es-AR')}</small></div>`).join('') + '</div>' : ''}
    <h3 style="margin-top:16px">Últimas consultas</h3><div class="lista">${r.ultimas.map(c => `<div class="item"><div class="t">${esc(c.pregunta)}</div><small>${esc(nombre(c.legajo))} · ${esc(c.modulo || 'inicio')} · ${new Date(c.fecha).toLocaleString('es-AR')} ${c.util ? '· ' + (String(c.util).startsWith('s') ? '👍' : '👎') : ''}</small></div>`).join('') || '<p class="vacio">Sin consultas todavía.</p>'}</div>`;
}

// — Enviar aviso —
function pintarFormAviso() {
  $('aviso-sector').innerHTML = S.admin.sectores.map(s => `<option>${esc(s)}</option>`).join('');
  $('aviso-modulo').innerHTML = S.admin.modulos.map(m => `<option value="${esc(m.codigo)}">${esc(m.nombre)}</option>`).join('');
  $('aviso-legajos').innerHTML = S.admin.usuarios.filter(u => u.activo).map(u => `<label><input type="checkbox" value="${esc(u.legajo)}">${esc(u.nombre_visible)}</label>`).join('');
  cambiarDestino();
}
function cambiarDestino() {
  const v = $('aviso-destino').value;
  $('aviso-campo-sector').hidden = v !== 'sector'; $('aviso-campo-modulo').hidden = v !== 'modulo'; $('aviso-campo-legajos').hidden = v !== 'legajos';
}
$('aviso-destino').onchange = cambiarDestino;
$('form-aviso').onsubmit = async e => {
  e.preventDefault();
  const v = $('aviso-destino').value;
  let destinatarios;
  if (v === 'todos') destinatarios = { legajos: S.admin.usuarios.filter(u => u.activo).map(u => u.legajo) };
  else if (v === 'sector') destinatarios = { sector: $('aviso-sector').value };
  else if (v === 'modulo') destinatarios = { rol: null, modulo: $('aviso-modulo').value, legajos: S.admin.usuarios.filter(u => u.activo && u.modulos.some(m => m.modulo === $('aviso-modulo').value)).map(u => u.legajo) };
  else destinatarios = { legajos: [...$('aviso-legajos').querySelectorAll('input:checked')].map(i => i.value) };
  const critico = $('aviso-critico').checked;
  if (!await confirmar('Enviar aviso', `Se envía a ${v === 'todos' ? 'todas las personas activas' : v === 'sector' ? 'el sector ' + $('aviso-sector').value : v === 'modulo' ? 'quienes tienen ' + $('aviso-modulo').value : (destinatarios.legajos.length + ' personas')}${critico ? ', también por WhatsApp' : ''}.`, 'Enviar')) return;
  const r = await api('admin_aviso', { destinatarios, modulo: v === 'modulo' ? $('aviso-modulo').value : 'APP', titulo: $('aviso-titulo').value, cuerpo: $('aviso-cuerpo').value, url_destino: $('aviso-url').value, prioridad: critico ? 'critica' : 'normal' });
  if (!r.ok) return toast(r.error, 'mal');
  toast('Aviso enviado a ' + r.avisos.length + ' persona' + (r.avisos.length === 1 ? '' : 's'), 'ok');
  $('form-aviso').reset(); cambiarDestino();
};

// ───────────────────────── Arranque ─────────────────────────
(async function arrancar() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
    navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.tipo === 'push') refrescar(true); });
  }
  if (!S.token) { mostrarVista('login'); return; }
  // Arranque rápido con el perfil cacheado; se valida en segundo plano.
  try { S.perfil = JSON.parse(localStorage.getItem('ingeco_perfil') || 'null'); } catch (e) { S.perfil = null; }
  if (S.perfil) { entrar(); return; }
  const r = await api('perfil');
  if (!r.ok) { cerrarSesionLocal(); mostrarVista('login'); return; }
  guardarPerfil(r);
  entrar();
})();
