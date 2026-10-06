# App INGECO — Diseño técnico v1

> **Cambio 6-oct-2026 (v1.1):** el login nombre + PIN de la sección 4 se reemplazó por **Google Sign-In con las cuentas del Workspace de INGECO** (`@grupoingeco.com.ar`). Desaparecen PIN, hash, bloqueo por intentos, PIN provisorio y alias; la identidad es el email verificado por Google. Alta: por Admin (nombre + email) o automática al primer ingreso, sin módulos. El resto del diseño sigue vigente.

Oct 6, 2026 · @Marcos

## 1. Objetivo y alcance

La app INGECO es un único punto de entrada en el celular: cada persona entra con nombre y PIN, ve solo los sistemas que le corresponden, recibe las notificaciones de esos sistemas y tiene un bot de ayuda que responde en contexto. Reemplaza al Portal INGECO actual y a los mails automáticos como canal de aviso.

**Incluye**

- Shell PWA instalable con login nombre + PIN y sesión persistente por dispositivo.
- Permisos por persona y por módulo, administrados por Marcos desde la misma app.
- Alta de usuarios en un paso, con envío del acceso por WhatsApp y PIN provisorio.
- Motor de notificaciones común: cualquier sistema llama a `notificar()` y el aviso llega a la bandeja de la app y por push; WhatsApp Cloud API como canal de respaldo para alertas críticas.
- Bot de ayuda con Claude, alimentado con los instructivos de cada módulo y consciente de quién pregunta y desde qué módulo.
- Integración de los módulos existentes (INGECOV, pedidos-compra, combustible, tarja, ropa) sin reescribirlos.

**No incluye**

- Chat interno entre personas: se resuelve con botones contextuales que abren WhatsApp con el mensaje prearmado.
- Reescritura de los módulos existentes: siguen con su código y su deploy.
- Usuarios externos (proveedores, clientes).
- App nativa en tienda en la fase 1; la publicación en Play Store como Trusted Web Activity queda como opción para una fase posterior.

## 2. Arquitectura general

Cuatro capas. Lo único nuevo son el shell y el backend común; los módulos y sus planillas quedan como están.

&#91;embedded content: arquitectura · 4 capas\]

El shell consulta al backend quién es la persona y qué módulos tiene; los módulos se abren embebidos o por link con el token de sesión; cada sistema existente dispara avisos llamando a `notificar()` por HTTP; todo el estado vive en una sola planilla.

**Decisiones de stack**

| Componente | Tecnología | Por qué |
| --- | --- | --- |
| Shell | HTML/CSS/JS plano, PWA con service worker, sin frameworks | Carga rápida en celulares viejos con mala señal; mismo criterio que INGECOV |
| Backend | Un proyecto Apps Script, Web App con `doPost` tipo RPC (`{accion, token, payload}`) | Sin infra; los datos ya viven en Sheets; deploy por `clasp` |
| Datos | Una planilla `APP_INGECO` con 8 hojas | Una sola fuente de verdad para identidad, permisos y avisos |
| Push | Web Push (VAPID) desde Apps Script | Gratis, funciona con la app cerrada en Android |
| WhatsApp | Cloud API oficial de Meta, plantillas Utility | Respaldo para alertas críticas y para iPhone |
| Bot | API de Claude, modelo Haiku, llamada desde el backend | El celular nunca ve la API key; costo marginal por consulta |
| Hash de PIN | SHA-256 con legajo como sal (`Utilities.computeDigest`) | Nunca PIN en claro en la planilla |

## 3. Modelo de datos (planilla APP\_INGECO)

Ocho hojas, una por entidad. El `legajo` es la clave de persona en todas; el `codigo` de módulo, la clave de sistema. Ninguna hoja se edita a mano: todo pasa por el backend, que valida y deja rastro de quién hizo qué.

