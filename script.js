const API_BASE = 'http://localhost:5000';

async function fetchJson(endpoint) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.ok ? data.data : null;
    } catch (e) { console.error(e); return null; }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderSlaSemaforo(color) {
    const c = document.getElementById('kpi-sla-semaforo');
    if (!c) return;
    c.querySelectorAll('.luz').forEach(luz => {
        luz.classList.toggle('activa', luz.dataset.color === color.toLowerCase());
    });
}

function normalizeColor(v) {
    const c = String(v || '').toLowerCase();
    if (c === 'green' || c === 'verde') return 'green';
    if (c === 'yellow' || c === 'amarillo') return 'yellow';
    return 'red';
}

function worstSlaColor(dims) {
    const order = { green: 0, yellow: 1, red: 2 };
    return (dims || []).reduce((worst, d) => {
        const c = normalizeColor(d.color);
        return order[c] > order[worst] ? c : worst;
    }, 'green');
}

function renderRangoLista(datos) {
    const container = document.getElementById('rango-lista');
    if (!container) return;
    container.innerHTML = datos.map(item => `
        <div class="rango-item">
            <span class="rango-nombre">${item.rango}:</span>
            <span class="rango-valor">${Math.round(item.promedio_minutos)} min</span>
        </div>
    `).join('');
}
// SLIDERS

document.addEventListener('DOMContentLoaded', function() {
    const sliders = [
        { id: 'slider-1', valueId: 'slider-value-1', statusId: 'slider-status-1', globalId: 'sla-global-1' },
        { id: 'slider-2', valueId: 'slider-value-2', statusId: 'slider-status-2', globalId: 'sla-global-2' },
        { id: 'slider-3', valueId: 'slider-value-3', statusId: 'slider-status-3', globalId: 'sla-global-3' }
    ];

    sliders.forEach(s => {
        const slider = document.getElementById(s.id);
        if (!slider) return;
        slider.addEventListener('input', function() {
            const value = parseFloat(this.value);
            const display = this.id !== 'slider-3' ? value + '%' : value + ' días';
            document.getElementById(s.valueId).textContent = display;
            document.getElementById(s.globalId).textContent = display;
            
            let color, statusText;
            if (this.id === 'slider-1') {
                if (value >= 50) { color = 'green'; statusText = 'Óptimo — verde'; }
                else if (value >= 30) { color = 'yellow'; statusText = 'Advertencia — amarillo'; }
                else { color = 'red'; statusText = 'Bajo — rojo'; }
            } else if (this.id === 'slider-2') {
                if (value >= 95) { color = 'green'; statusText = 'Completo — verde'; }
                else if (value >= 85) { color = 'yellow'; statusText = 'Parcial — amarillo'; }
                else { color = 'red'; statusText = 'Insuficiente — rojo'; }
            } else {
                if (value <= 21) { color = 'green'; statusText = 'Actualizado — verde'; }
                else if (value <= 42) { color = 'yellow'; statusText = 'Antiguo — amarillo'; }
                else { color = 'red'; statusText = 'Obsoleto — rojo'; }
            }
            const statusEl = document.getElementById(s.statusId);
            if (statusEl) {
                statusEl.textContent = statusText;
                statusEl.style.color = color === 'green' ? '#10b981' : color === 'yellow' ? '#f59e0b' : '#ef4444';
            }
            updateGlobalSLA();
        });
    });

    function updateGlobalSLA() {
        const v1 = parseFloat(document.getElementById('slider-1').value);
        const v2 = parseFloat(document.getElementById('slider-2').value);
        const v3 = parseFloat(document.getElementById('slider-3').value);
        let worst = 'green';
        if (v1 < 30 || v2 < 85 || v3 > 42) worst = 'red';
        else if (v1 < 50 || v2 < 95 || v3 > 21) worst = 'yellow';
        const gc = document.getElementById('sla-global-color');
        if (gc) {
            const colors = { green: '#10b981', yellow: '#f59e0b', red: '#ef4444' };
            const labels = { green: 'Verde', yellow: 'Amarillo', red: 'Rojo' };
            gc.style.background = colors[worst];
            gc.textContent = labels[worst];
        }
        renderSlaSemaforo(worst);
        const emojis = { green: '🟢', yellow: '🟡', red: '🔴' };
        const idx = { green:0, yellow:1, red:2 }[worst];
        setText('kpi-sla', `Semáforo ${['VERDE','AMARILLO','ROJO'][idx]} ${emojis[worst]}`);
        setText('kpi-sla-desc', ['Todos cumplen','Algún indicador en advertencia','Algún indicador incumple'][idx]);
        setText('hero-sla', `SLA ${['Verde','Amarillo','Rojo'][idx]}`);
        setText('hero-sla-desc', `Activos: ${v1}% | Completitud: ${v2}% | Freshness: ${v3} días`);
    }
});

