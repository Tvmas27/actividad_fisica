const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '',
  database: 'actividad_fisica',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let TABLE = 'actividad';
let pool;

async function initDb() {
  pool = mysql.createPool(DB_CONFIG);
  try {
    const conn = await pool.getConnection();
    conn.release();
    console.log('✅ Conectado a MySQL');
    try {
      const candidates = ['actividad', 'respuestas'];
      for (const t of candidates) {
        const r = await pool.execute(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
          [DB_CONFIG.database, t]
        );
        const cnt = r[0][0].cnt || 0;
        if (cnt > 0) {
          TABLE = t;
          console.log(`📊 Usando tabla: ${TABLE}`);
          break;
        }
      }
      if (!TABLE) TABLE = 'actividad';
    } catch (err) {
      console.warn('No se pudo detectar la tabla automáticamente:', err.message);
    }
  } catch (err) {
    console.error('❌ Error conectando a MySQL:', err.message);
    process.exit(1);
  }
}

async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    console.error('DB query error', { message: err.message, sql, params });
    throw err;
  }
}

function sendError(res, msg, code = 500) {
  return res.status(code).json({ ok: false, error: msg });
}

// ============ ENDPOINTS ============

app.get('/api/kpi/nivel_oms', async (req, res) => {
  try {
    const totalRows = await query(`SELECT COUNT(*) AS total FROM \`${TABLE}\``);
    const total = totalRows[0].total || 0;
    const sql = `
      SELECT nivel, COUNT(*) AS total, ROUND((COUNT(*) / NULLIF(?,0)) * 100, 2) AS porcentaje
      FROM (
        SELECT CASE
          WHEN minutos_actividad_semana < 75 THEN 'sedentario'
          WHEN minutos_actividad_semana BETWEEN 75 AND 149 THEN 'insuficiente'
          WHEN minutos_actividad_semana >= 150 THEN 'activo'
          ELSE 'sin_dato'
        END AS nivel
        FROM \`${TABLE}\`
      ) t
      GROUP BY nivel
    `;
    const rows = await query(sql, [total]);
    return res.json({ ok: true, total, data: rows });
  } catch (err) {
    console.error('/api/kpi/nivel_oms', err);
    return sendError(res, 'Error calculando nivel_oms');
  }
});

app.get('/api/kpi/rango_etario', async (req, res) => {
  try {
    const sql = `
      SELECT rango, ROUND(AVG(minutos_actividad_semana),2) AS promedio_minutos, COUNT(*) AS total
      FROM (
        SELECT CASE
          WHEN edad BETWEEN 14 AND 24 THEN '14-24'
          WHEN edad BETWEEN 25 AND 40 THEN '25-40'
          WHEN edad BETWEEN 41 AND 60 THEN '41-60'
          WHEN edad >= 61 THEN '60+'
          ELSE 'sin_rango'
        END AS rango, minutos_actividad_semana
        FROM \`${TABLE}\`
      ) t
      GROUP BY rango
    `;
    const rows = await query(sql);
    const data = rows.map(row => ({
      ...row,
      promedio_minutos: parseFloat(row.promedio_minutos) || 0
    }));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('/api/kpi/rango_etario', err);
    return sendError(res, 'Error calculando rango_etario');
  }
});

app.get('/api/kpi/sedentarismo', async (req, res) => {
  try {
    const sql = `
      SELECT rango, SUM(is_sedentario) AS total_sedentario, COUNT(*) AS total,
             ROUND((SUM(is_sedentario) / NULLIF(COUNT(*),0)) * 100, 2) AS porcentaje_sedentario
      FROM (
        SELECT CASE
          WHEN edad BETWEEN 14 AND 24 THEN '14-24'
          WHEN edad BETWEEN 25 AND 40 THEN '25-40'
          WHEN edad BETWEEN 41 AND 60 THEN '41-60'
          WHEN edad >= 61 THEN '60+'
          ELSE 'sin_rango'
        END AS rango,
        CASE WHEN minutos_actividad_semana < 75 THEN 1 ELSE 0 END AS is_sedentario
        FROM \`${TABLE}\`
      ) t
      GROUP BY rango
    `;
    const rows = await query(sql);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('/api/kpi/sedentarismo', err);
    return sendError(res, 'Error calculando sedentarismo');
  }
});