| Hoja | Columnas | Clave | Notas |
| --- | --- | --- | --- |
| USUARIOS | legajo, nombre\_visible, nombre\_norm, alias\_norm, sector, pin\_hash, pin\_provisorio (sí/no), activo, intentos\_fallidos, bloqueado\_hasta, creado\_por, fecha\_alta | legajo | `nombre_norm` y `alias_norm` se calculan al guardar: minúsculas, sin tildes, sin puntos ni espacios dobles; `alias_norm` separa variantes con `\|` |
| MODULOS | codigo, nombre, descripcion\_corta, url, tipo (iframe / link), icono, orden, activo | codigo | Agregar un sistema = agregar una fila; aparece en Admin y en el inicio sin redeploy |
| PERMISOS | legajo, modulo, rol, otorgado\_por, fecha | legajo + modulo | El shell solo mira si la fila existe; el `rol` lo lee cada módulo si le interesa (`ADMIN` es un módulo más) |
| SESIONES | token, legajo, dispositivo (user agent corto), creada, ultimo\_uso, expira | token | Token de 32 bytes aleatorios en base64url; expira a 60 días sin uso; se renueva en cada llamada |
| AVISOS | id, fecha, legajo, modulo, tipo, titulo, cuerpo, url\_destino, prioridad (normal / critica), canales\_enviados, leido, fecha\_leido | id | Es la bandeja; `url_destino` abre el módulo en el ítem exacto (el pedido, la máquina) |
| SUSCRIPCIONES | legajo, endpoint, p256dh, auth, dispositivo, creada, ultimo\_envio\_ok, fallos | endpoint | Un celular = una fila; se da de baja sola tras 3 fallos seguidos |
| INSTRUCTIVOS | modulo, seccion, texto, actualizado | modulo + seccion | Lo que lee el bot; en español llano, lo editás vos desde la planilla o desde Admin |
| CONSULTAS\_BOT | fecha, legajo, modulo\_contexto, pregunta, respuesta, tokens, util (sí/no, lo marca el usuario) | fecha + legajo | Auditoría y costo; los temas repetidos muestran dónde la app todavía no es POKAYOKE |

**Qué no se guarda**: el PIN en claro, nunca; el token en la planilla sí (es la referencia de sesión), pero en el celular vive solo en `localStorage` del dominio del shell.

**Carga inicial**: USUARIOS se importa de la nómina de RRHH si existe en digital; si no, se carga desde Admin. MODULOS arranca con las filas de INGECOV, Pedidos de compra, Combustible, Tarja, Ropa y Admin.

## 4. Identidad y acceso

La persona tipea su nombre y un PIN de 4 dígitos una sola vez por celular. Desde entonces la app abre directo; el PIN vuelve a pedirse solo si cambia de teléfono, pasan 60 días sin uso o vos revocás la sesión.

**Login**

1. El shell muestra un campo de texto (nombre) y un teclado numérico de 4 dígitos. Nada más en pantalla.
2. El backend normaliza el nombre tipeado igual que `nombre_norm` y busca filas donde `nombre_norm` o algún `alias_norm` coincidan.
3. Entre las candidatas, acepta solo la fila cuyo `pin_hash` coincide con `SHA256(pin + legajo)`. Si hay exactamente una, entra; si hay cero o más de una, falla.
4. Mensaje de error único: "Nombre o PIN incorrecto". No se revela si el nombre existe.
5. Tres fallos seguidos sobre el mismo nombre bloquean esa fila 10 minutos y disparan un aviso al administrador por el propio motor de notificaciones.
6. Si `pin_provisorio = sí`, la app obliga a elegir un PIN nuevo antes de mostrar el inicio. El provisorio muere ahí.
7. Devuelve `token` + perfil (`legajo`, `nombre_visible`, lista de módulos permitidos). El shell guarda el token en `localStorage` y lo manda en cada llamada.

**Sesión**

- El token se renueva en cada uso (`ultimo_uso`); expira a 60 días de inactividad.
- Varios dispositivos por persona son válidos: una fila por token.
- Admin puede revocar una sesión o todas las de un legajo.
- Los módulos reciben el token en la URL (`?t=…`) o por `postMessage` dentro del iframe, y lo validan contra `validar_token` del backend común. Así saben quién es sin pedir nada.

**Por qué 4 dígitos alcanza**: la amenaza real es que un compañero cargue algo a nombre de otro, no un ataque externo. La URL no es pública, el nombre y el PIN se validan juntos, hay bloqueo por intentos y el PIN nunca viaja ni se guarda en claro. Si en algún módulo aparece una acción con plata (aval de pedidos), ese módulo puede pedir un segundo factor propio, por ejemplo repetir el PIN al firmar.

