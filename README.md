# Dashboard HTML para actividad física

Base rápida en HTML para presentar el proyecto de la pauta.

## Qué debes rellenar

- `[TEMA]`: Actividad Fisica OMS.
- `[NOMBRES DEL GRUPO]`: Tomas Arenas y Cristobal Sepulveda.
- `[CURSO / ASIGNATURA]`: Almacenamiento y Arquitectura.
- `[API / DATASET / FORMULARIOS]`: fuente de datos.
- `[ENDPOINT]`: URL del servicio si hay API.
- `[CAMPO1]` y `[CAMPO2]`: nombres de variables reales.
- `[DEFINE AQUÍ TU REGLA DE SLA]`: definición del KPI de SLA.
- `[NOMBRE DEL TEMA]`, `[QUÉ QUIEREN MEDIR]`, `[OBJETIVO GENERAL]`, `[FECHAS / RANGO DE TIEMPO]`, `[NOTA IMPORTANTE DEL PROYECTO]`.

## Cómo usarlo

Abre `index.html` en el navegador o con Live Server.

## Notas

- Ya incluye 4 KPI cards.
- Uno de ellos está marcado como SLA.
- El gráfico usa Chart.js por CDN.

## Base de datos

- Hay un script SQL para crear la base de datos y poblarla con los datos de ejemplo en [db/init.sql](db/init.sql).
- Para ejecutarlo en tu sistema local (MySQL):

	- Abre una terminal y ejecuta: `mysql -u root < db/init.sql` (ajusta usuario/contraseña si es necesario).

- El servidor intenta detectar automáticamente si existe la tabla `actividad` o `respuestas` y usa la que encuentre.