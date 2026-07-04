from datetime import datetime
import os
from functools import lru_cache

import mysql.connector
from mysql.connector.pooling import MySQLConnectionPool
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS


# ============================================================
# Configuracion general
# ============================================================

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
PORT = int(os.getenv("PORT", "5000"))

DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "actividad_fisica"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
}

app = Flask(__name__, static_folder=ROOT_DIR, static_url_path="")
app.json.ensure_ascii = False
CORS(app)

pool = None


# ============================================================
# Conexion a MySQL
# ============================================================

def init_db():
    global pool
    try:
        pool = MySQLConnectionPool(pool_name="actividad_fisica_pool", pool_size=5, **DB_CONFIG)
        connection = pool.get_connection()
        connection.close()
        print("✅ Conectado a MySQL")
    except mysql.connector.Error as exc:
        print(f"❌ Error de conexión a MySQL: {exc}")
        raise SystemExit(1) from exc


def query(sql, params=None, fetch_one=False):
    if params is None:
        params = []

    connection = pool.get_connection()
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        if cursor.with_rows:
            return cursor.fetchone() if fetch_one else cursor.fetchall()
        connection.commit()
        return []
    finally:
        cursor.close()
        connection.close()


def scalar(sql, params=None, default=0):
    row = query(sql, params=params, fetch_one=True)
    if not row:
        return default
    value = next(iter(row.values()))
    return default if value is None else value


# ============================================================
# Utilidades dinamicas para tablas y columnas
# ============================================================

def sql_identifier(name):
    return f"`{name.replace('`', '``')}`"


@lru_cache(maxsize=None)
def get_table_columns(table_name):
    rows = query(
        """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ORDINAL_POSITION
        """,
        [DB_CONFIG["database"], table_name],
    )
    return [{"name": row["COLUMN_NAME"], "type": row["DATA_TYPE"]} for row in rows]


def has_table(table_name):
    return len(get_table_columns(table_name)) > 0


def column_map(table_name):
    return {column["name"].lower(): column for column in get_table_columns(table_name)}


def pick_column(table_name, candidates):
    columns = column_map(table_name)
    for candidate in candidates:
        column = columns.get(candidate.lower())
        if column:
            return column["name"]
    return None


def is_text_type(data_type):
    return data_type.lower() in {"char", "varchar", "text", "tinytext", "mediumtext", "longtext"}


def source_from_request():
    if request.path.startswith("/api/kpi/etl/"):
        return "etl"
    source = (request.args.get("source") or request.args.get("fuente") or "original").lower()
    return "etl" if source in {"etl", "filtrado", "filtered"} else "original"


def fact_table_for_source(source):
    return "fact_actividad_fisica" if source == "etl" else "fact_respuestas"


def range_expression(table_name, alias="f"):
    columnas = column_map(table_name)

    if "edad" in columnas:
        return f"""
            CASE
                WHEN {alias}.edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN {alias}.edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN {alias}.edad BETWEEN 41 AND 60 THEN '41-60'
                WHEN {alias}.edad >= 61 THEN '60+'
                ELSE 'sin_rango'
            END
        """

    for candidate in ["rango_etario", "rango_edad", "rango"]:
        column = columnas.get(candidate)
        if column:
            column_sql = sql_identifier(column["name"])
            return f"COALESCE(NULLIF({alias}.{column_sql}, ''), 'sin_rango')"

    raise ValueError(f"La tabla {table_name} no tiene columna de edad o rango etario")


def minutes_column(table_name, alias="f"):
    column = pick_column(table_name, ["minutos_actividad", "minutos", "actividad_minutos"])
    if not column:
        raise ValueError(f"La tabla {table_name} no tiene columna de minutos de actividad")
    return f"{alias}.{sql_identifier(column)}"


def hours_column(table_name, alias="f"):
    column = pick_column(table_name, ["horas_sentado", "horas", "horas_sentar"])
    if not column:
        raise ValueError(f"La tabla {table_name} no tiene columna de horas sentado")
    return f"{alias}.{sql_identifier(column)}"


