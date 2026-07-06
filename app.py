from datetime import datetime
import os
import mysql.connector
from mysql.connector.pooling import MySQLConnectionPool
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

ROOT = os.path.abspath(os.path.dirname(__file__))
PORT = int(os.getenv("PORT", "5000"))
DB = {"host": os.getenv("MYSQL_HOST", "127.0.0.1"), "user": os.getenv("MYSQL_USER", "root"),
      "password": os.getenv("MYSQL_PASSWORD", ""), "database": os.getenv("MYSQL_DATABASE", "actividad_fisica"),
      "port": int(os.getenv("MYSQL_PORT", "3306"))}
app = Flask(__name__, static_folder=ROOT, static_url_path="")
app.json.ensure_ascii = False
CORS(app)
pool = None

def init_db():
    global pool
    try:
        pool = MySQLConnectionPool(pool_name="actividad_fisica_pool", pool_size=10, **DB)
        pool.get_connection().close()
        print("✅ Conectado a MySQL")
    except Exception as e:
        print(f"❌ Error: {e}"); raise SystemExit(1)

def q(sql, p=None, one=False):
    if p is None: p = []
    c = pool.get_connection(); cur = c.cursor(dictionary=True)
    try:
        cur.execute(sql, p)
        return cur.fetchone() if one else cur.fetchall() if cur.with_rows else (c.commit() or [])
    finally:
        cur.close(); c.close()

def s(sql, p=None, d=0):
    r = q(sql, p, one=True)
    return d if not r else (r.get(next(iter(r))) or d)

def cm(t): return {c["COLUMN_NAME"].lower(): c for c in q(
    "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_schema=%s AND table_name=%s", [DB["database"], t])}

def pc(t, cand): return next((cm(t)[c.lower()]["COLUMN_NAME"] for c in cand if c.lower() in cm(t)), None)

def istext(t): return t.lower() in {"char","varchar","text","tinytext","mediumtext","longtext"}

def source_from_request():
    if request.path.startswith("/api/kpi/etl/") or request.args.get("source","").lower() in {"etl","filtrado","filtered"}:
        return "etl"
    return "original"

def tb(src): return "fact_actividad_fisica" if src=="etl" else "fact_respuestas"

def rex(t, a="f"):
    c = cm(t)
    if "edad" in c: return f"CASE WHEN {a}.edad BETWEEN 14 AND 24 THEN '14-24' WHEN {a}.edad BETWEEN 25 AND 40 THEN '25-40' WHEN {a}.edad BETWEEN 41 AND 60 THEN '41-60' WHEN {a}.edad >= 61 THEN '60+' ELSE 'sin_rango' END"
    for k in ["rango_etario","rango_edad","rango"]:
        if k in c: return f"COALESCE(NULLIF({a}.`{k}`,''),'sin_rango')"
    raise ValueError("Sin edad/rango")

def mcol(t, a="f"): return f"{a}.`{pc(t,['minutos_actividad','minutos','actividad_minutos'])}`"
def hcol(t, a="f"): return f"{a}.`{pc(t,['horas_sentado','horas','horas_sentar'])}`"

def jact(t, a="f"):
    fk = pc(t, ["id_actividad","actividad_id"])
    if fk:
        did = pc("dim_actividad", ["id_actividad","actividad_id","id"])
        dlab = pc("dim_actividad", ["tipo_actividad","tipo","actividad","nombre"])
        if did and dlab: return f"a.`{dlab}`", f"JOIN dim_actividad a ON {a}.`{fk}`=a.`{did}`"
    for k in ["tipo_actividad","actividad","tipo"]:
        if k in cm(t): return f"{a}.`{k}`", ""

def japp(t, a="f"):
    fk = pc(t, ["id_app","app_id"])
    if fk:
        did = pc("dim_app", ["id_app","app_id","id"])
        dlab = pc("dim_app", ["usa_app","app","descripcion"])
        if did and dlab: return f"a.`{dlab}`", f"JOIN dim_app a ON {a}.`{fk}`=a.`{did}`"
    for k in ["usa_app","app","usa"]:
        if k in cm(t): return f"{a}.`{k}`", ""
    raise ValueError("Sin app")

