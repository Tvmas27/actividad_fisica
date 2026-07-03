const API_BASE = 'http://localhost:5000';
let globalData = { rango: null, sedentarismo: null, tipoAct: null, nivel: null, correlacion: null, usaApp: null, sla: null };
let filtroActivos = 25;
let chartInstance = null;

async function fetchData(endpoint) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json.ok ? json.data : null;
    } catch (e) { console.error(e); return null; }
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function renderSlaSemaforo(color) {
    const c = document.getElementById('kpi-sla-semaforo');
    if (!c) return;
    c.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === color.toLowerCase()));
}

function actualizarGrafico(rangoData, sedData, filtro) {
    const ctx = document.getElementById('chartRangos');
    if (!ctx) return;
    const labels = ['14-24','25-40','41-60','60+'];
    const minutos = [0,0,0,0], sed = [0,0,0,0];
    rangoData?.forEach(item => {
        const i = labels.indexOf(item.rango);
        if (i>=0 && item.promedio_minutos >= filtro) minutos[i] = Math.round(item.promedio_minutos);
    });
    sedData?.forEach(item => {
        const i = labels.indexOf(item.rango);
        if (i>=0 && minutos[i] > 0) sed[i] = Math.round(item.porcentaje_sedentario);
    });
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [
            { label: 'Minutos (KPI 2)', data: minutos, backgroundColor: 'rgba(43,143,122,0.8)', borderColor: '#2b8f7a', borderWidth: 2, borderRadius: 4 },
            { label: '% Sedentarios (KPI 3)', data: sed, backgroundColor: 'rgba(245,158,11,0.8)', borderColor: '#f59e0b', borderWidth: 2, borderRadius: 4 }
        ]},
        options: { responsive: true, maintainAspectRatio: true, aspectRatio: 2.5,
            plugins: { legend: { labels: { color: '#d4def0', font: { size: 11, weight: '600' }, padding: 16 } },
                tooltip: { backgroundColor: '#1a1a2b', titleColor: '#fff', bodyColor: '#d4def0', padding: 12, cornerRadius: 8,
                    callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + (ctx.dataset.label.includes('Minutos') ? ' min' : '%') } } },
            scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7b8ba8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#7b8ba8' } } } }
    });
}

function filtrarTablaRangos(filtro) {
    const tbody = document.getElementById('tabla-rangos');
    if (!tbody || !globalData.rango) return;
    const orden = ['14-24','25-40','41-60','60+'];
    let html = '';
    orden.forEach(r => {
        const rItem = globalData.rango.find(item => item.rango === r);
        const sItem = globalData.sedentarismo?.find(item => item.rango === r);
        const tItem = globalData.tipoAct?.find(item => item.rango === r);
        if (rItem && rItem.promedio_minutos >= filtro) {
            html += `<tr><td><strong>${r}</strong></td><td>${Math.round(rItem.promedio_minutos)} min</td><td>${sItem ? Math.round(sItem.porcentaje_sedentario) : '-'}%</td><td>${tItem ? tItem.actividad : '-'}</td></tr>`;
        }
    });
    tbody.innerHTML = html || '<tr><td colspan="4">No hay datos</td></tr>';
}

