const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;
const DB = { host:'localhost', user:'root', password:'', database:'actividad_fisica' };

let pool, tabla = 'respuestas';

async function query(sql, params=[]) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

// Conectar a MySQL
async function iniciar() {
    try {
        pool = mysql.createPool({ ...DB, port:3306, connectionLimit:10 });
        await pool.getConnection();
        console.log('✅ Conectado a MySQL');
        const [r] = await query(`SELECT COUNT(*) as c FROM information_schema.tables WHERE table_schema='actividad_fisica' AND table_name='respuestas'`);
        tabla = r.c > 0 ? 'respuestas' : 'actividad';
        console.log(`📊 Tabla: ${tabla}`);
        app.listen(PORT, () => console.log(`🚀 API en http://localhost:${PORT}`));
    } catch(e) {
        console.error('❌ Error DB:', e.message);
        process.exit(1);
    }
}

// Total registros
async function total() {
    const r = await query(`SELECT COUNT(*) as t FROM ${tabla}`);
    return r[0].t;
}

// ============ ENDPOINTS ============

app.get('/api/kpi/nivel_oms', async (req, res) => {
    try {
        const t = await total();
        const data = await query(`
            SELECT CASE 
                WHEN minutos_actividad_semana < 75 THEN 'sedentario'
                WHEN minutos_actividad_semana BETWEEN 75 AND 149 THEN 'insuficiente'
                ELSE 'activo'
            END as nivel, COUNT(*) as total, ROUND(COUNT(*) * 100 / ${t}, 2) as porcentaje
            FROM ${tabla} GROUP BY nivel
        `);
        res.json({ ok:true, total:t, data });
    } catch(e) { res.status(500).json({ ok:false, error:'Error nivel_oms' }); }
});

app.get('/api/kpi/rango_etario', async (req, res) => {
    try {
        const data = await query(`
            SELECT CASE 
                WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                ELSE '60+'
            END as rango, ROUND(AVG(minutos_actividad_semana),2) as promedio_minutos, COUNT(*) as total
            FROM ${tabla} GROUP BY rango ORDER BY rango
        `);
        res.json({ ok:true, data });
    } catch(e) { res.status(500).json({ ok:false, error:'Error rango_etario' }); }
});

app.get('/api/kpi/sedentarismo', async (req, res) => {
    try {
        const data = await query(`
            SELECT CASE 
                WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                ELSE '60+'
            END as rango,
            ROUND(SUM(CASE WHEN minutos_actividad_semana < 75 THEN 1 ELSE 0 END) * 100 / COUNT(*), 2) as porcentaje_sedentario,
            COUNT(*) as total
            FROM ${tabla} GROUP BY rango ORDER BY rango
        `);
        res.json({ ok:true, data });
    } catch(e) { res.status(500).json({ ok:false, error:'Error sedentarismo' }); }
});

app.get('/api/kpi/tipo_actividad', async (req, res) => {
    try {
        const data = await query(`
            SELECT rango, tipo_actividad, total FROM (
                SELECT CASE 
                    WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                    WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                    WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                    ELSE '60+'
                END as rango, tipo_actividad, COUNT(*) as total,
                ROW_NUMBER() OVER (PARTITION BY CASE 
                    WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                    WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                    WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                    ELSE '60+'
                END ORDER BY COUNT(*) DESC) as pos
                FROM ${tabla} GROUP BY rango, tipo_actividad
            ) t WHERE pos = 1
        `);
        res.json({ ok:true, data });
    } catch(e) { res.status(500).json({ ok:false, error:'Error tipo_actividad' }); }
});

app.get('/api/kpi/correlacion', async (req, res) => {
    try {
        const data = await query(`
            SELECT ROUND(AVG(horas_sentado_dia),2) as promedio_horas_sentado,
                   ROUND(AVG(percepcion_salud),2) as promedio_percepcion_salud
            FROM ${tabla}
        `);
        res.json({ ok:true, data:data[0] });
    } catch(e) { res.status(500).json({ ok:false, error:'Error correlacion' }); }
});

app.get('/api/kpi/usa_app', async (req, res) => {
    try {
        const t = await total();
        const data = await query(`
            SELECT usa_app, COUNT(*) as total, ROUND(COUNT(*) * 100 / ${t}, 2) as porcentaje
            FROM ${tabla} GROUP BY usa_app
        `);
        res.json({ ok:true, data });
    } catch(e) { res.status(500).json({ ok:false, error:'Error usa_app' }); }
});

app.get('/api/sla', async (req, res) => {
    try {
        const totalR = await total();
        const comp = await query(`
            SELECT SUM(CASE WHEN fecha_encuesta IS NOT NULL AND genero IS NOT NULL AND edad IS NOT NULL 
                AND horas_sentado_dia IS NOT NULL AND minutos_actividad_semana IS NOT NULL 
                AND tipo_actividad IS NOT NULL AND usa_app IS NOT NULL AND percepcion_salud IS NOT NULL 
                THEN 1 ELSE 0 END) as completos FROM ${tabla}
        `);
        const completitud = totalR > 0 ? (comp[0].completos / totalR) * 100 : 0;
        
        const fresh = await query(`SELECT DATEDIFF(CURDATE(), MAX(fecha_encuesta)) as dias FROM ${tabla}`);
        const freshness = fresh[0].dias || 0;
        
        const err = await query(`
            SELECT SUM(CASE WHEN minutos_actividad_semana < 0 OR horas_sentado_dia > 18 OR horas_sentado_dia < 0 THEN 1 ELSE 0 END) as errores FROM ${tabla}
        `);
        const errorRate = totalR > 0 ? (err[0].errores / totalR) * 100 : 0;

        const color = (v, g, y) => v >= g ? 'green' : v >= y ? 'yellow' : 'red';
        
        res.json({ ok:true, data: [
            { dimension:'Completitud', valor:Math.round(completitud*100)/100, umbral:'>=95%', color:color(completitud,95,90), descripcion:`${comp[0].completos}/${totalR} completos` },
            { dimension:'Freshness', valor:freshness, umbral:'<=21 días', color:color(freshness,21,42), descripcion:`${freshness} días` },
            { dimension:'Error Rate', valor:Math.round(errorRate*100)/100, umbral:'<=1%', color:color(errorRate,1,5), descripcion:`${Math.round(errorRate*100)/100}% errores` }
        ] });
    } catch(e) { res.status(500).json({ ok:false, error:'Error SLA' }); }
});

// Servir frontend
const front = path.join(__dirname, '..', 'index.html');
if (fs.existsSync(front)) {
    app.use('/', express.static(path.join(__dirname, '..')));
    console.log('📁 Serviendo frontend');
}

app.use((req, res) => res.status(404).json({ ok:false, error:'Endpoint no encontrado' }));

iniciar();