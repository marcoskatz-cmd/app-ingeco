# IngeBot — asistente transversal de App INGECO

Fecha: 2026-11-04. Autor: Claude con Marcos Katz. Estado: borrador para aprobación.

## 1. Intención

INGECO tiene 15 sistemas conectados a la app, cada uno con su planilla y su pantalla. Encontrar un dato
obliga a saber en qué sistema está y recorrerlo; cruzar datos de dos sistemas ("¿hay alguna orden de
compra pendiente para el equipo que está en Canal Margaritas?") hoy no lo hace nadie sin abrir dos
pantallas y buscar a ojo.

IngeBot es un asistente conversacional que vive flotando en la pantalla de App INGECO, responde en
lenguaje natural sobre **los datos que hay detrás de cada sistema** (las planillas completas con su
historial, no solo lo que muestran las pantallas), cruza sistemas cuando la pregunta lo pide, y solo
ve lo que la persona que pregunta tiene autorizado.

Hoy la app la usan ingenieros, administrativos y gerencia; ese es el público de la primera versión.

## 2. Objetivos, no-objetivos, anti-objetivos

**Objetivos**
- Responder preguntas de datos de cualquier sistema habilitado para quien pregunta, incluyendo
  historial y columnas que la pantalla no muestra.
- Cruzar sistemas en una misma respuesta.
- Respuestas **cortas por defecto**; profundiza (tablas, series, desgloses) solo si se lo piden.
- Cada dato citado dice de qué sistema salió, con link para abrirlo en la app.
- Respetar permisos: una fuente de un módulo no autorizado no se lee, ni para "ayudar".
- Quién ve a IngeBot (mi criterio): solo quien tenga el módulo **`BOT`** en PERMISOS. Marcos lo da
  a ingenieros, administrativos y gerencia desde Admin, como cualquier otro módulo. Sin `BOT` el FAB
  no aparece. Esto evita que un operario con solo TARJA lea las tarjas de todos: dentro de un módulo
  el bot ve lo que ve el rol más alto, así que el acceso al bot debe ser explícito.
- Un personaje propio: **IngeBot**, con cara, saludo animado, arrastrable y ocultable.
- Absorber el bot de ayuda actual (instructivos, "qué módulos tengo") para que haya un solo bot.

**No-objetivos (primera versión)**
- No ejecuta acciones: no carga, no modifica, no crea avisos ni pedidos. Se agrega después sin
  rehacer nada (el loop de herramientas ya lo permite).
- No reemplaza a AlberBot dentro de INGECOV; convive. Más adelante INGECOV puede apuntar a IngeBot.
- No cubre los 15 módulos de entrada. Arranca con seis fuentes (§5) y el resto entra por tandas.
- No accede a sueldos/Tango del Dashboard aunque la persona tenga DASHBOARD (ver §5).

**Anti-objetivos (sería un fracaso aunque "funcione")**
- Que alguien vea un dato de un módulo que no tiene habilitado.
- Que invente un número. Si no encontró el dato, lo dice.
- Que parezca un chatbot genérico: nada neutro ni monograma; personaje con identidad INGECO.
- Que tarde tanto que la gente deje de usarlo: una pregunta simple debe responder en pocos segundos.
- Que la clave de Anthropic termine en el repo público o en el browser.

## 3. Restricciones

- Stack INGECO: Apps Script + Google Sheets, PWA estática en GitHub Pages (repo público
  `marcoskatz-cmd/app-ingeco`), deploy por clasp/git. Sin frameworks nuevos.
- La identidad viene del login Google de la app (sesión de 60 días). El bot no tiene login propio.
- El backend común corre con la cuenta de Marcos; esa cuenta ya tiene acceso a todas las planillas
  fuente (las lee hoy el Dashboard o los propios sistemas).
- Daltonismo rojo-verde de Marcos: estados en azul/teal/ámbar, nunca verde puro contra rojo.
- Sin modo oscuro. Español rioplatense, tono neutral (no simpático forzado).
- CSP estricta del shell: sin `onclick` inline ni `innerHTML` directo (mismo criterio que INGECOV).

## 4. Arquitectura

```
 Shell (GitHub Pages)                  Backend común App INGECO (Apps Script)          Datos
 ┌──────────────────┐   POST text/plain  ┌─────────────────────────────────┐
 │ ingebot.js (FAB) │ ───────────────►   │ accion: bot_preguntar           │
 │ historial en     │   {token,          │  1. identidad + modulosDe_      │   SpreadsheetApp
 │ sessionStorage   │    pregunta,       │  2. catálogo filtrado (§5)      │ ─────────► planillas fuente
 │                  │    conversacion}   │  3. loop Claude ⇄ herramientas  │
 │                  │ ◄───────────────   │  4. cupo + log CONSULTAS_BOT    │   UrlFetchApp
 └──────────────────┘   {texto, fuentes, │                                 │ ─────────► Pedidos de compra
                         usadas, cupo}   └──────────────┬──────────────────┘            (endpoint lectura)
                                                        │ UrlFetchApp
                                                        ▼
                                                  api.anthropic.com
```

**Decisión central (mía):** el loop de herramientas corre **en el backend**, no en el browser como
en AlberBot. Motivo: las herramientas leen planillas con la cuenta del servidor y filtran por
permiso; nada de eso puede confiarse al cliente. El frontend solo manda la pregunta y recibe texto.
Costo: una pregunta con varias herramientas tarda lo que tarden las lecturas (Apps Script tiene
6 minutos por ejecución; sobra).

**Una sola llamada HTTP por pregunta.** El backend hace todas las vueltas Claude⇄herramientas
y devuelve el texto final más la lista de fuentes consultadas. Mientras tanto el frontend muestra
a IngeBot "pensando". Si el backend supera 60 s, corta y responde con lo que tenga.

### 4.1 Backend: `backend/bot.js` (reemplaza `ayuda.js`)

Acciones nuevas en el mapa `USUARIO` de `Code.js` (requieren token de sesión):

| acción | payload | devuelve |
|---|---|---|
| `bot_preguntar` | `{pregunta, conversacion:[{rol,texto}], modulo_contexto?}` | `{texto, fuentes:[{modulo,tabla,filas}], cupo:{usadas,max}, conv_id}` |
| `bot_valorar` | `{conv_id, util:true/false}` | ok |
| `bot_saludo` | — | `{texto}` saludo corto armado en el servidor sin llamar a Claude: nombre, cuántos avisos sin leer tiene en la bandeja y una sugerencia según sus módulos. No lee fuentes de datos |

Se mantienen las acciones `ayuda`/`valorar_ayuda`/`saludo_ayuda` como alias un tiempo para no
romper el shell viejo en caché; se borran en la tanda siguiente.

**Loop:** manual (`UrlFetchApp` contra `/v1/messages`, igual que AlberBot: Apps Script no tiene
SDK). Hasta 8 vueltas de herramientas por pregunta. Historial que se manda a Claude: la
`conversacion` que trae el cliente (texto plano, últimos 12 mensajes) más los bloques
`tool_use`/`tool_result` de la pregunta actual. Los bloques de herramientas no se persisten entre
preguntas: se achica el contexto y la conversación textual alcanza para el seguimiento ("y en
septiembre?").

**Modelo y parámetros (mi criterio):** `claude-opus-5-5`, `output_config.effort: 'medium'`,
`max_tokens: 4000`, `fallbacks: 'default'` con beta `server-side-fallback-2026-07-01`,
`thinking` omitido (adaptativo por defecto). Prompt caching con `cache_control` en el bloque
estable del system prompt y en la definición de herramientas. Si el costo mensual preocupa,
bajar a `claude-sonnet-5-5` es cambiar una constante; el sistema está pensado para que funcione
igual.

**System prompt en dos bloques:**
1. *Estable, cacheable:* rol, reglas (§6), catálogo completo de módulos con descripción,
   instructivos (`INSTRUCTIVOS`), y el **diccionario de fuentes** de §5 (qué tabla hay en cada
   módulo, columnas, qué significa cada una, cómo se relacionan: código de equipo, nombre de obra,
   nro de orden). Este diccionario es lo que hace que el bot "sepa" dónde buscar.
2. *Variable:* quién pregunta (nombre, sector), sus módulos y rol, fecha/hora de Tucumán, y la
   lista de fuentes **habilitadas para esa persona** (subconjunto del diccionario).

**Herramientas (genéricas, no una por sistema):**

| herramienta | hace |
|---|---|
| `listar_fuentes()` | devuelve las tablas habilitadas con columnas y cantidad de filas (para que el bot confirme antes de leer) |
| `leer_tabla(fuente, filtros?, columnas?, orden?, limite?)` | lee una tabla; `filtros` = lista de `{col, op, valor}` con `op ∈ {=, !=, contiene, >, <, >=, <=, entre, en}`; fechas en ISO; devuelve filas (máx. 300) y `total_coincidencias` |
| `resumir_tabla(fuente, agrupar_por, metrica:{col, fn}, filtros?)` | agrupaciones server-side: `fn ∈ {sum, count, avg, min, max}` por una o dos columnas; evita traer miles de filas para una suma |
| `buscar_texto(texto, fuentes?)` | búsqueda libre en todas las columnas de texto de las fuentes habilitadas; sirve para "Margaritas", un código de equipo o un proveedor cuando no se sabe en qué tabla está |
| `ficha_equipo(codigo)` | atajo que junta lo que se sabe de un equipo en todas las fuentes habilitadas (tarjas, combustible, OC que lo mencionen, trabajos) |
| `pedidos_compra(consulta)` | puente a Pedidos de compra (Postgres), ver §5.5 |

Toda herramienta recibe el `legajo` del que pregunta desde el backend (no desde Claude) y verifica
`tienePermiso_(legajo, modulo_de_la_fuente)` antes de leer. Si Claude pide una fuente no habilitada
la herramienta devuelve `is_error` con "fuente no habilitada" y el bot lo informa.

**Lectura de planillas:** `SpreadsheetApp.openById(...).getSheetByName(...).getDataRange()
.getValues()` con caché en `CacheService` por tabla (TTL 10 min, troceada en bloques de 90 KB
porque el límite por clave es 100 KB). Los filtros y agregaciones corren en memoria del script.
Tablas grandes conocidas: tarjas por año (~600 filas hoy, crecen ~60/día), movimientos de
expedientes, OC de insumos (miles). Todas entran en memoria sin problema.

**Cupo:** 30 preguntas por persona por día (Script Property `BOT_CUPO_DIA`), sin tope para
quienes tengan rol ADMIN en el módulo `ADMIN` o estén en la Property `BOT_SIN_TOPE` (legajos).
Fusible global de 400 llamadas a Anthropic por día. `bot_estado` dentro de `perfil` para que el
FAB muestre cuántas quedan.

**Registro:** cada pregunta a `CONSULTAS_BOT` (fecha, legajo, pregunta, respuesta recortada,
fuentes, vueltas, tokens, ms, valoración). Admin ya tiene pestaña Bot; se amplía con fuentes
más consultadas y preguntas con pulgar abajo.

### 4.2 Frontend: `shell/ingebot.js` + estilos en `shell/styles.css`

- **FAB** circular (56 px) con la cara de IngeBot, abajo a la derecha por defecto, encima de la
  barra inferior. Badge con el número de preguntas restantes si quedan ≤5.
- **Saludo animado** al abrir la app (una vez por sesión): el FAB "aparece" con un rebote suave y
  despliega un globo con el texto de `bot_saludo` durante 6 s o hasta tocarlo. Respeta
  `prefers-reduced-motion`.
- **Arrastrable** con pointer events; se pega al borde más cercano al soltar; la posición se guarda
  en `localStorage`. Un toque corto abre el chat; arrastre no lo abre.
- **Ocultar**: mantener presionado 600 ms o botón "Ocultar" en el header del chat → desaparece y
  queda una pestaña fina de 24 px en el borde con la cara a medias para traerlo de vuelta. El
  estado se guarda en `localStorage`. También se puede volver a mostrar desde Ayuda.
- **Panel de chat** tipo sheet (mismo lenguaje visual de `ingeco.css`): header con IngeBot, nombre
  de la persona, cupo y botón ocultar; lista de mensajes; chips de sugerencia iniciales según los
  módulos de la persona ("¿Cuánto asfalto hay en tanque?", "Tarjas de hoy", "OC pendientes de
  Autovías"); caja de texto con enviar. Markdown mínimo: negritas, listas, tablas simples.
- **Fuentes**: debajo de cada respuesta, chips "Asfalto · DIARIO", "Tarja · TARJAS_2026" que abren
  el módulo en la app (`#modulo/COD`). Pulgar arriba/abajo.
- **Historial** en `sessionStorage` (se pierde al cerrar la pestaña). Botón "Nueva conversación".
- La vista Ayuda queda solo con Guías; la pestaña Preguntar abre a IngeBot.
- Personaje: cara SVG propia, trazo INGECO (azul `--azul`, teal), casco de obra, antena corta,
  ojos que parpadean. Nada de robot genérico gris. Se dibuja inline (sin PNG) para animarlo con CSS.

## 5. Fuentes de la primera versión

Cada fuente se declara en un **catálogo en código** (`backend/bot_fuentes.js`): módulo que la
habilita, planilla (ID en Script Property o constante), pestaña(s), columnas con descripción,
claves para cruzar. Agregar un sistema es agregar una entrada.

| módulo | planilla / origen | tablas | notas |
|---|---|---|---|
| **ASFALTO** | STOCK ASFALTO `1rqS_raT…` | `DIARIO` (fecha, stock_t, recibido_t, obs, arranques), `SALIDAS` (fecha, destino, mezcla_t), `CONFIG` solo PORC_TEORICO/TOLERANCIA/STOCK_MINIMO/CAPACIDAD | el consumo real entre mediciones se calcula igual que en el sistema: lo documenta el diccionario |
| **AUTOVIAS** | planilla de Autovías (Property `AUTOVIAS_SHEET_ID`) + combustible Leandro `19eyY8MI…` hoja ENTREGAS filtrada "autovia" | `PRODUCCION` (fecha, toneladas, viajes, jornada, combustible_ars), `PUNTAS`, `EQUIPOS` (alquileres) | la mezcla de Autovías es `SALIDAS` de Asfalto con destino Autovías |
| **EXPEDIENTES** | Expedientes - Datos `1XhsRoR6…` + OBRAS INGECO `1Hl8HZqr…` | `ESTADO_ACTUAL`, `MOVIMIENTOS`, `GESTIONES`, `OFICINAS`, `Detalle Municipio` | `dias_quieto`, `etapa` ya vienen calculados |
| **TARJAS** | planilla Tarja (Property `TARJA_SHEET_ID`) | `TARJAS_<año>` (todas las existentes), `EQUIPOS`, `PENDIENTES`, `ABIERTAS`, `PERSONAL` (solo legajo/nombre/obra, sin datos personales) | **clave de cruce:** código de equipo y nombre de obra; la ubicación "dónde está el equipo" = última tarja por equipo |
| **DASHBOARD** | mismas planillas que lee María (IDs completos en §5.6) | OC insumos (hoja ÓRDENES), maestro de obras, obras a cobrar, cobros reales, equipos y precio mensual de flota, partes diarios, remitos de asfalto, remitos Amaicha, precio de asfalto, gastos de estructura, combustible Tiburcio y Herrero | **excluido:** carpeta TANGO entera (sueldos). Se lee la planilla, no la API de María; su código no se toca. Vedadas: ver §5.6 |
| **COMPRAS** | Pedidos de compra (Postgres Neon) | ordenes, solicitudes, items (campos no sensibles) | ver §5.5 |

Códigos de módulo: el seed de la app dice `TARJA` pero el sistema usa `TARJAS`. El catálogo acepta
ambos como sinónimos y queda anotado para unificar en la hoja MODULOS.

### 5.5 Puente a Pedidos de compra

Pedidos de compra no está en planillas. El repo vigente es la carpeta local `ingeco-pedidos-vercel`
(remoto `pedidosingeco/pedidos-compra`, Neon; `pedidos-compra` es una copia vieja de septiembre).
Se le agrega un método RPC
de solo lectura **`botConsultar`** que recibe `{consulta}` con la misma gramática de
`leer_tabla`/`resumir_tabla` (tabla ∈ {ordenes, solicitudes, items}, filtros, agrupación, límite)
y se autentica con un header `X-Bot-Clave` = env `BOT_CLAVE` (y la misma clave en Script Property
`COMPRAS_BOT_CLAVE` del backend común). Devuelve filas sin `credencial_hash`, sin firmas, sin
`autorizaciones_json` crudo (solo quién autorizó y cuándo). El backend común lo invoca desde la
herramienta `pedidos_compra` solo si la persona tiene `COMPRAS`. Nada de SQL libre desde el bot. Tope: 300 filas por consulta y caché de 10 min en el backend común
por consulta idéntica; Neon ya agotó una vez el cupo Free por transferencia, así que el puente no
hace barridos: `resumir_tabla` se traduce a `GROUP BY` en el servidor.

### 5.6 IDs y columnas vedadas del DASHBOARD

Tomados del código de María (`ingeco-dashboard/apps_script_ingeco.gs`, `FILE_IDS`):

| fuente | ID | nota |
|---|---|---|
| OC insumos (Guillermo), hoja ÓRDENES | `1UWUIW4sNtRBa90nYoGg88ghGK8SyyjKe9UdZLRcHMEE` | |
| Maestro de obras (COD_OBRA) | `1VbG7DPqaOSlYkvQxbxag-4P2sOoRJQwWGccbx9OMyBM` | clave de cruce con Tarja por nombre de obra |
| Obras a cobrar (Agustín) | `1YldZRtbLh17Xqczl-omI0zjHcgvrhvp3QOsjWffEm_s` | |
| Cobros reales (Esteban), una pestaña por mes | `1EwrHdUkCBER10vBZyrQBodJOrfEr2p94QlfYZ7ewSmY` | el catálogo une las pestañas |
| Equipos + precio mensual de flota (Adrián) | `1PEcPzwrQ8kE2evmUlrFq9wPbgWOR92MPl3LEqcSYbIk` | |
| Partes diarios (Nico) | `1e_emRVEUxTaNtLxeC0wXIWKzcKuoulZkFSS9O1e0XHo` | también la lee Tarja |
| Repuestos / pedidos (Nico), hoja ENTREGAS | `1JpXjGTJwlvMuEI-rFTd4KeKvzd708-yuSLAhIRuCFC0` | misma planilla que importa Compras |
| Remitos oficiales de asfalto (Roberto) | `1_c6El5XDWoy84J7UAe8xlA1WC03IdklQyraMZEbQiEs` | |
| Mezcla desde Amaicha (María) | `1k5tUEAHh_ecCY81Y7oGAcxMz6hQ0A0Fna4ewLWPIuUg` | |
| Precio de mercado del asfalto $/t | `1lqKTXtDLT2FxyXurxjU1uE4epDOKs5SP8AXu5wAUsJ4` | |
| Gastos de estructura (libro mayor) | `1beFIrKD6ljPKjjssuWP-_TmTH8vr1TktBnVDuX9nxyM` | ver vedadas |
| Combustible Tiburcio Sanz | `1DD8BVoF6jX-CcakbbVO6fNJKYF82qBIK1YwyVLQcDJ8` | |
| Combustible Carlos Herrero | `1GB_oiL40fEXHXzhmor3ztnnriiikX1xp3fG-F5Uuw5E` | |

**No entra:** carpeta TANGO `1hQZoJovbFDHNsJhNiGMEueH1bLfXuuCP` (liquidaciones), formulario de
ajuste de stock y planilla de ajustes del tablero (son internos de María).

**Vedadas (mi criterio):** en toda fuente DASHBOARD se descartan al leer las columnas cuyo
encabezado contenga `sueldo`, `haber`, `jornal`, `remuner`, `liquidac`, `cuil`, `dni`; en Gastos de
estructura además se descartan las filas cuya categoría o descripción contenga `sueldo`, `haber`
o `cargas sociales`. El constructor revisa los encabezados reales al armar el catálogo y amplía la
lista si encuentra otro nombre; ante la duda, afuera.

**Precondición antes de empezar:** verificar desde el editor del backend común que
`SpreadsheetApp.openById` abre cada una de estas planillas con la cuenta de Marcos. Las que fallen se
piden compartir a su dueño; mientras tanto esa fuente queda fuera del catálogo, no bloquea al resto.

## 6. Reglas de comportamiento (van en el system prompt)

1. Respondé corto: una o dos oraciones con el dato y su fecha. Si piden más detalle, tabla o serie,
   ahí sí ampliá.
2. Siempre decí de qué fuente salió cada dato (módulo y tabla). Si cruzaste, nombrá las dos.
3. Nunca inventes un número ni un nombre. Si una búsqueda no trae nada, decilo y sugerí dónde
   mirar.
4. Si la pregunta toca un módulo que la persona no tiene, decí que ese dato vive en tal sistema y
   que pida acceso a Marcos; no intentes leerlo.
5. Antes de leer una tabla grande, filtrá por fecha o por clave; usá `resumir_tabla` para totales.
6. Si la pregunta es sobre cómo usar la app, respondé con los instructivos (lo que hoy hace ayuda).
7. Fechas y horas en horario de Tucumán. Montos en pesos con separador de miles.
8. Tono neutral y directo; nada de disculpas largas ni emojis.

## 7. Seguridad y privacidad

- Clave de Anthropic en Script Property `CLAUDE_API_KEY` (ya existe). Nunca en el repo público.
- Permiso verificado **dentro de cada herramienta**, no solo al armar el prompt.
- Columnas vedadas por fuente (sueldos, PINs, hashes, celulares de PERSONAL) se declaran en el
  catálogo y se descartan al leer, antes de que lleguen a Claude.
- Lo que Claude manda como argumentos de herramienta es dato, no código: no hay `eval`, no hay
  SQL libre, los filtros son estructurados.
- El log `CONSULTAS_BOT` recorta la respuesta a 500 caracteres; lo lee solo ADMIN.
- Hallazgos del relevamiento, fuera de alcance del bot pero para cerrar aparte: Autovías tiene una
  clave temporal en `doGet` que graba `ASFALTO_CLAVE` por URL (sacar); el proxy de AlberBot no
  verifica identidad (al menos exigir `REFRESH_KEY` o migrar a IngeBot).

## 8. Despliegue y verificación

- Alta del módulo `BOT` en la hoja MODULOS (tipo interno, sin URL) y permisos iniciales a Marcos,
  Gerencia e ingenieros desde Admin.
- Backend: `clasp push` + nueva versión del deployment existente de app-ingeco (mismo `/exec`).
  Properties nuevas: `AUTOVIAS_SHEET_ID`, `TARJA_SHEET_ID`, `COMPRAS_BOT_CLAVE`, `BOT_CUPO_DIA`,
  `BOT_SIN_TOPE`. Script `scripts/setup_bot.sh` documenta cómo cargarlas sin tocar prod a mano.
- Pedidos de compra: push a main (deploy directo, regla de Marcos) con env `BOT_CLAVE` en Vercel.
- Shell: `?v=N` en assets y bump del SW, push a main (gh-pages por subtree, como siempre).
- Prueba de aceptación, con la sesión real de Marcos en Chrome:
  1. "¿Cuánto asfalto hay en tanque?" → número, fecha, chip Asfalto.
  2. "¿Qué equipos están en Canal Margaritas?" → lista desde Tarja.
  3. "¿Hay OC pendiente para alguno de esos?" → cruce Tarja + Compras, chips de ambos.
  4. Con un usuario de prueba sin ASFALTO: la pregunta 1 devuelve "pedí acceso", y en el log no
     hay lectura de la fuente.
  5. Arrastrar, soltar en borde izquierdo, recargar: queda ahí. Ocultar, recargar: sigue oculto.
  6. Cupo: forzar `BOT_CUPO_DIA=2` para un legajo de prueba y ver el mensaje al tercer intento.

## 9. Lo que queda al constructor

- Forma exacta del diccionario de fuentes (texto vs JSON) y cómo describir las columnas; medir
  tokens del bloque estable (apuntar a <15k).
- Troceado de caché, orden de lectura, y si conviene un snapshot nocturno de las tablas más
  pesadas (OC insumos) en una planilla propia del bot.
- Dibujo definitivo de IngeBot (iterar con Marcos, que rechaza lo genérico; mostrarle 2 o 3
  bocetos SVG antes de integrar).
- Textos de los chips de sugerencia por módulo.
- Cómo convive con el iframe de los módulos: el FAB vive en el shell, no dentro de los iframes;
  cuando un módulo está abierto en la app, `modulo_contexto` se manda para que el bot priorice esa
  fuente.

## 10. Tandas siguientes (fuera de esta versión)

1. Sumar INGECOV (fuentes del snapshot), PAVIMAX, Terminal (locales y pedidos), Licitaciones,
   Rendiciones.
2. Acciones con confirmación: crear aviso, abrir pedido, cerrar pendiente de tarja.
3. Reemplazar AlberBot en INGECOV por IngeBot vía ticket.
4. Preguntas programadas ("todos los lunes mandame el consumo de la semana") usando Enviar avisos.