app.get('/api/kpi/tipo_actividad', async (req, res) => {
  try {
    const sql = `
      SELECT rango, tipo_actividad, total FROM (
        SELECT rango, tipo_actividad, COUNT(*) AS total,
               ROW_NUMBER() OVER (PARTITION BY rango ORDER BY COUNT(*) DESC) AS rn
        FROM (
          SELECT CASE
            WHEN edad BETWEEN 14 AND 24 THEN '14-24'
            WHEN edad BETWEEN 25 AND 40 THEN '25-40'
            WHEN edad BETWEEN 41 AND 60 THEN '41-60'
            WHEN edad >= 61 THEN '60+'
            ELSE 'sin_rango'
          END AS rango, tipo_actividad
          FROM \`${TABLE}\`
        ) s
        GROUP BY rango, tipo_actividad
      ) t
      WHERE rn = 1
    `;
    const rows = await query(sql);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('/api/kpi/tipo_actividad', err);
    return sendError(res, 'Error calculando tipo_actividad');
  }
});

app.get('/api/kpi/correlacion', async (req, res) => {
  try {
    const sql = `
      SELECT
        COUNT(*) AS N,
        AVG(horas_sentado_dia) AS avg_x,
        AVG(percepcion_salud) AS avg_y,
        SUM(horas_sentado_dia * percepcion_salud) AS sum_xy,
        SUM(horas_sentado_dia) AS sum_x,
        SUM(percepcion_salud) AS sum_y,
        SUM(POW(horas_sentado_dia,2)) AS sum_x2,
        SUM(POW(percepcion_salud,2)) AS sum_y2
      FROM \`${TABLE}\`
      WHERE horas_sentado_dia IS NOT NULL AND percepcion_salud IS NOT NULL
    `;
    const r = (await query(sql))[0];
    const N = r.N || 0;
    if (N === 0) {
      return res.json({ ok: true, data: { promedio_horas_sentado: null, promedio_percepcion_salud: null, correlacion: null } });
    }
    const numerator = (N * r.sum_xy) - (r.sum_x * r.sum_y);
    const denomPartX = (N * r.sum_x2) - Math.pow(r.sum_x, 2);
    const denomPartY = (N * r.sum_y2) - Math.pow(r.sum_y, 2);
    let correlacion = null;
    if (denomPartX > 0 && denomPartY > 0) {
      correlacion = numerator / Math.sqrt(denomPartX * denomPartY);
    }
    return res.json({ ok: true, data: {
      promedio_horas_sentado: Number(r.avg_x).toFixed(2),
      promedio_percepcion_salud: Number(r.avg_y).toFixed(2),
      correlacion: correlacion === null ? null : Number(correlacion.toFixed(4))
    }});
  } catch (err) {
    console.error('/api/kpi/correlacion', err);
    return sendError(res, 'Error calculando correlacion');
  }
});

app.get('/api/kpi/usa_app', async (req, res) => {
  try {
    const totalRows = await query(`SELECT COUNT(*) AS total FROM \`${TABLE}\``);
    const total = totalRows[0].total || 0;
    const sql = `
      SELECT usa_app AS usa_app_raw, COUNT(*) AS total, ROUND((COUNT(*) / NULLIF(?,0)) * 100, 2) AS porcentaje
      FROM \`${TABLE}\`
      GROUP BY usa_app
    `;
    const raw = await query(sql, [total]);
    const data = raw.map(r => ({
      usa_app: (r.usa_app_raw === 1 || r.usa_app_raw === '1' || String(r.usa_app_raw).toLowerCase().startsWith('s')) ? 'Sí' : (String(r.usa_app_raw).toLowerCase().startsWith('n') ? 'No' : String(r.usa_app_raw)),
      total: r.total,
      porcentaje: r.porcentaje
    }));
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('/api/kpi/usa_app', err);
    return sendError(res, 'Error calculando usa_app');
  }
});

