# Estética común INGECO — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los sistemas de INGECO se vean como la App INGECO, cargando un estilo común publicado desde la App.

**Architecture:**
- La App publica dos archivos chicos junto a `guard.js`:
  - `ingeco.css`: tokens de diseño y estilos base de elementos.
  - `ingeco.js`: detecta el contexto (iframe / pestaña / directo), maneja la flecha de volver y entrega la paleta para gráficos.
- El shell pasa a usarlos.
- Cada sistema hace cuatro cosas:
  - carga los dos archivos;
  - reemplaza su `:root` por un bloque de **alias** (sus nombres viejos apuntan a los tokens comunes);
  - restyla sus propios componentes con esos tokens;
  - saca los colores fijos del JS.
- Las clases propias de cada sistema no se renombran.

**Tech Stack:** HTML/CSS/JS vanilla estático (GitHub Pages; Vercel solo en Pedidos). Sin build ni frameworks. Chart.js y Leaflet donde ya estaban.

**Spec:** `docs/superpowers/specs/2026-10-21-estetica-comun-design.md` (y la maqueta `2026-10-21-estetica-comun-maqueta.html` al lado).

## Global Constraints

- **Tokens:** los de `shell/styles.css` líneas 8–33, verbatim, más los nuevos de la Task 1. Hay un solo set de tokens y ningún sistema redefine sus valores.
- **Solo modo claro:** se elimina todo `[data-theme=dark]`, `prefers-color-scheme: dark` y cualquier toggle de tema.
- **Daltonismo rojo-verde:**
  - teal = bien, ámbar = pendiente, `--alerta` (naranja oscuro) = problema.
  - Todo estado lleva texto además del color.
  - No queda ningún verde (`#16a34a`, `#1e8e3e`, `#0ca30c`, `#166534`, `#157f3d`) ni ningún rojo (`#dc2626`, `#c5221f`, `#d03b3b`, `#b91c1c`, `#c0392b`) en las UI tocadas.
- **Texto ámbar:** el texto sobre fondo claro usa `--ambar-texto` (`#8a5a00`), nunca `--ambar`.
- **Tipografía:**
  - Cuerpo: `var(--cuerpo)` (Barlow).
  - Títulos, números grandes y etiquetas: `var(--display)` (Barlow Semi Condensed).
  - Las cifras en tablas llevan `font-variant-numeric: tabular-nums`.
  - Afuera: IBM Plex, JetBrains Mono, Inter y system-ui como fuente principal.
- **Versión del estilo común:** los sistemas cargan `https://marcoskatz-cmd.github.io/app-ingeco/ingeco.css` y `.../ingeco.js` **sin `?v=`**, para tomar siempre la última (opción A).
- **Flecha de volver:**
  - Iframe: no se ve. Al tocarla manda `postMessage({tipo:'ingeco_volver'})`.
  - Pestaña abierta desde la App: se ve y lleva a `https://marcoskatz-cmd.github.io/app-ingeco/`.
  - Directo: no se ve.
- **Logos:**
  - INGECO en los sistemas de INGECO.
  - PAVIMAX en sus dos páginas.
  - Tarja Corrientes conserva la banda UTE (Casella + INGECO).
