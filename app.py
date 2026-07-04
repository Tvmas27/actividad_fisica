from datetime import datetime
import os
import mysql.connector
from mysql.connector.pooling import MySQLConnectionPool
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

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

def init_db():
    global pool
    try:
        pool = MySQLConnectionPool(pool_name="actividad_fisica_pool", pool_size=5, **DB_CONFIG)
        pool.get_connection().close()
        print("✅ Conectado a MySQL")
    except mysql.connector.Error as exc:
        print(f"❌ Error de conexión: {exc}")
        raise SystemExit(1)

def query(sql, params=None, fetch_one=False):
    if params is None: params = []
    conn = pool.get_connection()
    cursor = conn.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        if cursor.with_rows:
            return cursor.fetchone() if fetch_one else cursor.fetchall()
        conn.commit()
        return []
    finally:
        cursor.close()
        conn.close()

def scalar(sql, params=None, default=0):
    row = query(sql, params=params, fetch_one=True)
    if not row:
        return default
    val = next(iter(row.values()))
    return default if val is None else val

def sql_identifier(name):
    return f"`{name.replace('`', '``')}`"

def get_table_columns(table_name):
    rows = query("""
        SELECT COLUMN_NAME, DATA_TYPE
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ORDINAL_POSITION
    """, [DB_CONFIG["database"], table_name])
    return [{"name": r["COLUMN_NAME"], "type": r["DATA_TYPE"]} for r in rows]

def has_table(table_name):
    return len(get_table_columns(table_name)) > 0

def column_map(table_name):
    return {col["name"].lower(): col for col in get_table_columns(table_name)}

def pick_column(table_name, candidates):
    cols = column_map(table_name)
    for c in candidates:
        if c.lower() in cols:
            return cols[c.lower()]["name"]
    return None

def is_text_type(dtype):
    return dtype.lower() in {"char", "varchar", "text", "tinytext", "mediumtext", "longtext"}

def source_from_request():
    if request.path.startswith("/api/kpi/etl/"):
        return "etl"
    src = (request.args.get("source") or "").lower()
    return "etl" if src in {"etl", "filtrado", "filtered"} else "original"

def fact_table_for_source(source):
    return "fact_actividad_fisica" if source == "etl" else "fact_respuestas"

def range_expression(table_name, alias="f"):
    cols = column_map(table_name)
    if "edad" in cols:
        return f"""
            CASE
                WHEN {alias}.edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN {alias}.edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN {alias}.edad BETWEEN 41 AND 60 THEN '41-60'
                WHEN {alias}.edad >= 61 THEN '60+'
                ELSE 'sin_rango'
            END
        """
    for c in ["rango_etario", "rango_edad", "rango"]:
        if c in cols:
            return f"COALESCE(NULLIF({alias}.{sql_identifier(c)}, ''), 'sin_rango')"
    raise ValueError("Tabla sin columna de edad o rango")

def minutes_column(table_name, alias="f"):
    col = pick_column(table_name, ["minutos_actividad", "minutos", "actividad_minutos"])
    if not col:
        raise ValueError("Tabla sin columna de minutos")
    return f"{alias}.{sql_identifier(col)}"

def hours_column(table_name, alias="f"):
    col = pick_column(table_name, ["horas_sentado", "horas", "horas_sentar"])
    if not col:
        raise ValueError("Tabla sin columna de horas sentado")
    return f"{alias}.{sql_identifier(col)}"

def activity_expression_and_join(table_name, alias="f"):
    cols = column_map(table_name)
    fk = pick_column(table_name, ["id_actividad", "actividad_id"])
    if fk and has_table("dim_actividad"):
        dim_id = pick_column("dim_actividad", ["id_actividad", "actividad_id", "id"])
        dim_label = pick_column("dim_actividad", ["tipo_actividad", "tipo", "actividad", "nombre"])
        if dim_id and dim_label:
            return f"a.{sql_identifier(dim_label)}", f"JOIN dim_actividad a ON {alias}.{sql_identifier(fk)} = a.{sql_identifier(dim_id)}"
    for c in ["tipo_actividad", "actividad", "tipo"]:
        if c in cols:
            return f"{alias}.{sql_identifier(c)}", ""
    raise ValueError("No se pudo resolver actividad")

