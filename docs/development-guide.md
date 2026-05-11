# Guia de desarrollo: scraping SCORM/Rise de Blackboard a Markdown y Notion

Esta guia resume como se ha desarrollado el extractor, que decisiones tecnicas
hay detras, que problemas son esperables y como deberia trabajar cualquier
persona o agente que continue este proyecto.

## Objetivo del proyecto

El objetivo no es hacer scraping HTML generico sin contexto. El objetivo es
automatizar un flujo autenticado de Blackboard/Scorm, abrir un paquete
SCORM/Rise, recorrer todas sus lecciones, extraer el contenido visible con la
estructura correcta y poder llevarlo a otros destinos, empezando por Markdown y
despues Notion con imagenes y videos nativos.

El flujo actual tiene tres capas:

1. Sesion autenticada persistente en Chrome/Chromium con Playwright.
2. Extraccion semantica de contenido Rise/SCORM a Markdown.
3. Exportador Notion mediante API oficial para conservar medios.
4. Panel web local para ejecutar workflows y ver progreso en tiempo real.

## Estructura modular del backend

Los comandos publicos siguen viviendo en `scripts/*.mjs`, pero esos ficheros son
wrappers finos. La implementacion vive en `scripts/backend/`:

- `shared/`: rutas, defaults de entorno, nombres seguros, formato de bytes y
  sanitizacion de logs/errores.
- `browser/`: contexto persistente Playwright y comandos de sesion Blackboard.
- `scorm/`: navegacion Blackboard/SCORM, lectura del indice Rise, acciones de
  leccion, renderer DOM->Markdown y orquestacion del export Markdown.
- `notion/`: assets, bloques Notion, cliente/retry, uploads y orquestacion de
  `--dry-run` / `--publish`.
- `web/`: HTTP local, jobs allowlisted, SSE, cancelacion y servidor API.

Al cambiar comportamiento, tocar primero el modulo de la responsabilidad
afectada. Los wrappers solo deben preservar compatibilidad con los comandos npm.

## Como usar el navegador/MCP durante el desarrollo

El navegador controlado por MCP o por Playwright es una herramienta de
investigacion. Sirve para ver que ocurre realmente en Blackboard y en el SCORM
antes de codificar reglas.

Usalo para:

- iniciar sesion manualmente cuando Microsoft/Blackboard pidan credenciales;
- confirmar si la sesion persistente sigue viva;
- abrir el item SCORM real y observar botones, popups y nuevas pestanas;
- inspeccionar si el contenido vive en un iframe;
- comparar lo que se ve en pantalla con el HTML que recibe el script;
- activar componentes interactivos antes de extraer texto;
- capturar screenshots de estados problematicos.

No lo uses como unica fuente de verdad para el exportador. El comportamiento
visual ayuda a entender el componente, pero las reglas estables deben salir del
DOM, las clases y la estructura del HTML.

Patron recomendado:

1. Reproducir manualmente el caso con el navegador/MCP.
2. Identificar el componente visual: card, acordeon, carrusel, video, lista,
   imagen, bloque de texto, etc.
3. Guardar o revisar el HTML raw generado en `exports/raw/`.
4. Comparar HTML raw, texto visible y Markdown final.
5. Crear una regla semantica concreta para ese tipo de componente.
6. Regenerar y validar con busquedas de patrones rotos.

## Sesion autenticada y persistencia

Blackboard y Microsoft no deben automatizarse introduciendo credenciales en el
codigo. La decision correcta es usar un perfil persistente de navegador.

El proyecto usa por defecto:

```text
~/.scorm-scraping/chromium-profile
```

Ese perfil puede contener cookies, localStorage, IndexedDB, cache y refresh
tokens. Debe tratarse como material sensible.

Comandos principales:

```bash
npm run login
npm run open
npm run check-session
```

Si la sesion caduca, se vuelve a ejecutar `npm run login`, el usuario inicia
sesion manualmente y el perfil queda actualizado. No se debe copiar la sesion
del Chrome personal del usuario ni pedir contrasenas.

