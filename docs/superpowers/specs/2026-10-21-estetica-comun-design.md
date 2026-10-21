# Estética común para los sistemas de INGECO — diseño

Fecha: 21-oct-2026 · Pedido por: Marcos Katz

## Para qué

Hoy cada sistema se abre desde la App INGECO, pero se ve como otra aplicación: otros colores, otra letra, otras barras y otros botones. Marcos quiere que **al entrar a cualquier sistema desde la App no se note el salto**, que todo parezca la misma app.

Por ahora alcanza con que **se vea igual**. La navegación y la forma de trabajar de cada sistema no cambian. Más adelante se evalúa si con eso alcanzó.

## Alcance

**Entran (10 sistemas):**

| Sistema | Carpeta local | UI a tocar | Estado hoy | Esfuerzo estimado |
|---|---|---|---|---|
| INGECOV (panel de flota) | `Downloads\ingecov-repo` | `index.html` (unas 1870 líneas de CSS inline) + `js\*.js` (renderers con colores fijos, Chart.js, Leaflet) + `mapa-baches.html` | Naranja `#e85d1a`, JetBrains Mono, **modo oscuro** | Grande |
| Pedidos de Compra | `ingeco-pedidos-vercel\public` | `index.html` (CSS de unas 830 líneas, tokens prolijos) + `firmar.html` (copia de los tokens) | Navy `#1f3866`, IBM Plex | Medio |
| Traslados | `traslados` (ver nota) | `index.html` (unas 450 líneas) | Azul `#0b4f8a`, verde y rojo, fuente del sistema | Chico |
| PAVIMAX carga | `pavimax-repo\cargar.html` | CSS inline duplicado | Verde `#157f3d`, fuente del sistema | Chico a medio |
| PAVIMAX operario | `pavimax-repo\index.html` | CSS inline duplicado | Igual que carga | Chico a medio |
| Obra Autovías | `Proyectos\obra-autovias\docs` | `index.html` (CSS minificado) + Chart.js | Índigo `#2A3D7C`, fuente del sistema | Chico |
| Tarja de flota (operarios + panel TARJAS) | `tarja-flota\docs` | PWA: `estilo.css` + `app.js` · Panel: `panel.css` (ya es v3) | La PWA tiene el teal viejo; el panel ya coincide | Medio (casi todo en la PWA) |
| Tarja Corrientes (operarios + panel) | `tarja-corrientes\docs` | `estilo.css` compartido + bloque inline en `panel.html` | Teal viejo | Medio |
| Licitaciones NOA | `licitaciones-noa\index.html` | Un archivo con variables semánticas | Azul `#2a78d6`, verde y rojo, **modo oscuro**, pensado para escritorio | Chico a medio |
| Expedientes | `expedientes-ingeco\web` | `estilos.css` + `app.js` | Barlow, teal `#0f766e` | Chico |
| Rendiciones | `rendiciones\docs` | `estilo.css` | Ya es v3 | Retoques |

**Nota sobre Traslados:** existe otra copia en `ingecov-repo\traslados\` y difiere de la de `traslados\`. Antes de tocar nada, el builder confirma cuál es la que está publicada y restyla esa.

**Quedan afuera (decisión de Marcos):** Ropa de Trabajo, Demarcación Vial, relevamiento de baches con Waze, Locales Terminal y Pedidos Terminal (estos dos últimos no son de INGECO).

## Objetivos

1. Los 10 sistemas usan la misma paleta, la misma tipografía y los mismos componentes que la App INGECO (shell v3, `app-ingeco\shell\styles.css`).
2. **Un solo archivo de estilos común**, publicado desde la App en `https://marcoskatz-cmd.github.io/app-ingeco/ingeco.css`, igual que hoy se publica `guard.js`. Todos los sistemas lo cargan. Un cambio futuro de estética se hace en un solo lugar. *(Decisión de Claude, que Marcos vio en la propuesta.)*
3. PAVIMAX usa la misma estética pero **conserva su logo**.

## No-objetivos

- No cambia la navegación: no se agrega la barra inferior de la App y se mantienen las pestañas y vistas que ya tiene cada sistema.
- No cambian funcionalidades, flujos, logins ni backends.
- No se rediseñan pantallas: se cambia la piel.