- **Quedan sin tocar:** Ropa, Demarcación Vial, Waze, Locales Terminal, Pedidos Terminal y `ingecov-repo/mapa-baches.html` (es de baches).
- **No cambian:** flujos, logins, backends ni Apps Script. Solo HTML, CSS y JS de front.
- **Deploy:** commit y push directo a la rama publicada de cada repo, sin staging ni Preview. Commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git push` se corre por PowerShell (bajo Bash se cuelga).

## Review Focus

1. **`ingeco.css` no carga** (GitHub caído, primera visita sin señal): la página tiene que seguir legible y los botones visibles. Lo cubre el respaldo mínimo (Task 1) y el chequeo "sin ingeco.css" de la receta (paso R7).
2. **Sistema dentro del iframe de la App:** no aparece una segunda flecha de volver ni el logo duplicado. Lo cubren los casos de `ingeco-prueba.html` (Task 1) y el chequeo integrado (Task 12).
3. **Operario abre la PWA desde el ícono del celular:** no ve la flecha de volver. Lo cubren el caso "directo" (Task 1) y R7.
4. **Estados que solo se distinguen por color:** cada chip o etiqueta de estado tiene texto. Lo cubre el chequeo R7.
5. **Celulares con la PWA cacheada siguen viendo la piel vieja:** se sube la versión del caché del SW en cada sistema que lo tenga y se confirma en vivo (paso R9).

---

## La receta común (R1–R9)

Las Tasks 3 a 11 aplican esta receta. Cada task da sus datos: archivos, tabla de alias, colores viejos y forma de deploy.

**R1. Cabecera.** En el `<head>`, **antes** de cualquier estilo propio:

```html
<style>:root{--azul:#1e3a8a;--azul-suave:#e6ecfb;--tinta:#0f1a3d;--teal:#0e8a7a;--ambar-texto:#8a5a00;--alerta:#b8410e;--fondo:#f5f4f0;--superficie:#fff;--texto:#171c2e;--texto-2:#5b6274;--linea:#e2dfd7;--linea-fuerte:#c9c5bb;--radio:14px;--radio-s:10px;--cuerpo:system-ui,sans-serif;--display:system-ui,sans-serif}</style>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://marcoskatz-cmd.github.io/app-ingeco/ingeco.css">
<script src="https://marcoskatz-cmd.github.io/app-ingeco/ingeco.js" defer></script>
```

El primer `<style>` es el **respaldo mínimo**. `ingeco.css` viene después y lo pisa. Si `ingeco.css` no llega, el respaldo queda. Va idéntico en todos los sistemas.

**R2. Alias.** Se reemplaza el `:root` del sistema por la tabla de alias de la task:
- Una variable vieja cuyo nombre coincide con un token común (`--azul`, `--texto`, `--fondo`, `--alerta`, `--teal`) **se borra**.
- Si en ese sistema la variable tenía otro significado, primero se renombran sus usos (lo indica la task).

**R3. Fuentes.**
- Se borran los `<link>` a otras fuentes.
- `font-family` pasa a `var(--cuerpo)`. Los títulos, KPI y etiquetas pasan a `var(--display)`.
- Las tablas llevan `tabular-nums`.

**R4. Barra superior.** El header del sistema adopta el look de `.barra` del shell:
- Alto `56px`.
- Fondo `color-mix(in srgb, var(--fondo) 88%, transparent)`, con `backdrop-filter: blur(12px)`.
- `border-bottom: 1px solid var(--linea)`.
- Título en `var(--display)` 600 color `var(--tinta)`.

Como primer hijo de la barra va:

```html
<button class="ig-volver" data-ig-volver aria-label="Volver a la App INGECO"><svg class="i" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button>
```

El logo y el título que repiten lo que ya muestra la App llevan `data-ig-ocultar-en-app`.

**R5. Componentes propios.** Se restylan con tokens, en el idioma visual del shell:
- **Pestañas:** pastilla, `border-radius: 999px`; la activa con fondo `--tinta` y texto `--fondo`.
- **Tarjetas:** fondo `--superficie`, borde `--linea`, radio `--radio`.
- **Botón principal:** fondo `--azul`, texto `#fff`, alto mínimo 46px, radio `--radio-s`.
- **Botón secundario:** fondo `--superficie`, borde `--linea-fuerte`, texto `--azul`.
- **Estados:** fondo `-suave` y texto fuerte, en mayúscula `.68rem`/600, como `.estado` del shell.
- **Inputs:** borde `--linea-fuerte`, radio `--radio-s`, foco con outline de 2px `--azul-claro`.
- **Toast:** fondo `--tinta`; `ok` con `--teal`, `mal` con `--alerta`.
- **Modal:** hoja inferior en el celular.

**R6. Colores en JS e inline.**
- Se buscan los colores de la lista "colores viejos" de la task en `.js` y en `style="..."`.
- En estilos inline o en `cssText` se reemplazan por `var(--token)`.
- En Chart.js y Leaflet se reemplazan por `IG.color('token')` o `IG.paleta()`. Se hace dentro de la función que arma el gráfico, no al cargar el módulo, porque `ingeco.js` es `defer`.

**R7. Verificación en el navegador.** Con `preview_start` (configs de `C:\Users\Usuario\.claude\launch.json`; si falta, se agrega una con `python -m http.server`):

1. Se revisa a 375×812 y a 1280 de ancho. La consola no tiene errores nuevos y la acción principal del sistema funciona (cargar, filtrar, abrir detalle).
2. Se corre el chequeo en la consola:

   ```js
   document.querySelector('link[href*="ingeco.css"]').disabled = true;
   [getComputedStyle(document.body).fontFamily, getComputedStyle(document.querySelector('<botón principal>')).backgroundColor]
   ```

   Lo esperado es que el botón siga en `rgb(30, 58, 138)`. Después se vuelve a poner `disabled = false`.
3. Los chips de estado tienen texto: `[...document.querySelectorAll('<selector de estado>')].every(e => e.textContent.trim())` devuelve `true`.
4. La flecha de volver está oculta (contexto directo): `document.documentElement.dataset.igContexto === 'directo'`, y `[data-ig-volver]` tiene `display: none`.
5. Captura de pantalla para Marcos.

**R8. Chequeo de restos (hace de test):**

```bash
grep -rniE "<colores viejos de la task>|IBM Plex|JetBrains|data-theme|prefers-color-scheme: *dark|color: *var\(--ambar\)" <archivos de la task>
```

- Se corre **antes** de tocar nada: tiene que encontrar líneas (falla).
- Se corre **después**: tiene que dar vacío (pasa).

**R9. Deploy y confirmación en vivo.**
- Si el sistema tiene service worker, se sube el nombre o versión de su caché.
- El SW trata las URLs de `marcoskatz-cmd.github.io/app-ingeco/ingeco.*` como **red primero con respaldo de caché**.
- Commit y push. Después se abre la URL publicada con `?v=<timestamp>` (Pages cachea unos 10 minutos) y se confirma con `read_network_requests` que pidió `ingeco.css` y que la piel es la nueva.

---

### Task 1: `ingeco.css` + `ingeco.js` + página de prueba

**Files:**
- Create: `app-ingeco/shell/ingeco.css`
- Create: `app-ingeco/shell/ingeco.js`
- Create: `app-ingeco/shell/ingeco-prueba.html`

**Interfaces:**
- Produces:
  - **Tokens en `:root`, sin capa:** todos los de `styles.css` 8–33, más:
    - `--ambar-texto:#8a5a00`
    - `--sombra-media:0 4px 14px rgba(23,28,46,.10)`
    - la paleta de gráficos `--g1:#1e3a8a; --g2:#0e8a7a; --g3:#d98f00; --g4:#b8410e; --g5:#6d4ab1; --g6:#5b6274`
  - **Clases de `ingeco.css`:** `.ig-volver` (botón redondo de 44px, transparente, color `--texto-2`) y `svg.i`.
  - **Atributos que lee `ingeco.css`:** `html[data-ig-contexto]`, `[data-ig-volver]`, `[data-ig-ocultar-en-app]`.
  - **API de `window.IG`:**
    - `IG.contexto(env) -> 'iframe'|'pestana'|'directo'`, con `env = {enIframe:boolean, referrer:string, sesionGuard:boolean, ticketEnUrl:boolean}`.
    - `IG.color(nombre:string) -> string`, que es `getComputedStyle(documentElement).getPropertyValue('--'+nombre).trim()`.
    - `IG.paleta() -> string[]`, que devuelve `--g1`…`--g6`.
    - `IG.volver() -> void`.
    - `IG.APP_URL = 'https://marcoskatz-cmd.github.io/app-ingeco/'`.

- [ ] **Step 1: Escribir `ingeco-prueba.html` con las aserciones (falla porque `IG` no existe)**

La página carga `ingeco.css` e `ingeco.js` en forma relativa, corre las aserciones y escribe en `#resultado` "TODO OK" o la lista de fallas. Debajo muestra muestras de cada token, botones y un chip de estado.

```js
const casos = [
  [{enIframe:true,  referrer:'', sesionGuard:false, ticketEnUrl:false}, 'iframe'],
  [{enIframe:true,  referrer:'', sesionGuard:true,  ticketEnUrl:true }, 'iframe'],
  [{enIframe:false, referrer:'', sesionGuard:false, ticketEnUrl:true }, 'pestana'],
  [{enIframe:false, referrer:'', sesionGuard:true,  ticketEnUrl:false}, 'pestana'],
  [{enIframe:false, referrer:'https://marcoskatz-cmd.github.io/app-ingeco/#inicio', sesionGuard:false, ticketEnUrl:false}, 'pestana'],
  [{enIframe:false, referrer:'https://www.google.com/', sesionGuard:false, ticketEnUrl:false}, 'directo'],
  [{enIframe:false, referrer:'', sesionGuard:false, ticketEnUrl:false}, 'directo'],
];
// cada caso: IG.contexto(env) === esperado
// IG.color('azul') === '#1e3a8a'; IG.color('ambar-texto') === '#8a5a00'
// IG.paleta().length === 6 && IG.paleta()[0] === '#1e3a8a'
// document.documentElement.dataset.igContexto === 'directo'  (la página abierta suelta)
// getComputedStyle(document.querySelector('[data-ig-volver]')).display === 'none'
```

- [ ] **Step 2: Abrir la página y ver que falla**

Run: `preview_start {name:"app-ingeco-shell"}` y navegar a `/ingeco-prueba.html`.
Expected: error `IG is not defined` en la consola, o fallas listadas.

- [ ] **Step 3: Escribir `ingeco.css`**

Contenido, en este orden:
1. El `@import` de Google Fonts de `styles.css` línea 5.
2. `:root{…}` sin capa, con los tokens.
3. `@layer ingeco { … }` con la base de elementos, tomada de `styles.css` líneas 36–51:
   - `*` box-sizing;
   - `body` con font, color y fondo;
   - `h1`–`h4`;
   - `a` y `small`;
   - `input, select, textarea` con font, borde, radio y foco;
   - `svg.i`.

**No** lleva `button,input{min-height:46px}`: eso queda en `styles.css` porque agrandaría botones chicos de los sistemas.

Fuera de la capa:
- `.ig-volver`
- `[data-ig-volver]{display:none}`
- `html[data-ig-contexto="pestana"] [data-ig-volver]{display:inline-flex}`
- `html[data-ig-contexto="iframe"] [data-ig-ocultar-en-app]{display:none !important}`

- [ ] **Step 4: Escribir `ingeco.js`**

Es una IIFE sin dependencias. Al cargar:
- Arma `env`:
  - `enIframe`: `window.self !== window.top`, dentro de un try (si tira, cuenta como `true`).
  - `referrer`: `document.referrer`.
  - `sesionGuard`: `!!sessionStorage.getItem('ingeco_guard')`, dentro de un try.
  - `ticketEnUrl`: `/[?&]tk=/.test(location.search)`.
- Pone `document.documentElement.dataset.igContexto = IG.contexto(env)`.
- Delega el click en `[data-ig-volver]` a `IG.volver()`:
  - En iframe: `parent.postMessage({tipo:'ingeco_volver'}, '*')`.
  - Si no: `location.href = IG.APP_URL`.

- [ ] **Step 5: Recargar la prueba**

Expected: `#resultado` dice "TODO OK", la consola está limpia y las muestras se ven en Barlow con los colores del shell.

- [ ] **Step 6: Commit (todavía sin publicar)**

```bash
git -C app-ingeco add shell/ingeco.css shell/ingeco.js shell/ingeco-prueba.html
git -C app-ingeco commit -m "feat(shell): estilo común ingeco.css + ingeco.js"
```

### Task 2: El shell usa `ingeco.css` y se publica

**Files:**
- Modify: `app-ingeco/shell/styles.css:5-51` (se van el `@import`, los tokens y la base que pasaron a `ingeco.css`)
- Modify: `app-ingeco/shell/index.html:15` (agregar el `<link>` a `ingeco.css` antes de `styles.css?v=22`; agregar `ingeco.js` antes de `app.js`)
- Modify: `app-ingeco/shell/sw.js` (subir la versión del caché; sumar `ingeco.css` e `ingeco.js` a los assets)

**Interfaces:**
- Consumes: Task 1.
- Produces: `https://marcoskatz-cmd.github.io/app-ingeco/ingeco.css` e `ingeco.js` publicados. Todas las tasks siguientes dependen de esto.

- [ ] **Step 1: Foto del "antes"**

Con el shell local (`app-ingeco-shell`), a 375 y a 1280, se toman capturas del login. Si hay sesión, también de Inicio, Avisos y un modal. En consola se guarda:

```js
JSON.stringify(['body','.barra','.primario','.nav button','.tile .lbl','input'].map(s=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e);return [s,c.fontFamily,c.color,c.backgroundColor,c.borderRadius,c.minHeight]}))
```

- [ ] **Step 2: Hacer el cambio en `styles.css` e `index.html`; subir `?v=` a 22 y la versión del caché del SW**

- [ ] **Step 3: Foto del "después"**

Expected: el JSON es idéntico al del Step 1 y las capturas no tienen diferencias visibles.

- [ ] **Step 4: Commit, push y gh-pages**

```powershell
cd C:\Users\Usuario\app-ingeco; git add shell; git commit -m "refactor(shell): usa ingeco.css común"; git push origin main
git subtree split --prefix shell -b gh-pages; git push -f origin gh-pages; git branch -D gh-pages
```

- [ ] **Step 5: Confirmar en vivo**

Run: `curl -sI https://marcoskatz-cmd.github.io/app-ingeco/ingeco.css` y lo mismo con `ingeco.js`.
Expected: `200`. La App publicada se ve igual que antes y `/ingeco-prueba.html` publicada dice "TODO OK".

### Task 3: Expedientes (piloto)

**Files:**
- `expedientes-ingeco/web/index.html`, `estilos.css`, `app.js`, `sw.js`, `ayuda.html`
- Create: `web/logo.png` (copia de `app-ingeco/shell/logo.png`)

**Interfaces:** Consumes: Task 2 publicada; receta R1–R9.

**Alias (R2):** su `--teal` es el acento de la app. Antes de borrarlo, sus usos se renombran a `--azul`.

| Variable vieja | Pasa a |
|---|---|
| `--teal` como acento | `var(--azul)` |
| `--teal` como "ok" o "al día" | se queda `--teal` |
| `--teal-claro` | `var(--azul-suave)` (acento) o `var(--teal-suave)` (ok) |
| `--ambar` | `var(--ambar-texto)` (texto) o `var(--ambar)` (fondos y bordes) |
| `--ambar-claro` | `var(--ambar-suave)` |
| `--gris` | `var(--texto-2)` |
| `--gris-claro` | `var(--fondo-2)` |
| `--borde` | `var(--linea)` |
| `--texto` | se borra |
| `--fondo` | se borra |

**Colores viejos (R8):** `#0f766e|#ccfbf1|#b45309|#fef3c7|#6b7280|#f3f4f6|#e5e7eb|#111827|#fafafa|#d1d5db`

**Notas:**
- Las pestañas subrayadas pasan a pastilla.
- Se agrega el logo INGECO en la barra, con `data-ig-ocultar-en-app`.
- El preview se abre con `expedientes`.

**Deploy (R9):**
```powershell
git push origin main; git subtree push --prefix web origin gh-pages
```
URL: `marcoskatz-cmd.github.io/expedientes-ingeco`.

- [ ] Step 1: R8 antes (falla) · Step 2: R1–R6 · Step 3: R8 después (vacío) · Step 4: R7 · Step 5: commit + R9
- [ ] **Step 6: Mostrarle la captura a Marcos antes de seguir con el resto.** Es el piloto: si algo del lenguaje visual no le cierra, se corrige en `ingeco.css` o en la receta y recién después se sigue.

### Task 4: Obra Autovías

**Files:** `Proyectos/obra-autovias/docs/index.html` (CSS minificado; se des-minifica al tocarlo) y `docs/sw.js`.

**Alias:**

| Variable vieja | Pasa a |
|---|---|
| `--azul` | se borra |
| `--azul2` | `var(--azul-claro)` |
| `--gris` | `var(--fondo)` |
| `--txt` | `var(--texto)` |
| `--ok` | `var(--teal)` |
| `--mal` | `var(--alerta)` |
| `--warn` | `var(--ambar-texto)` |
| `--bd` | `var(--linea)` |

**Colores viejos:** `#2A3D7C|#3f57a6|#eef1f8|#1f2430|#c0392b|#b9770e|#d5d9e3|#0f766e`

**Notas:**
- La caja de PIN toma el estilo de `.login-caja` del shell.
- En los gráficos de Chart.js (pestañas "Día a día" y "Se…"): series con `IG.paleta()`, grillas con `IG.color('linea')`, ticks con `IG.color('texto-2')`.
- El preview se abre con `autovias`.

**Deploy:** push a `master` (Pages sirve `/docs`). Se sube la versión de `sw.js` y el `?v=`.

- [ ] Step 1: R8 antes · Step 2: R1–R6 · Step 3: R8 después · Step 4: R7, con los gráficos visibles y sin rojo ni verde · Step 5: commit + R9

### Task 5: Rendiciones

**Files:** `rendiciones/docs/index.html`, `estilo.css`, `app.js`, `sw.js`

**Alias:** se borra entero su `:root` de tokens, que ya son los mismos. Quedan solo `--barra-h`, `--nav-h` y `--nav-w`.

**Colores viejos:** ninguno de paleta. R8 se corre con el patrón `^\s*--(azul|teal|ambar|alerta|fondo|texto|linea|radio|display|cuerpo)[a-z0-9-]*\s*:` sobre `estilo.css`: antes encuentra líneas, después da vacío.

**Notas:**
- Se revisan los 17 estilos inline de `app.js` con R6.
- Se agrega la flecha de volver.
- El logo `ingeco-azul.png` se queda.

**Deploy:** push a `main` (Pages). Se sube la versión de `sw.js`.

- [ ] Step 1: R8 antes · Step 2: R1–R6 · Step 3: R8 después · Step 4: R7 · Step 5: commit + R9

### Task 6: Tarja de flota (PWA de operarios + panel TARJAS)

**Files:**
- PWA: `tarja-flota/docs/index.html`, `estilo.css`, `app.js`, `ayuda.html`, `sw.js`
- Panel: `panel.html`, `panel.css`, `panel.js`

**Alias de la PWA (`estilo.css`).** Antes de borrar, sus usos se renombran:
- `var(--alerta)` pasa a `var(--ambar)` en fondos y bordes, y a `var(--ambar-texto)` en texto.
- `var(--alerta-suave)` pasa a `var(--ambar-suave)`.
- `--grave` pasa a `var(--alerta)`.

| Variable vieja | Pasa a |
|---|---|
| `--fondo` | se borra |
| `--texto` | se borra |
| `--tarjeta` | `var(--superficie)` |
| `--tenue` | `var(--texto-2)` |
| `--borde` | `var(--linea-fuerte)` (mantiene el contraste al sol) |
| `--acento` | `var(--azul)` |
| `--acento-suave` | `var(--azul-suave)` |

**Panel:** se borra el `:root` duplicado de `panel.css` y se le agrega R1.

**Colores viejos:** `#f2f5f7|#14212c|#5b6b78|#d3dbe2|#0f766e|#d7efec|#b45309|#fdf0dc|#9f1239`

**Notas:**
- La PWA de operarios se abre directo desde el ícono, así que la flecha nunca se ve. Se pone igual por consistencia.
- Los botones de la PWA mantienen su alto actual si ya es mayor a 46px (se usa con guantes).
- En el mapa Leaflet, los marcadores y polígonos usan `IG.color()`.
- El preview se abre con `tarja-flota-dev`.

**Deploy:** push a `main` (Pages desde `/docs`). Se sube la versión de `sw.js`.

- [ ] Step 1: R8 antes · Step 2: R1–R6 en la PWA · Step 3: R1–R6 en el panel · Step 4: R8 después · Step 5: R7 en `index.html` (flujo completo de la tarja hasta "guardado sin señal") y en `panel.html` (las 4 pestañas y el mapa) · Step 6: commit + R9

### Task 7: Tarja Corrientes

**Files:** `tarja-corrientes/docs/index.html`, `panel.html` (con su bloque `<style>` inline), `estilo.css`, `app.js`, `panel.js`, `ayuda.html`, `sw.js`

**Alias:** la misma tabla y los mismos renombres de la Task 6.

**Colores viejos:** los mismos de la Task 6.

**Notas:**
- El bloque inline de `panel.html` (pestañas y tablas) se pasa a tokens.
- La banda UTE con `casella.jpeg` e `ingeco.png` se mantiene, con `data-ig-ocultar-en-app` solo en el logo INGECO.
- El login por PIN del panel no se toca, solo se restyla.
- No hay config de preview: se agrega `tarja-corrientes` a `launch.json` con `python -m http.server 8766 -d C:/Users/Usuario/tarja-corrientes/docs`.

**Deploy:** push a `main` (Pages). Se sube la versión de `sw.js`; según la memoria del proyecto, sin eso los celulares se quedan en la versión vieja.

- [ ] Step 1: R8 antes · Step 2: R1–R6 · Step 3: R8 después · Step 4: R7 (PWA y panel) · Step 5: commit + R9

### Task 8: Licitaciones NOA

**Files:** `licitaciones-noa/index.html`

**Alias:**

| Variable vieja | Pasa a |
|---|---|
| `--surface-0` | `var(--fondo)` |
| `--surface-1` | `var(--superficie)` |
| `--border` | `var(--linea-fuerte)` |
| `--border-soft` | `var(--linea)` |
| `--text-primary` | `var(--texto)` |
| `--text-secondary` | `var(--texto-2)` |
| `--text-muted` | `var(--texto-3)` |
| `--accent` | `var(--azul)` |
| `--good` | `var(--teal)` |
| `--warning` | `var(--ambar-texto)` (texto) o `var(--ambar)` (fondos) |
| `--serious` | `var(--alerta)` |
| `--critical` | `var(--tinta)`, siempre junto a la etiqueta de texto "Crítico" |
| `--rel-alta` | `var(--azul)` |
| `--rel-media` | `var(--azul-claro)` |
| `--rel-baja` | `color-mix(in srgb, var(--azul) 22%, white)` |
| `--chip-bg` | `var(--superficie)` |

**Modo oscuro:** se borran los dos bloques oscuros, el botón de tema y su JS; `color-scheme: light`.

**Colores viejos:** `#2a78d6|#0ca30c|#fab219|#ec835a|#d03b3b|#1b4f8f|#5c93cf|#b9cfe8|#f4f4f2|#fcfcfb|#0b0b0b|#111110|#1a1a19`

**Notas:**
- El layout de escritorio con tabla se queda; la tabla toma el estilo de `.grilla` del shell.
- Se agrega el logo INGECO, copiando `logo.png` a la raíz del repo.
- Config de preview: `licitaciones` con `python -m http.server 8767 -d C:/Users/Usuario/licitaciones-noa`.

**Deploy:** push a `main` (Pages).

- [ ] Step 1: R8 antes · Step 2: R1–R6 · Step 3: R8 después · Step 4: R7 (filtros y orden de columnas funcionando) · Step 5: commit + R9

### Task 9: PAVIMAX (carga + operario)

**Files:**
- `pavimax-repo/cargar.html` (CSS inline)
- `pavimax-repo/index.html` (CSS inline)
- `service-worker.js`

El CSS se queda inline en cada página para no reestructurar. Las dos reciben el mismo alias.

**Alias:**

| Variable vieja | Pasa a |
|---|---|
| `--bg` | `var(--fondo)` |
| `--surface` | `var(--superficie)` |
| `--surface-2` | `var(--fondo)` |
| `--text` | `var(--texto)` |
| `--muted` | `var(--texto-2)` |
| `--border` | `var(--linea)` |
| `--primary` | `var(--azul)` |
| `--primary-dark` | `var(--tinta)` |
| `--primary-soft` | `var(--azul-suave)` |
| `--ok` | `var(--teal)` |
| `--ok-dark` | `var(--teal)` |
| `--warn` | `var(--alerta)` |
| `--info` | `var(--azul-claro)` |
| `--info-soft` | `var(--azul-suave)` |
| `--tag-bg` | `var(--ambar-suave)` |
| `--tag-text` | `var(--ambar-texto)` |
| `--tag-border` | `var(--ambar)` |
| `--shadow` | `var(--sombra)` |
| `--shadow-lg` | `var(--sombra-alta)` |

**Colores viejos:** `#157f3d|#0f5e2d|#e8f5ec|#16a34a|#15803d|#dc2626|#1e40af|#dbeafe|#f5f6f8|#fafbfc|#111827|#6b7280|#e5e7eb|#fef3c7|#92400e|#fcd34d`

**Notas:**
- En la barra va el logo de PAVIMAX (`logo.png` del repo). El fallback de texto pasa a `var(--display)`.
- No se toca `Code.gs` ni `.claspignore`.
- Preview: `pavimax`. Se prueban `cargar.html` y `index.html`, incluidos los modales de parciales y de capacidad.

**Deploy:** push a `main` con PAT clásico `repo`. Se sube la versión de `service-worker.js`.

- [ ] Step 1: R8 antes · Step 2: R1–R6 en `cargar.html` · Step 3: R1–R6 en `index.html` · Step 4: R8 después · Step 5: R7 en las dos · Step 6: commit + R9

### Task 10: Pedidos de Compra

**Files:** `ingeco-pedidos-vercel/public/index.html` (CSS de unas 830 líneas y JS inline) y `public/firmar.html`

**Alias**, el mismo en los dos archivos:

| Variable vieja | Pasa a |
|---|---|
| `--azul`, `--azul-claro`, `--texto` | se borran |
| `--azul-oscuro` | `var(--tinta)` |
| `--bg` | `var(--fondo)` |
| `--surface` | `var(--superficie)` |
| `--surface-suave` | `var(--fondo)` |
| `--surface-tinted` | `var(--fondo-2)` |
| `--texto-suave` | `var(--texto-2)` |
| `--texto-muted` | `var(--texto-3)` |
| `--borde` | `var(--linea)` |
| `--borde-fuerte` | `var(--linea-fuerte)` |
| `--info` | `var(--azul-claro)` |
| `--info-bg` | `var(--azul-suave)` |
| `--warning` | `var(--ambar-texto)` |
| `--warning-bg` | `var(--ambar-suave)` |
| `--ok` | `var(--teal)` |
| `--ok-bg` | `var(--teal-suave)` |
| `--error` | `var(--alerta)` |
| `--error-bg` | `var(--alerta-suave)` |
| `--pendiente-fuerte` | `var(--ambar-texto)` |
| `--pendiente-bg` | `var(--ambar-suave)` |
| `--radio` | `var(--radio-s)` |
| `--radio-sm` | `6px` |
| `--radio-lg` | `var(--radio)` |
| `--radio-pill` | `999px` |
| `--shadow-xs` | `var(--sombra)` |
| `--shadow-sm` | `var(--sombra)` |
| `--shadow-md` | `var(--sombra-media)` |
| `--shadow-lg` | `var(--sombra-alta)` |
| `--shadow-focus` | `0 0 0 3px var(--azul-suave)` |
| `--font-body` | `var(--cuerpo)` |
| `--font-mono` | `var(--cuerpo)` (más `tabular-nums` donde se usaba) |

**Colores viejos:** `#1f3866|#2e5cb8|#142d57|#f5f7fa|#f8fafc|#eef2f7|#0f172a|#475569|#94a3b8|#e2e8f0|#cbd5e1|#166534|#dcfce7|#b91c1c|#fee2e2|#1d4ed8|#dbeafe|#a16207|#fef3c7|#9a3412|#ffedd5`

**Notas:**
- Se borra el `<link>` de IBM Plex.
- La barra `header.barra` del sistema conserva sus acciones (usuario, pendientes, menú) y se le suma la flecha.
- El canvas de firma no cambia de tamaño.
- Preview: `pedidos-ingeco`. Se prueban login, inicio, detalle de una OC, firmar, KPI y el modal de una OC.

**Deploy:** push a `main` de `pedidosingeco/pedidos-compra` (Vercel prod), directo y sin Preview.

- [ ] Step 1: R8 antes · Step 2: R1–R6 en `index.html` · Step 3: R1–R6 en `firmar.html` · Step 4: R8 después · Step 5: R7 · Step 6: commit + R9 (confirmar en `pedidos-ingeco.vercel.app`)

### Task 11: INGECOV

**Files:**
- `Downloads/ingecov-repo/index.html` (`<style>` de unas 1870 líneas)
- `js/*.js` (13 archivos)
- `sw.js`

**No se tocan:** `mapa-baches.html`, `traslados/` ni `docs/mockup/`.

Se hace en dos commits, porque se pueden revisar por separado.

**11a. CSS en `index.html`.** Alias:

| Variable vieja | Pasa a |
|---|---|
| `--bg` | `var(--fondo)` |
| `--bg2` | `var(--superficie)` |
| `--bg3` | `var(--fondo-2)` |
| `--bg-elev` | `var(--superficie)` |
| `--border` | `var(--linea)` |
| `--border2` | `var(--linea-fuerte)` |
| `--border-strong` | `var(--texto-3)` |
| `--border-accent` | `color-mix(in srgb, var(--azul) 50%, transparent)` |
| `--text` | `var(--texto)` |
| `--text2` | `var(--texto-2)` |
| `--text3` | `var(--texto-3)` |
| `--text-mute` | `color-mix(in srgb, var(--texto-3) 60%, white)` |
| `--accent` | `var(--azul)` |
| `--accent2` | `var(--azul-claro)` |
| `--accent-bg` | `var(--azul-suave)` |
| `--accent-bg2` | `color-mix(in srgb, var(--azul) 18%, white)` |
| `--accent-tint` | `color-mix(in srgb, var(--azul) 12%, transparent)` |
| `--accent-glow` / `--shadow-accent` | sombras en `rgba(30,58,138,…)` |
| `--corp` | `var(--azul-claro)` |
| `--corp-bg` | `var(--azul-suave)` |
| `--red` | `var(--alerta)` |
| `--red-bg` | `var(--alerta-suave)` |
| `--amber` | `var(--ambar-texto)` |
| `--amber-bg` | `var(--ambar-suave)` |
| `--green` | `var(--teal)` |
| `--green-bg` | `var(--teal-suave)` |
| `--blue` | `var(--azul-claro)` |
| `--blue-bg` | `var(--azul-suave)` |
| `--violet` | `var(--g5)` |
| `--chart-tick` | `var(--texto-2)` |
| `--chart-grid` | `var(--linea)` |
| `--chart-tooltip-bg` | `var(--tinta)` |
| `--shadow-sm` | `var(--sombra)` |
| `--shadow-md` | `var(--sombra-media)` |
| `--shadow-lg` | `var(--sombra-alta)` |
| `--r-sm` | `var(--radio-s)` |
| `--r-md` | `var(--radio)` |
| `--ease`, `--t-*`, `--r-lg`, `--r-pill` | se quedan |

**Más cambios de CSS:**
- El header oscuro pasa a ser la barra clara de R4.
- La barra de pestañas pasa a pastillas, con scroll horizontal en el celular.
- Las KPI toman el estilo de `.kpi` del shell.
- Las tablas toman el estilo de `.grilla` en la computadora. En pantallas de menos de 560px, la tabla de Equipos pasa a lista de tarjetas.
- JetBrains Mono, Inter e IBM Plex Mono pasan a `var(--display)` con `tabular-nums`.
- Si quedan, se borran las reglas `[data-theme]` y los botones de sol y luna.
- `fonts/fonts.css` se queda (Barlow autoalojada, sirve sin señal).

**11b. JS.** Se aplica R6 en `js/*.js`:
- renderers con `style=` y `cssText`;
- configs de Chart.js (Costos, Combustible, Telemetría);
- Leaflet (Mapa);
- AlberBot (`js/09-bot.js`, su FAB teal pasa a `--azul`).

**Colores viejos:** `#e85d1a|#f26522|#fdeadf|#f9d3bf|#1b1d22|#f4f2ed|#eeebe4|#faf9f6|#e6e2d9|#d6d1c6|#9d988d|#4f5566|#80869a|#c93c34|#b9770e|#0e8a7d|#2f55c7|#7c3aed|JetBrains|Inter|IBM Plex`

El chequeo R8 corre sobre `index.html js/*.js`, excluyendo `mapa-baches.html`.

**Deploy (memoria `ingecov-deploy`):**
1. `node --check js/<archivo>.js` en cada archivo tocado.
2. Subir el `?v=` de **todos** los scripts en `index.html` (mismo número).
3. Subir `CACHE_VERSION` en `sw.js`.
4. Push directo a `main`.
5. Si Pages queda "zombie" en `building`, commit vacío y push.

- [ ] Step 1: R8 antes · Step 2: 11a · Step 3: R7 parcial (las 10 pestañas abren sin error) · Step 4: commit 11a · Step 5: 11b · Step 6: R8 después · Step 7: R7 completo (cada gráfico, el mapa y el bot) · Step 8: commit + R9

### Task 12: Chequeo integrado desde la App y cierre

**Files:**
- Modify: memorias del proyecto (`app-ingeco.md` y una línea en cada memoria de sistema tocado)
- Modify: `app-ingeco/docs/integracion-modulos.md` (sección nueva "Estilo común": R1, alias, `data-ig-*`)

- [ ] **Step 1: Abrir cada sistema desde la App publicada**

Se usa el navegador con sesión de Marcos, con un módulo tipo `iframe` y uno tipo `link`.
Expected:
- **Iframe:** `dataset.igContexto === 'iframe'`, no hay flecha propia y no se repite el logo.
- **Pestaña:** `'pestana'`, la flecha se ve y lleva a la App.

- [ ] **Step 2: Abrir la PWA de Tarja de flota por su URL directa**

Expected: `'directo'` y sin flecha.

- [ ] **Step 3: Probar que un cambio se propaga**

Se cambia temporalmente un token en una copia local de `ingeco.css` servida en el shell local y se confirma que un sistema cargado contra esa copia lo refleja. Después se revierte. Esto **no** se publica.

- [ ] **Step 4: Documentar y commitear**

Se completa `integracion-modulos.md` y se actualizan las memorias. Commit y push de app-ingeco con el subtree de gh-pages.

### Task 13 (bloqueada): Traslados

`traslados/index.html` y `ingecov-repo/traslados/` ya **no** son la app viva. Desde el 9-oct, `ingecov/traslados/` redirige a una app nueva de Apps Script (HtmlService, dominio grupoingeco). Según la memoria, ese sistema nuevo lo hace Bruno Dallagata y su código no está en esta PC.

Queda bloqueada hasta que Marcos decida una de dos:
- Pasarle a Bruno la receta R1–R9.
- Conseguir acceso al proyecto de Apps Script.

Ojo: en HtmlService el `<link>` externo a `ingeco.css` funciona, pero `ingeco.js` corre dentro del sandbox de Google, así que la detección de iframe ahí no es confiable.