def jsal(t, a="f"):
    fk = pc(t, ["id_salud","salud_id"])
    if fk:
        did = pc("dim_salud", ["id_salud","salud_id","id"])
        num = pc("dim_salud", ["valor_promedio","promedio","valor"])
        lab = pc("dim_salud", ["nivel_salud","nivel","rango"])
        if did and num: return f"s.`{num}`", f"JOIN dim_salud s ON {a}.`{fk}`=s.`{did}`"
        if did and lab:
            return f"CASE WHEN s.`{lab}`='1-3' THEN 2 WHEN s.`{lab}`='3-5' THEN 4 WHEN s.`{lab}`='5-8' THEN 6.5 WHEN s.`{lab}`='8-10' THEN 9 ELSE 0 END", f"JOIN dim_salud s ON {a}.`{fk}`=s.`{did}`"
    for k in ["percepcion_salud","nivel_salud","salud"]:
        if k in cm(t):
            col = cm(t)[k]
            return f"CASE WHEN {a}.`{k}`='1-3' THEN 2 WHEN {a}.`{k}`='3-5' THEN 4 WHEN {a}.`{k}`='5-8' THEN 6.5 WHEN {a}.`{k}`='8-10' THEN 9 ELSE CAST({a}.`{k}` AS DECIMAL) END" if istext(col["DATA_TYPE"]) else f"CAST({a}.`{k}` AS DECIMAL)", ""
    raise ValueError("Sin salud")

def jfec(t, a="f"):
    c = cm(t)
    for k in ["fecha_carga","fecha","date"]:
        if k in c: return f"{a}.`{k}`", ""
    fk = pc(t, ["id_fecha","fecha_id"])
    if fk and "dim_fecha" in cm("dim_fecha"):
        did = pc("dim_fecha", ["id_fecha","fecha_id","id"])
        ddate = pc("dim_fecha", ["fecha","date","dia"])
        if did and ddate: return f"d.`{ddate}`", f"JOIN dim_fecha d ON {a}.`{fk}`=d.`{did}`"
    raise ValueError("Sin fecha")

def quality(t, src):
    cols = q("SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns WHERE table_schema=%s AND table_name=%s", [DB["database"], t])
    total = s(f"SELECT COUNT(*) FROM {t}")
    sp = ["COUNT(*) AS total"]
    for c in cols:
        if c["COLUMN_NAME"].lower() == "id": continue
        col = f"`{c['COLUMN_NAME']}`"
        sp.append(f"SUM(CASE WHEN {col} IS NULL OR (TRIM({col})='' AND {1 if istext(c['DATA_TYPE']) else 0}) THEN 1 ELSE 0 END) AS `{c['COLUMN_NAME']}_nulos`")
    row = q(f"SELECT {', '.join(sp)} FROM {t}", one=True)
    metrics = []
    for c in cols:
        if c["COLUMN_NAME"].lower() == "id": continue
        nulos = int(row.get(f"{c['COLUMN_NAME']}_nulos", 0) or 0)
        comp = round(((total - nulos) / total) * 100, 2) if total else 0
        estado = "verde" if comp >= 95 else "amarillo" if comp >= 90 else "rojo"
        metrics.append({"campo": c["COLUMN_NAME"], "completitud": comp, "nulos": nulos, "estado": estado})
    return {"ok": True, "source": src, "table": t, "generated_at": datetime.now().isoformat(timespec="seconds"),
            "total": total, "data": metrics, "resumen": {"completitud_promedio": round(sum(m["completitud"] for m in metrics)/len(metrics),2) if metrics else 0, "campos": len(metrics)}}