**Normalización** (misma función en alta y en login): minúsculas → quitar tildes y diéresis → quitar puntos, comas y guiones → colapsar espacios. "José Ma. Pérez" y "jose ma perez" son la misma clave.

## 5. Administración de usuarios

Un alta son 20 segundos y un mensaje de WhatsApp. Admin es un módulo más del shell, visible solo para legajos con permiso `ADMIN`.

**Alta de una persona**

1. Formulario: nombre, apellido, sector (desplegable), celular, y los módulos como casillas.
2. Al guardar, el backend crea la fila en USUARIOS con `pin_provisorio = sí` y un PIN aleatorio de 4 dígitos, y una fila en PERMISOS por cada casilla tildada.
3. La pantalla muestra el PIN una sola vez y un botón "Enviar acceso por WhatsApp" que abre `wa.me/549<celular>?text=…` con el mensaje armado: link de la app, cómo instalarla en el inicio, y el PIN provisorio.
4. En el primer ingreso la persona elige su PIN definitivo (sección 4).

**Permisos**: grilla legajo × módulo con casillas. Cada tilde escribe o borra una fila en PERMISOS con tu legajo en `otorgado_por`. El cambio se ve en el celular de la persona en el próximo refresco del inicio; no hace falta que vuelva a entrar.

**Ficha de usuario**: datos, módulos, sesiones activas (dispositivo y último uso) y tres acciones: resetear PIN (mismo circuito que el alta), cerrar sesiones, dar de baja (`activo = no`; no se borra la fila para conservar el historial de avisos).

**Alias**: campo libre en la ficha para variantes del nombre ("pepe perez"). Si una persona falla el login por tipeo, la solución es un alias, no explicarle cómo escribir su nombre.

**Importación masiva**: pegás un rango con nombre, apellido, sector y celular; el sistema crea las filas sin permisos y sin PIN. Después tildás permisos y usás "Enviar acceso" de a uno o para todos los seleccionados.

**Lo que Admin no hace**: editar la planilla a mano. Si una columna de USUARIOS cambia de nombre, el backend lo detecta al arrancar y lo avisa en Admin (auto-diagnóstico, como la pestaña META de INGECOV).

## 6. Shell PWA: pantallas y comportamiento

Cinco pantallas, mobile-first, en español llano. Nada que no sea el siguiente paso aparece en pantalla.

| Pantalla | Qué muestra | Comportamiento |
| --- | --- | --- |
| Login | Logo, campo nombre, teclado numérico de 4 dígitos | El PIN se envía solo al completar 4 dígitos; error inline; tras bloqueo muestra el tiempo restante |
| Cambio de PIN | Teclado numérico, dos veces | Solo aparece la primera vez o cuando Admin resetea |
| Inicio | Tarjetas de los módulos permitidos (icono, nombre, descripción corta, contador de avisos sin leer); campana con total; botón de ayuda | Orden por `MODULOS.orden`; se refresca al volver a primer plano; sin tarjetas si no hay permisos, con mensaje "Pedile acceso a Marcos" |
| Módulo | El sistema embebido (iframe) a pantalla completa, con barra superior mínima: volver, nombre, ayuda | Para `tipo = link` abre en la misma pestaña con el token; el botón volver trae al inicio |
| Bandeja | Lista de avisos, no leídos arriba, agrupados por día; tocar uno marca leído y abre `url_destino` | Botón "marcar todo leído"; filtro por módulo solo si hay más de 20 avisos |
| Ayuda | Chat con el bot; arranca con "¿En qué te ayudo con X?" si venís de un módulo | Botón pulgar arriba/abajo por respuesta; link "Hablar con Marcos" que abre WhatsApp |

**Instalación**: `manifest.json` con nombre "INGECO", icono y `display: standalone`; service worker que cachea el shell para que abra sin señal y muestre la bandeja local. En la primera visita, un banner "Agregar a la pantalla de inicio" con las instrucciones por sistema operativo. El mensaje de alta ya trae ese paso.

**Push**: al entrar al inicio por primera vez, la app pide permiso de notificaciones y registra la suscripción en SUSCRIPCIONES. Si la persona lo niega, la campana lo recuerda con un punto y un texto "activar avisos". Nunca se insiste con popups.