## Como esta estructurado Blackboard/SCORM

El flujo observado tiene varias capas:

- Blackboard Ultra muestra el curso y el item SCORM.
- El item puede tener boton de `Iniciar intento` o `Continuar intento`.
- Tras iniciar/continuar, puede abrirse una pestana o frame con
  `scormdriver/indexAPI.html`.
- El contenido real suele vivir en un frame llamado `scormdriver_content` o en
  una URL que contiene `/scormcontent/`.
- Rise usa rutas hash como `#/preview` o hashes por leccion.
- El indice se puede leer desde elementos como
  `.overview-list__section-title` y `a.overview-list-item__link`.
- Cada leccion renderizada expone el contenido bajo `.blocks-lesson`.

El exportador no debe depender de IDs concretos de una unidad. Los IDs cambian
entre cursos. Las clases de componente Rise son mas reutilizables.

## Decisiones importantes de scraping

### Playwright antes que HTTP puro

Blackboard/SCORM depende de autenticacion, iframes, hash routing, lazy loading y
componentes interactivos. Hacer peticiones HTTP directas puede funcionar para
assets puntuales, pero como estrategia principal es fragil.

Playwright permite:

- reutilizar la sesion autenticada;
- esperar a que el SCORM renderice;
- navegar hashes internos;
- activar botones no navegacionales;
- descargar assets autenticados usando el mismo contexto.

### Extraccion semantica antes que `innerText`

`innerText` plano mezcla contenido con UI. En Rise aparecen textos como:

- `Click to flip`;
- `START`;
- numeros de controles de carrusel;
- textos ocultos como `(opens in a new tab)`;
- controles de video;
- botones de continuar;
- bullets visuales y contadores.

Por eso el exportador debe reconocer componentes y renderizarlos segun su
significado, no concatenar todo el DOM.

### Markdown como formato intermedio

Markdown es util para validar la transcripcion, hacer diffs y revisar fallos.
Pero Markdown pegado en Notion no conserva bien imagenes ni videos locales.

La decision actual es:

- mantener Markdown como salida auditable;
- usar API oficial de Notion para crear bloques nativos y subir medios.

## Como analizar un fallo de conversion

Cuando el Markdown se ve mal, no se debe parchear a ciegas el texto final. El
analisis correcto es:

1. Buscar el texto roto en el Markdown exportado.
2. Buscar el mismo contenido en `exports/raw/*.html`.
3. Identificar el componente Rise que lo genera.
4. Ver si el problema viene de UI auxiliar, texto oculto, estructura no
   semantica o una regla demasiado generica.
5. Escribir una regla para el componente o una heuristica estricta.
6. Regenerar y comprobar que no se rompe otro caso.

Ejemplos reales:

- Flashcards: el DOM incluia `Click to flip`; la salida correcta es
  `- **Titulo**: descripcion`.
- Listas numeradas: los numeros visuales aparecian pegados al texto; la salida
  correcta es `1. texto`.
- Listas bullet: el bullet visual `•` no debe conservarse como caracter pegado.
- Carruseles/procesos: `START`, botones `1`, `2`, `3` y controles no son
  contenido; los slides con imagen deben salir como lista ordenada de imagenes.
- Enlaces: `(opens in a new tab)` viene de texto oculto accesible, no del texto
  visible; debe eliminarse al leer texto inline.
- `h3` largos: algunos bloques usan visualmente un heading para texto narrativo.
  No se deben eliminar todos los `###`; se aplica una heuristica estricta para
  convertir en parrafo solo encabezados largos con forma de frase.

## Componentes Rise que hay que tratar

### Texto y encabezados

Los titulos de seccion del indice se renderizan como `#`.
Los titulos de leccion se renderizan como `##`.
Los titulos internos reales se renderizan como `###`.

Hay que tener cuidado con headings largos usados como texto decorativo. La
regla debe ser conservadora: solo degradar a parrafo cuando el texto sea largo,
con muchas palabras y puntuacion propia de una frase.