def sla(t, src):
    total = s(f"SELECT COUNT(*) FROM {t}")
    # Completitud
    checks = []
    for k in ["edad","horas_sentado","minutos_actividad","id_genero","id_actividad","id_salud","id_app"]:
        if k in cm(t):
            c = cm(t)[k]
            checks.append(f"`{k}` IS NOT NULL AND TRIM(`{k}`) <> ''" if istext(c["DATA_TYPE"]) else f"`{k}` IS NOT NULL")
    completos = s(f"SELECT COUNT(*) FROM {t} WHERE {' AND '.join(checks)}") if checks else total
    pct = round(completos/total*100) if total else 0
    colcomp = "green" if pct>=95 else "yellow" if pct>=90 else "red"
    # Freshness
    try:
        fe, fj = jfec(t)
        fresh = int(s(f"SELECT DATEDIFF(CURDATE(), MAX(x.fecha_valor)) FROM (SELECT {fe} AS fecha_valor FROM {t} f {fj}) x") or 0)
    except: fresh = 0
    colfresh = "green" if fresh<=21 else "yellow" if fresh<=42 else "red"
    # Error
    invalid = []
    if "horas_sentado" in cm(t): invalid.append("horas_sentado < 0 OR horas_sentado > 18")
    if "minutos_actividad" in cm(t): invalid.append("minutos_actividad < 0")
    err = s(f"SELECT SUM(CASE WHEN {' OR '.join(invalid)} THEN 1 ELSE 0 END) FROM {t}") if invalid else 0
    rate = round(err/total*100,2) if total else 0
    colerr = "green" if rate<=1 else "yellow" if rate<=5 else "red"
    return {"ok": True, "source": src, "table": t, "data": [
        {"dimension": "Completitud", "color": colcomp, "descripcion": f"{completos}/{total} ({pct}%)"},
        {"dimension": "Freshness (días)", "color": colfresh, "descripcion": f"{fresh} días"},
        {"dimension": "Error Rate", "color": colerr, "descripcion": f"{rate:.2f}%"}
    ]}

def kpi(kind):
    def wrapper():
        try:
            source = source_from_request()
            t = tb(source)
            if source == "etl":
                if kind == "nivel_oms":
                    total = s(f"SELECT SUM(total_encuestados) FROM {t}")
                    rows = q(f"SELECT nivel_actividad nivel, SUM(total_encuestados) total, ROUND(SUM(total_encuestados)/(SELECT SUM(total_encuestados) FROM {t})*100,2) porcentaje FROM {t} GROUP BY nivel ORDER BY total DESC")
                    return jsonify({"ok": True, "source": source, "total": total, "data": rows})
                elif kind == "rango":
                    return jsonify({"ok": True, "source": source, "data": q(f"SELECT rango, ROUND(AVG(promedio_minutos),2) promedio_minutos, SUM(total_encuestados) total FROM {t} GROUP BY rango ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango')")})
                elif kind == "sedentarismo":
                    return jsonify({"ok": True, "source": source, "data": q(f"SELECT rango, ROUND(AVG(promedio_sedentarismo),2) porcentaje_sedentario FROM {t} GROUP BY rango ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango')")})
                elif kind == "tipo_actividad":
                    rows = q(f"SELECT rango, nivel_actividad actividad, SUM(total_encuestados) total FROM {t} GROUP BY rango, actividad ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango'), total DESC")
                    res=[]; seen=set()
                    for r in rows:
                        if r["rango"] and r["rango"] != "sin_rango" and r["rango"] not in seen:
                            seen.add(r["rango"]); res.append(r)
                    return jsonify({"ok": True, "source": source, "data": res})
                elif kind == "correlacion":
                    rows = q(f"SELECT promedio_minutos x, promedio_sedentarismo y FROM {t} WHERE promedio_minutos IS NOT NULL AND promedio_sedentarismo IS NOT NULL")
                    if not rows or len(rows) < 2:
                        return jsonify({"ok": True, "source": source, "data": {"correlacion": 0, "color": "yellow", "n": 0}})
                    n=len(rows); sx=sy=sxy=sx2=sy2=0.0
                    for r in rows:
                        x=float(r["x"]); y=float(r["y"])
                        sx+=x; sy+=y; sxy+=x*y; sx2+=x*x; sy2+=y*y
                    den = ((n*sx2 - sx*sx)*(n*sy2 - sy*sy))**0.5
                    corr = 0 if den<=0 else round((n*sxy - sx*sy)/den,4)
                    color = "green" if corr < -0.3 else "red" if corr > 0.3 else "yellow"
                    return jsonify({"ok": True, "source": source, "data": {"correlacion": corr, "color": color, "n": n}})
                elif kind == "usa_app":
                    return jsonify({"ok": True, "source": source, "data": q(f"SELECT CASE WHEN nivel_actividad='sedentario' THEN 'No' ELSE 'Si' END usa_app, SUM(total_encuestados) total, ROUND(SUM(total_encuestados)/(SELECT SUM(total_encuestados) FROM {t})*100,2) porcentaje FROM {t} GROUP BY usa_app")})
            if kind == "nivel_oms":
                total = s(f"SELECT COUNT(*) FROM {t}")
                rows = q(f"SELECT CASE WHEN {mcol(t)}<75 THEN 'sedentario' WHEN {mcol(t)} BETWEEN 75 AND 149 THEN 'insuficiente' WHEN {mcol(t)}>=150 THEN 'activo' ELSE 'sin_dato' END nivel, COUNT(*) total, ROUND(COUNT(*)/{total}*100,2) porcentaje FROM {t} f GROUP BY nivel")
                return jsonify({"ok": True, "source": source, "total": total, "data": rows})
            elif kind == "rango":
                return jsonify({"ok": True, "source": source, "data": q(f"SELECT {rex(t)} rango, ROUND(AVG({mcol(t)}),2) promedio_minutos, COUNT(*) total FROM {t} f GROUP BY rango ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango')")})
            elif kind == "sedentarismo":
                return jsonify({"ok": True, "source": source, "data": q(f"SELECT {rex(t)} rango, ROUND(SUM(CASE WHEN {mcol(t)}<75 THEN 1 ELSE 0 END)/COUNT(*)*100,2) porcentaje_sedentario FROM {t} f GROUP BY rango ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango')")})
            elif kind == "tipo_actividad":
                a_expr, a_join = jact(t)
                rows = q(f"SELECT {rex(t)} rango, {a_expr} actividad, COUNT(*) total FROM {t} f {a_join} GROUP BY rango, actividad ORDER BY FIELD(rango,'14-24','25-40','41-60','60+','sin_rango'), total DESC")
                res=[]; seen=set()
                for r in rows:
                    if r["rango"] and r["rango"]!="sin_rango" and r["rango"] not in seen:
                        seen.add(r["rango"]); res.append(r)
                return jsonify({"ok": True, "source": source, "data": res})
            elif kind == "correlacion":
                h = hcol(t); s_expr, s_join = jsal(t)
                rows = q(f"SELECT {h} x, {s_expr} y FROM {t} f {s_join} WHERE {h} IS NOT NULL AND {s_expr} IS NOT NULL")
                if not rows or len(rows)<2:
                    return jsonify({"ok": True, "source": source, "data": {"correlacion":0, "color":"yellow", "n":0}})
                n=len(rows); sx=sy=sxy=sx2=sy2=0.0
                for r in rows:
                    x=float(r["x"]); y=float(r["y"])
                    sx+=x; sy+=y; sxy+=x*y; sx2+=x*x; sy2+=y*y
                den = ((n*sx2 - sx*sx)*(n*sy2 - sy*sy))**0.5
                corr = 0 if den<=0 else round((n*sxy - sx*sy)/den,4)
                color = "green" if corr<-0.3 else "red" if corr>0.3 else "yellow"
                return jsonify({"ok": True, "source": source, "data": {"correlacion":corr, "color":color, "n":n}})
            elif kind == "usa_app":
                a_expr, a_join = japp(t)
                return jsonify({"ok": True, "source": source, "data": q(f"SELECT {a_expr} usa_app, COUNT(*) total, ROUND(COUNT(*)/(SELECT COUNT(*) FROM {t})*100,2) porcentaje FROM {t} f {a_join} GROUP BY usa_app")})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
    return wrapper

