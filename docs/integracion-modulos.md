# Integración de los módulos existentes

> **14-oct-2026 — Acceso por ticket.** La app ya no manda su token en la URL. Al abrir un módulo pide un **ticket
> de un solo uso (5 min)** y lo pone en `?tk=…`. El módulo lo canjea con `validar_ticket` y recibe la identidad más
> una **sesión de módulo** (`sesion`, 12 h, no consumible) que su backend puede verificar con `validar_sesion_modulo`.
> Un link copiado y abierto por fuera no entra (ticket usado o vencido).
>
> **Sistemas estáticos (GitHub Pages)**: basta con `<script src="https://marcoskatz-cmd.github.io/app-ingeco/guard.js" data-modulo="CODIGO"></script>`
> en el `<head>`. `guard.js` canjea el ticket, guarda la identidad en `sessionStorage`, expone `window.INGECO_USUARIO`
> y `window.INGECO_SESION`, y tapa la página si no hay acceso. Ya está en INGECOV, PAVIMAX (×2), Trituración, Tarja,
> Demarcación (×2), Baches, Licitaciones y Locales Terminal. INGECOV saltea su PIN si `INGECO_USUARIO` existe; Locales
> Terminal manda `ingeco_sesion` en cada pedido y su backend la verifica.
>
> Contratos: `POST {accion:"validar_ticket", payload:{ticket, modulo}}` → `{ok, legajo, nombre_visible, email, sector, rol_en_modulo, modulos, es_admin, sesion}` (una sola vez).
> `POST {accion:"validar_sesion_modulo", payload:{sesion, modulo}}` → lo mismo sin `sesion`, mientras no venza.
> Lo que sigue describe el contrato anterior (`?t=` + `validar_token`), que sigue existiendo para módulos ya integrados pero no debe usarse en nuevos.

Cada módulo necesita un cambio chico (aceptar el token del shell) y uno opcional (llamar a `notificar()`).

## 1. Aceptar el token (módulos Apps Script embebidos: INGECOV, Combustible, Tarja, Ropa)

El shell abre el módulo en un iframe con `?t=<token>&legajo=<legajo>` y además le manda `postMessage({tipo:'ingeco_token', token, legajo, modulo})` al cargar. El módulo valida el token **una vez por sesión** contra el backend común y cachea el resultado en memoria (no en localStorage: cada apertura trae token fresco).

### Lado cliente del módulo (HTML)

```js
const APP_INGECO_BACKEND = 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec';
let usuarioShell = null;

async function validarTokenShell(token, modulo) {
  const r = await fetch(APP_INGECO_BACKEND, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ accion: 'validar_token', token, modulo })
  });
  const j = await r.json();
  return j.ok ? j : null;   // {legajo, nombre_visible, email, sector, rol_en_modulo}
}

(async () => {
  const t = new URLSearchParams(location.search).get('t');
  if (t) usuarioShell = await validarTokenShell(t, 'INGECOV');
  if (usuarioShell) {
    // Ya sabemos quién es: NO pedir PIN propio, saltar directo a la pantalla principal.
    iniciarComo(usuarioShell.legajo, usuarioShell.nombre_visible, usuarioShell.rol_en_modulo);
  } else {
    // Sin token: seguir como hoy (login propio o acceso libre).
    iniciarComoSiempre();
  }
})();

// Opcional: botones que hablan con el shell
function pedirAyudaAlShell() { parent.postMessage({ tipo: 'ingeco_ayuda' }, '*'); }
function volverAlShell()     { parent.postMessage({ tipo: 'ingeco_volver' }, '*'); }
```

> Ropa de trabajo: hoy pide PIN por legajo. Con token válido, confiar en `legajo` y no pedir PIN. Sin token, pedirlo como siempre.
> El token del shell nace de la cuenta de Google de INGECO, así que `email` también viene verificado.

### Pedidos de compra (Vercel, JWT propio) — `tipo = link`

El shell abre `https://pedidos-ingeco.vercel.app/?t=<token>`. Agregar un endpoint `api/sesion-shell.js`:

```js
// POST {token} → valida contra el backend común y emite el JWT propio
export default async function handler(req, res) {
  const { token } = req.body || {};
  const r = await fetch(process.env.APP_INGECO_BACKEND, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ accion: 'validar_token', token, modulo: 'COMPRAS' })
  }).then(r => r.json());
  if (!r.ok) return res.status(401).json({ ok: false, error: r.error });
  const usuario = await buscarUsuarioPorLegajo(r.legajo);     // tabla propia de usuarios
  if (!usuario) return res.status(403).json({ ok: false, error: 'No estás dado de alta en Pedidos' });
  return res.json({ ok: true, jwt: emitirJWT(usuario) });
}
```

El PIN propio de pedidos-compra queda como **segundo factor al firmar**, no para entrar.

## 2. Disparar avisos con `notificar()`

Desde Apps Script (INGECOV, Combustible, Tarja, Ropa):