**Botones contextuales de contacto**: dentro de cada tarjeta de aviso y en la barra del módulo, un botón "Consultar" abre WhatsApp al responsable de ese módulo (definido en MODULOS) con un mensaje prearmado que incluye el ítem. Esto reemplaza al chat interno.

**Accesibilidad de campo**: botones de al menos 48 px, contraste alto, sin gestos ocultos, todo operable con una mano. Textos de error que dicen qué pasó y qué hacer, nunca "Error 500".

## 7. Integración de los módulos existentes

Cada módulo necesita un cambio chico y uno opcional. El chico: aceptar el token del shell. El opcional: llamar a `notificar()` cuando pase algo que alguien deba saber.

| Módulo | Stack actual | Cómo se abre | Cambio mínimo | Convive con su login actual |
| --- | --- | --- | --- | --- |
| INGECOV | Apps Script + gviz | iframe | Leer `?t=` y llamar `validar_token`; si no hay token, seguir como hoy | Sí, hasta que todos usen el shell |
| Pedidos de compra | Vercel + Sheets + JWT por PIN | link con token | Endpoint que recibe el token del shell, lo valida contra el backend común y emite su propio JWT. El PIN propio queda como segundo factor para firmar | Sí |
| Combustible | Apps Script Web App | iframe | Igual que INGECOV | Sí |
| Tarja diaria | Apps Script Web App | iframe | Igual que INGECOV | Sí |
| Ropa de trabajo | Apps Script, PIN por legajo | iframe | Confiar en el token; dejar de pedir PIN cuando llega del shell | Sí |

**Contrato `validar_token`**: `POST {accion: "validar_token", token}` → `{ok, legajo, nombre_visible, rol_en_modulo}`. Un módulo lo llama una vez por sesión y cachea el resultado.

**Contrato `notificar`**: `POST {accion: "notificar", clave_sistema, destinatarios, modulo, tipo, titulo, cuerpo, url_destino, prioridad}`. `destinatarios` acepta legajos, un rol ("todos los AUTORIZANTE de COMPRAS") o un sector. `clave_sistema` es un secreto por módulo guardado en `PropertiesService` de ambos lados, para que nadie dispare avisos desde afuera.

**Iframe y sesión**: los módulos Apps Script corren en `script.google.com`, distinto dominio que el shell, así que no comparten `localStorage`. El token viaja en la URL del iframe en cada apertura; el módulo no lo persiste.

**Orden de migración**: INGECOV primero (es el más usado y el cambio es trivial), después Combustible y Tarja, y Pedidos de compra al final porque es el único con autenticación propia que vale la pena conservar.

## 8. Motor de notificaciones

Un aviso se escribe una vez en AVISOS y de ahí sale por los canales que correspondan. La bandeja es la fuente de verdad; push y WhatsApp son formas de llamar la atención sobre ella.

**Flujo de `notificar()`**

1. Validar `clave_sistema` y resolver `destinatarios` a una lista de legajos (expande roles y sectores con PERMISOS y USUARIOS).
2. Escribir una fila en AVISOS por legajo, `leido = no`.
3. Para cada legajo con filas en SUSCRIPCIONES, enviar Web Push con título, cuerpo y `url_destino`. Un fallo 404/410 marca la suscripción como caída.
4. Si `prioridad = critica` y el legajo tiene celular, enviar además por WhatsApp Cloud API con la plantilla del `tipo`.
5. Registrar en `canales_enviados` qué salió por dónde.

**Web Push desde Apps Script**: es la única pieza con riesgo técnico real. Apps Script no trae librería de Web Push ni firma ECDSA P-256 nativa, que el protocolo VAPID exige. Dos caminos: (a) implementar la firma en JS puro dentro del backend, viable pero frágil; (b) un microservicio de 30 líneas en Vercel con la librería `web-push`, al que el backend le pasa el aviso y la suscripción. Se prototipan ambos en la fase 1; si (a) no cierra en dos días de trabajo, se adopta (b) sin más discusión.

**WhatsApp**: plantillas Utility, una por `tipo` (`stock_critico`, `vencimiento_doc`, `pedido_pendiente`, `aviso_general` con un parámetro de texto). Número dedicado, token permanente de System User, celular en formato `549…`. Reservado a prioridad crítica para que la cuenta de Meta no crezca con avisos rutinarios.