def activity_expression_and_join(table_name, alias="f"):
    fact_columns = column_map(table_name)
    fk = pick_column(table_name, ["id_actividad", "actividad_id"])

    if fk and has_table("dim_actividad"):
        dim_id = pick_column("dim_actividad", ["id_actividad", "actividad_id", "id"])
        dim_label = pick_column("dim_actividad", ["tipo_actividad", "tipo", "actividad", "nombre"])
        if dim_id and dim_label:
            join_sql = f"JOIN dim_actividad a ON {alias}.{sql_identifier(fk)} = a.{sql_identifier(dim_id)}"
            return f"a.{sql_identifier(dim_label)}", join_sql

    for candidate in ["tipo_actividad", "actividad", "tipo"]:
        column = fact_columns.get(candidate)
        if column:
            return f"{alias}.{sql_identifier(column['name'])}", ""

    raise ValueError(f"No se pudo resolver la actividad para {table_name}")


def app_expression_and_join(table_name, alias="f"):
    fact_columns = column_map(table_name)
    fk = pick_column(table_name, ["id_app", "app_id"])

    if fk and has_table("dim_app"):
        dim_id = pick_column("dim_app", ["id_app", "app_id", "id"])
        dim_label = pick_column("dim_app", ["usa_app", "app", "descripcion"])
        if dim_id and dim_label:
            join_sql = f"JOIN dim_app a ON {alias}.{sql_identifier(fk)} = a.{sql_identifier(dim_id)}"
            return f"a.{sql_identifier(dim_label)}", join_sql

    for candidate in ["usa_app", "app", "usa"]:
        column = fact_columns.get(candidate)
        if column:
            return f"{alias}.{sql_identifier(column['name'])}", ""

    raise ValueError(f"No se pudo resolver el uso de app para {table_name}")


def health_expression_and_join(table_name, alias="f"):
    fact_columns = column_map(table_name)
    fk = pick_column(table_name, ["id_salud", "salud_id"])

    if fk and has_table("dim_salud"):
        dim_id = pick_column("dim_salud", ["id_salud", "salud_id", "id"])
        numeric_col = pick_column("dim_salud", ["valor_promedio", "promedio", "valor"])
        label_col = pick_column("dim_salud", ["nivel_salud", "nivel", "rango"])

        if dim_id and numeric_col:
            join_sql = f"JOIN dim_salud s ON {alias}.{sql_identifier(fk)} = s.{sql_identifier(dim_id)}"
            return f"s.{sql_identifier(numeric_col)}", join_sql

        if dim_id and label_col:
            join_sql = f"JOIN dim_salud s ON {alias}.{sql_identifier(fk)} = s.{sql_identifier(dim_id)}"
            expression = f"""
                CASE
                    WHEN s.{sql_identifier(label_col)} = '1-3' THEN 2
                    WHEN s.{sql_identifier(label_col)} = '3-5' THEN 4
                    WHEN s.{sql_identifier(label_col)} = '5-8' THEN 6.5
                    WHEN s.{sql_identifier(label_col)} = '8-10' THEN 9
                    ELSE 0
                END
            """
            return expression, join_sql

    for candidate in ["percepcion_salud", "nivel_salud", "salud"]:
        column = fact_columns.get(candidate)
        if column:
            column_sql = sql_identifier(column["name"])
            if is_text_type(column["type"]):
                expression = f"""
                    CASE
                        WHEN {alias}.{column_sql} = '1-3' THEN 2
                        WHEN {alias}.{column_sql} = '3-5' THEN 4
                        WHEN {alias}.{column_sql} = '5-8' THEN 6.5
                        WHEN {alias}.{column_sql} = '8-10' THEN 9
                        ELSE CAST({alias}.{column_sql} AS DECIMAL(10,2))
                    END
                """
            else:
                expression = f"CAST({alias}.{column_sql} AS DECIMAL(10,2))"
            return expression, ""

    raise ValueError(f"No se pudo resolver la percepcion de salud para {table_name}")