```js
const APP_INGECO = { url: 'https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec' };

function notificarAppIngeco(aviso) {
  const clave = PropertiesService.getScriptProperties().getProperty('CLAVE_SISTEMA_APP_INGECO');
  const r = UrlFetchApp.fetch(APP_INGECO.url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ accion: 'notificar', clave_sistema: clave }, aviso))
  });
  return JSON.parse(r.getContentText());
}

// Ejemplo INGECOV: service vencido
notificarAppIngeco({
  modulo: 'INGECOV',
  destinatarios: [{ rol: 'TALLER' }, equipo.responsable_legajo],
  tipo: 'aviso_general',
  titulo: 'Service vencido: ' + equipo.interno,
  cuerpo: equipo.descripcion + ' pasó las ' + equipo.horas_service + ' h sin service.',
  url_destino: 'https://marcoskatz-cmd.github.io/ingecov/#equipo/' + equipo.interno,
  prioridad: 'normal'
});

// Ejemplo documentación a 3 días (crítica → también WhatsApp)
notificarAppIngeco({
  modulo: 'INGECOV', destinatarios: [{ sector: 'Administración' }, { admin: true }],
  tipo: 'vencimiento_doc', titulo: 'Vence el seguro de ' + equipo.interno + ' en 3 días',
  cuerpo: 'Póliza ' + doc.numero + ' vence el ' + doc.vence, url_destino: '...', prioridad: 'critica'
});
```

Desde Node (pedidos-compra):

```js
await fetch(process.env.APP_INGECO_BACKEND, {
  method: 'POST', headers: { 'Content-Type': 'text/plain' },
  body: JSON.stringify({
    accion: 'notificar', clave_sistema: process.env.CLAVE_SISTEMA_APP_INGECO, modulo: 'COMPRAS',
    destinatarios: [orden.solicitante_legajo], tipo: 'pedido_pendiente',
    titulo: 'Tu pedido ' + orden.numero + ' fue autorizado',
    cuerpo: 'Monto $' + orden.total + '. Compras ya puede emitir la orden.',
    url_destino: 'https://pedidos-ingeco.vercel.app/#oc/' + orden.id, prioridad: 'normal'
  })
});
```

### `destinatarios` acepta

| Forma | Resuelve a |
|---|---|
| `"123"` o `["123","456"]` | esos legajos |
| `{rol: "AUTORIZANTE", modulo: "COMPRAS"}` | todos los que tienen ese rol en ese módulo (en PERMISOS) |
| `{rol: "TALLER"}` | ese rol en el módulo del aviso |
| `{sector: "Taller"}` | todos los activos de ese sector (USUARIOS) |
| `{admin: true}` | los ADMIN de la app |

Se descartan los inactivos y se deduplica. Cada legajo recibe una fila propia en AVISOS.

### `tipo` (define la plantilla de WhatsApp)

`stock_critico` · `vencimiento_doc` · `pedido_pendiente` · `aviso_general` · `seguridad`

## 3. Qué notifica cada sistema (estado 15-oct-2026)

Todos usan el snippet `docs/IngecoAvisos.gs` (`notificarAppIngeco_(modulo, aviso)`) con su `CLAVE_<MODULO>` en Script Properties, salvo los de Vercel que tienen su propio helper. Los avisos llegan a la bandeja de la app y por push a quien tenga el módulo.

| Sistema | Evento | Destinatarios | Prioridad |
|---|---|---|---|
| Expedientes | Cada movimiento de expediente (cambio de oficina) y cada cobro | `{con_modulo:'EXPEDIENTES'}` | normal |
| Licitaciones | Cada licitación nueva detectada por la rutina diaria | `{con_modulo:'LICITACIONES'}` | normal |
| Pedidos de compra INGECO | OC nueva, conformada, caja chica, autorizada, pagada, devuelta, rechazada + recordatorio diario a Gerencia | por rol → área (INGENIERIA, GERENCIA, ADMINISTRACION, COMPRAS) + admin | normal |
| Pedidos Terminal | Todo cambio de estado de una OC (mismos mails que el aviso por correo) | `{emails:[...]}` | normal |
| INGECOV | Service a ≤ 50 h o vencido; VTV a 15 días, 3 días y vencida | TALLER / ADMINISTRACION, con `clave_unica` para no repetir | normal / critica |
| PAVIMAX | Pedido nuevo (→ operario), entrega de tanda (→ carga), stock bajo (umbrales en STOCK!G2/G3) | `{con_modulo:'PAVIMAX_OP'}` / `{con_modulo:'PAVIMAX'}` | normal / critica |
| Tarja Corrientes | Tarja abierta, tarja cerrada (horas), ítem del checklist con PROBLEMA | `{con_modulo:'TARJA'}`; problema también a TALLER + admin | normal / critica |
| Trituración | Camión (entrada de bruto / salida de producto) y producción registrada | `{con_modulo:'TRITURACION'}` | normal |
| Ropa de trabajo | Compra congelada (totales y proveedor) y cada entrega confirmada a una persona | `{con_modulo:'ROPA'}` | normal |
| Demarcación Vial | Trabajo iniciado (foto antes) y trabajo terminado (foto después) | `{con_modulo:'DEMARCACION_MON'}` | normal |
| Locales Terminal | Pago registrado (local, monto, medio) | `{con_modulo:'LOCALES_TERMINAL'}` | normal |
| Baches Waze | Bache nuevo respecto de la corrida anterior (si son más de 8, un solo aviso resumen) | `{con_modulo:'BACHES'}` | normal |
| Combustible / Traslados (apps de Bruno) | Pendiente: Bruno tiene que pegar el snippet y pedir su `CLAVE_COMBUSTIBLE` / `CLAVE_TRASLADOS` | — | — |

## Orden de migración

INGECOV → Combustible y Tarja → Ropa → Pedidos de compra (el único con auth propia que vale conservar).
