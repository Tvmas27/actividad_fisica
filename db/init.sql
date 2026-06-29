// server.js - API REST para actividad_fisica (Modelo Estrella)
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;
const DB = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'actividad_fisica'
};

let pool;

async function initDB() {
  pool = mysql.createPool(DB);
  await pool.getConnection();
  console.log('✅ Conectado a MySQL');
}

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// ==================== ENDPOINTS ====================

// 1. Nivel OMS
app.get('/api/kpi/nivel_oms', async (req, res) => {
  try {
    const total = (await query('SELECT COUNT(*) AS total FROM hecho'))[0].total;
    const rows = await query(`
      SELECT 
        CASE 
          WHEN minutos_actividad < 75 THEN 'sedentario'
          WHEN minutos_actividad BETWEEN 75 AND 149 THEN 'insuficiente'
          WHEN minutos_actividad >= 150 THEN 'activo'
        END AS nivel,
        COUNT(*) AS total,
        ROUND(COUNT(*) / ? * 100, 2) AS porcentaje
      FROM hecho GROUP BY nivel
    `, [total]);
    res.json({ ok: true, total, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 2. Minutos promedio por rango de edad
app.get('/api/kpi/rango_etario', async (req, res) => {
  try {
    const rows = await query(`
      SELECT e.rango, ROUND(AVG(h.minutos_actividad), 2) AS promedio_minutos, COUNT(*) AS total
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      GROUP BY e.rango
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Sedentarismo por rango de edad
app.get('/api/kpi/sedentarismo', async (req, res) => {
  try {
    const rows = await query(`
      SELECT 
        e.rango,
        COUNT(*) AS total,
        SUM(CASE WHEN h.minutos_actividad < 75 THEN 1 ELSE 0 END) AS sedentarios,
        ROUND(SUM(CASE WHEN h.minutos_actividad < 75 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS porcentaje_sedentario
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      GROUP BY e.rango
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Actividad más frecuente por rango
app.get('/api/kpi/tipo_actividad', async (req, res) => {
  try {
    const rows = await query(`
      SELECT e.rango, a.tipo AS actividad, COUNT(*) AS total
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      JOIN dim_actividad a ON h.actividad_id = a.id
      GROUP BY e.rango, a.tipo
      HAVING COUNT(*) = (
        SELECT MAX(c) FROM (
          SELECT COUNT(*) AS c FROM hecho h2
          WHERE h2.edad_id = h.edad_id
          GROUP BY h2.actividad_id
        ) t
      )
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Correlación horas sentadas vs salud
app.get('/api/kpi/correlacion', async (req, res) => {
  try {
    const r = (await query(`
      SELECT 
        COUNT(*) AS N,
        AVG(horas_sentado) AS avg_x,
        AVG(s.valor_promedio) AS avg_y,
        SUM(horas_sentado * s.valor_promedio) AS sum_xy,
        SUM(horas_sentado) AS sum_x,
        SUM(s.valor_promedio) AS sum_y,
        SUM(POW(horas_sentado,2)) AS sum_x2,
        SUM(POW(s.valor_promedio,2)) AS sum_y2
      FROM hecho h
      JOIN dim_salud s ON h.salud_id = s.id
    `))[0];
    
    // Calcular correlación de Pearson
    let corr = null;
    const denom = Math.sqrt((r.N * r.sum_x2 - Math.pow(r.sum_x, 2)) * (r.N * r.sum_y2 - Math.pow(r.sum_y, 2)));
    if (denom !== 0) {
      corr = (r.N * r.sum_xy - r.sum_x * r.sum_y) / denom;
    }
    
    res.json({ ok: true, data: { 
      promedio_horas_sentado: Number(r.avg_x || 0).toFixed(2), 
      promedio_percepcion_salud: Number(r.avg_y || 0).toFixed(2),
      correlacion: corr !== null ? Number(corr.toFixed(4)) : null
    }});
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Uso de app
app.get('/api/kpi/usa_app', async (req, res) => {
  try {
    const rows = await query(`
      SELECT a.usa_app, COUNT(*) AS total, 
             ROUND(COUNT(*) / (SELECT COUNT(*) FROM hecho) * 100, 2) AS porcentaje
      FROM hecho h
      JOIN dim_app a ON h.app_id = a.id
      GROUP BY a.usa_app
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 7. SLA (Completitud, Freshness, Error Rate)
app.get('/api/sla', async (req, res) => {
  try {
    const total = (await query('SELECT COUNT(*) AS total FROM hecho'))[0].total;
    
    // Completitud
    const comp = (await query(`
      SELECT COUNT(*) AS completos FROM hecho 
      WHERE horas_sentado IS NOT NULL AND minutos_actividad IS NOT NULL
    `))[0].completos;
    const pct_completitud = total > 0 ? Math.round(comp / total * 100) : 0;
    const colorCompletitud = pct_completitud >= 95 ? 'green' : pct_completitud >= 90 ? 'yellow' : 'red';
    
    // Freshness (días desde última encuesta)
    const fresh = (await query(`
      SELECT DATEDIFF(CURDATE(), MAX(f.fecha)) AS dias 
      FROM hecho h
      JOIN dim_fecha f ON h.fecha_id = f.id
    `))[0];
    const freshness = fresh ? fresh.dias : null;
    let colorFreshness = 'red';
    if (freshness !== null) {
      colorFreshness = freshness <= 21 ? 'green' : freshness <= 42 ? 'yellow' : 'red';
    }
    
    // Error Rate (horas sentado negativas o > 18 horas)
    const err = (await query(`
      SELECT SUM(CASE 
        WHEN h.horas_sentado < 0 OR h.horas_sentado > 18 OR h.minutos_actividad < 0 
        THEN 1 ELSE 0 END) AS errores 
      FROM hecho h
    `))[0];
    const errorRate = total > 0 ? (err.errores / total) * 100 : 0;
    const colorError = errorRate <= 1 ? 'green' : errorRate <= 5 ? 'yellow' : 'red';
    
    const dims = [
      { 
        dimension: 'Completitud', 
        valor: pct_completitud,
        umbral: '>= 95%', 
        color: colorCompletitud, 
        descripcion: `${comp}/${total} filas completas (${pct_completitud}%)` 
      },
      { 
        dimension: 'Freshness (días)', 
        valor: freshness,
        umbral: '<= 21 días', 
        color: colorFreshness, 
        descripcion: freshness !== null ? `Última encuesta hace ${freshness} días` : 'Sin datos' 
      },
      { 
        dimension: 'Error Rate', 
        valor: Number(errorRate.toFixed(2)),
        umbral: '<= 1%', 
        color: colorError, 
        descripcion: `${Number(errorRate.toFixed(2))}% de errores` 
      }
    ];
    
    res.json({ ok: true, data: dims });
  } catch (err) {
    console.error('Error en /api/sla:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Iniciar
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
}).catch(err => {
  console.error('❌ Error al iniciar:', err);
  process.exit(1);
});