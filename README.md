# App INGECO

Punto de entrada único en el celular: login con la cuenta de Google de INGECO, módulos por permiso, bandeja de avisos con push, bot de ayuda con Claude que conoce los módulos que cada persona tiene autorizados.

Diseño técnico completo en `docs/diseno-v1.md`.

```
app-ingeco/
  backend/      Apps Script (clasp): Code.js (router), auth.js, permisos.js, avisos.js, ayuda.js, admin.js, sheets.js
  shell/        PWA estática: index.html, app.js, styles.css, sw.js, manifest.json, íconos
  push-relay/   Función Vercel con web-push (Apps Script no puede firmar VAPID ni cifrar el payload)
  docs/         diseño, integración de módulos, plantillas WhatsApp
```

## Puesta en marcha (una vez)

### 1. Backend

```bash
cd backend
clasp create --type webapp --title "APP INGECO backend"   # o pegar el scriptId existente en .clasp.json
clasp push
```

En el editor de Apps Script (o con `clasp run`):

1. Correr `setup()` → crea la planilla `APP_INGECO`, las 8 hojas, los módulos iniciales, los instructivos semilla y el primer ADMIN. **Editá EMAIL/NOMBRE/CELULAR en `setup()` antes.**
2. Completar `configurarSecretos()` y correrlo una vez (después borrar los valores del código). Propiedades:

| Propiedad | Para qué |
|---|---|
| `SPREADSHEET_ID` | la pone `setup()` |
| `GOOGLE_CLIENT_ID` | OAuth client id (Web) de Google Cloud, el mismo que en `shell/app.js` |
| `GOOGLE_HD` | dominio(s) permitidos, coma-separados. Default `grupoingeco.com.ar` |
| `CLAUDE_API_KEY` | bot de ayuda |
| `PUSH_RELAY_URL`, `PUSH_RELAY_SECRET`, `VAPID_PUBLIC_KEY` | Web Push vía relay |
| `WA_TOKEN`, `WA_PHONE_ID` | WhatsApp Cloud API (solo avisos críticos) |
| `CLAVE_<MODULO>` | secreto por módulo para `notificar` (ej. `CLAVE_INGECOV`) |
| `SHELL_URL` | link que va en el WhatsApp de alta |
| `ADMIN_NOMBRE`, `ADMIN_CELULAR` | a quién manda el bot cuando no sabe |

3. Correr `instalarTriggers()` → resumen diario 7:30 y limpieza de sesiones 3:00.
4. Desplegar: `clasp deploy -d prod` la primera vez; después siempre `clasp push && clasp deploy -i <deploymentId>` para no cambiar la URL.

Para `dev`: segundo deployment apuntando a otra planilla (`APP_INGECO_DEV`) cambiando `SPREADSHEET_ID`... como Apps Script comparte PropertiesService entre deployments, lo más simple es un **segundo proyecto** clonado con su propio `.clasp.json` (carpeta `backend-dev/` ignorada por git o un branch).

### 2. Push relay (Vercel)

```bash
cd push-relay
npx web-push generate-vapid-keys        # guardar ambas claves
vercel --prod
```

Variables de entorno en Vercel: `RELAY_SECRET` (inventalo, largo), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:marcoskatz@grupoingeco.com.ar`. Las mismas `VAPID_PUBLIC_KEY`, `PUSH_RELAY_URL` (`https://<proyecto>.vercel.app/api/push`) y `PUSH_RELAY_SECRET` van al PropertiesService del backend.

Prueba: con tu celular suscripto, correr `probarPush()` en el editor.

### 3. Google Sign-In (una vez)

1. Google Cloud Console (con la cuenta de Workspace de INGECO) → APIs y servicios → Pantalla de consentimiento OAuth: tipo **Interno** (solo cuentas del Workspace), nombre "INGECO".
2. Credenciales → Crear credencial → **ID de cliente OAuth** → tipo *Aplicación web*. En *Orígenes autorizados de JavaScript* poner la URL del shell (ej. `https://marcoskatz-cmd.github.io`) y `http://localhost:8765` para probar. No hace falta redirect URI (se usa modo popup).
3. Copiar el client id en `CONFIG.GOOGLE_CLIENT_ID` de `shell/app.js` y en la propiedad `GOOGLE_CLIENT_ID` del backend.

### 4. Shell

1. En `shell/app.js` pegar la URL `/exec` del deployment en `CONFIG.BACKEND_URL`.
2. Publicar la carpeta `shell/` en GitHub Pages (Settings → Pages → branch `main`, folder `/shell`) o en Vercel. HTTPS es obligatorio para service worker y push.
3. Abrir en el celular, "Iniciar sesión con Google" con la cuenta de INGECO, aceptar avisos.

## Operación diaria

- **Alta**: Admin → Personas → "+ Nueva persona" (nombre + email de INGECO + módulos) → botón "Enviar acceso por WhatsApp". Alternativa sin alta: la persona entra con su cuenta de Google, queda creada sin módulos y el admin recibe un aviso para tildarle permisos.
- **Permisos**: la grilla persona × módulo. Cada tilde escribe/borra una fila en PERMISOS. ADMIN es un módulo más.
- **Módulo nuevo**: Admin → Módulos → "+ Nuevo módulo" (o una fila en MODULOS). Aparece en el inicio sin redeploy.
- **Instructivos**: Admin → Instructivos. El bot los lee en cada llamada; un cambio rige al instante.
- **Bot**: Admin → Bot muestra consultas, tokens y las respuestas con pulgar abajo (qué instructivo mejorar / qué pantalla rediseñar).
- **Aviso manual**: Admin → Enviar aviso (a todos, un sector, quienes tienen un módulo, o personas puntuales).

## Qué sabe el bot

- Cómo usar los módulos **que esa persona tiene autorizados**, con los INSTRUCTIVOS, priorizando el módulo desde el que abrió la ayuda.
- Qué módulos tiene, para qué sirve cada uno, con qué rol, y quién es el responsable.
- Si pregunta por un módulo que existe pero no tiene: le dice para qué sirve en una frase y que pida acceso a Marcos. No explica su uso.
- Datos en vivo ("cuánto stock hay"): deriva al módulo o al botón de WhatsApp. Nunca inventa.
- Fusible: 30 consultas por persona por día.

## Contratos para los módulos

Ver `docs/integracion-modulos.md`. Resumen:

```
POST <exec> {"accion":"validar_token","token":"…","modulo":"INGECOV"}
  → {ok, legajo, nombre_visible, email, sector, rol_en_modulo, modulos:[…]}

POST <exec> {"accion":"notificar","clave_sistema":"…","modulo":"INGECOV","destinatarios":["12", {"rol":"TALLER"}, {"sector":"Taller"}],
             "tipo":"vencimiento_doc","titulo":"…","cuerpo":"…","url_destino":"https://…","prioridad":"normal|critica"}
  → {ok, avisos:[{legajo, id, canales}]}
```