def date_expression_and_join(table_name, alias="f"):
    fact_columns = column_map(table_name)

    for candidate in ["fecha_carga", "fecha", "date"]:
        column = fact_columns.get(candidate)
        if column:
            return f"{alias}.{sql_identifier(column['name'])}", ""

    fk = pick_column(table_name, ["id_fecha", "fecha_id"])
    if fk and has_table("dim_fecha"):
        dim_id = pick_column("dim_fecha", ["id_fecha", "fecha_id", "id"])
        dim_date = pick_column("dim_fecha", ["fecha", "date", "dia"])
        if dim_id and dim_date:
            join_sql = f"JOIN dim_fecha d ON {alias}.{sql_identifier(fk)} = d.{sql_identifier(dim_id)}"
            return f"d.{sql_identifier(dim_date)}", join_sql

    raise ValueError(f"No se pudo resolver la fecha para {table_name}")


def completeness_columns(table_name):
    fact_columns = column_map(table_name)
    preferred = [
        "edad",
        "rango_etario",
        "rango_edad",
        "horas_sentado",
        "horas",
        "minutos_actividad",
        "id_genero",
        "genero",
        "id_actividad",
        "actividad_id",
        "tipo_actividad",
        "actividad",
        "id_salud",
        "salud_id",
        "nivel_salud",
        "percepcion_salud",
        "id_app",
        "app_id",
        "usa_app",
        "id_fecha",
        "fecha_id",
        "fecha",
        "fecha_carga",
    ]

    selected = []
    seen = set()
    for candidate in preferred:
        column = fact_columns.get(candidate)
        if column and column["name"].lower() not in seen:
            selected.append(column)
            seen.add(column["name"].lower())
    return selected


def build_quality_response(table_name, source):
    columns = get_table_columns(table_name)
    if not columns:
        raise ValueError(f"La tabla {table_name} no existe o no tiene columnas")

    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    select_parts = ["COUNT(*) AS total"]

    for column in columns:
        if column["name"].lower() == "id":
            continue
        column_sql = sql_identifier(column["name"])
        alias_name = f"{column['name']}_nulos"
        alias_sql = sql_identifier(alias_name)
        if is_text_type(column["type"]):
            null_sql = f"SUM(CASE WHEN {column_sql} IS NULL OR TRIM({column_sql}) = '' THEN 1 ELSE 0 END) AS {alias_sql}"
        else:
            null_sql = f"SUM(CASE WHEN {column_sql} IS NULL THEN 1 ELSE 0 END) AS {alias_sql}"
        select_parts.append(null_sql)

    row = query(f"SELECT {', '.join(select_parts)} FROM {table_name}", fetch_one=True)
    metrics = []

    for column in columns:
        if column["name"].lower() == "id":
            continue
        nulos = int(row.get(f"{column['name']}_nulos", 0) or 0)
        completitud = round(((total - nulos) / total) * 100, 2) if total else 0
        estado = "verde" if completitud >= 95 else "amarillo" if completitud >= 90 else "rojo"
        metrics.append(
            {
                "campo": column["name"],
                "completitud": completitud,
                "nulos": nulos,
                "estado": estado,
            }
        )

    promedio = round(sum(item["completitud"] for item in metrics) / len(metrics), 2) if metrics else 0
    return {
        "ok": True,
        "source": source,
        "table": table_name,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total": total,
        "data": metrics,
        "resumen": {
            "completitud_promedio": promedio,
            "campos": len(metrics),
        },
    }


