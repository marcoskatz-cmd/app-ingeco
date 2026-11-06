/* IngeBot — asistente flotante de App INGECO.
   FAB arrastrable (se pega al borde), ocultable (presión larga o botón), saludo animado una vez por
   sesión, panel de chat que hace UN POST por pregunta al backend (bot_preguntar). Sin frameworks.
   Depende de app.js: api(), esc(), irA(), toast(), S.perfil. Expone window.IngeBot. */
'use strict';

(function () {
  const POS_KEY = 'ingebot_pos', OCULTO_KEY = 'ingebot_oculto', CONV_KEY = 'ingebot_conv', SALUDO_KEY = 'ingebot_saludado';
  const UMBRAL_ARRASTRE = 8, PRESION_LARGA_MS = 600, SALUDO_MS = 6000, HISTORIAL = 12;
  const CHIPS_POR_MODULO = {
    ASFALTO: ['¿Cuánto asfalto hay en tanque?', 'Mezcla despachada esta semana'],
    TARJAS: ['¿Qué equipos tuvieron tarja hoy?', '¿Dónde está el equipo…?'],
    TARJA: ['¿Qué equipos tuvieron tarja hoy?'],
    COMPRAS: ['OC pendientes de esta semana', '¿Qué está esperando Gerencia?'],
    AUTOVIAS: ['Producción de Autovías este mes', 'Toneladas por día en octubre'],
    EXPEDIENTES: ['Expedientes quietos hace más de 30 días', '¿Dónde está el expediente de…?'],
    DASHBOARD: ['¿Cuánto se cobró este mes?', 'OC de insumos por obra']
  };

  // Cara de IngeBot: ilustración generada por Marcos (5-nov-2026), PNG con fondo transparente.
  const CARA = `<img class="ib-cara" src="ingebot-128.png" srcset="ingebot-128.png 1x, ingebot.png 4x" alt="" draggable="false">`;
  const BRAZO = `<svg class="ib-brazo" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V9a3 3 0 0 1 6 0v3l5-6"/></svg>`;

  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } }, del: k => { try { localStorage.removeItem(k); } catch (e) { } } };
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { } }, del: k => { try { sessionStorage.removeItem(k); } catch (e) { } } };
  const reducido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const E = {};           // elementos
  let perfil = null, conv = [], ocupado = false, ctxModulo = '', abierto = false, iniciado = false;
  let pos = null;         // {lado:'der'|'izq', y}
  let posGuardada = false; // false = posición por defecto (se recalcula al cambiar el tamaño de la ventana)

  // ── Markdown mínimo → HTML seguro (escapa todo primero, marca después) ──
  function md(texto) {
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>');
    const lines = String(texto || '').replace(/\r/g, '').split('\n');
    let out = '', i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|/.test(l)) {
        const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const body = rows.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
        if (body.length) {
          out += '<div class="ib-tabla-wrap"><table class="ib-tabla"><thead><tr>' + cells(body[0]).map(c => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>';
          body.slice(1).forEach(r => { out += '<tr>' + cells(r).map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>'; });
          out += '</tbody></table></div>';
        }
        continue;
      }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        out += '<ul>'; while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { out += '<li>' + inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')) + '</li>'; i++; }
        out += '</ul>'; continue;
      }
      if (/^\s*#{1,6}\s+/.test(l)) { out += '<p><b>' + inline(l.replace(/^\s*#{1,6}\s+/, '')) + '</b></p>'; i++; continue; }
      if (l.trim() === '') { i++; continue; }
      let p = inline(l); i++;
      while (i < lines.length && lines[i].trim() !== '' && !/^\s*(\||[-*•]|\d+[.)]\s|#)/.test(lines[i])) { p += '<br>' + inline(lines[i]); i++; }
      out += '<p>' + p + '</p>';
    }
    return out;
  }

  // ── Construcción ──
  function construir() {
    const raiz = document.getElementById('ingebot');
    if (!raiz || E.fab) return;
    raiz.innerHTML = `
      <button id="ib-fab" class="ib-fab" type="button" aria-label="Abrir IngeBot" title="IngeBot">${CARA}${BRAZO}<span id="ib-badge" class="ib-badge" hidden></span></button>
      <div id="ib-globo" class="ib-globo" role="status" hidden></div>
      <button id="ib-pestana" class="ib-pestana" type="button" aria-label="Mostrar IngeBot" hidden>${CARA}</button>
      <section id="ib-panel" class="ib-panel" role="dialog" aria-label="IngeBot" hidden>
        <header class="ib-head">
          <span class="ib-head-cara">${CARA}</span>
          <div class="ib-head-t"><b>IngeBot</b><small id="ib-sub"></small></div>
          <span id="ib-cupo" class="ib-cupo"></span>
          <button id="ib-nueva" class="icono chico" type="button" aria-label="Nueva conversación" title="Nueva conversación"><svg class="i" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 2.3 5.7M4 20v-5h5"/></svg></button>
          <button id="ib-ocultar" class="icono chico" type="button" aria-label="Ocultar IngeBot" title="Ocultar"><svg class="i" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6A2 2 0 0 0 13.4 13.4M9.9 5.1A10 10 0 0 1 21 12a10.7 10.7 0 0 1-2.6 3.6M6.1 6.1A10.7 10.7 0 0 0 3 12a10 10 0 0 0 13.6 5.4"/></svg></button>
          <button id="ib-cerrar" class="icono chico" type="button" aria-label="Cerrar"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        </header>
        <div id="ib-chips" class="ib-chips"></div>
        <div id="ib-log" class="ib-log"></div>
        <form id="ib-form" class="ib-form">
          <input id="ib-input" type="text" placeholder="Preguntale a IngeBot…" autocomplete="off" enterkeyhint="send" maxlength="2000">
          <button type="submit" class="primario" aria-label="Enviar"><svg class="i" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>
        </form>
      </section>`;
    ['fab', 'badge', 'globo', 'pestana', 'panel', 'sub', 'cupo', 'nueva', 'ocultar', 'cerrar', 'chips', 'log', 'form', 'input'].forEach(k => { E[k] = document.getElementById('ib-' + k); });
    E.nueva.onclick = nuevaConversacion;
    E.ocultar.onclick = () => ocultar();
    E.cerrar.onclick = cerrar;
    E.pestana.onclick = () => mostrar();
    E.form.onsubmit = e => { e.preventDefault(); const q = E.input.value.trim(); if (q) { E.input.value = ''; preguntar(q); } };
    E.globo.onclick = () => { esconderGlobo(); abrir(); };
    instalarArrastre();
    window.addEventListener('resize', () => aplicarPos());
  }

  // ── Posición / arrastre ──
  function limites() {
    const nav = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 62;
    return { minY: 70, maxY: Math.max(90, window.innerHeight - nav - 70) };
  }
  function aplicarPos() {
    if (!E.fab) return;
    const l = limites();
    if (!pos || !posGuardada) { pos = { lado: 'der', y: l.maxY - 10 }; }
    pos.y = Math.min(l.maxY, Math.max(l.minY, pos.y));
    [E.fab, E.pestana, E.globo].forEach(el => { el.style.top = pos.y + 'px'; el.classList.toggle('izq', pos.lado === 'izq'); el.classList.toggle('der', pos.lado !== 'izq'); });
    E.fab.style.left = ''; E.fab.style.transform = '';
  }
  function instalarArrastre() {
    let origen = null, arrastrando = false, timerLargo = null;
    const fab = E.fab;
    fab.addEventListener('pointerdown', e => {
      if (e.button && e.button !== 0) return;
      origen = { x: e.clientX, y: e.clientY, top: pos.y, left: fab.getBoundingClientRect().left };
      arrastrando = false;
      clearTimeout(timerLargo);
      timerLargo = setTimeout(() => { if (!arrastrando) { origen = null; ocultar(); } }, PRESION_LARGA_MS);
    });
    fab.addEventListener('pointermove', e => {
      if (!origen) return;
      const dx = e.clientX - origen.x, dy = e.clientY - origen.y;
      if (Math.hypot(dx, dy) > 4) clearTimeout(timerLargo);   // se movió: ya no es presión larga
      if (!arrastrando && Math.hypot(dx, dy) > UMBRAL_ARRASTRE) { arrastrando = true; clearTimeout(timerLargo); fab.classList.add('ib-arrastrando'); try { fab.setPointerCapture(e.pointerId); } catch (err) { } }
      if (!arrastrando) return;
      fab.style.top = (origen.top + dy) + 'px';
      fab.style.left = (origen.left + dx) + 'px';
      fab.style.right = 'auto';
    });
    const soltar = e => {
      clearTimeout(timerLargo);
      if (!origen) return;
      const fue = arrastrando; origen = null;
      fab.classList.remove('ib-arrastrando');
      if (fue) {
        const r = fab.getBoundingClientRect();
        pos = { lado: (r.left + r.width / 2) < window.innerWidth / 2 ? 'izq' : 'der', y: Math.round(r.top) };
        fab.style.right = ''; fab.style.left = '';
        aplicarPos();
        posGuardada = true;
        ls.set(POS_KEY, JSON.stringify(pos));
      } else {
        abierto ? cerrar() : abrir();
      }
    };
    fab.addEventListener('pointerup', soltar);
    fab.addEventListener('pointercancel', () => { clearTimeout(timerLargo); origen = null; arrastrando = false; fab.classList.remove('ib-arrastrando'); aplicarPos(); });
    fab.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Mostrar / ocultar ──
  function ocultar() {
    cerrar();
    E.fab.hidden = true; E.pestana.hidden = false; esconderGlobo();
    ls.set(OCULTO_KEY, '1');
    const btn = document.getElementById('btn-mostrar-ingebot'); if (btn) btn.hidden = false;
  }
  function mostrar() {
    E.pestana.hidden = true; E.fab.hidden = false;
    ls.del(OCULTO_KEY);
    const btn = document.getElementById('btn-mostrar-ingebot'); if (btn) btn.hidden = true;
  }
  function esconderGlobo() { E.globo.hidden = true; E.fab.classList.remove('ib-saludando'); }

  async function saludar() {
    if (ss.get(SALUDO_KEY)) return;
    ss.set(SALUDO_KEY, '1');
    if (!reducido()) E.fab.classList.add('ib-saludando');
    const r = await api('bot_saludo', {}, { silencioso: true });
    if (!r.ok || E.fab.hidden || abierto) { E.fab.classList.remove('ib-saludando'); return; }
    E.globo.textContent = r.texto;
    E.globo.hidden = false;
    setTimeout(esconderGlobo, SALUDO_MS);
  }

  // ── Chat ──
  function cargarConv() { try { conv = JSON.parse(ss.get(CONV_KEY) || '[]'); } catch (e) { conv = []; } }
  function guardarConv() { ss.set(CONV_KEY, JSON.stringify(conv.slice(-40))); }
  function chips() {
    const mods = ((perfil && perfil.modulos) || []).map(m => m.codigo);
    const lista = [];
    (ctxModulo ? [ctxModulo].concat(mods) : mods).forEach(c => (CHIPS_POR_MODULO[c] || []).forEach(t => { if (lista.indexOf(t) < 0) lista.push(t); }));
    if (!lista.length) lista.push('¿Qué módulos tengo?', '¿Cómo instalo la app?');
    E.chips.innerHTML = lista.slice(0, 6).map(t => `<button type="button" class="ib-chip">${esc(t)}</button>`).join('');
    E.chips.querySelectorAll('button').forEach(b => b.onclick = () => { if (/…$/.test(b.textContent)) { E.input.value = b.textContent.replace(/…$/, ' '); E.input.focus(); } else preguntar(b.textContent); });
    E.chips.hidden = conv.length > 0;
  }
  function pintarCupo(c) {
    if (!c) { E.cupo.textContent = ''; E.badge.hidden = true; return; }
    if (c.sin_tope) { E.cupo.textContent = ''; E.badge.hidden = true; return; }
    const quedan = Math.max(0, c.max - c.usadas);
    E.cupo.textContent = 'quedan ' + quedan;
    E.cupo.classList.toggle('poco', quedan <= 5);
    E.badge.hidden = quedan > 5; E.badge.textContent = quedan;
  }
  function pintarLog() {
    E.log.innerHTML = conv.map((m, i) => {
      if (m.rol === 'usuario') return `<div class="ib-msg ib-usuario">${esc(m.texto)}</div>`;
      const fuentes = (m.fuentes || []).map(f => {
        const mods = (perfil && perfil.modulos) || [];
        const mod = mods.find(x => x.codigo === f.modulo) || (f.modulo === 'TARJAS' ? mods.find(x => x.codigo === 'TARJA') : null);
        const label = esc((mod ? mod.nombre : f.modulo) + ' · ' + (f.tabla || f.fuente));
        return mod && mod.url ? `<a class="ib-fuente" href="#modulo/${encodeURIComponent(mod.codigo)}">${label}</a>` : `<span class="ib-fuente">${label}</span>`;
      }).join('');
      const val = m.fila ? `<span class="ib-valorar"><button type="button" data-v="1" data-i="${i}" class="${m.util === true ? 'elegido' : ''}" aria-label="Me sirvió"><svg class="i" viewBox="0 0 24 24"><path d="M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2.3l-1 6a2 2 0 0 1-2 1.7H7"/></svg></button><button type="button" data-v="0" data-i="${i}" class="${m.util === false ? 'elegido' : ''}" aria-label="No me sirvió"><svg class="i" viewBox="0 0 24 24"><path d="M17 13V4h3v9zM17 13l-4 7a2 2 0 0 1-2-2v-4H6a2 2 0 0 1-2-2.3l1-6A2 2 0 0 1 7 4h10"/></svg></button></span>` : '';
      return `<div class="ib-msg ib-bot ${m.error ? 'ib-error' : ''}">${md(m.texto)}${fuentes || val ? `<div class="ib-pie">${fuentes}${val}</div>` : ''}</div>`;
    }).join('') + (ocupado ? '<div class="ib-msg ib-bot ib-pensando"><span class="ib-dots"><i></i><i></i><i></i></span></div>' : '');
    E.log.scrollTop = E.log.scrollHeight;
    E.log.querySelectorAll('.ib-valorar button').forEach(b => b.onclick = async () => {
      const m = conv[+b.dataset.i]; m.util = b.dataset.v === '1'; guardarConv(); pintarLog();
      await api('bot_valorar', { fila: m.fila, util: m.util }, { silencioso: true });
    });
    E.chips.hidden = conv.length > 0;
  }
  async function preguntar(texto) {
    if (ocupado || !texto) return;
    ocupado = true;
    conv.push({ rol: 'usuario', texto }); guardarConv(); pintarLog();
    E.sub.textContent = 'pensando…';
    const conversacion = conv.slice(0, -1).filter(m => !m.error).slice(-HISTORIAL).map(m => ({ rol: m.rol, texto: m.texto }));
    const r = await api('bot_preguntar', { pregunta: texto, conversacion, modulo_contexto: ctxModulo }, { silencioso: true });
    ocupado = false;
    E.sub.textContent = '';
    if (r.ok) {
      conv.push({ rol: 'bot', texto: r.texto, fuentes: r.fuentes || [], fila: r.fila, limite: !!r.limite });
      if (r.cupo) pintarCupo(r.cupo);
      if (r.limite) { E.input.disabled = true; E.input.placeholder = 'Cupo de hoy agotado'; }
    } else {
      conv.push({ rol: 'bot', texto: r.error || 'No pude responder.', error: true });
      if (r.sin_permiso) { E.input.disabled = true; E.input.placeholder = 'Sin acceso a IngeBot'; }
    }
    guardarConv(); pintarLog();
  }
  function habilitarInput() { E.input.disabled = false; E.input.placeholder = 'Preguntale a IngeBot…'; }
  function nuevaConversacion() { conv = []; ss.del(CONV_KEY); habilitarInput(); chips(); pintarLog(); E.input.focus(); }

  // ── Abrir / cerrar ──
  function abrir(moduloCtx) {
    if (!iniciado) return;
    if (E.fab.hidden) mostrar();
    esconderGlobo();
    ctxModulo = moduloCtx || (typeof S !== 'undefined' && S.moduloActual && S.moduloActual.codigo) || '';
    abierto = true;
    E.panel.hidden = false; E.fab.classList.add('ib-abierto');
    E.sub.textContent = ctxModulo ? 'sobre ' + ctxModulo : '';
    chips(); pintarLog();
    if (perfil && perfil.bot) pintarCupo(perfil.bot);
    setTimeout(() => E.input.focus(), 120);
  }
  function cerrar() { abierto = false; if (E.panel) { E.panel.hidden = true; E.fab.classList.remove('ib-abierto'); } }

  // ── Ciclo de vida ──
  function iniciar(p) {
    perfil = p;
    construir();
    if (!E.fab) return;
    const hab = !!(p && p.bot && p.bot.habilitado);
    const raiz = document.getElementById('ingebot');
    raiz.hidden = !hab;
    iniciado = hab;
    if (!hab) { cerrar(); return; }
    try { pos = JSON.parse(ls.get(POS_KEY) || 'null'); } catch (e) { pos = null; }
    posGuardada = !!(pos && pos.lado && typeof pos.y === 'number');
    aplicarPos();
    cargarConv();
    if (ls.get(OCULTO_KEY)) { E.fab.hidden = true; E.pestana.hidden = false; } else { E.fab.hidden = false; E.pestana.hidden = true; }
    pintarCupo(p.bot);
    if (p.bot.sin_tope || p.bot.usadas < p.bot.max) habilitarInput();
    if (!E.fab.hidden) saludar();
    const btn = document.getElementById('btn-mostrar-ingebot'); if (btn) btn.hidden = !E.fab.hidden;
  }
  function apagar() {
    iniciado = false; perfil = null; conv = []; ss.del(CONV_KEY); ss.del(SALUDO_KEY);
    cerrar();
    const raiz = document.getElementById('ingebot'); if (raiz) raiz.hidden = true;
  }

  window.IngeBot = { iniciar, abrir, cerrar, apagar, mostrar, ocultar };
})();
