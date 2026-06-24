const API_BASE = 'http://localhost:5000';

async function fetchJson(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.ok ? data.data : null;
    } catch (error) {
        console.error(`Error en ${endpoint}:`, error);
        return null;
    }
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function renderSlaSemaforo(color) {
    const container = document.getElementById('kpi-sla-semaforo');
    if (!container) return;
    const luces = container.querySelectorAll('.luz');
    const normalized = color.toLowerCase();
    luces.forEach((luz) => {
        const isActive = luz.dataset.color === normalized;
        luz.classList.toggle('activa', isActive);
    });
}

function normalizeColor(value) {
    const c = String(value || '').toLowerCase();
    if (c === 'green' || c === 'verde') return 'green';
    if (c === 'yellow' || c === 'amarillo') return 'yellow';
    return 'red';
}

function worstSlaColor(dimensions) {
    const order = { green: 0, yellow: 1, red: 2 };
    let worst = 'green';
    (dimensions || []).forEach((d) => {
        const c = normalizeColor(d.color);
        if (order[c] > order[worst]) worst = c;
    });
    return worst;
}

// ============ RENDERIZAR LISTA (estilo imagen) ============
function renderRangoLista(datos) {
    const container = document.getElementById('rango-lista');
    if (!container) return;
    
    let html = '';
    datos.forEach((item) => {
        const min = Math.round(item.promedio_minutos);
        html += `
            <div class="rango-item">
                <span class="rango-nombre">${item.rango}:</span>
                <span class="rango-valor">${min} min</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

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
            const isPercentage = this.id !== 'slider-3';
            const displayValue = isPercentage ? value + '%' : value + ' días';
            document.getElementById(s.valueId).textContent = displayValue;
            document.getElementById(s.globalId).textContent = displayValue;
            let color, statusText;
            if (this.id === 'slider-1') {
                if (value >= 50) { color = 'green'; statusText = 'Óptimo — verde'; }
                else if (value >= 30) { color = 'yellow'; statusText = 'Advertencia — amarillo'; }
                else { color = 'red'; statusText = 'Bajo — rojo'; }
            } else if (this.id === 'slider-2') {
                if (value >= 95) { color = 'green'; statusText = 'Completo — verde'; }
                else if (value >= 85) { color = 'yellow'; statusText = 'Parcial — amarillo'; }
                else { color = 'red'; statusText = 'Insuficiente — rojo'; }
            } else if (this.id === 'slider-3') {
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
        const val1 = parseFloat(document.getElementById('slider-1').value);
        const val2 = parseFloat(document.getElementById('slider-2').value);
        const val3 = parseFloat(document.getElementById('slider-3').value);
        let worstColor = 'green';
        if (val1 < 30) worstColor = 'red';
        else if (val1 < 50 && worstColor !== 'red') worstColor = 'yellow';
        if (val2 < 85) worstColor = 'red';
        else if (val2 < 95 && worstColor !== 'red') worstColor = 'yellow';
        if (val3 > 42) worstColor = 'red';
        else if (val3 > 21 && worstColor !== 'red') worstColor = 'yellow';
        const globalColor = document.getElementById('sla-global-color');
        if (globalColor) {
            const colorMap = { green: '#10b981', yellow: '#f59e0b', red: '#ef4444' };
            const textMap = { green: 'Verde', yellow: 'Amarillo', red: 'Rojo' };
            globalColor.style.background = colorMap[worstColor];
            globalColor.textContent = textMap[worstColor];
        }
        renderSlaSemaforo(worstColor);
        const colorMap2 = { green: 'VERDE 🟢', yellow: 'AMARILLO 🟡', red: 'ROJO 🔴' };
        setText('kpi-sla', `Semáforo ${colorMap2[worstColor] || 'DESCONOCIDO'}`);
        const descMap = {
            green: 'Todos los indicadores cumplen SLA',
            yellow: 'Algún indicador está en advertencia',
            red: 'Algún indicador incumple SLA'
        };
        setText('kpi-sla-desc', descMap[worstColor] || '');
        setText('hero-sla', `SLA ${textMap[worstColor]}`);
        setText('hero-sla-desc', `Activos: ${val1}% | Completitud: ${val2}% | Freshness: ${val3} días`);
    }
});

function showSQL(kpiName) {
    const sqlQueries = {
        'nivel_oms': `-- KPI: Distribución por nivel OMS
SELECT 
    CASE 
        WHEN minutos_actividad_semana < 75 THEN 'sedentario'
        WHEN minutos_actividad_semana BETWEEN 75 AND 149 THEN 'insuficiente'
        ELSE 'activo'
    END as nivel,
    COUNT(*) as total,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM respuestas), 2) as porcentaje
FROM respuestas
GROUP BY nivel;`,
        'rango_etario': `-- KPI: Minutos promedio por rango etario
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
ORDER BY rango;`,
        'sedentarismo': `-- KPI: % sedentarios por rango etario
SELECT 
    CASE 
        WHEN edad BETWEEN 14 AND 24 THEN '14-24'
        WHEN edad BETWEEN 25 AND 40 THEN '25-40'
        WHEN edad BETWEEN 41 AND 60 THEN '41-60'
        ELSE '60+'
    END as rango,
    ROUND(SUM(CASE WHEN minutos_actividad_semana < 75 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje_sedentario,
    COUNT(*) as total
FROM respuestas
GROUP BY rango
ORDER BY rango;`,
        'completitud': `-- KPI: Completitud de datos
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
        THEN 1 ELSE 0 END) as completos,
    ROUND(SUM(CASE 
        WHEN fecha_encuesta IS NOT NULL 
        AND genero IS NOT NULL 
        AND edad IS NOT NULL 
        AND horas_sentado_dia IS NOT NULL 
        AND minutos_actividad_semana IS NOT NULL 
        AND tipo_actividad IS NOT NULL 
        AND usa_app IS NOT NULL 
        AND percepcion_salud IS NOT NULL 
        THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as porcentaje_completitud
FROM respuestas;`,
        'freshness': `-- KPI: Freshness (días desde última encuesta)
SELECT 
    DATEDIFF(CURDATE(), MAX(fecha_encuesta)) as dias_desde_ultima,
    MAX(fecha_encuesta) as ultima_encuesta
FROM respuestas;`,
        'usa_app': `-- KPI: % que usa app
SELECT 
    usa_app,
    COUNT(*) as total,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM respuestas), 2) as porcentaje
FROM respuestas
GROUP BY usa_app;`
    };
    const sql = sqlQueries[kpiName] || '-- No hay query definida para este KPI';
    const modal = document.getElementById('sqlModal');
    if (modal) {
        document.getElementById('sqlContent').textContent = sql;
        modal.style.display = 'flex';
    }
}

function closeSQL() {
    const modal = document.getElementById('sqlModal');
    if (modal) modal.style.display = 'none';
}

async function loadDashboard() {
    try {
        const nivelOms = await fetchJson('/api/kpi/nivel_oms');
        if (nivelOms) {
            const activo = nivelOms.find(n => n.nivel === 'activo');
            const sedentario = nivelOms.find(n => n.nivel === 'sedentario');
            const insuficiente = nivelOms.find(n => n.nivel === 'insuficiente');
            setText('kpi-nivel-oms', `${sedentario ? sedentario.porcentaje : 0}% / ${insuficiente ? insuficiente.porcentaje : 0}% / ${activo ? activo.porcentaje : 0}%`);
            const activoPct = activo ? Math.round(activo.porcentaje) : 0;
            const slider1 = document.getElementById('slider-1');
            if (slider1) {
                slider1.value = activoPct;
                document.getElementById('slider-value-1').textContent = activoPct + '%';
                document.getElementById('sla-global-1').textContent = activoPct + '%';
            }
        }

        const rangoEtario = await fetchJson('/api/kpi/rango_etario');
        if (rangoEtario) {
            const datos = rangoEtario.map(r => ({
                ...r,
                promedio_minutos: parseFloat(r.promedio_minutos) || 0
            }));
            // Renderizar lista (estilo imagen)
            renderRangoLista(datos);
            
            const total = datos.reduce((sum, r) => sum + r.promedio_minutos, 0);
            const promedio = Math.round(total / datos.length);
            setText('kpi-minutos', `${isNaN(promedio) ? '--' : promedio} min`);
            setText('hero-minutos', `${isNaN(promedio) ? '--' : promedio} min`);
        }

        const sedentarismo = await fetchJson('/api/kpi/sedentarismo');
        if (sedentarismo) {
            const datos = sedentarismo.map(r => ({
                ...r,
                porcentaje_sedentario: parseFloat(r.porcentaje_sedentario) || 0
            }));
            const total = datos.reduce((sum, r) => sum + r.porcentaje_sedentario, 0);
            setText('kpi-sedentarismo', `${Math.round(total / datos.length)}%`);
        }

        const tipoActividad = await fetchJson('/api/kpi/tipo_actividad');
        if (tipoActividad && tipoActividad.length > 0) {
            const top = tipoActividad[0];
            setText('kpi-tipo-actividad', `${top.tipo_actividad} (${top.rango})`);
        }

        const correlacion = await fetchJson('/api/kpi/correlacion');
        if (correlacion) {
            setText('kpi-correlacion', `r = ${correlacion.correlacion || 0}`);
            setText('hero-correlacion', `r = ${correlacion.correlacion || 0}`);
        }

        const usaApp = await fetchJson('/api/kpi/usa_app');
        if (usaApp) {
            const si = usaApp.find(a => a.usa_app === 'Sí');
            const pct = si ? Math.round(si.porcentaje) : 0;
            setText('kpi-usa-app', `${pct}%`);
            setText('hero-usa-app', `${pct}%`);
        }

        const sla = await fetchJson('/api/sla');
        if (sla) {
            const worst = worstSlaColor(sla);
            const colorMap = { green: 'VERDE', yellow: 'AMARILLO', red: 'ROJO' };
            const emojiMap = { green: '🟢', yellow: '🟡', red: '🔴' };
            setText('hero-sla', `SLA ${colorMap[worst] || 'DESCONOCIDO'}`);
            setText('kpi-sla', `Semáforo ${colorMap[worst] || 'DESCONOCIDO'} ${emojiMap[worst] || ''}`);
            setText('hero-sla-desc', sla.map(d => `${d.dimension}: ${normalizeColor(d.color)}`).join(' | '));
            setText('kpi-sla-desc', sla.map(d => `${d.dimension}: ${normalizeColor(d.color)}`).join(' | '));
            renderSlaSemaforo(worst);
        }
        console.log('✅ Dashboard cargado con datos reales desde API');
    } catch (error) {
        console.error('❌ Error cargando dashboard:', error);
        setText('hero-sla', '⚠️ ERROR');
        setText('hero-sla-desc', 'No se pudo conectar a la API');
    }
}

document.addEventListener('DOMContentLoaded', loadDashboard);