def sla_response_for_table(table_name, source):
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    fact_columns = column_map(table_name)

    completeness_fields = completeness_columns(table_name)
    if completeness_fields:
        checks = []
        for column in completeness_fields:
            column_sql = sql_identifier(column["name"])
            if is_text_type(column["type"]):
                checks.append(f"{column_sql} IS NOT NULL AND TRIM({column_sql}) <> ''")
            else:
                checks.append(f"{column_sql} IS NOT NULL")
        completeness_sql = f"SELECT COUNT(*) AS completos FROM {table_name} WHERE {' AND '.join(checks)}"
        completos = scalar(completeness_sql, default=0)
    else:
        completos = total

    pct_comp = round((completos / total) * 100) if total else 0
    color_comp = "green" if pct_comp >= 95 else "yellow" if pct_comp >= 90 else "red"

    freshness = 0
    color_fresh = "red"
    try:
        date_expr, date_join = date_expression_and_join(table_name)
        freshness_sql = f"SELECT DATEDIFF(CURDATE(), MAX(x.fecha_valor)) AS dias FROM (SELECT {date_expr} AS fecha_valor FROM {table_name} f {date_join}) x"
        freshness_value = scalar(freshness_sql, default=0)
        freshness = int(freshness_value) if freshness_value is not None else 0
        color_fresh = "green" if freshness <= 21 else "yellow" if freshness <= 42 else "red"
    except Exception:
        freshness = 0

    invalid_conditions = []
    if "horas_sentado" in fact_columns:
        invalid_conditions.append("horas_sentado < 0 OR horas_sentado > 18")
    if "minutos_actividad" in fact_columns:
        invalid_conditions.append("minutos_actividad < 0")

    errores = 0
    if invalid_conditions:
        error_sql = f"SELECT SUM(CASE WHEN {' OR '.join(invalid_conditions)} THEN 1 ELSE 0 END) AS errores FROM {table_name}"
        errores = scalar(error_sql, default=0)

    error_rate = round((errores / total) * 100, 2) if total else 0
    color_error = "green" if error_rate <= 1 else "yellow" if error_rate <= 5 else "red"

    return {
        "ok": True,
        "source": source,
        "table": table_name,
        "data": [
            {
                "dimension": "Completitud",
                "color": color_comp,
                "descripcion": f"{completos}/{total} ({pct_comp}%)",
            },
            {
                "dimension": "Freshness (días)",
                "color": color_fresh,
                "descripcion": f"{freshness} días",
            },
            {
                "dimension": "Error Rate",
                "color": color_error,
                "descripcion": f"{error_rate:.2f}%",
            },
        ],
    }


def pearson_correlation(table_name):
    hours_expr = hours_column(table_name)
    health_expr, health_join = health_expression_and_join(table_name)
    joins = f" {health_join}" if health_join else ""

    sql = f"""
        SELECT
            {hours_expr} AS horas_sentado,
            {health_expr} AS percepcion_salud
        FROM {table_name} f{joins}
        WHERE {hours_expr} IS NOT NULL
          AND {health_expr} IS NOT NULL
    """
    rows = query(sql)
    if not rows or len(rows) < 2:
        return {"correlacion": 0, "color": "yellow", "n": 0}

    n = len(rows)
    sum_x = 0.0
    sum_y = 0.0
    sum_xy = 0.0
    sum_x2 = 0.0
    sum_y2 = 0.0

    for row in rows:
        x = float(row["horas_sentado"])
        y = float(row["percepcion_salud"])
        sum_x += x
        sum_y += y
        sum_xy += x * y
        sum_x2 += x * x
        sum_y2 += y * y

    numerador = (n * sum_xy) - (sum_x * sum_y)
    denominador = ((n * sum_x2) - (sum_x * sum_x)) * ((n * sum_y2) - (sum_y * sum_y))
    correlacion = 0 if denominador <= 0 else round(numerador / (denominador ** 0.5), 4)
    color = "green" if correlacion < -0.3 else "red" if correlacion > 0.3 else "yellow"
    return {"correlacion": correlacion, "color": color, "n": n}


def tipo_actividad_response(table_name):
    rango_expr = range_expression(table_name)
    actividad_expr, join_sql = activity_expression_and_join(table_name)
    sql = f"""
        SELECT
            {rango_expr} AS rango,
            {actividad_expr} AS actividad,
            COUNT(*) AS total
        FROM {table_name} f
        {join_sql}
        GROUP BY rango, actividad
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango'), total DESC
    """
    rows = query(sql)
    result = []
    seen = set()
    for row in rows:
        rango = row.get("rango")
        if rango and rango != "sin_rango" and rango not in seen:
            seen.add(rango)
            result.append(row)
    return result