### Flashcards

No se deben leer como texto plano. Hay que separar anverso y reverso:

```md
- **Titulo**: descripcion
```

Si la descripcion tiene varias lineas, debe indentarse bajo el item.

### Acordeones

Cada item debe convertirse en:

```md
### Titulo

Descripcion
```

Botones, iconos, estados visuales y atributos de expandido no son contenido.

### Pestanas

Los bloques `.blocks-tabs` no son parrafos sueltos. Cada `button[role="tab"]`
debe emparejarse con su `role="tabpanel"` mediante `aria-controls` y convertirse
en una lista semantica:

```md
- **Titulo de pestana**: descripcion
```

Las flechas, estados activos, atributos de seleccion y controles de navegacion
no son contenido.

### Carruseles y procesos

El carrusel tiene controles que parecen contenido si se usa texto plano. Hay
que ignorar:

- `START`;
- prev/next;
- dots;
- numeros de control;
- contadores ocultos.

La slide de introduccion puede convertirse en `### titulo`. Las slides de paso
deben convertirse en lista ordenada. Si una slide solo contiene imagen:

```md
1. ![](assets/imagen1.png)
2. ![](assets/imagen2.jpg)
```

Si tiene titulo, descripcion y media:

```md
1. **Titulo**

   Descripcion

   ![](assets/imagen.png)
```

### Listas

Rise puede representar listas con HTML no canonico, iconos, labels o divs
intermedios. Hay que tomar el contenido desde `.block-list__content` y descartar
`.block-list__number` y `.block-list__bullet`.

### Imagenes

Las imagenes pueden aparecer como `<img src="assets/...">` o como fondos CSS.
El extractor conserva las referencias que aparecen como imagenes de contenido en
el DOM. Debe ignorar imagenes decorativas de Rise por estructura, no por unidad:
avatares de callout como `img.block-quote__avatar` dentro de `.block-quote`, y
placeholders `stock-image.*` con `alt` vacio dentro de bloques `.block-image`
decorativos de tipo overlay/hero sin texto asociado. Para Notion hara falta
resolver esas rutas contra `document.baseURI` y descargarlas desde la sesion
autenticada.

### Videos

Los videos suelen aparecer como `video/source` con `assets/*.mp4?v=1` y poster
`assets/*.jpg`. Para Markdown basta con:

```md
[video](assets/video.mp4?v=1)
```

Para Notion hay que descargar el mp4 y subirlo como bloque `video` o como
`file` si Notion rechaza el formato o tamano.

## Limpieza y postprocesado

La regla general es quitar UI por estructura/clase, no por texto hardcodeado.
Solo se aceptan filtros de texto exactos cuando son muletillas conocidas y
confirmadas.

Filtros exactos actuales:

- `¡Comenzamos!`
- `¡Vamos allá!`
- `START`

Regla especial actual:

- si despues de un `# ...` aparece inmediatamente `## Introducción`, se elimina
  solo ese `## Introducción` y se conserva el contenido posterior.

No conviene crear filtros amplios como "eliminar cualquier linea corta en
mayusculas" porque podria borrar contenido real.

## Validacion recomendada

Despues de cambiar el extractor:

```bash
npm run export-scorm-md
```

Luego buscar patrones de fallo:

```bash
rg -n "Click to flip|\\(opens in a new tab\\)|1Comprender|\\.•|^- [123]$" exports -S
rg -n "^(START|¡Comenzamos!|¡Vamos allá!)$" exports -S
rg -n "^### .{140,}" exports -S
rg -n "AprenderMasLogo|ImportanteLogo|Recuerda1Logo|stock-image" exports/*.md -S
```

Tambien hay que revisar manualmente zonas conocidas de riesgo:

- flashcards;
- listas numeradas;
- listas bullet;
- acordeones;
- carruseles con imagenes;
- videos;
- bloques quote/callout con avatar decorativo;
- portadas Rise placeholder `stock-image`;
- enlaces externos;
- headings internos largos.

