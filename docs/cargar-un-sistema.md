# Cómo cargar un sistema nuevo en la app INGECO

Para quien desarrolla sistemas (Marcos, Bruno). Cargar un sistema son dos pasos: darlo de alta en la app y, si querés que entre sin login desde la app, agregarle una línea.

## 1. Darlo de alta (2 minutos, sin tocar código)

1. Entrá a la app → **Admin** (barra de abajo) → pestaña **Módulos** → **+ Nuevo módulo**.
2. Completá:
   - **Código**: corto, en mayúsculas, sin espacios. Ej. `HORMIGON`. No se cambia después.
   - **Nombre** y **Descripción corta**: lo que ve la gente en la tarjeta.
   - **URL**: la dirección del sistema.
   - **Cómo se abre**:
     - *Embebido* si es una página en GitHub Pages o Vercel.
     - *Link* si es una web app de Apps Script (`script.google.com`): Google no permite embeberlas con cuenta de Workspace, así que abre en pestaña completa aunque elijas embebido.
   - **Ícono**: un emoji.
   - **Orden**: posición en el inicio (menor = más arriba).
   - **Responsable**: la persona a la que le llega el botón "Consultar por WhatsApp".
3. Guardar. La tarjeta aparece en el inicio de quien tenga permiso, sin redeploy.
4. **Admin → Personas**: tildá el sistema a cada persona que deba verlo. Para vos mismo también: nadie lo ve hasta que se lo asignás.

## 2. Que entre sin login desde la app (opcional, 1 línea)

Cuando alguien toca la tarjeta, la app abre el sistema con `?tk=<ticket>`: un código de un solo uso que vence a los 5 minutos. El sistema lo canjea contra el backend común y sabe quién entró. Un link copiado no sirve para otro.

### Sistema estático (GitHub Pages, Vercel, HTML plano)

Agregá en el `<head>`, antes de cualquier otro script:

```html
<script src="https://marcoskatz-cmd.github.io/app-ingeco/guard.js" data-modulo="CODIGO"></script>
```

`CODIGO` es el código que pusiste en el paso 1. Eso te deja disponible:

- `window.INGECO_USUARIO` → `{legajo, nombre_visible, email, sector, rol_en_modulo, modulos, es_admin}` si vino desde la app, `null` si entró por fuera.
- `window.INGECO_SESION` → token de sesión de 12 horas que tu backend puede verificar (ver abajo).
- El evento `ingeco:usuario` en `document` cuando queda resuelto.

**No bloquea nada**: si el sistema era abierto, sigue abierto. Si tiene su propio PIN, vos decidís saltearlo cuando hay usuario. Ejemplo, el PIN de INGECOV:

```html
<script>if (window.INGECO_USUARIO) sessionStorage.setItem('ingeco-pin-ok', '1');</script>
```

### Si tu backend tiene que verificar quién es (no confiar solo en el front)

Mandá `window.INGECO_SESION` en cada pedido y verificalo del lado del servidor:

```
POST https://script.google.com/macros/s/AKfycbx9NN1FfOQjUjfymLXrMyd2QM6l96HP0lxY6RC7_xKsbDlO0PnwdHbaMtag54VYFor0/exec
Content-Type: text/plain
{"accion":"validar_sesion_modulo","payload":{"sesion":"<INGECO_SESION>","modulo":"CODIGO"}}
→ {ok:true, legajo, nombre_visible, email, sector, rol_en_modulo, modulos, es_admin}
```

Vale 12 horas y se puede consultar muchas veces. En Apps Script es un `UrlFetchApp.fetch` (la primera vez hay que autorizar el permiso de conexiones externas ejecutando cualquier función desde el editor). Conviene cachear la respuesta unos minutos. Ejemplo real: `backend/WebApp.js` del repo `locales-terminal`, función `sesionIngecoOk_`.

### Web app de Apps Script (HtmlService)

El ticket llega por `?tk=`. En `doGet(e)` leé `e.parameter.tk` y canjealo con `validar_ticket` (una sola vez):

```
{"accion":"validar_ticket","payload":{"ticket":"<tk>","modulo":"CODIGO"}}
→ {ok:true, legajo, nombre_visible, ..., sesion}
```

Con eso emitís tu propia sesión y no pedís PIN. Ejemplo real: `Auth.gs` del repo `ingeco-ropa`, función `loginShell_`. Si no querés tocar nada, basta con publicarla con acceso para el dominio de INGECO: Google pide la cuenta y listo.

## 3. Que el sistema mande avisos a la app (opcional)

Pedile a Marcos una clave para tu sistema (propiedad `CLAVE_CODIGO` en el backend común) y llamá:

```
{"accion":"notificar","clave_sistema":"<clave>","modulo":"CODIGO","destinatarios":["12", {"area":"TALLER"}, {"admin":true}],
 "tipo":"aviso_general","titulo":"...","cuerpo":"...","url_destino":"https://...","prioridad":"normal"}
```

Llega a la bandeja de cada persona y por push al celular. Detalle en `docs/integracion-modulos.md`.

## Qué no hacer

- No pongas el token de la app en links que se compartan: usá siempre el ticket (`?tk=`) que la app genera sola.
- No edites la planilla `APP_INGECO` a mano: todo va por Admin.
- No repitas código de acceso en cada sistema: `guard.js` ya lo hace.