// QUERYS SQL
const SQL = {
    // KPI 1: Distribución por nivel OMS
    'nivel_oms': `
        SELECT 
            CASE 
                WHEN minutos_actividad_semana < 75 THEN 'sedentario'
                WHEN minutos_actividad_semana BETWEEN 75 AND 149 THEN 'insuficiente'
                ELSE 'activo'
            END as nivel,
            COUNT(*) as total,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM respuestas), 2) as porcentaje
        FROM respuestas
        GROUP BY nivel;
    `,
    // KPI 2: Minutos promedio por rango etario
    'rango_etario': `
        SELECT 
            CASE 
                WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                ELSE '60+'
            END as rango,
            ROUND(AVG(minutos_actividad_semana), 2) as promedio_minutos,
            COUNT(*) as total
        FROM respuestas
        GROUP BY rango
        ORDER BY rango;
    `,
    // KPI 3: % sedentarios por rango etario
    'sedentarismo': `
        SELECT 
            CASE 
                WHEN edad BETWEEN 14 AND 24 THEN '14-24'
                WHEN edad BETWEEN 25 AND 40 THEN '25-40'
                WHEN edad BETWEEN 41 AND 60 THEN '41-60'
                ELSE '60+'
            END as rango,
            ROUND(SUM(CASE WHEN minutos_actividad_semana < 75 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje_sedentario
        FROM respuestas
        GROUP BY rango
        ORDER BY rango;
    `,
    // KPI 4: Completitud de datos (SLA)
    'completitud': `
        SELECT 
            COUNT(*) as total,
            SUM(CASE 
                WHEN fecha_encuesta IS NOT NULL 
                AND genero IS NOT NULL 
                AND edad IS NOT NULL 
                AND horas_sentado_dia IS NOT NULL 
                AND minutos_actividad_semana IS NOT NULL 
                AND tipo_actividad IS NOT NULL 
                AND usa_app IS NOT NULL 
                AND percepcion_salud IS NOT NULL 
                THEN 1 ELSE 0 
            END) as completos,
            ROUND(SUM(CASE 
                WHEN fecha_encuesta IS NOT NULL 
                AND genero IS NOT NULL 
                AND edad IS NOT NULL 
                AND horas_sentado_dia IS NOT NULL 
                AND minutos_actividad_semana IS NOT NULL 
                AND tipo_actividad IS NOT NULL 
                AND usa_app IS NOT NULL 
                AND percepcion_salud IS NOT NULL 
                THEN 1 ELSE 0 
            END) * 100.0 / COUNT(*), 2) as porcentaje_completitud
        FROM respuestas;
    `,
    // KPI 5: Freshness (días desde última encuesta)
    'freshness': `
        SELECT 
            DATEDIFF(CURDATE(), MAX(fecha_encuesta)) as dias_desde_ultima,
            MAX(fecha_encuesta) as ultima_encuesta
        FROM respuestas;
    `,
    // KPI 6: % que usa app
    'usa_app': `
        SELECT 
            usa_app,
            COUNT(*) as total,
            ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM respuestas), 2) as porcentaje
        FROM respuestas
        GROUP BY usa_app;
    `
};
// MOSTRAR QUERY SQL
function showSQL(kpiName) {
    const modal = document.getElementById('sqlModal');
    if (modal) {
        document.getElementById('sqlContent').textContent = SQL[kpiName] || '-- No hay query definida';
        modal.style.display = 'flex';
    }
}