## Anti-objetivos (sería un fracaso aunque "funcione")

- Que algún sistema deje de andar o pierda datos por el cambio: hay sistemas en producción usados por operarios en el campo.
- Rojo contra verde como única forma de distinguir estados. **Marcos es daltónico rojo-verde.** Se usa teal para bien, ámbar para pendiente y naranja oscuro `--alerta` para problema, siempre con texto o etiqueta además del color.
- Que quede con aspecto genérico o neutro. Marcos rechaza los monogramas y los íconos de relleno: van los logos reales.
- Modo oscuro: **se saca** donde exista (INGECOV, Licitaciones). A Marcos no le gusta.
- Perder legibilidad al sol en las PWA de operarios (Tarjas): el contraste se mantiene o mejora.
- Que si `ingeco.css` no carga (sin señal, por ejemplo) la app quede rota o ilegible.

## Lo que se decidió

**Lenguaje visual.** Es el de la App INGECO tal como está en `shell\styles.css`:
- **Tokens:** `--azul #1e3a8a`, `--azul-claro`, `--azul-suave`, `--tinta #0f1a3d`, `--teal`, `--ambar`, `--alerta`, sus variantes `-suave`, `--fondo #f5f4f0`, `--fondo-2`, `--superficie`, `--texto`, `--texto-2`, `--texto-3`, `--linea`, `--linea-fuerte`, radios de 14 y 10 px, sombras y las fuentes `--display` y `--cuerpo`.
- **Tipografía:** Barlow para el cuerpo; Barlow Semi Condensed para títulos, números y etiquetas.
- **Barra superior:** clara, translúcida, con una línea fina abajo. Lleva título en `--tinta`, acciones con íconos de trazo y una flecha para volver a la App (la App ya escucha el `postMessage` `ingeco_volver`).
- **Componentes:**
  - Pestañas en pastilla (la activa en `--tinta`).
  - Tarjetas blancas con borde `--linea`.
  - Listas con separadores finos.
  - KPI con número en Semi Condensed.
  - Etiquetas de estado `.estado`: fondo suave y texto fuerte.
  - Botones `.primario`, `.secundario`, `.chico` y `.peligro` de 46 px de alto.
  - Inputs con borde `--linea-fuerte` y foco azul.
  - Modal tipo hoja inferior.
  - Toast oscuro, con variantes `.ok` (teal) y `.mal` (naranja).
  - Esqueleto de carga y spinner.
- **Íconos:** de trazo (24×24, `stroke-width` 1.8, `currentColor`), como en la App. Sin librerías de íconos.
- **Solo modo claro.**

**PAVIMAX.** Misma piel. En la barra va el logo de PAVIMAX (`logo-pavimax.png` de la App, o el `logo.png` del repo). El acento pasa al azul común; el verde actual se va. *(Suposición de Claude mostrada en la maqueta, aprobada por Marcos con el resto.)*

**Logos.**
- INGECO en los sistemas de INGECO.
- PAVIMAX en los dos de PAVIMAX.
- Tarja Corrientes conserva la banda UTE con Casella + INGECO.

**Maqueta de referencia aprobada:** se le mostró a Marcos INGECOV antes y después, Traslados y PAVIMAX con la nueva piel (barra clara, pestañas en pastilla, KPI, lista de tarjetas con estados, formulario con firma y toast). Respondió "dale". Una copia queda en `docs/superpowers/specs/2026-10-21-estetica-comun-maqueta.html`.

**INGECOV en el celular:** las tablas largas pueden pasar a lista de tarjetas en pantallas angostas. En la computadora siguen siendo tablas, con el estilo `.grilla` de la App.

**Deploy:** commit y push directo a `main` (o a `gh-pages` según cada repo) en todos los proyectos, sin staging ni Preview (regla de Marcos del 1-oct-2026). En Ropa solo se despliega desde `Desktop\ingeco-ropa`, aunque Ropa queda fuera de este trabajo.