async function cargarDashboard() {
    const [nivel, rango, sedentarismo, tipoAct, correlacion, usaApp, sla] = await Promise.all([
        fetchData('/api/kpi/nivel_oms'), fetchData('/api/kpi/rango_etario'), fetchData('/api/kpi/sedentarismo'),
        fetchData('/api/kpi/tipo_actividad'), fetchData('/api/kpi/correlacion'), fetchData('/api/kpi/usa_app'), fetchData('/api/sla')
    ]);
    if (!nivel && !rango && !sedentarismo && !tipoAct && !correlacion && !usaApp && !sla) return;
    globalData = { nivel, rango, sedentarismo, tipoAct, correlacion, usaApp, sla };

    setText('hero-total-registros', nivel?.total || 59);
    setText('hero-periodo', 'Jun 2026');

    if (nivel) setText('kpi-nivel-oms', nivel.map(n => parseFloat(n.porcentaje).toFixed(2) + '%').join(' / '));

    if (rango && sedentarismo) {
        const avgMin = Math.round(rango.reduce((s,r) => s + parseFloat(r.promedio_minutos||0), 0) / rango.length);
        const avgSed = Math.round(sedentarismo.reduce((s,r) => s + parseFloat(r.porcentaje_sedentario||0), 0) / sedentarismo.length);
        setText('kpi-minutos-rango', avgMin + ' min promedio');
        setText('hero-minutos', avgMin + ' min');
        setText('kpi-sedentarismo-rango', avgSed + '% promedio');
        actualizarGrafico(rango, sedentarismo, filtroActivos);
        filtrarTablaRangos(filtroActivos);
    }

    if (tipoAct && tipoAct.length) {
        const top = tipoAct.reduce((a,b) => a.total > b.total ? a : b);
        setText('kpi-tipo-actividad', top.actividad + ' (' + top.rango + ')');
        const tbody = document.getElementById('tabla-actividad-body');
        if (tbody) {
            const orden = ['14-24','25-40','41-60','60+'];
            let html = '';
            orden.forEach(r => { const item = tipoAct.find(t => t.rango === r); html += `<tr><td><strong>${r}</strong></td><td>${item ? item.actividad : '-'}</td></tr>`; });
            tbody.innerHTML = html;
        }
    }

    if (correlacion) {
        setText('kpi-correlacion', 'r = ' + (correlacion.correlacion || 0).toFixed(4));
        setText('hero-correlacion', 'r = ' + (correlacion.correlacion || 0).toFixed(4));
        const sem = document.getElementById('correlacion-semaforo');
        if (sem) sem.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === (correlacion.color || 'yellow')));
    }

    if (usaApp) {
        const si = usaApp.find(a => a.usa_app.toLowerCase() === 'si') || { porcentaje: 0 };
        setText('kpi-usa-app', Math.round(si.porcentaje) + '%');
        setText('hero-usa-app', Math.round(si.porcentaje) + '%');
        document.getElementById('sla-global-1').textContent = Math.round(si.porcentaje) + '%';
    }

    if (sla && sla.length) {
        const order = { green:0, yellow:1, red:2 };
        let worst = 'green';
        sla.forEach(d => { const c = d.color.toLowerCase(); if (order[c] > order[worst]) worst = c; });
        const colors = { green:'VERDE', yellow:'AMARILLO', red:'ROJO' };
        setText('kpi-sla', 'Semáforo ' + colors[worst]);
        setText('kpi-sla-desc', sla.map(d => d.dimension + ': ' + d.color).join(' | '));
        renderSlaSemaforo(worst);
        const gc = document.getElementById('sla-global-color');
        if (gc) {
            gc.style.background = worst === 'green' ? '#10b981' : worst === 'yellow' ? '#f59e0b' : '#ef4444';
            gc.textContent = worst === 'green' ? 'Verde' : worst === 'yellow' ? 'Amarillo' : 'Rojo';
        }
        const compItem = sla.find(d => d.dimension === 'Completitud');
        const freshItem = sla.find(d => d.dimension === 'Freshness (días)');
        document.getElementById('sla-global-2').textContent = compItem ? compItem.descripcion : '--';
        document.getElementById('sla-global-3').textContent = freshItem ? freshItem.descripcion : '--';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    cargarDashboard();
    const sliders = [
        { id:'slider-1', valueId:'slider-value-1', statusId:'slider-status-1', globalId:'sla-global-1', tipo:'activos' },
        { id:'slider-2', valueId:'slider-value-2', statusId:'slider-status-2', globalId:'sla-global-2', tipo:'completitud' },
        { id:'slider-3', valueId:'slider-value-3', statusId:'slider-status-3', globalId:'sla-global-3', tipo:'freshness' }
    ];
    sliders.forEach(s => {
        const slider = document.getElementById(s.id);
        if (!slider) return;
        slider.addEventListener('input', function() {
            const val = parseFloat(this.value);
            const display = this.id !== 'slider-3' ? val + '%' : val + ' días';
            document.getElementById(s.valueId).textContent = display;
            document.getElementById(s.globalId).textContent = display;
            let color, statusText;
            if (s.tipo === 'activos') {
                if (val >= 50) { color = 'green'; statusText = 'Óptimo — verde'; }
                else if (val >= 30) { color = 'yellow'; statusText = 'Advertencia — amarillo'; }
                else { color = 'red'; statusText = 'Bajo — rojo'; }
                filtroActivos = val;
                if (globalData.rango && globalData.sedentarismo) {
                    actualizarGrafico(globalData.rango, globalData.sedentarismo, filtroActivos);
                    filtrarTablaRangos(filtroActivos);
                }
            } else if (s.tipo === 'completitud') {
                if (val >= 95) { color = 'green'; statusText = 'Completo — verde'; }
                else if (val >= 85) { color = 'yellow'; statusText = 'Parcial — amarillo'; }
                else { color = 'red'; statusText = 'Insuficiente — rojo'; }
            } else {
                if (val <= 21) { color = 'green'; statusText = 'Actualizado — verde'; }
                else if (val <= 42) { color = 'yellow'; statusText = 'Antiguo — amarillo'; }
                else { color = 'red'; statusText = 'Obsoleto — rojo'; }
            }
            const statusEl = document.getElementById(s.statusId);
            if (statusEl) { statusEl.textContent = statusText; statusEl.style.color = color === 'green' ? '#10b981' : color === 'yellow' ? '#f59e0b' : '#ef4444'; }
            const semaforo = document.getElementById('kpi-sla-semaforo');
            if (semaforo) semaforo.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === color));
            const gc = document.getElementById('sla-global-color');
            if (gc) { gc.style.background = color === 'green' ? '#10b981' : color === 'yellow' ? '#f59e0b' : '#ef4444'; gc.textContent = color === 'green' ? 'Verde' : color === 'yellow' ? 'Amarillo' : 'Rojo'; }
        });
    });
});