app.get('/api/sla', async (req, res) => {
  try {
    const requiredCols = ['minutos_actividad_semana','edad','tipo_actividad','horas_sentado_dia','percepcion_salud'];
    const notNullExpr = requiredCols.map(c => `\`${c}\` IS NOT NULL`).join(' AND ');
    const sqlCompleteness = `
      SELECT COUNT(*) AS total, 
             SUM(CASE WHEN ${notNullExpr} THEN 1 ELSE 0 END) AS complete_count 
      FROM \`${TABLE}\`
    `;
    const compRow = (await query(sqlCompleteness))[0];
    const total = compRow.total || 0;
    const completeCount = compRow.complete_count || 0;
    const completenessPct = total === 0 ? 0 : Number(((completeCount/total) * 100).toFixed(2));

    let freshnessDays = null;
    try {
      const freshRow = (await query(`SELECT MAX(fecha_encuesta) AS last_update FROM \`${TABLE}\``))[0];
      if (freshRow && freshRow.last_update) {
        const d = (await query(`SELECT DATEDIFF(CURDATE(), ?) AS days`, [freshRow.last_update]))[0];
        freshnessDays = d.days != null ? Number(d.days) : 0;
      }
    } catch (err) {
      freshnessDays = null;
    }

    let errorRatePct = 0;
    try {
      const errRow = (await query(`
        SELECT 
          SUM(CASE WHEN minutos_actividad_semana < 0 OR horas_sentado_dia > 18 OR horas_sentado_dia < 0 THEN 1 ELSE 0 END) AS errors, 
          COUNT(*) AS total 
        FROM \`${TABLE}\`
      `))[0];
      if (errRow && errRow.total > 0) {
        errorRatePct = Number(((errRow.errors / errRow.total) * 100).toFixed(2));
      } else {
        errorRatePct = 0;
      }
    } catch (err) {
      errorRatePct = 0;
    }

    function colorForCompleteness(value) {
      if (value === null || value === undefined) return 'red';
      if (value >= 95) return 'green';
      if (value >= 90) return 'yellow';
      return 'red';
    }
    function colorForFreshness(days) {
      if (days === null || days === undefined) return 'red';
      if (days <= 21) return 'green';
      if (days <= 42) return 'yellow';
      return 'red';
    }
    function colorForErrorRate(pct) {
      if (pct === null || pct === undefined) return 'red';
      if (pct <= 1) return 'green';
      if (pct <= 5) return 'yellow';
      return 'red';
    }

    const dimensions = [
      { 
        dimension: 'Completitud', 
        valor: completenessPct, 
        umbral: '>= 95%', 
        color: colorForCompleteness(completenessPct), 
        descripcion: `${completeCount}/${total} filas completas (${completenessPct}%)` 
      },
      { 
        dimension: 'Freshness', 
        valor: freshnessDays, 
        umbral: '<= 21 días', 
        color: colorForFreshness(freshnessDays), 
        descripcion: freshnessDays !== null ? `Última encuesta hace ${freshnessDays} días` : 'No hay datos' 
      },
      { 
        dimension: 'Error Rate', 
        valor: errorRatePct, 
        umbral: '<= 1%', 
        color: colorForErrorRate(errorRatePct), 
        descripcion: `${errorRatePct}% errores en datos` 
      }
    ];

    return res.json({ ok: true, data: dimensions });
  } catch (err) {
    console.error('/api/sla', err);
    return sendError(res, 'Error calculando SLA');
  }
});

const frontIndex = path.join(__dirname, '..', 'index.html');
if (fs.existsSync(frontIndex)) {
  app.use('/', express.static(path.join(__dirname, '..')));
  console.log('📁 Servirá frontend desde / (index.html detectado)');
}

app.use((req, res) => res.status(404).json({ ok: false, error: 'Endpoint not found' }));

initDb().then(() => {
  app.listen(PORT, () => console.log(`🚀 REST API server listening on http://localhost:${PORT}`));
}).catch(err => {
  console.error('No se pudo iniciar DB', err);
  process.exit(1);
});