function closeSQL() {
    const modal = document.getElementById('sqlModal');
    if (modal) modal.style.display = 'none';
}
// CARGA PRINCIPAL

async function loadDashboard() {
    try {
        const nivel = await fetchJson('/api/kpi/nivel_oms');
        if (nivel) {
            const find = (name) => (nivel.find(n => n.nivel === name) || {}).porcentaje || 0;
            setText('kpi-nivel-oms', `${find('sedentario')}% / ${find('insuficiente')}% / ${find('activo')}%`);
            const pct = Math.round(find('activo'));
            const s1 = document.getElementById('slider-1');
            if (s1) { s1.value = pct;
                document.getElementById('slider-value-1').textContent = pct + '%';
                document.getElementById('sla-global-1').textContent = pct + '%'; }
        }

        const rango = await fetchJson('/api/kpi/rango_etario');
        if (rango) {
            const datos = rango.map(r => ({ ...r, promedio_minutos: parseFloat(r.promedio_minutos) || 0 }));
            renderRangoLista(datos);
            const avg = Math.round(datos.reduce((s, r) => s + r.promedio_minutos, 0) / datos.length);
            setText('kpi-minutos', `${isNaN(avg) ? '--' : avg} min`);
            setText('hero-minutos', `${isNaN(avg) ? '--' : avg} min`);
        }

        const sed = await fetchJson('/api/kpi/sedentarismo');
        if (sed) {
            const datos = sed.map(r => ({ ...r, porcentaje_sedentario: parseFloat(r.porcentaje_sedentario) || 0 }));
            setText('kpi-sedentarismo', `${Math.round(datos.reduce((s, r) => s + r.porcentaje_sedentario, 0) / datos.length)}%`);
        }

        const tipo = await fetchJson('/api/kpi/tipo_actividad');
        if (tipo && tipo.length) setText('kpi-tipo-actividad', `${tipo[0].tipo_actividad} (${tipo[0].rango})`);

        const corr = await fetchJson('/api/kpi/correlacion');
        if (corr) {
            setText('kpi-correlacion', `r = ${corr.correlacion || 0}`);
            setText('hero-correlacion', `r = ${corr.correlacion || 0}`);
        }

        const app = await fetchJson('/api/kpi/usa_app');
        if (app) {
            const pct = Math.round((app.find(a => a.usa_app === 'Sí') || {}).porcentaje || 0);
            setText('kpi-usa-app', `${pct}%`);
            setText('hero-usa-app', `${pct}%`);
        }

        const sla = await fetchJson('/api/sla');
        if (sla) {
            const worst = worstSlaColor(sla);
            const colors = { green: 'VERDE', yellow: 'AMARILLO', red: 'ROJO' };
            const small = { green: 'Verde', yellow: 'Amarillo', red: 'Rojo' };
            const emojis = { green: '🟢', yellow: '🟡', red: '🔴' };
            setText('hero-sla', `SLA ${colors[worst]}`);
            setText('kpi-sla', `Semáforo ${colors[worst]} ${emojis[worst]}`);
            setText('hero-sla-desc', sla.map(d => `${d.dimension}: ${small[d.color]}`).join(' | '));
            setText('kpi-sla-desc', sla.map(d => `${d.dimension}: ${small[d.color]}`).join(' | '));
            renderSlaSemaforo(worst);
        }
        console.log('✅ Dashboard cargado');
    } catch (e) {
        console.error(e);
        setText('hero-sla', '⚠️ ERROR');
        setText('hero-sla-desc', 'No se pudo conectar a la API');
    }
}

document.addEventListener('DOMContentLoaded', loadDashboard);