## Generalidad del script

El script debe funcionar con cualquier tema SCORM/Rise similar. Por tanto:

- no hardcodear IDs de curso, leccion, bloque o asset;
- no hardcodear textos de la unidad salvo filtros exactos aprobados;
- parametrizar `COURSE_OUTLINE_URL`, `SCORM_TITLE` y `SCORM_MARKDOWN_OUT`;
- preferir una URL directa de `outline/scorm/overview/...` cuando este
  disponible. En ese caso `SCORM_TITLE` es opcional y se infiere desde el SCORM.
  Si `COURSE_OUTLINE_URL` apunta al outline del curso, entonces `SCORM_TITLE`
  sigue siendo necesario para localizar el item visible en Blackboard;
- derivar nombres de salida desde el titulo;
- preferir clases/componentes Rise a selectores de posicion;
- conservar raw HTML y raw text para depuracion.

El objetivo es que una unidad nueva solo requiera cambiar variables de entorno.

## Exportacion a Notion

La decision final es usar la API oficial de Notion, no el MCP de Notion, para el
flujo completo con medios. La razon es practica: el MCP disponible puede crear
paginas desde Markdown, pero no expone una herramienta fiable para subir
binarios locales. Notion necesita que imagenes y videos se suban como archivos o
esten disponibles por URL publica.

Variables previstas:

- `NOTION_API_KEY`: token local en `.env`; no leerlo ni imprimirlo.
- `NOTION_PARENT_PAGE_ID`: pagina padre donde crear la pagina exportada.
- `NOTION_PARENT_PAGE_TITLE`: titulo de pagina padre usado cuando no hay
  `NOTION_PARENT_PAGE_ID`; default `Universidad`.
- `NOTION_PAGE_TITLE`: override opcional del titulo.
- `NOTION_VERSION`: default previsto `2026-03-11`.

El flujo esta orquestado por `scripts/backend/notion/exporter.mjs` y expuesto por
`scripts/export-scorm-notion.mjs`:

1. Ejecutar o reutilizar la exportacion Markdown y su manifest.
2. Extraer todas las referencias media del Markdown y/o del raw HTML.
3. Resolver rutas `assets/...` contra la URL base del SCORM.
4. Descargar cada asset usando el contexto autenticado de Playwright.
5. Guardar un manifest con `source`, `absoluteUrl`, `localPath`, `mime`,
   `size` y `sha256`.
6. Subir assets a Notion File Upload API.
7. Crear la pagina Notion y anadir bloques en tandas de maximo 100.
8. Cachear uploads por `sha256` dentro del run.
9. Si un video no puede ser bloque `video`, subirlo como `file`.

Comandos:

```bash
npm run export-scorm-notion -- --dry-run
npm run export-scorm-notion -- --publish
```

El modo `--dry-run` no crea paginas ni sube archivos a Notion. Descarga los
assets autenticados, escribe `exports/notion-assets/manifest.json` y muestra
conteos de bloques, imagenes, videos, bytes, chunks y fallos. El modo
`--publish` requiere `NOTION_API_KEY`, sube los medios y crea una pagina hija
nueva. Usa `NOTION_PARENT_PAGE_ID` si esta configurado; si no, busca una pagina
accesible llamada `Universidad` o el titulo indicado en
`NOTION_PARENT_PAGE_TITLE`. Al terminar imprime la URL de la pagina creada.
Usar `--refresh` si se quiere forzar una nueva extraccion SCORM en vez de
reutilizar el manifest existente.

## Aplicacion web local

La app web es una capa operativa local sobre los scripts existentes. No sustituye
la CLI ni cambia la semantica del exportador.

Comandos:

```bash
npm run dev
npm run web
npm run build
```

- `npm run dev` arranca `scripts/web-server.mjs` y Vite. Vite imprime la URL
  exacta de la UI; normalmente sera `http://127.0.0.1:5173`.
- `npm run web` arranca solo la API local en `http://127.0.0.1:8787` y sirve
  `dist/` si existe.