**Eventos iniciales por módulo**

| Módulo | Evento | Destinatarios | Prioridad |
| --- | --- | --- | --- |
| INGECOV | Service por horas vencido o a 50 h | Taller, responsable del equipo | normal |
| INGECOV | Documentación (VTV, seguro, RTO) a 15 y 3 días de vencer | Administración, Marcos | critica a 3 días |
| Pedidos de compra | Pedido pendiente de aval hace más de 48 h | Autorizante del monto | normal |
| Pedidos de compra | Pedido autorizado / rechazado | Solicitante | normal |
| Combustible | Carga fuera de rango respecto al equipo | Marcos | critica |
| Ropa | Entrega pendiente de retiro | Operario | normal |
| Shell | 3 intentos fallidos de login | Admin | normal |

**Resumen diario**: un disparador de Apps Script a las 7:30 arma un único aviso por persona con lo pendiente del día (sin leer + vencimientos próximos), para no fragmentar la atención en diez pushes sueltos.

## 9. Bot de ayuda con Claude

El bot responde "cómo hago X" leyendo los instructivos de los módulos que esa persona tiene, en el contexto del módulo donde está parada. No ejecuta acciones ni consulta datos de negocio; eso lo hacen los módulos.

**Arquitectura**: el shell manda `{accion: "ayuda", token, modulo_contexto, pregunta, historial}` al backend. El backend arma el prompt, llama a la API de Claude con `UrlFetchApp`, guarda la consulta en CONSULTAS\_BOT y devuelve la respuesta. La API key vive en `PropertiesService` del backend; el celular nunca la ve.

**System prompt** (se arma en cada llamada):

1. Rol: asistente de la app INGECO, responde en español llano, en no más de 4 oraciones, sin jerga técnica.
2. Quién pregunta: `nombre_visible`, sector, módulos permitidos. Si preguntan por un módulo que no tienen, responde que pidan acceso a Marcos.
3. Contexto: el `modulo_contexto` desde el que abrieron la ayuda, con su INSTRUCTIVOS completo primero.
4. Resto de INSTRUCTIVOS de los módulos permitidos, resumidos a sus secciones.
5. Regla de salida: si no sabe o la pregunta es sobre un dato concreto ("cuánto stock hay"), dice que eso se ve en el módulo o que lo consulte con el responsable, y ofrece el botón de WhatsApp. Nunca inventa pasos.

**Modelo y costo**: Haiku como modelo por defecto; una consulta típica son unos 3.000 tokens de entrada (instructivos) y 150 de salida. Con prompt caching sobre el bloque de instructivos, el costo por consulta queda en fracciones de centavo de dólar. Fusible: 30 consultas por legajo por día; al pasarlo, el bot responde con el link de WhatsApp.

**Instructivos**: hoja INSTRUCTIVOS con una fila por sección ("Cómo cargar un pedido", "Qué hacer si no aparece mi equipo"). Los editás vos; el bot lee la planilla en cada llamada, así que un cambio rige al instante. Arrancamos con lo que ya existe en las pestañas de ayuda de INGECOV y pedidos-compra.

**Mejora continua**: CONSULTAS\_BOT con pulgar arriba/abajo. Una vez por mes, las preguntas más repetidas y las peor valoradas van a dos listas: instructivos a mejorar y pantallas a rediseñar. Si la gente pregunta mucho "dónde está el botón de guardar", el problema no es el instructivo.

**Lo que queda fuera en la fase 1**: respuestas con datos en vivo ("qué pedidos tengo pendientes"). Es posible dándole al bot herramientas que consulten el backend, pero multiplica el riesgo de respuestas equivocadas; se evalúa cuando el bot básico tenga un mes de uso.

## 10. Repositorio, deploy y entornos

Un repo `app-ingeco` en GitHub, dos carpetas, cero copy-paste al editor online.