for kind in ["nivel_oms","rango","sedentarismo","tipo_actividad","correlacion","usa_app"]:
    for prefix in ["", "/etl"]:
        endpoint = f"{kind}_{prefix.replace('/','_')}"
        app.add_url_rule(f"/api/kpi{prefix}/{kind}", endpoint=endpoint, view_func=kpi(kind))

app.add_url_rule("/api/kpi/rango_etario", endpoint="rango_etario", view_func=kpi("rango"))
app.add_url_rule("/api/kpi/etl/rango_etario", endpoint="etl_rango_etario", view_func=kpi("rango"))

@app.route("/api/sla")
@app.route("/api/kpi/etl/sla")
def api_sla():
    try:
        source = source_from_request()
        return jsonify(sla(tb(source), source))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/api/quality")
@app.route("/api/kpi/etl/quality")
def api_quality():
    try:
        source = source_from_request()
        return jsonify(quality(tb(source), source))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/")
def home(): return send_from_directory(ROOT, "index.html")

@app.errorhandler(404)
def not_found(_):
    return jsonify({"ok": False, "error": "Endpoint no encontrado"}), 404 if request.path.startswith("/api/") else ("Not Found", 404)

if __name__ == "__main__":
    init_db()
    print(f"🚀 Servidor Flask en http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)