def app_expression_and_join(table_name, alias="f"):
    cols = column_map(table_name)
    fk = pick_column(table_name, ["id_app", "app_id"])
    if fk and has_table("dim_app"):
        dim_id = pick_column("dim_app", ["id_app", "app_id", "id"])
        dim_label = pick_column("dim_app", ["usa_app", "app", "descripcion"])
        if dim_id and dim_label:
            return f"a.{sql_identifier(dim_label)}", f"JOIN dim_app a ON {alias}.{sql_identifier(fk)} = a.{sql_identifier(dim_id)}"
    for c in ["usa_app", "app", "usa"]:
        if c in cols:
            return f"{alias}.{sql_identifier(c)}", ""
    raise ValueError("No se pudo resolver app")

def health_expression_and_join(table_name, alias="f"):
    cols = column_map(table_name)
    fk = pick_column(table_name, ["id_salud", "salud_id"])
    if fk and has_table("dim_salud"):
        dim_id = pick_column("dim_salud", ["id_salud", "salud_id", "id"])
        numeric_col = pick_column("dim_salud", ["valor_promedio", "promedio", "valor"])
        label_col = pick_column("dim_salud", ["nivel_salud", "nivel", "rango"])
        if dim_id and numeric_col:
            return f"s.{sql_identifier(numeric_col)}", f"JOIN dim_salud s ON {alias}.{sql_identifier(fk)} = s.{sql_identifier(dim_id)}"
        if dim_id and label_col:
            expr = f"""
                CASE
                    WHEN s.{sql_identifier(label_col)} = '1-3' THEN 2
                    WHEN s.{sql_identifier(label_col)} = '3-5' THEN 4
                    WHEN s.{sql_identifier(label_col)} = '5-8' THEN 6.5
                    WHEN s.{sql_identifier(label_col)} = '8-10' THEN 9
                    ELSE 0
                END
            """
            return expr, f"JOIN dim_salud s ON {alias}.{sql_identifier(fk)} = s.{sql_identifier(dim_id)}"
    for c in ["percepcion_salud", "nivel_salud", "salud"]:
        if c in cols:
            col_sql = sql_identifier(c)
            if is_text_type(cols[c]["type"]):
                return f"""
                    CASE
                        WHEN {alias}.{col_sql} = '1-3' THEN 2
                        WHEN {alias}.{col_sql} = '3-5' THEN 4
                        WHEN {alias}.{col_sql} = '5-8' THEN 6.5
                        WHEN {alias}.{col_sql} = '8-10' THEN 9
                        ELSE CAST({alias}.{col_sql} AS DECIMAL(10,2))
                    END
                """, ""
            return f"CAST({alias}.{col_sql} AS DECIMAL(10,2))", ""
    raise ValueError("No se pudo resolver salud")

def date_expression_and_join(table_name, alias="f"):
    cols = column_map(table_name)
    for c in ["fecha_carga", "fecha", "date"]:
        if c in cols:
            return f"{alias}.{sql_identifier(c)}", ""
    fk = pick_column(table_name, ["id_fecha", "fecha_id"])
    if fk and has_table("dim_fecha"):
        dim_id = pick_column("dim_fecha", ["id_fecha", "fecha_id", "id"])
        dim_date = pick_column("dim_fecha", ["fecha", "date", "dia"])
        if dim_id and dim_date:
            return f"d.{sql_identifier(dim_date)}", f"JOIN dim_fecha d ON {alias}.{sql_identifier(fk)} = d.{sql_identifier(dim_id)}"
    raise ValueError("No se pudo resolver fecha")

def completeness_columns(table_name):
    cols = column_map(table_name)
    preferred = ["edad","rango_etario","rango_edad","horas_sentado","horas","minutos_actividad","id_genero","genero","id_actividad","actividad_id","tipo_actividad","actividad","id_salud","salud_id","nivel_salud","percepcion_salud","id_app","app_id","usa_app","id_fecha","fecha_id","fecha","fecha_carga"]
    selected = []
    seen = set()
    for c in preferred:
        if c in cols and c not in seen:
            selected.append(cols[c])
            seen.add(c)
    return selected

def build_quality_response(table_name, source):
    cols = get_table_columns(table_name)
    if not cols:
        raise ValueError(f"Tabla {table_name} no existe")
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    select_parts = ["COUNT(*) AS total"]
    for col in cols:
        if col["name"].lower() == "id": continue
        col_sql = sql_identifier(col["name"])
        alias = sql_identifier(f"{col['name']}_nulos")
        if is_text_type(col["type"]):
            select_parts.append(f"SUM(CASE WHEN {col_sql} IS NULL OR TRIM({col_sql}) = '' THEN 1 ELSE 0 END) AS {alias}")
        else:
            select_parts.append(f"SUM(CASE WHEN {col_sql} IS NULL THEN 1 ELSE 0 END) AS {alias}")
    row = query(f"SELECT {', '.join(select_parts)} FROM {table_name}", fetch_one=True)
    metrics = []
    for col in cols:
        if col["name"].lower() == "id": continue
        nulos = int(row.get(f"{col['name']}_nulos", 0) or 0)
        completitud = round(((total - nulos) / total) * 100, 2) if total else 0
        estado = "verde" if completitud >= 95 else "amarillo" if completitud >= 90 else "rojo"
        metrics.append({"campo": col["name"], "completitud": completitud, "nulos": nulos, "estado": estado})
    avg = round(sum(m["completitud"] for m in metrics) / len(metrics), 2) if metrics else 0
    return {
        "ok": True, "source": source, "table": table_name,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total": total, "data": metrics,
        "resumen": {"completitud_promedio": avg, "campos": len(metrics)}
    }