```
app-ingeco/
  backend/        Apps Script del backend común (clasp)
    Code.gs       doGet / doPost, enrutador RPC
    auth.gs       login, token, normalización, hash
    permisos.gs   lectura de PERMISOS y MODULOS
    avisos.gs     notificar(), push, WhatsApp, resumen diario
    ayuda.gs      prompt y llamada a Claude
    admin.gs      alta, permisos, importación, diagnóstico
    sheets.gs     acceso a hojas con verificación de columnas
    .clasp.json
  shell/          PWA estática
    index.html    una sola página, vistas por hash (#inicio, #bandeja, #ayuda, #admin)
    app.js        estado, llamadas al backend, render
    sw.js         service worker: caché del shell + recepción de push
    manifest.json
    styles.css
  push-relay/     (solo si hace falta el plan B de Web Push) función Vercel con web-push
  docs/           este diseño, instructivos fuente, plantillas de WhatsApp
```

**Deploy**: `clasp push && clasp deploy -i <deploymentId>` para el backend; el shell se publica en GitHub Pages o Vercel con `git push` (dominio propio tipo `app.grupoingeco.com.ar` si Administración lo habilita; el service worker y el push exigen HTTPS, que ambos dan). Dos deployments de Apps Script: `dev` y `prod`, cada uno apuntando a su planilla.

**Secretos** en `PropertiesService` del backend: API key de Claude, claves VAPID, token de WhatsApp, `clave_sistema` de cada módulo. Nunca en el repo.

**Entornos**: planilla `APP_INGECO_DEV` con tres usuarios de prueba y módulos apuntando a sus versiones de prueba; `APP_INGECO` para producción. El shell lee la URL del backend de una constante al inicio de `app.js`.

## 11. Plan de desarrollo por fases

Nueve semanas en cuatro fases. Cada fase entrega algo que se usa; cada puerta es una condición observable, no una fecha.

&#91;embedded content: roadmap · 4 fases, 3 puertas\]

La fase 1 se puede usar sin la app: los avisos ya quedan registrados y el prototipo de push define si Web Push se hace en Apps Script o con el relay en Vercel. La fase 2 convierte el Portal en algo con identidad. La fase 3 cierra el motivo original del proyecto y permite apagar los mails. La fase 4 suma el bot y termina la migración.

**Entregables por fase**

| Fase | Entregable verificable |
| --- | --- |
| 1 | Planilla `APP_INGECO` creada; backend desplegado; INGECOV escribe avisos en AVISOS al vencer un service; un push de prueba llega a tu celular |
| 2 | Shell publicado; vos y 4 personas más entran con nombre + PIN y ven solo sus tarjetas; alta por WhatsApp funcionando |
| 3 | Bandeja operativa; avisos críticos salen por WhatsApp con plantilla aprobada; resumen de 7:30 activo; mails automáticos desactivados |
| 4 | Bot respondiendo sobre INGECOV y pedidos-compra; CONSULTAS\_BOT con registro; pedidos-compra, combustible, tarja y ropa aceptando el token |

**Qué necesito de vos antes de arrancar**: acceso a la planilla de nómina (o la lista de personas), la lista de módulos con sus URLs actuales, una API key de Claude, y la decisión de iniciar el trámite de WhatsApp Business (tarda días y conviene lanzarlo en la fase 1 aunque se use en la 3).

## 12. Decisiones abiertas para el OK

Seis decisiones. Las tres primeras cambian el código de la fase 1; las otras pueden esperar.

- [ ] **PIN de 4 o 6 dígitos.** Propuesta: 4, con segundo factor en pedidos-compra al firmar.
- [ ] **Dominio del shell.** Propuesta: subdominio propio (`app.grupoingeco.com.ar`) en Vercel. Alternativa sin pedir nada a nadie: GitHub Pages con dominio `*.github.io`.
- [ ] **Web Push: Apps Script puro o relay en Vercel.** Propuesta: prototipar ambos en la fase 1 y decidir por resultado, con tope de dos días para el camino en Apps Script.
- [ ] **WhatsApp Cloud API: iniciar el trámite ahora.** Requiere Meta Business verificado con CUIT de INGECO y un número dedicado. Si no se inicia en la fase 1, la fase 3 sale sin WhatsApp y los críticos van solo por push.
- [ ] **Resumen diario a las 7:30: sí o no, y para quién.** Propuesta: sí, para todos los que tengan al menos un aviso sin leer o un vencimiento en 7 días.
- [ ] **Fuente de la nómina.** ¿Existe una planilla digital de RRHH con nombre, sector y celular? Si no, la carga inicial es manual desde Admin.

Con las tres primeras definidas arranco por la fase 1: planilla, backend, `notificar()` y el prototipo de push.