**Versión del estilo común (decisión de Marcos, opción A):**
- Los 10 sistemas cargan siempre la **última versión** de `ingeco.css`. No se ancla una versión por sistema.
- Un cambio de estética se publica en un solo lugar.
- El riesgo aceptado es que un error rompe a todos a la vez. Para mitigarlo, cada cambio se prueba en al menos un sistema antes de publicarlo, y si algo sale mal se arregla en ese mismo archivo.
- El service worker de las PWA debe traer la versión nueva cuando hay red (red primero o stale-while-revalidate) y usar la copia cacheada solo sin señal.

**La App también usa `ingeco.css` (decisión de Claude):**
- `ingeco.css` se **extrae** de `shell\styles.css`: tokens, base y componentes compartidos.
- El shell pasa a cargarlo y deja en `styles.css` solo lo que es propio de la App: hero, tiles, nav, bandeja de avisos, chat.
- Así la App no se desfasa del resto.
- Es el paso más delicado, porque la App está en producción. Se verifica que la App quede visualmente idéntica antes de seguir con los sistemas.

**Flecha "volver a la App" (decisión de Claude):**
- **Dentro del iframe de la App:** el sistema no muestra flecha propia, porque la App ya tiene la suya.
- **Abierto desde la App en una pestaña aparte:** se detecta porque llegó con ticket (`guard.js`) o con la App como referrer. La flecha lleva a `https://marcoskatz-cmd.github.io/app-ingeco/`.
- **Abierto directo:** por ejemplo, operarios desde el ícono del celular, como en la PWA de Tarja de flota o en Traslados. **No hay flecha.**
- En todos los casos la barra sigue mostrando el título y las acciones propias del sistema.

## Restricciones

- **Todos los sistemas son estáticos** (GitHub Pages, o Vercel en el caso de Pedidos) y usan Apps Script o Node como API JSON. HtmlService no se usa a propósito. No se introduce ningún build, framework ni Tailwind.
- **Hosting de `ingeco.css`:** la App publica `shell\` en `gh-pages` por subtree. El archivo va en `shell\ingeco.css` y se versiona por query string (`?v=N`), como `styles.css?v=21`.
- **Caché y offline:**
  - Las PWA con service worker (Tarjas, Expedientes, Rendiciones, PAVIMAX, Autovías) tienen que seguir funcionando sin señal.
  - La App ya tuvo problemas de caché de assets.
  - Por eso hay que resolver cómo un sistema offline tiene `ingeco.css` disponible: cachearlo en su SW o tener un fallback local.
- **Riesgo cruzado:** un error en `ingeco.css` afecta a los 10 sistemas a la vez. Se aceptó; ver "Versión del estilo común".
- **Colores dentro del JS:** INGECOV, Autovías y los paneles de Tarjas tienen colores fijos en los renderers y en las configs de Chart.js y Leaflet. Hay que pasarlos a los tokens, leyéndolos con `getComputedStyle` o con constantes compartidas.
- **Paleta de gráficos:** debe ser apta para daltonismo rojo-verde (azul, teal, ámbar, naranja oscuro, gris).

## Lo que queda para el builder

- La API concreta de `ingeco.css`: qué parte es tokens, qué parte es base (reset, tipografía) y qué parte son componentes, y cómo convive con los nombres de clase que ya usa cada sistema. Puede mapear las variables viejas a las nuevas, renombrar clases o combinar ambas cosas.
- La estrategia para offline y caché de `ingeco.css`, y el fallback si no carga.
- El mecanismo concreto para detectar el contexto (iframe, pestaña aparte o directo). Puede ser un script chico compartido junto a `ingeco.css`, o integrarse en `guard.js` si no rompe su contrato de "nunca bloquea".
- El orden de los sistemas. Sugerencia: primero `ingeco.css` y la App sobre él; después un piloto chico (Expedientes o Traslados); después los chicos y medianos; INGECOV al final.
- Qué hacer con JetBrains Mono en INGECOV. Se puede reemplazar por números tabulares en Barlow (`font-variant-numeric: tabular-nums`).
- Cómo verificar cada sistema: abrirlo en el navegador, a ancho de celular y de escritorio, y confirmar que no hay errores en consola y que las acciones principales siguen funcionando.