- `scripts/backend/web/server.mjs` solo debe aceptar comandos allowlisted y
  escuchar en `127.0.0.1` a traves del wrapper `scripts/web-server.mjs`.
- La comunicacion de progreso usa SSE en `GET /api/jobs/:id/events`.
- El frontend no debe recibir `.env`, tokens de Notion, cookies, cabeceras ni
  URLs firmadas. Los overrides permitidos son nombres no secretos como
  `COURSE_OUTLINE_URL`, `SCORM_TITLE` opcional, `SCORM_MARKDOWN_OUT`,
  `NOTION_PARENT_PAGE_TITLE`, `NOTION_PARENT_PAGE_ID`, `NOTION_PAGE_TITLE` y
  `NOTION_VERSION`.

## Seguridad

Reglas no negociables:

- no leer `.env` para "ver que tiene";
- no imprimir tokens, cookies, cabeceras Authorization ni URLs firmadas;
- no commitear `exports/`, `artifacts/`, perfiles de navegador ni `.env`;
- no copiar cookies desde el Chrome personal del usuario;
- no automatizar credenciales Microsoft en codigo;
- tratar el perfil persistente como una llave de acceso.

Si hace falta diagnosticar credenciales, usar checks booleanos:

- existe/no existe variable;
- longitud no nula;
- respuesta HTTP autorizada/no autorizada;
- codigo de error de Notion sin imprimir secretos.

## Decisiones de diseno que conviene mantener

- Separar scripts de login/apertura/exportacion para poder depurar cada capa.
- Mantener raw HTML por leccion para investigar regresiones.
- Hacer renderizadores por componente antes que regex sobre todo el Markdown.
- Aplicar postprocesado solo para reglas globales muy claras.
- Mantener Markdown como artefacto auditable aunque Notion sea el destino final.
- Preferir cambios pequenos y verificables.

## Problemas esperables

### La sesion caduca

Ejecutar `npm run login` y volver a iniciar sesion manualmente. No tocar tokens.

### Blackboard muestra un modal de sesion concurrente

El script ya intenta cerrar el modal. Si cambia el selector, depurarlo con
captura visual y actualizar solo esa funcion.

### No aparece el frame SCORM

Comprobar si la URL cambio, si el popup se abrio en otra pagina o si Blackboard
redirigio a login. Revisar paginas abiertas del contexto y screenshots.

### El indice no se lee

Revisar `#/preview` y `#/`. Si Rise cambia clases, inspeccionar HTML del indice
y ajustar `readOverview`.

### El contenido aparece incompleto

Probablemente falta scroll o activar controles. Rise lazy-loads imagenes y
componentes. Ejecutar scroll completo antes y despues de activar controles.

### El Markdown contiene UI

No eliminar por texto amplio. Buscar el componente en raw HTML y anadirlo a los
selectores skippable o crear renderer especifico.

### Notion no muestra imagenes o videos

No pegar Markdown. Hay que subir los assets como archivos de Notion o usar URLs
publicas permanentes. Para assets autenticados de Blackboard, descargar y subir
es la ruta correcta.

## Checklist para nuevos cambios

Antes de tocar codigo:

- leer `AGENTS.md`;
- entender que script toca la capa afectada;
- reproducir el caso con navegador/MCP si es visual;
- localizar raw HTML del componente;
- definir una regla generica, no especifica de una unidad.

Despues de tocar codigo:

- ejecutar `npm run export-scorm-md`;
- revisar patrones de fallo con `rg`;
- abrir el fragmento Markdown afectado;
- comparar con raw HTML;
- documentar cualquier decision nueva en `AGENTS.md` si cambia el criterio del
  proyecto.

## Estado pendiente

Pendientes principales:

- anadir validaciones automatizadas basicas para patrones de Markdown roto.
- ampliar cobertura de componentes Notion si aparecen nuevos patrones Markdown
  fuera de headings, parrafos, listas, enlaces, imagenes, videos, files, codigo,
  quotes y tablas.