def sla_response_for_table(table_name, source):
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    cols = completeness_columns(table_name)
    if cols:
        checks = []
        for col in cols:
            col_sql = sql_identifier(col["name"])
            if is_text_type(col["type"]):
                checks.append(f"{col_sql} IS NOT NULL AND TRIM({col_sql}) <> ''")
            else:
                checks.append(f"{col_sql} IS NOT NULL")
        completos = scalar(f"SELECT COUNT(*) AS completos FROM {table_name} WHERE {' AND '.join(checks)}", default=0)
    else:
        completos = total
    pct_comp = round((completos / total) * 100) if total else 0
    color_comp = "green" if pct_comp >= 95 else "yellow" if pct_comp >= 90 else "red"
    freshness = 0
    color_fresh = "red"
    try:
        date_expr, date_join = date_expression_and_join(table_name)
        freshness = int(scalar(f"SELECT DATEDIFF(CURDATE(), MAX(x.fecha_valor)) AS dias FROM (SELECT {date_expr} AS fecha_valor FROM {table_name} f {date_join}) x", default=0) or 0)
        color_fresh = "green" if freshness <= 21 else "yellow" if freshness <= 42 else "red"
    except Exception:
        pass
    invalid = []
    if "horas_sentado" in column_map(table_name):
        invalid.append("horas_sentado < 0 OR horas_sentado > 18")
    if "minutos_actividad" in column_map(table_name):
        invalid.append("minutos_actividad < 0")
    errores = scalar(f"SELECT SUM(CASE WHEN {' OR '.join(invalid)} THEN 1 ELSE 0 END) AS errores FROM {table_name}", default=0) if invalid else 0
    error_rate = round((errores / total) * 100, 2) if total else 0
    color_error = "green" if error_rate <= 1 else "yellow" if error_rate <= 5 else "red"
    return {
        "ok": True, "source": source, "table": table_name,
        "data": [
            {"dimension": "Completitud", "color": color_comp, "descripcion": f"{completos}/{total} ({pct_comp}%)"},
            {"dimension": "Freshness (días)", "color": color_fresh, "descripcion": f"{freshness} días"},
            {"dimension": "Error Rate", "color": color_error, "descripcion": f"{error_rate:.2f}%"}
        ]
    }

def pearson_correlation(table_name):
    hours_expr = hours_column(table_name)
    health_expr, health_join = health_expression_and_join(table_name)
    rows = query(f"SELECT {hours_expr} AS horas_sentado, {health_expr} AS percepcion_salud FROM {table_name} f {health_join} WHERE {hours_expr} IS NOT NULL AND {health_expr} IS NOT NULL")
    if not rows or len(rows) < 2:
        return {"correlacion": 0, "color": "yellow", "n": 0}
    n = len(rows)
    sum_x = sum_y = sum_xy = sum_x2 = sum_y2 = 0.0
    for r in rows:
        x = float(r["horas_sentado"]); y = float(r["percepcion_salud"])
        sum_x += x; sum_y += y; sum_xy += x*y; sum_x2 += x*x; sum_y2 += y*y
    num = (n * sum_xy) - (sum_x * sum_y)
    den = ((n * sum_x2) - (sum_x * sum_x)) * ((n * sum_y2) - (sum_y * sum_y))
    corr = 0 if den <= 0 else round(num / (den ** 0.5), 4)
    color = "green" if corr < -0.3 else "red" if corr > 0.3 else "yellow"
    return {"correlacion": corr, "color": color, "n": n}

def tipo_actividad_response(table_name):
    rango_expr = range_expression(table_name)
    act_expr, join_sql = activity_expression_and_join(table_name)
    rows = query(f"""
        SELECT {rango_expr} AS rango, {act_expr} AS actividad, COUNT(*) AS total
        FROM {table_name} f {join_sql}
        GROUP BY rango, actividad
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango'), total DESC
    """)
    result = []
    seen = set()
    for row in rows:
        r = row.get("rango")
        if r and r != "sin_rango" and r not in seen:
            seen.add(r); result.append(row)
    return result

