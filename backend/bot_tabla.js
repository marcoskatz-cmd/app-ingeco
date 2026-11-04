/**
 * bot_tabla.js — filtros, orden, agregaciones y búsqueda sobre filas en memoria.
 * Funciones puras (sin Sheets): lo que Claude pide como argumentos se interpreta acá,
 * nunca se evalúa como código.
 */

function sinAcentos_(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** '1.234,5' → 1234.5 · '1234.5' → 1234.5 · '$ 2.500' → 2500 · '' → null. */
function numero_(v) {
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[^\d,.\-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const tienePunto = s.indexOf('.') >= 0, tieneComa = s.indexOf(',') >= 0;
  if (tienePunto && tieneComa) {
    // El último separador es el decimal.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (tieneComa) {
    s = s.replace(',', '.');
  } else if (tienePunto) {
    // Un solo punto con exactamente 3 dígitos después → separador de miles ("2.500").
    const partes = s.split('.');
    if (partes.length > 2 || (partes.length === 2 && partes[1].length === 3)) s = partes.join('');
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

const FECHA_RE_ = /^(\d{4})-(\d{2})-(\d{2})/;

/** Valor comparable: fecha ISO → epoch; número → número; resto → texto normalizado. null si vacío. */
function comparable_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const m = FECHA_RE_.exec(s);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const n = numero_(s);
  if (n !== null && /^[\d.,\-\s$]+$/.test(s)) return n;
  return sinAcentos_(s);
}

function cumple_(fila, f) {
  const op = String(f.op || '=').toLowerCase();
  const v = fila[f.col];
  if (op === 'contiene') return sinAcentos_(v).indexOf(sinAcentos_(f.valor)) >= 0;
  if (op === 'en') return (Array.isArray(f.valor) ? f.valor : [f.valor]).some(x => iguales_(v, x));
  if (op === '=' || op === '==') return iguales_(v, f.valor);
  if (op === '!=' || op === '<>') return !iguales_(v, f.valor);
  const a = comparable_(v);
  if (a === null) return false;
  if (op === 'entre') {
    const lo = comparable_(f.valor[0]), hi = comparable_(f.valor[1]);
    return lo !== null && hi !== null && a >= lo && a <= hi;
  }
  const b = comparable_(f.valor);
  if (b === null) return false;
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  if (op === '>=') return a >= b;
  if (op === '<=') return a <= b;
  return false;
}

function iguales_(a, b) {
  const ca = comparable_(a), cb = comparable_(b);
  if (ca === null || cb === null) return ca === cb;
  if (typeof ca === 'number' && typeof cb === 'number') return ca === cb;
  return sinAcentos_(a) === sinAcentos_(b);
}

/** filtros: [{col, op, valor}] con op ∈ {=, !=, contiene, >, <, >=, <=, entre, en}. Todos deben cumplirse. */
function aplicarFiltros_(filas, filtros) {
  if (!filtros || !filtros.length) return filas;
  return filas.filter(f => filtros.every(x => x && x.col && cumple_(f, x)));
}

function ordenarFilas_(filas, orden) {
  if (!orden || !orden.col) return filas;
  const dir = String(orden.dir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return filas.slice().sort((a, b) => {
    const ca = comparable_(a[orden.col]), cb = comparable_(b[orden.col]);
    if (ca === null && cb === null) return 0;
    if (ca === null) return 1;
    if (cb === null) return -1;
    if (ca < cb) return -dir;
    if (ca > cb) return dir;
    return 0;
  });
}

/** agrupar_por: string[] · metrica: {col, fn} con fn ∈ {sum, count, avg, min, max}. Devuelve [{...grupo, valor, n}]. */
function resumir_(filas, agruparPor, metrica) {
  const fn = String((metrica && metrica.fn) || 'count').toLowerCase();
  const col = metrica && metrica.col;
  const grupos = {};
  const orden = [];
  filas.forEach(f => {
    const clave = (agruparPor || []).map(c => String(f[c] === undefined ? '' : f[c])).join('\u0001');
    if (!grupos[clave]) {
      grupos[clave] = { grupo: {}, n: 0, suma: 0, cuenta: 0, min: null, max: null };
      (agruparPor || []).forEach(c => { grupos[clave].grupo[c] = f[c] === undefined ? '' : f[c]; });
      orden.push(clave);
    }
    const g = grupos[clave];
    g.n++;
    if (fn !== 'count') {
      const v = numero_(f[col]);
      if (v !== null) {
        g.suma += v; g.cuenta++;
        g.min = g.min === null ? v : Math.min(g.min, v);
        g.max = g.max === null ? v : Math.max(g.max, v);
      }
    }
  });
  return orden.map(k => {
    const g = grupos[k];
    let valor;
    if (fn === 'count') valor = g.n;
    else if (fn === 'sum') valor = Math.round(g.suma * 1000) / 1000;
    else if (fn === 'avg') valor = g.cuenta ? Math.round((g.suma / g.cuenta) * 1000) / 1000 : null;
    else if (fn === 'min') valor = g.min;
    else if (fn === 'max') valor = g.max;
    else valor = g.n;
    return Object.assign({}, g.grupo, { valor, n: g.n });
  });
}

/** Filas donde alguna columna de texto contiene el texto (sin acentos ni mayúsculas). */
function buscarTexto_(filas, texto) {
  const t = sinAcentos_(texto);
  if (!t) return [];
  return filas.filter(f => Object.keys(f).some(k => typeof f[k] === 'string' && sinAcentos_(f[k]).indexOf(t) >= 0));
}
