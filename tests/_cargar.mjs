// Carga archivos de backend/ (Apps Script, sin módulos) en un contexto Node con
// stubs de los servicios de Google. Los tests configuran los stubs que necesitan.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');

export function stubs(extra) {
  const props = {};
  const cache = new Map();
  const hojas = {};       // { spreadsheetId: { nombreHoja: [[fila], ...] } }
  const abiertas = [];    // ids abiertos con openById (para verificar que NO se abra algo)
  const base = {
    console,
    marca_: () => { },
    __props: props, __cache: cache, __hojas: hojas, __abiertas: abiertas,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = v; },
        setProperties: o => Object.assign(props, o),
        getProperties: () => Object.assign({}, props)
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => (cache.has(k) ? cache.get(k) : null),
        put: (k, v) => { cache.set(k, v); },
        remove: k => { cache.delete(k); },
        removeAll: ks => ks.forEach(k => cache.delete(k)),
        getAll: ks => { const o = {}; ks.forEach(k => { if (cache.has(k)) o[k] = cache.get(k); }); return o; },
        putAll: o => Object.keys(o).forEach(k => cache.set(k, o[k]))
      })
    },
    SpreadsheetApp: {
      openById: id => {
        abiertas.push(id);
        const ss = hojas[id];
        if (!ss) throw new Error('No se encontró la planilla ' + id);
        const hoja = nombre => ({
          getName: () => nombre,
          getLastRow: () => ss[nombre].length,
          getLastColumn: () => Math.max(...ss[nombre].map(f => f.length), 1),
          getDataRange: () => ({ getValues: () => ss[nombre].map(f => f.slice()) }),
          getRange: (r, c, nr, nc) => ({ getValues: () => ss[nombre].slice(r - 1, r - 1 + nr).map(f => f.slice(c - 1, c - 1 + nc)) })
        });
        return {
          getId: () => id,
          getName: () => 'Planilla ' + id,
          getSheetByName: n => (ss[n] ? hoja(n) : null),
          getSheets: () => Object.keys(ss).map(hoja)
        };
      }
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const p = n => String(n).padStart(2, '0');
        const s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        return fmt.indexOf('HH') >= 0 ? s + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) : s;
      },
      getUuid: () => 'uuid-' + Math.random().toString(36).slice(2)
    },
    LockService: { getScriptLock: () => ({ waitLock: () => { }, releaseLock: () => { } }) }
  };
  return Object.assign(base, extra || {});
}

/** Evalúa los archivos en un contexto nuevo y devuelve el contexto (las funciones top-level quedan como propiedades). */
export function cargar(archivos, globals) {
  const ctx = vm.createContext(globals || stubs());
  for (const a of archivos) {
    const src = fs.readFileSync(path.join(RAIZ, a), 'utf8');
    vm.runInContext(src, ctx, { filename: a });
  }
  return ctx;
}

/** Lee una const/let top-level del contexto (no quedan en el global object). */
export function valor(ctx, expr) { return vm.runInContext(expr, ctx); }

/** Planilla APP_INGECO mínima: hojas con encabezados del esquema y filas opcionales. */
export function appIngeco(g, filas) {
  g.__props.SPREADSHEET_ID = 'APP';
  const enc = {
    USUARIOS: ['legajo', 'nombre_visible', 'email', 'sector', 'celular', 'activo', 'creado_por', 'fecha_alta', 'ultimo_ingreso', 'tipo', 'areas', 'obra', 'token_lector'],
    MODULOS: ['codigo', 'nombre', 'descripcion_corta', 'url', 'tipo', 'icono', 'orden', 'activo', 'responsable_legajo', 'responsable_celular'],
    PERMISOS: ['legajo', 'modulo', 'rol', 'otorgado_por', 'fecha'],
    INSTRUCTIVOS: ['modulo', 'seccion', 'texto', 'actualizado'],
    CONSULTAS_BOT: ['fecha', 'legajo', 'modulo_contexto', 'pregunta', 'respuesta', 'tokens', 'util', 'fuentes', 'vueltas', 'ms'],
    SESIONES: ['token', 'legajo', 'dispositivo', 'creada', 'ultimo_uso', 'expira'],
    AVISOS: ['id', 'fecha', 'legajo', 'modulo', 'tipo', 'titulo', 'cuerpo', 'url_destino', 'prioridad', 'canales_enviados', 'leido', 'fecha_leido', 'comunicado_id', 'clave_unica']
  };
  const ss = {};
  Object.keys(enc).forEach(h => {
    const fs_ = (filas && filas[h]) || [];
    ss[h] = [enc[h]].concat(fs_.map(o => enc[h].map(c => (o[c] === undefined ? '' : o[c]))));
  });
  g.__hojas.APP = ss;
  return g;
}