def basic_range_response(table_name):
    rango_expr = range_expression(table_name)
    mins = minutes_column(table_name)
    return query(f"""
        SELECT {rango_expr} AS rango, ROUND(AVG({mins}), 2) AS promedio_minutos, COUNT(*) AS total
        FROM {table_name} f
        GROUP BY rango
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango')
    """)

def sedentarismo_response(table_name):
    rango_expr = range_expression(table_name)
    mins = minutes_column(table_name)
    return query(f"""
        SELECT {rango_expr} AS rango, ROUND(SUM(CASE WHEN {mins} < 75 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS porcentaje_sedentario
        FROM {table_name} f
        GROUP BY rango
        ORDER BY FIELD(rango, '14-24', '25-40', '41-60', '60+', 'sin_rango')
    """)

def nivel_oms_response(table_name):
    mins = minutes_column(table_name)
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    rows = query(f"""
        SELECT
            CASE WHEN {mins} < 75 THEN 'sedentario' WHEN {mins} BETWEEN 75 AND 149 THEN 'insuficiente' WHEN {mins} >= 150 THEN 'activo' ELSE 'sin_dato' END AS nivel,
            COUNT(*) AS total,
            ROUND(COUNT(*) / %s * 100, 2) AS porcentaje
        FROM {table_name} f
        GROUP BY nivel
        ORDER BY FIELD(nivel, 'sedentario', 'insuficiente', 'activo', 'sin_dato')
    """, [total])
    return total, rows

def usa_app_response(table_name):
    app_expr, join_sql = app_expression_and_join(table_name)
    total = scalar(f"SELECT COUNT(*) AS total FROM {table_name}", default=0)
    return query(f"""
        SELECT {app_expr} AS usa_app, COUNT(*) AS total, ROUND(COUNT(*) / %s * 100, 2) AS porcentaje
        FROM {table_name} f {join_sql}
        GROUP BY usa_app
    """, [total])

# Rutas (todas las que antes estaban en el bucle, pero ahora con funciones lambda simples)
def make_route(path, func):
    app.add_url_rule(path, endpoint=f"{func.__name__}_{path.replace('/', '_')}", view_func=func)

def api_nivel_oms():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        total, rows = nivel_oms_response(t)
        return jsonify({"ok": True, "source": src, "total": total, "data": rows})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_rango_etario():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify({"ok": True, "source": src, "data": basic_range_response(t)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_sedentarismo():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify({"ok": True, "source": src, "data": sedentarismo_response(t)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_tipo_actividad():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify({"ok": True, "source": src, "data": tipo_actividad_response(t)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_correlacion():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify({"ok": True, "source": src, "data": pearson_correlation(t)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_usa_app():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify({"ok": True, "source": src, "data": usa_app_response(t)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_sla():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify(sla_response_for_table(t, src))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

def api_quality():
    try:
        src = source_from_request(); t = fact_table_for_source(src)
        return jsonify(build_quality_response(t, src))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

# Registrar rutas
routes = [
    ("/api/kpi/nivel_oms", api_nivel_oms), ("/api/kpi/etl/nivel_oms", api_nivel_oms),
    ("/api/kpi/rango_etario", api_rango_etario), ("/api/kpi/etl/rango_etario", api_rango_etario),
    ("/api/kpi/sedentarismo", api_sedentarismo), ("/api/kpi/etl/sedentarismo", api_sedentarismo),
    ("/api/kpi/tipo_actividad", api_tipo_actividad), ("/api/kpi/etl/tipo_actividad", api_tipo_actividad),
    ("/api/kpi/correlacion", api_correlacion), ("/api/kpi/etl/correlacion", api_correlacion),
    ("/api/kpi/usa_app", api_usa_app), ("/api/kpi/etl/usa_app", api_usa_app),
    ("/api/sla", api_sla), ("/api/kpi/etl/sla", api_sla),
    ("/api/quality", api_quality), ("/api/kpi/etl/quality", api_quality),
]
for path, func in routes:
    app.add_url_rule(path, endpoint=f"{func.__name__}_{path.replace('/', '_')}", view_func=func)

@app.get("/")
def home():
    return send_from_directory(ROOT_DIR, "index.html")

@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "Endpoint no encontrado"}), 404
    return "Not Found", 404

if __name__ == "__main__":
    init_db()
    print(f"🚀 Servidor Flask en http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)