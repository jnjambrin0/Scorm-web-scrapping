export type Lang = "es" | "en";

export const LANGS: ReadonlyArray<Lang> = ["es", "en"] as const;

export const STRINGS = {
  // App / chrome
  "app.title":          { es: "Scorm → Notion",                                en: "Scorm → Notion" },
  "app.subtitle":       { es: "Aplicación local · 127.0.0.1",                  en: "Local app · 127.0.0.1" },

  // Session chip
  "session.verified":   { es: "Sesión verificada",                              en: "Session verified" },
  "session.unauth":     { es: "No autenticada",                                 en: "Not authenticated" },
  "session.unknown":    { es: "Sin verificar",                                  en: "Not checked" },
  "session.checking":   { es: "Verificando…",                                   en: "Checking…" },
  "session.stored":     { es: "Perfil guardado · sin confirmar",                en: "Profile stored · unconfirmed" },
  "session.stale":      { es: "Comprobación pendiente",                         en: "Verification pending" },
  "session.refresh":    { es: "Verificar sesión",                               en: "Check session" },
  "session.minutesAgo": { es: "hace {n} min",                                   en: "{n} min ago" },
  "session.justNow":    { es: "ahora mismo",                                    en: "just now" },

  // Hero
  "hero.title":         { es: "Publicar una unidad en Notion",                  en: "Publish a unit to Notion" },
  "hero.subtitle":      { es: "Pega la URL de Blackboard, elige el destino y sigue el progreso en tiempo real.",
                          en: "Paste the Blackboard URL, choose the destination, and follow progress in real time." },

  // Fields — main
  "field.unit.label":           { es: "Título de unidad (opcional)",              en: "Unit title (optional)" },
  "field.unit.help":            { es: "Sólo hace falta si pegas la URL del outline del curso en vez de una URL directa del SCORM. Debe coincidir con el título visible en Blackboard.",
                                  en: "Only needed if you paste the course outline URL instead of a direct SCORM URL. It must match the visible Blackboard title." },
  "field.unit.placeholder":     { es: "Unidad 5: Asignatura de ejemplo",         en: "Unit 5: Sample course" },

  "field.parentTitle.label":    { es: "Página padre en Notion",                  en: "Notion parent page" },
  "field.parentTitle.help":     { es: "Nombre de la página de Notion bajo la cual se creará la nueva. Por defecto: Universidad.",
                                  en: "Name of the Notion page under which the new page will be created. Default: Universidad." },
  "field.parentTitle.placeholder": { es: "Universidad",                          en: "Universidad" },

  "field.pageTitle.label":      { es: "Título de la página nueva",               en: "New page title" },
  "field.pageTitle.help":       { es: "Cómo se llamará la página creada. Si lo dejas vacío usamos el título de la unidad.",
                                  en: "What the created page will be called. If empty we use the unit title." },
  "field.pageTitle.placeholder": { es: "(automático)",                            en: "(auto)" },

  // Fields — advanced
  "field.courseUrl.label":      { es: "URL de Blackboard",                       en: "Blackboard URL" },
  "field.courseUrl.help":       { es: "Pega la URL directa del SCORM/overview. También acepta el outline del curso, pero entonces usa el título opcional de unidad.",
                                  en: "Paste the direct SCORM/overview URL. Course outline URLs also work, but then use the optional unit title." },
  "field.courseUrl.placeholder": { es: "https://x.blackboard.com/ultra/courses/_…/outline/scorm/overview/_…",
                                   en: "https://x.blackboard.com/ultra/courses/_…/outline/scorm/overview/_…" },

  "field.parentId.label":       { es: "ID de página padre",                      en: "Parent page ID" },
  "field.parentId.help":        { es: "Si lo conoces, evitamos buscar por título. UUID de 32 caracteres con guiones.",
                                  en: "If you know it, we skip the title lookup. 32-char UUID with dashes." },
  "field.parentId.placeholder": { es: "00000000-0000-0000-0000-000000000000",    en: "00000000-0000-0000-0000-000000000000" },

  "field.markdownOut.label":    { es: "Ruta de salida del Markdown",             en: "Markdown output path" },
  "field.markdownOut.help":     { es: "Dónde escribir el archivo .md de la unidad. Si lo dejas vacío, se usa exports/<título>.md.",
                                  en: "Where to write the unit's .md file. Empty = exports/<title>.md." },
  "field.markdownOut.placeholder": { es: "exports/mi-unidad.md",                  en: "exports/my-unit.md" },

  "field.refresh.label":        { es: "Refrescar SCORM",                          en: "Refresh SCORM" },
  "field.refresh.help":         { es: "Vuelve a descargar el SCORM en lugar de usar el manifest cacheado. Más lento pero asegura contenido al día.",
                                  en: "Re-download the SCORM instead of using the cached manifest. Slower but always up to date." },

  "field.deleteAfter.label":    { es: "Borrar tras validar",                      en: "Delete after validating" },
  "field.deleteAfter.help":     { es: "Sólo en modo Publicar. Tras crear la página la mueve a la papelera de Notion. Útil para tests.",
                                  en: "Publish mode only. Moves the created page to the Notion trash. Useful for tests." },

  // Primary / secondary actions
  "action.publish":             { es: "Publicar en Notion",                       en: "Publish to Notion" },
  "action.publish.detail":      { es: "Crea una página nueva con todo el contenido y los recursos.",
                                  en: "Creates a new page with all content and assets." },
  "action.dryrun":              { es: "Vista previa (dry-run)",                   en: "Preview (dry-run)" },
  "action.dryrun.detail":       { es: "Descarga y prepara todo, sin tocar Notion.",
                                  en: "Downloads and prepares everything without touching Notion." },
  "action.cancel":              { es: "Cancelar",                                  en: "Cancel" },
  "action.retry":               { es: "Reintentar",                                en: "Retry" },
  "action.publishNow":          { es: "Publicar ahora",                            en: "Publish now" },
  "action.dismiss":             { es: "Cerrar",                                    en: "Dismiss" },

  // Disclosure
  "advanced.title":             { es: "Ajustes opcionales",                        en: "Optional settings" },
  "advanced.subtitle":          { es: "Título de unidad, IDs y rutas. Cambia esto sólo si lo necesitas.",
                                  en: "Unit title, IDs, paths. Change only if you need to." },

  // Tools section
  "tools.title":                { es: "Herramientas",                              en: "Tools" },
  "tools.subtitle":             { es: "Acciones secundarias que no tocan Notion.",
                                  en: "Secondary actions that don't touch Notion." },
  "tools.check":                { es: "Verificar sesión",                          en: "Check session" },
  "tools.check.detail":         { es: "Comprueba si Blackboard sigue autenticado.",
                                  en: "Checks if Blackboard is still authenticated." },
  "tools.exportMd":             { es: "Exportar sólo Markdown",                    en: "Export Markdown only" },
  "tools.exportMd.detail":      { es: "Genera el .md de la unidad sin subirlo a Notion.",
                                  en: "Generates the unit's .md without uploading to Notion." },

  // Job panel
  "job.starting":               { es: "Iniciando trabajo…",                        en: "Starting job…" },
  "job.running":                { es: "Ejecutando",                                 en: "Running" },
  "job.cancelling":             { es: "Cancelando…",                                en: "Cancelling…" },
  "job.elapsed":                { es: "Tiempo: {n}",                                en: "Elapsed: {n}" },
  "job.idle":                   { es: "Sin actividad",                              en: "Idle" },
  "job.viewLogs":               { es: "Ver registro detallado",                    en: "View detailed log" },
  "job.hideLogs":               { es: "Ocultar registro",                           en: "Hide log" },
  "job.logsEmpty":              { es: "Sin registros aún. Aparecerán al iniciar.",
                                  en: "No logs yet. They will appear when you start." },
  "job.connectionLost":         { es: "Conexión SSE perdida",                       en: "SSE connection lost" },

  // Phases
  "phase.starting":             { es: "Inicio",                                     en: "Starting" },
  "phase.markdown":             { es: "Markdown",                                   en: "Markdown" },
  "phase.assets":               { es: "Recursos",                                   en: "Assets" },
  "phase.notion-parent":        { es: "Página padre",                               en: "Parent page" },
  "phase.upload":               { es: "Subida",                                      en: "Upload" },
  "phase.create-page":          { es: "Crear página",                                en: "Create page" },
  "phase.append-blocks":        { es: "Bloques",                                     en: "Blocks" },
  "phase.done":                 { es: "Final",                                        en: "Done" },

  // Progress kinds
  "progress.assets":            { es: "Descargando recursos",                       en: "Downloading assets" },
  "progress.upload-parts":      { es: "Subiendo a Notion",                          en: "Uploading to Notion" },
  "progress.block-batches":     { es: "Insertando bloques",                          en: "Appending blocks" },
  "progress.generic":           { es: "Progreso",                                    en: "Progress" },
  "progress.count":             { es: "{current} de {total}",                       en: "{current} of {total}" },
  "progress.percent":           { es: "{n}%",                                        en: "{n}%" },

  // Result card
  "result.success.publish.title":     { es: "Página publicada en Notion",          en: "Page published to Notion" },
  "result.success.publish.subtitle":  { es: "Tu unidad ya está disponible en tu workspace.",
                                        en: "Your unit is now available in your workspace." },
  "result.success.dryrun.title":      { es: "Vista previa lista",                  en: "Preview ready" },
  "result.success.dryrun.subtitle":   { es: "No hemos tocado Notion. Revisa los datos antes de publicar.",
                                        en: "We didn't touch Notion. Review the numbers before publishing." },
  "result.success.exportMd.title":    { es: "Markdown exportado",                  en: "Markdown exported" },
  "result.success.exportMd.subtitle": { es: "El archivo está en exports/.",         en: "The file is under exports/." },
  "result.success.checkSession.title":   { es: "Sesión verificada",                en: "Session verified" },
  "result.success.checkSession.subtitle": { es: "La sesión de Blackboard sigue activa.",
                                            en: "The Blackboard session is still active." },
  "result.openNotion":          { es: "Abrir página en Notion",                    en: "Open page in Notion" },
  "result.openOutput":          { es: "Ver archivo de salida",                     en: "View output file" },
  "result.failure.title":       { es: "El trabajo no ha terminado",                 en: "The job did not finish" },
  "result.failure.subtitle":    { es: "Revisa el registro o reintenta.",            en: "Review the log or retry." },
  "result.cancelled.title":     { es: "Trabajo cancelado",                          en: "Job cancelled" },
  "result.cancelled.subtitle":  { es: "Has cancelado el proceso. Puedes volver a iniciarlo cuando quieras.",
                                  en: "You cancelled the process. Start again whenever you want." },

  // Stats labels
  "stats.lessons":              { es: "Lecciones",                                   en: "Lessons" },
  "stats.blocks":                { es: "Bloques Notion",                              en: "Notion blocks" },
  "stats.images":                { es: "Imágenes",                                    en: "Images" },
  "stats.videos":                { es: "Vídeos",                                       en: "Videos" },
  "stats.assets":                { es: "Recursos",                                     en: "Assets" },
  "stats.uploaded":              { es: "Subidos",                                      en: "Uploaded" },
  "stats.reused":                { es: "Reutilizados",                                 en: "Reused" },
  "stats.failed":                { es: "Fallidos",                                     en: "Failed" },
  "stats.bytes":                 { es: "Tamaño total",                                 en: "Total size" },
  "stats.deleted":               { es: "Borrada tras validar",                        en: "Deleted after validation" },

  // Settings modal
  "settings.open":                          { es: "Abrir ajustes",                          en: "Open settings" },
  "settings.title":                         { es: "Ajustes",                                en: "Settings" },
  "settings.close":                         { es: "Cerrar ajustes",                         en: "Close settings" },
  "settings.done":                          { es: "Hecho",                                  en: "Done" },
  "settings.reset":                         { es: "Restaurar valores por defecto",          en: "Reset to defaults" },
  "settings.section.formDefaults":          { es: "Formulario por defecto",                 en: "Form defaults" },
  "settings.section.notion":                { es: "Notion",                                 en: "Notion" },
  "settings.section.system":                { es: "Sistema",                                en: "System" },

  "settings.formDefaults.parentTitle.label": { es: "Página padre en Notion",                en: "Notion parent page" },
  "settings.formDefaults.parentTitle.hint":  { es: "Se usa para pre-rellenar el formulario en cada nueva ejecución.",
                                               en: "Used to pre-fill the form on every new run." },
  "settings.formDefaults.parentId.label":    { es: "ID de página padre (opcional)",         en: "Parent page ID (optional)" },
  "settings.formDefaults.parentId.hint":     { es: "Si lo conoces, evita la búsqueda por título y apunta exactamente a esa página.",
                                               en: "If you have it, this skips the title lookup and points exactly to that page." },
  "settings.formDefaults.refresh.label":     { es: "Refrescar SCORM por defecto",           en: "Refresh SCORM by default" },
  "settings.formDefaults.refresh.hint":      { es: "Cuando está activo, el formulario arranca con el toggle 'Refrescar SCORM' encendido.",
                                               en: "When on, the form starts with the 'Refresh SCORM' toggle enabled." },
  "settings.formDefaults.deleteAfter.label": { es: "Borrar tras validar por defecto",       en: "Delete after validating by default" },
  "settings.formDefaults.deleteAfter.hint":  { es: "Sólo aplica al publicar. Si está activo, la página creada se mueve a la papelera automáticamente.",
                                               en: "Only affects publish runs. When on, the created page is moved to the trash automatically." },

  "settings.notion.mediaWidthRatio.label":   { es: "Ancho de medios en Notion",             en: "Notion media width" },
  "settings.notion.mediaWidthRatio.hint":    { es: "Controla cómo de anchas se ven las imágenes y los vídeos en la página publicada (50–100 %).",
                                               en: "Controls how wide images and videos appear on the published page (50–100%)." },
  "settings.notion.paidPlan.label":          { es: "Tengo Notion Plus, Business o Education",
                                               en: "I have Notion Plus, Business, or Education" },
  "settings.notion.paidPlan.hint":           { es: "Notion gratuito limita cada archivo a 5 MiB. Si tu workspace tiene un plan de pago, lo activamos y subimos todo. Si lo dejas apagado, omitiremos los archivos que superen 5 MiB para que el publish no falle.",
                                               en: "Notion Free caps each file at 5 MiB. If your workspace is on a paid plan we'll upload everything; if you leave it off we'll skip files over 5 MiB so the publish doesn't fail." },

  "settings.system.notionKey":               { es: "Token de Notion",                       en: "Notion token" },
  "settings.system.notionKey.set":           { es: "Configurado",                           en: "Configured" },
  "settings.system.notionKey.unset":         { es: "No configurado",                        en: "Not configured" },
  "settings.system.blackboardUrl":           { es: "URL base de Blackboard",                en: "Blackboard base URL" },
  "settings.system.editNote":                { es: "Para cambiar estos valores edita tu `.env` y reinicia el servidor local.",
                                               en: "To change these values, edit your `.env` and restart the local server." },

  // Setup banner (shown when required env vars are missing)
  "setup.incomplete.title":      { es: "Configuración incompleta",                    en: "Setup incomplete" },
  "setup.incomplete.body":       { es: "Edita el archivo .env de tu proyecto y añade las variables que faltan. Sin ellas algunas acciones no pueden ejecutarse.",
                                   en: "Edit your project's .env file to add the missing variables. Without them, some actions can't run." },
  "setup.incomplete.notion":     { es: "token de integración de Notion (obtén el tuyo en notion.so/profile/integrations).",
                                   en: "Notion integration token (get one at notion.so/profile/integrations)." },
  "setup.incomplete.blackboard": { es: "URL base de tu Blackboard, p. ej. https://<tu-institución>.blackboard.com/ultra/stream.",
                                   en: "Base URL of your Blackboard, e.g. https://<your-institution>.blackboard.com/ultra/stream." },

  // Errors
  "error.boot":                  { es: "No se han podido cargar los defaults del backend local.",
                                   en: "Couldn't load the backend's default values." },
  "error.unknown":               { es: "Ha ocurrido un error desconocido.",           en: "An unknown error occurred." },

  // Classified errors (title + hint)
  "error.process.crashed":       { es: "El proceso se cerró sin completarse",          en: "The process exited unexpectedly" },
  "error.process.crashed.hint":  { es: "Suele indicar que Playwright no pudo abrir el navegador. Prueba `npx playwright install chromium` y reintenta.",
                                   en: "Usually means Playwright couldn't open the browser. Try `npx playwright install chromium` and retry." },
  "error.session.expired":       { es: "Sesión de Blackboard caducada",                en: "Blackboard session expired" },
  "error.session.expired.hint":  { es: "Tu sesión ya no es válida. Pulsa el chip de la barra superior para iniciar sesión de nuevo.",
                                   en: "Your session is no longer valid. Click the chip in the top bar to sign in again." },
  "error.playwright.missing":    { es: "Navegador de Playwright no instalado",         en: "Playwright browser not installed" },
  "error.playwright.missing.hint": { es: "Ejecuta `npx playwright install chromium` en la raíz del proyecto y vuelve a intentarlo.",
                                     en: "Run `npx playwright install chromium` from the project root and try again." },
  "error.notion.api":            { es: "Notion ha rechazado la petición",              en: "Notion rejected the request" },
  "error.notion.api.hint":       { es: "Revisa que el token de la integración esté activo y que la página padre esté compartida con ella.",
                                   en: "Check that the integration token is active and that the parent page is shared with it." },
  "error.notion.fileSize":       { es: "Notion rechazó un archivo por tamaño",         en: "Notion rejected a file because of its size" },
  "error.notion.fileSize.hint":  { es: "El plan gratuito de Notion limita cada archivo a 5 MiB. Tienes tres opciones: 1) desactiva el switch \"Tengo Notion Plus / Business / Education\" en Ajustes para que omitamos automáticamente los archivos grandes; 2) contrata Notion Education (gratis para estudiantes verificados, hasta 5 GiB por archivo); 3) contrata Notion Plus o Business.",
                                   en: "Notion Free caps each file at 5 MiB. Three options: 1) turn off the \"I have Notion Plus / Business / Education\" switch in Settings so we skip large files automatically; 2) get Notion Education (free for verified students, 5 GiB per file); 3) upgrade to Plus or Business." },
  "error.filesystem":            { es: "Error de archivos",                            en: "Filesystem error" },
  "error.filesystem.hint":       { es: "No se pudo leer o escribir un archivo. Mira los detalles técnicos.",
                                   en: "Couldn't read or write a file. See technical details." },
  "error.url.unreachable":       { es: "URL no accesible",                             en: "URL not reachable" },
  "error.url.unreachable.hint":  { es: "El dominio de la URL no resuelve o rechaza la conexión. Revisa que `COURSE_OUTLINE_URL` en tu `.env` apunte a la instancia real de Blackboard (la del `.env.example` es solo un placeholder).",
                                   en: "The URL's host doesn't resolve or refused the connection. Make sure `COURSE_OUTLINE_URL` in your `.env` points to your real Blackboard instance (the one in `.env.example` is just a placeholder)." },
  "error.blackboard.unreachable": { es: "Blackboard no responde",                       en: "Blackboard isn't responding" },
  "error.blackboard.unreachable.hint": { es: "La página ha tardado demasiado en cargar. Comprueba tu conexión, la URL del curso, o reintenta en unos segundos.",
                                         en: "The page took too long to load. Check your connection, the course URL, or retry in a moment." },
  "error.network":               { es: "Error de red",                                 en: "Network error" },
  "error.network.hint":          { es: "No se pudo alcanzar el servicio remoto. Comprueba tu conexión y reintenta.",
                                   en: "Could not reach the remote service. Check your connection and retry." },
  "error.generic":               { es: "El trabajo no ha terminado",                   en: "The job did not finish" },
  "error.generic.hint":          { es: "Mira los detalles técnicos o reintenta cuando estés listo.",
                                   en: "Check technical details or retry when ready." },
  "error.profile.busy":           { es: "El perfil de Blackboard está en uso",           en: "The Blackboard profile is busy" },
  "error.profile.busy.hint":      { es: "Si la aplicación ofrece recuperar o cancelar una tarea activa, úsala. Si no, cierra la otra ventana de Blackboard y vuelve a intentarlo.",
                                    en: "Use the app's recover or cancel action when available. Otherwise, close the other Blackboard window and try again." },
  "error.scorm.url":              { es: "La URL SCORM no ha abierto la unidad",           en: "The SCORM URL did not open the unit" },
  "error.scorm.url.hint":         { es: "Comprueba que la URL pertenece a ese curso y que la sesión remota está confirmada.",
                                    en: "Check that the URL belongs to that course and that the remote session is confirmed." },
  "error.scorm.sourceHttp":       { es: "La URL directa de SCORM no existe",          en: "The direct SCORM URL does not exist" },
  "error.scorm.sourceHttp.hint":  { es: "Blackboard devolvió un error para la URL introducida. La aplicación no la reemplazó por otra ruta.",
                                    en: "Blackboard returned an error for the entered URL. The app did not replace it with another route." },
  "error.scorm.linkMissing":      { es: "Blackboard no mostró el enlace del SCORM",   en: "Blackboard did not show the SCORM link" },
  "error.scorm.linkMissing.hint": { es: "La URL llegó a una página intermedia, pero no había un enlace del mismo curso e ítem para seguir.",
                                    en: "The URL reached an intermediate page, but it had no link for the same course and item." },
  "error.scorm.linkAmbiguous":    { es: "Blackboard mostró enlaces SCORM ambiguos",   en: "Blackboard showed ambiguous SCORM links" },
  "error.scorm.linkAmbiguous.hint": { es: "La aplicación se detuvo para no elegir una ruta incorrecta. Abre el ítem manualmente y copia su enlace actual.",
                                    en: "The app stopped rather than choose a wrong route. Open the item manually and copy its current link." },
  "error.scorm.linkWrong":        { es: "El enlace SCORM no abrió el ítem esperado",  en: "The SCORM link did not open the expected item" },
  "error.scorm.linkWrong.hint":   { es: "Blackboard cambió el destino después de seleccionar su enlace. Revisa el detalle técnico y la disponibilidad del ítem.",
                                    en: "Blackboard changed the destination after selecting its link. Check technical details and item availability." },
  "error.scorm.item":             { es: "No se ha encontrado el SCORM en el curso",      en: "The SCORM item was not found in the course" },
  "error.scorm.item.hint":        { es: "Blackboard ha acabado en otra página o ha cambiado el enlace. Copia de nuevo la URL del SCORM y reintenta.",
                                    en: "Blackboard ended on another page or changed the link. Copy the SCORM URL again and retry." },
  "error.cache.invalid":          { es: "La caché de SCORM no es válida",                en: "The SCORM cache is invalid" },
  "error.cache.invalid.hint":     { es: "La caché se volverá a generar sin borrar una exportación anterior válida.",
                                    en: "The cache will be regenerated without deleting a previous valid export." },
  "error.login.incomplete":       { es: "El inicio de sesión no ha terminado",            en: "Sign-in did not finish" },
  "error.login.incomplete.hint":  { es: "La ventana se cerró antes de que Blackboard confirmase la sesión. Vuelve a verificar e inicia sesión hasta llegar a Blackboard.",
                                    en: "The window closed before Blackboard confirmed the session. Verify and sign in again until Blackboard loads." },

  // Result card affordances
  "result.showDetails":          { es: "Mostrar detalles técnicos",                    en: "Show technical details" },
  "result.hideDetails":          { es: "Ocultar detalles técnicos",                    en: "Hide technical details" },

  // Session chip CTAs (calmed states)
  "session.signIn":              { es: "Verificar e iniciar sesión",                  en: "Verify and sign in" },
  "session.notVerified":         { es: "Sin verificar",                                en: "Not verified" },
  "session.error":               { es: "No se pudo verificar la sesión",               en: "Couldn't verify the session" },
  "session.remoteVerify":        { es: "Verificar e iniciar sesión",                  en: "Verify and sign in" },
  "session.dialog.title": { es: "Verificar e iniciar sesión",                   en: "Verify and sign in" },
  "session.dialog.body": { es: "Abriremos Blackboard en una ventana independiente. Si tu sesión ha caducado, podrás iniciar sesión manualmente.",
                             en: "We'll open Blackboard in a separate window. If your session has expired, you can sign in manually." },
  "session.dialog.concurrent": { es: "Tu institución puede limitar las sesiones simultáneas y cerrar la más antigua.",
                                   en: "Your institution may limit simultaneous sessions and end the oldest one." },
  "session.dialog.cancel": { es: "Cancelar",                                    en: "Cancel" },
  "session.dialog.confirm": { es: "Abrir Blackboard",                           en: "Open Blackboard" },

  // Login flow toast
  "login.waiting.title":         { es: "Esperando inicio de sesión…",                  en: "Waiting for sign-in…" },
  "login.waiting.body":          { es: "Se ha abierto una ventana de navegador. Inicia sesión a tu ritmo; la aplicación detectará Blackboard, cerrará la ventana y confirmará la sesión.",
                                   en: "A browser window opened. Sign in at your pace; the app will detect Blackboard, close the window, and confirm the session." },
  "login.cancel":                { es: "Cancelar",                                     en: "Cancel" },
  "login.failure.title":         { es: "No se pudo completar el inicio de sesión",       en: "Sign-in could not be completed" },

  // Section labels in the publish form
  "section.source":              { es: "Origen",                                       en: "Source" },
  "section.destination":         { es: "Destino",                                      en: "Destination" },

  // Toast affordances
  "toast.dismiss":               { es: "Cerrar aviso",                                 en: "Dismiss" },

  // Inline validation
  "validation.url.required":     { es: "Introduce la URL de Blackboard.",              en: "Enter the Blackboard URL." },
  "validation.url.protocol":     { es: "La URL debe empezar por http:// o https://.",  en: "The URL must start with http:// or https://." },
  "validation.url.host":         { es: "La URL debe incluir el dominio.",              en: "The URL must include the host." },
  "validation.url.malformed":    { es: "La URL no tiene un formato válido.",           en: "The URL is not valid." },
  "validation.uuid.malformed":   { es: "El ID de página debe ser un UUID de Notion (32 caracteres hex con o sin guiones).",
                                   en: "The page ID must be a Notion UUID (32 hex chars, with or without dashes)." },

  // Misc
  "common.lang":                 { es: "Idioma",                                       en: "Language" },
  "common.help":                 { es: "Ayuda",                                         en: "Help" },
  "common.close":                { es: "Cerrar",                                        en: "Close" },
  "common.dash":                 { es: "—",                                              en: "—" },
} as const;

export type StringKey = keyof typeof STRINGS;

export function translate(
  key: StringKey,
  lang: Lang,
  vars?: Record<string, string | number>,
): string {
  const entry = STRINGS[key];
  let raw: string = entry[lang];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      raw = raw.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
  }
  return raw;
}
