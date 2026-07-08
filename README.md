# 🏃 Dashboard de Actividad Física y Sedentarismo

Dashboard interactivo para visualizar KPIs sobre hábitos de actividad física a partir de una encuesta real de 60 respuestas. El sistema sigue una arquitectura completa de datos: ETL con Pentaho, almacenamiento en MySQL con modelo estrella, API REST en Flask y frontend con HTML/CSS/JS y Chart.js.

---

## 📌 Descripción del proyecto

El objetivo es medir los niveles reales de actividad física en una muestra de 60 personas, clasificándolos según los estándares de la Organización Mundial de la Salud (OMS). Los datos se recolectaron mediante un formulario de Google Forms entre el 24 y 26 de junio de 2026.

El dashboard permite:

- Visualizar 7 KPIs clave en tiempo real.
- Alternar entre datos originales y datos procesados por el ETL.
- Insertar y eliminar registros (CRUD).
- Monitorear la calidad de los datos mediante un SLA (semáforo de completitud, freshness y error rate).

---

## 🏗️ Arquitectura

El proyecto sigue una arquitectura de 4 capas inspirada en TOGAF:

| Capa | Tecnología |
|------|------------|
| **Frontend** | HTML5, CSS3, JavaScript vanilla, Chart.js |
| **Backend** | Python + Flask (API REST) |
| **Base de datos** | MySQL (modelo estrella) |
| **ETL** | Pentaho Data Integration (CE) |

### Flujo de datos

1. **Recolección:** Google Forms → 60 respuestas reales (CSV).
2. **ETL (Pentaho):** Limpieza, transformación y carga de datos a MySQL.
3. **Almacenamiento:** Modelo estrella en MySQL (`fact_respuestas` + dimensiones).
4. **API (Flask):** Expone métricas y KPIs mediante endpoints REST.
5. **Dashboard:** Consume la API y visualiza los datos en tiempo real.

---

## 📊 Modelo de datos (estrella)

- **Tabla de hechos:** `fact_respuestas`
  - `id_respuesta`, `edad`, `horas_sentado`, `minutos_actividad`, `fecha_carga`
- **Dimensiones:**
  - `dim_genero` (id_genero, genero)
  - `dim_actividad` (id_actividad, tipo_actividad)
  - `dim_salud` (id_salud, nivel_salud)
  - `dim_app` (id_app, usa_app)
  - `dim_fecha` (id_fecha, fecha)

---

## ⚙️ Instalación y ejecución

### Requisitos previos

- Python 3.8+
- MySQL 8.x
- Pentaho CE (opcional, para ejecutar el ETL)

### Pasos

1. **Clonar el repositorio**

```bash
git clone <url-del-repositorio>
cd actividad_fisica