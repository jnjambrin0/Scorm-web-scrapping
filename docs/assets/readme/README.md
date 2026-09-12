# Imágenes de la documentación

Las capturas de la aplicación se obtienen del frontend construido, con
servidores simulados y un contexto temporal de Chromium. Los títulos, dominios
y enlaces de publicación son datos de prueba; no son evidencia de una
exportación real ni incluyen sesiones del perfil privado.

| Archivo | Contenido |
|---|---|
| `local-app.png` | Publicación individual con URL y título de ejemplo. |
| `queue-running.png` | Cola de diez elementos, trabajo en curso y pendientes editables. |
| `queue-summary.png` | Resumen con ocho publicaciones, una incompleta y un fallo simulado. |
| `queue-mobile.png` | Adaptación a 390 px de ancho; el servidor sigue siendo local al ordenador. |
| `settings.png` | Diálogo de ajustes actual con configuración ficticia. |
| `session-verification.png` | Confirmación integrada para abrir Blackboard. |
| `publication-review.png` | Revisión antes de crear otra página en un reintento. |

## Regeneración

Desde la raíz del repositorio, con dependencias y Google Chrome instalados:

```bash
npm run docs:images
npm run docs:check
git diff --check
```

`scripts/update-doc-images.mjs` ejecuta el build y la prueba de interfaz con
`SCORM_DOC_SCREENSHOTS=1`. Esa variable solo controla capturas de prueba; no es
configuración de la aplicación ni se añade a `.env`. Las imágenes se producen
en `artifacts/queue-ui/` y se copian aquí **solo si la prueba termina con éxito**.
El comando sobrescribe los siete PNG de la tabla; el código de producción no
cambia y no se crean páginas en Notion.

Revisar las imágenes completas: legibilidad, ausencia de desbordamientos,
diálogos sin recortes y datos exclusivamente simulados. No retocar la captura
para aparentar un estado que la aplicación no muestra. Si cambia la interfaz,
actualizar la fixture y regenerar.

## Guía externa de Notion

`notion-api-guide/step1.png` a `step6.png` son capturas ilustrativas existentes
del panel de conexiones de Notion. El generador local no las sustituye; su
interfaz y los nombres de menús pueden cambiar. La captura del token lo muestra
oculto. No introducir tokens visibles al renovar esa guía.

Contrastar sus pasos con [Internal connections](https://developers.notion.com/guides/get-started/internal-connections).
El procedimiento de configuración está en el [README principal](../../../README.md).
