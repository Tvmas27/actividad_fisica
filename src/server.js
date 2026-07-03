const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;
const DB = { host: 'localhost', user: 'root', password: '', database: 'actividad_fisica' };
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

// ========== KPIs ==========

app.get('/api/kpi/nivel_oms', async (req, res) => {
    try {
        const total = (await query('SELECT COUNT(*) AS total FROM fact_respuestas'))[0].total;
        const rows = await query(`
            SELECT 
                CASE 
                    WHEN minutos_actividad < 75 THEN 'sedentario'
                    WHEN minutos_actividad BETWEEN 75 AND 149 THEN 'insuficiente'
                    WHEN minutos_actividad >= 150 THEN 'activo'
                END AS nivel,
                COUNT(*) AS total,
                ROUND(COUNT(*) / ? * 100, 2) AS porcentaje
            FROM fact_respuestas GROUP BY nivel
        `, [total]);
        res.json({ ok: true, total, data: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/kpi/rango_etario', async (req, res) => {
    try {
        const rows = await query(`
            SELECT 
                CASE 
                    WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                    WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                    WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                    WHEN edad >= 61 THEN '60+'
                END AS rango,
                ROUND(AVG(minutos_actividad), 2) AS promedio_minutos,
                COUNT(*) AS total
            FROM fact_respuestas
            GROUP BY rango
            ORDER BY rango = '14-24' DESC, rango = '25-40' DESC, rango = '41-60' DESC, rango = '60+' DESC
        `);
        res.json({ ok: true, data: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/kpi/sedentarismo', async (req, res) => {
    try {
        const rows = await query(`
            SELECT 
                CASE 
                    WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                    WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                    WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                    WHEN edad >= 61 THEN '60+'
                END AS rango,
                ROUND(SUM(CASE WHEN minutos_actividad < 75 THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS porcentaje_sedentario
            FROM fact_respuestas
            GROUP BY rango
            ORDER BY rango = '14-24' DESC, rango = '25-40' DESC, rango = '41-60' DESC, rango = '60+' DESC
        `);
        res.json({ ok: true, data: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/kpi/tipo_actividad', async (req, res) => {
    try {
        const rows = await query(`
            SELECT rango, tipo_actividad AS actividad, total FROM (
                SELECT 
                    CASE 
                        WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                        WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                        WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                        WHEN edad >= 61 THEN '60+'
                    END AS rango,
                    a.tipo_actividad,
                    COUNT(*) AS total,
                    ROW_NUMBER() OVER (PARTITION BY 
                        CASE 
                            WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                            WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                            WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                            WHEN edad >= 61 THEN '60+'
                        END ORDER BY COUNT(*) DESC
                    ) AS pos
                FROM fact_respuestas f
                JOIN dim_actividad a ON f.id_actividad = a.id_actividad
                GROUP BY rango, a.tipo_actividad
            ) t WHERE pos = 1
        `);
        res.json({ ok: true, data: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/kpi/correlacion', async (req, res) => {
    try {
        const datos = await query(`
            SELECT 
                f.horas_sentado,
                CASE 
                    WHEN s.nivel_salud = '1-3' THEN 2
                    WHEN s.nivel_salud = '3-5' THEN 4
                    WHEN s.nivel_salud = '5-8' THEN 6.5
                    WHEN s.nivel_salud = '8-10' THEN 9
                END AS percepcion_salud
            FROM fact_respuestas f
            JOIN dim_salud s ON f.id_salud = s.id_salud
            WHERE f.horas_sentado IS NOT NULL
        `);
        if (!datos || datos.length < 2) {
            return res.json({ ok: true, data: { correlacion: 0, color: 'yellow' } });
        }
        const n = datos.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
        datos.forEach(row => {
            const x = parseFloat(row.horas_sentado);
            const y = parseFloat(row.percepcion_salud);
            sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y;
        });
        const numerador = (n * sumXY) - (sumX * sumY);
        const denominador = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
        let correlacion = denominador !== 0 ? Math.round((numerador / denominador) * 10000) / 10000 : 0;
        let color = correlacion < -0.3 ? 'green' : correlacion > 0.3 ? 'red' : 'yellow';
        res.json({ ok: true, data: { correlacion, color, n } });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/kpi/usa_app', async (req, res) => {
    try {
        const total = (await query('SELECT COUNT(*) AS total FROM fact_respuestas'))[0].total;
        const rows = await query(`
            SELECT a.usa_app, COUNT(*) AS total, ROUND(COUNT(*) / ? * 100, 2) AS porcentaje
            FROM fact_respuestas f
            JOIN dim_app a ON f.id_app = a.id_app
            GROUP BY a.usa_app
        `, [total]);
        res.json({ ok: true, data: rows });
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/sla', async (req, res) => {
    try {
        const total = (await query('SELECT COUNT(*) AS total FROM fact_respuestas'))[0].total;
        const comp = (await query(`
            SELECT COUNT(*) AS completos FROM fact_respuestas 
            WHERE id_genero IS NOT NULL AND id_actividad IS NOT NULL AND id_salud IS NOT NULL 
            AND id_app IS NOT NULL AND edad IS NOT NULL AND horas_sentado IS NOT NULL AND minutos_actividad IS NOT NULL
        `))[0].completos;
        const pctComp = total > 0 ? Math.round(comp / total * 100) : 0;
        const colorComp = pctComp >= 95 ? 'green' : pctComp >= 90 ? 'yellow' : 'red';
        const freshResult = (await query(`
            SELECT DATEDIFF(CURDATE(), MAX(f.fecha)) AS dias
            FROM fact_respuestas fr JOIN dim_fecha f ON fr.id_fecha = f.id_fecha
        `))[0];
        const freshness = freshResult ? freshResult.dias : 0;
        const colorFresh = freshness <= 21 ? 'green' : freshness <= 42 ? 'yellow' : 'red';
        const err = (await query(`
            SELECT SUM(CASE WHEN horas_sentado < 0 OR horas_sentado > 18 OR minutos_actividad < 0 THEN 1 ELSE 0 END) AS errores 
            FROM fact_respuestas
        `))[0];
        const errorRate = total > 0 ? (err.errores / total) * 100 : 0;
        const colorErr = errorRate <= 1 ? 'green' : errorRate <= 5 ? 'yellow' : 'red';
        res.json({ ok: true, data: [
            { dimension: 'Completitud', color: colorComp, descripcion: `${comp}/${total} (${pctComp}%)` },
            { dimension: 'Freshness (días)', color: colorFresh, descripcion: `${freshness} días` },
            { dimension: 'Error Rate', color: colorErr, descripcion: `${errorRate.toFixed(2)}%` }
        ]});
    } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ========== Frontend ==========
const indexPath = path.join(__dirname, '..', 'index.html');
if (fs.existsSync(indexPath)) {
    app.use(express.static(path.join(__dirname, '..')));
    app.get('/', (req, res) => res.sendFile(indexPath));
}

app.use((req, res) => res.status(404).json({ ok: false, error: 'Endpoint no encontrado' }));

initDB().then(() => {
    app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));
}).catch(err => { console.error('❌ Error:', err); process.exit(1); });