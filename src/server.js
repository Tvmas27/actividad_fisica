const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

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

// ==================== 7 KPIS ====================

// KPI 1: % Nivel OMS
app.get('/api/kpi/nivel_oms', async (req, res) => {
  try {
    const total = (await query('SELECT COUNT(*) AS total FROM hecho'))[0].total;
    const rows = await query(`
      SELECT 
        CASE 
          WHEN h.minutos_actividad < 75 THEN 'sedentario'
          WHEN h.minutos_actividad BETWEEN 75 AND 149 THEN 'insuficiente'
          WHEN h.minutos_actividad >= 150 THEN 'activo'
        END AS nivel,
        COUNT(*) AS total,
        ROUND(COUNT(*) / ? * 100, 2) AS porcentaje
      FROM hecho h
      GROUP BY nivel
    `, [total]);
    res.json({ ok: true, total, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 2: Minutos promedio por rango etario
app.get('/api/kpi/rango_etario', async (req, res) => {
  try {
    const rows = await query(`
      SELECT 
        e.rango,
        ROUND(AVG(h.minutos_actividad), 2) AS promedio_minutos,
        COUNT(*) AS total
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      GROUP BY e.rango
      ORDER BY 
        CASE 
          WHEN e.rango = '14-24' THEN 1
          WHEN e.rango = '25-40' THEN 2
          WHEN e.rango = '41-60' THEN 3
          WHEN e.rango = '60+' THEN 4
        END
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 3: % sedentarios por rango etario
app.get('/api/kpi/sedentarismo', async (req, res) => {
  try {
    const rows = await query(`
      SELECT 
        e.rango,
        COUNT(*) AS total,
        ROUND(SUM(CASE WHEN h.minutos_actividad < 75 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS porcentaje_sedentario
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      GROUP BY e.rango
      ORDER BY 
        CASE 
          WHEN e.rango = '14-24' THEN 1
          WHEN e.rango = '25-40' THEN 2
          WHEN e.rango = '41-60' THEN 3
          WHEN e.rango = '60+' THEN 4
        END
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 4: Actividad más frecuente por rango etario (VERSIÓN SIMPLIFICADA)
app.get('/api/kpi/tipo_actividad', async (req, res) => {
  try {
    const rows = await query(`
      SELECT e.rango, a.tipo AS actividad, COUNT(*) AS total
      FROM hecho h
      JOIN dim_edad e ON h.edad_id = e.id
      JOIN dim_actividad a ON h.actividad_id = a.id
      GROUP BY e.rango, a.tipo
      ORDER BY e.rango, total DESC
    `);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 5: Correlación + semáforo
app.get('/api/kpi/correlacion', async (req, res) => {
  try {
    const datos = await query(`
      SELECT 
        h.horas_sentado,
        CASE 
          WHEN s.rango = '1-3' THEN 2
          WHEN s.rango = '3-5' THEN 4
          WHEN s.rango = '5-8' THEN 6.5
          WHEN s.rango = '8-10' THEN 9
          ELSE 0
        END AS percepcion_salud
      FROM hecho h
      JOIN dim_salud s ON h.salud_id = s.id
      WHERE h.horas_sentado IS NOT NULL
    `);
    
    if (!datos || datos.length < 2) {
      return res.json({ 
        ok: true, 
        data: { 
          correlacion: 0,
          color: 'yellow',
          mensaje: 'Datos insuficientes'
        }
      });
    }
    
    const n = datos.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    datos.forEach(row => {
      const x = parseFloat(row.horas_sentado);
      const y = parseFloat(row.percepcion_salud);
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
      sumY2 += y * y;
    });
    
    const numerador = (n * sumXY) - (sumX * sumY);
    const denominador = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
    
    let correlacion = 0;
    if (denominador !== 0) {
      correlacion = numerador / denominador;
    }
    correlacion = Math.round(correlacion * 10000) / 10000;
    
    let color = 'yellow';
    if (correlacion < -0.3) color = 'green';
    else if (correlacion > 0.3) color = 'red';
    
    res.json({ 
      ok: true, 
      data: { 
        correlacion: correlacion,
        color: color,
        n: n
      }
    });
    
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 6: % que usa app
app.get('/api/kpi/usa_app', async (req, res) => {
  try {
    const total = (await query('SELECT COUNT(*) AS total FROM hecho'))[0].total;
    const rows = await query(`
      SELECT a.usa_app, COUNT(*) AS total, 
             ROUND(COUNT(*) / ? * 100, 2) AS porcentaje
      FROM hecho h
      JOIN dim_app a ON h.app_id = a.id
      GROUP BY a.usa_app
    `, [total]);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KPI 7: Semáforo SLA
app.get('/api/sla', async (req, res) => {
  try {
    const total = (await query('SELECT COUNT(*) AS total FROM hecho'))[0].total;
    
    const comp = (await query(`
      SELECT COUNT(*) AS completos FROM hecho 
      WHERE horas_sentado IS NOT NULL AND minutos_actividad IS NOT NULL
    `))[0].completos;
    const pctComp = total > 0 ? Math.round(comp / total * 100) : 0;
    const colorComp = pctComp >= 95 ? 'green' : pctComp >= 90 ? 'yellow' : 'red';
    
    const fresh = (await query(`
      SELECT DATEDIFF(CURDATE(), MAX(f.fecha)) AS dias 
      FROM hecho h
      JOIN dim_fecha f ON h.fecha_id = f.id
    `))[0];
    const freshness = fresh ? fresh.dias : 0;
    const colorFresh = freshness <= 21 ? 'green' : freshness <= 42 ? 'yellow' : 'red';
    
    const err = (await query(`
      SELECT SUM(CASE 
        WHEN h.horas_sentado < 0 OR h.horas_sentado > 18 OR h.minutos_actividad < 0 
        THEN 1 ELSE 0 END) AS errores 
      FROM hecho h
    `))[0];
    const errorRate = total > 0 ? (err.errores / total) * 100 : 0;
    const colorErr = errorRate <= 1 ? 'green' : errorRate <= 5 ? 'yellow' : 'red';
    
    const dims = [
      { dimension: 'Completitud', color: colorComp, descripcion: `${comp}/${total} (${pctComp}%)` },
      { dimension: 'Freshness (días)', color: colorFresh, descripcion: `${freshness} días` },
      { dimension: 'Error Rate', color: colorErr, descripcion: `${errorRate.toFixed(2)}%` }
    ];
    
    res.json({ ok: true, data: dims });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// SERVIR FRONTEND
// ============================================================

const carpetaRaiz = path.join(__dirname, '..');
const indexPath = path.join(carpetaRaiz, 'index.html');

console.log('📁 Buscando index.html en:', indexPath);

if (fs.existsSync(indexPath)) {
    app.use(express.static(carpetaRaiz));
    console.log('✅ Serviendo frontend desde:', carpetaRaiz);
    app.get('/', (req, res) => {
        res.sendFile(indexPath);
    });
} else {
    console.log('⚠️ No se encontró index.html en:', indexPath);
}

app.use((req, res) => {
    res.status(404).json({ ok: false, error: 'Endpoint no encontrado' });
});

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor en http://localhost:${PORT}`);
        console.log(`📁 Accede al dashboard en http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('❌ Error al iniciar:', err);
    process.exit(1);
});