def basic_range_response(table_name):
    rango_expr = range_expression(table_name)
    minutos_expr = minutes_column(table_name)
    sql = f"""
        SELECT
            {rango_expr} AS rango,
            ROUND(AVG({minutos_expr}), 2) AS promedio_minutos,
            COUNT(*) AS total
        FROM {table_name} f
        GROUP BY rango
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango')
    """
    return query(sql)


def sedentarismo_response(table_name):
    rango_expr = range_expression(table_name)
    minutos_expr = minutes_column(table_name)
    sql = f"""
        SELECT
            {rango_expr} AS rango,
            ROUND(SUM(CASE WHEN {minutos_expr} < 75 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS porcentaje_sedentario
        FROM {table_name} f
        GROUP BY rango
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango')
    """
    return query(sql)


def nivel_oms_response(table_name):
    minutos_expr = minutes_column(table_name)
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    sql = f"""
        SELECT
            CASE
                WHEN {minutos_expr} < 75 THEN 'sedentario'
                WHEN {minutos_expr} BETWEEN 75 AND 149 THEN 'insuficiente'
                WHEN {minutos_expr} >= 150 THEN 'activo'
                ELSE 'sin_dato'
            END AS nivel,
            COUNT(*) AS total,
            ROUND(COUNT(*) / %s * 100, 2) AS porcentaje
        FROM {table_name} f
        GROUP BY nivel
        ORDER BY FIELD(nivel, 'sedentario', 'insuficiente', 'activo', 'sin_dato')
    """
    rows = query(sql, [total])
    return total, rows


def usa_app_response(table_name):
    app_expr, join_sql = app_expression_and_join(table_name)
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    sql = f"""
        SELECT
            {app_expr} AS usa_app,
            COUNT(*) AS total,
            ROUND(COUNT(*) / %s * 100, 2) AS porcentaje
        FROM {table_name} f
        {join_sql}
        GROUP BY usa_app
    """
    return query(sql, [total])


# ============================================================
# Endpoints KPI
# ============================================================

@app.get("/api/kpi/nivel_oms")
@app.get("/api/kpi/etl/nivel_oms")
def api_nivel_oms():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        total, rows = nivel_oms_response(table_name)
        return jsonify({"ok": True, "source": source, "total": total, "data": rows})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/kpi/rango_etario")
@app.get("/api/kpi/etl/rango_etario")
def api_rango_etario():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        rows = basic_range_response(table_name)
        return jsonify({"ok": True, "source": source, "data": rows})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/kpi/sedentarismo")
@app.get("/api/kpi/etl/sedentarismo")
def api_sedentarismo():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        rows = sedentarismo_response(table_name)
        return jsonify({"ok": True, "source": source, "data": rows})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/kpi/tipo_actividad")
@app.get("/api/kpi/etl/tipo_actividad")
def api_tipo_actividad():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        rows = tipo_actividad_response(table_name)
        return jsonify({"ok": True, "source": source, "data": rows})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/kpi/correlacion")
@app.get("/api/kpi/etl/correlacion")
def api_correlacion():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        data = pearson_correlation(table_name)
        return jsonify({"ok": True, "source": source, "data": data})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/kpi/usa_app")
@app.get("/api/kpi/etl/usa_app")
def api_usa_app():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        rows = usa_app_response(table_name)
        return jsonify({"ok": True, "source": source, "data": rows})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# ============================================================
# SLA y calidad de datos
# ============================================================

@app.get("/api/sla")
@app.get("/api/kpi/etl/sla")
def api_sla():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        data = sla_response_for_table(table_name, source)
        return jsonify(data)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/quality")
@app.get("/api/kpi/etl/quality")
def api_quality():
    try:
        source = source_from_request()
        table_name = fact_table_for_source(source)
        data = build_quality_response(table_name, source)
        return jsonify(data)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


# ============================================================
# Frontend
# ============================================================

@app.get("/")
def home():
    return send_from_directory(ROOT_DIR, "index.html")


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Endpoint no encontrado"}), 404
    return "Not Found", 404


if __name__ == "__main__":
    init_db()
    print(f"🚀 Servidor Flask en http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)