const API_BASE = 'http://localhost:5000';
let globalData = { rango: null, sedentarismo: null, tipoAct: null, nivel: null, correlacion: null, usaApp: null, sla: null };
let filtroActivos = 0;
let chartLineaInstance = null;
let chartBarrasInstance = null;
let modoDatos = 'original';

async function fetchData(endpoint) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return json.ok ? json.data : null;
    } catch (e) { 
        console.error('❌ Error en fetch:', e.message);
        return null; 
    }
}

function apiEndpoint(path) {
    if (modoDatos !== 'etl') return path;
    if (path === '/api/sla') return '/api/kpi/etl/sla';
    if (path.startsWith('/api/kpi/')) return path.replace('/api/kpi/', '/api/kpi/etl/');
    return path;
}

async function fetchDataMode(path) {
    return fetchData(apiEndpoint(path));
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function normalizarTexto(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function renderSlaSemaforo(color) {
    const c = document.getElementById('kpi-sla-semaforo');
    if (!c) return;
    c.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === color.toLowerCase()));
}

function actualizarGraficoLinea(rangoData) {
    const ctx = document.getElementById('chartLinea');
    if (!ctx) return;
    const orden = ['14-24', '25-40', '41-60', '60+'];
    const valores = orden.map(rango => {
        const item = rangoData?.find(d => d.rango === rango);
        return item ? Math.round(parseFloat(item.promedio_minutos || 0)) : 0;
    });

    if (chartLineaInstance) chartLineaInstance.destroy();
    chartLineaInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: orden,
            datasets: [{
                label: 'Minutos promedio',
                data: valores,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#000000',
                pointRadius: 6,
                pointHoverRadius: 8,
                borderWidth: 3,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            plugins: {
                legend: {
                    labels: { color: '#b0bcc8', font: { size: 11, weight: '600' }, padding: 16 }
                },
                tooltip: {
                    backgroundColor: '#1a1a2b',
                    titleColor: '#fff',
                    bodyColor: '#c8d4e8',
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => `Minutos promedio: ${ctx.parsed.y} min`
                    }
                }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8ba3c7' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8ba3c7' } }
            }
        }
    });
}

function actualizarGraficoBarras(nivelData) {
    const ctx = document.getElementById('chartBarras');
    if (!ctx) return;

    const orden = ['sedentario', 'insuficiente', 'activo'];
    // NUEVA PALETA AZULADA
    const colores = {
        sedentario: '#1e40af',  // Azul oscuro
        insuficiente: '#3b82f6', // Azul medio
        activo: '#60a5fa'        // Azul claro / celeste
    };

    const itemsOrdenados = orden.map(nivel =>
        nivelData?.find(d => normalizarTexto(d.nivel) === nivel) || null
    );
    const valores = itemsOrdenados.map(item => item ? Number(item.total || 0) : 0);

    if (chartBarrasInstance) chartBarrasInstance.destroy();
    chartBarrasInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: orden,
            datasets: [{
                label: 'Total de encuestados',
                data: valores,
                backgroundColor: [colores.sedentario, colores.insuficiente, colores.activo],
                borderColor: [colores.sedentario, colores.insuficiente, colores.activo],
                borderWidth: 1,
                borderRadius: 10,
                maxBarThickness: 72
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            plugins: {
                legend: {
                    labels: { color: '#b0bcc8', font: { size: 11, weight: '600' }, padding: 16 }
                },
                tooltip: {
                    backgroundColor: '#1a1a2b',
                    titleColor: '#fff',
                    bodyColor: '#c8d4e8',
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const item = itemsOrdenados[context.dataIndex];
                            const total = context.parsed.y;
                            const porcentaje = item ? Number(item.porcentaje || 0).toFixed(2) : '0.00';
                            return `Total: ${total} (${porcentaje}%)`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8ba3c7' }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8ba3c7' },
                    beginAtZero: true
                }
            }
        }
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
    console.log('🔄 Cargando dashboard...');
    
    const [nivel, rango, sedentarismo, tipoAct, correlacion, usaApp, sla] = await Promise.all([
        fetchDataMode('/api/kpi/nivel_oms'),
        fetchDataMode('/api/kpi/rango'),
        fetchDataMode('/api/kpi/sedentarismo'),
        fetchDataMode('/api/kpi/tipo_actividad'),
        fetchDataMode('/api/kpi/correlacion'),
        fetchDataMode('/api/kpi/usa_app'),
        fetchDataMode('/api/sla')
    ]);

    const hayDatosReales = nivel && nivel.length > 0;
    if (!hayDatosReales) {
        setText('kpi-nivel-oms', 'Sin datos');
        setText('kpi-minutos-rango', 'Sin datos');
        setText('kpi-sedentarismo-rango', 'Sin datos');
        setText('kpi-tipo-actividad', 'Sin datos');
        setText('kpi-correlacion', 'Sin datos');
        setText('kpi-usa-app', 'Sin datos');
        setText('kpi-sla', 'Sin datos');
        return;
    }

    console.log('✅ Datos reales recibidos:', { nivel, rango, sedentarismo, tipoAct, correlacion, usaApp, sla });
    globalData = { nivel, rango, sedentarismo, tipoAct, correlacion, usaApp, sla };

    // ---- HERO ----
    setText('hero-total-registros', nivel.reduce((s, n) => s + n.total, 0) || 0);
    setText('hero-periodo', 'Jul 2026');

    // ---- KPI 1 + gráfico barras ----
    if (nivel) {
        setText('kpi-nivel-oms', nivel.map(n => parseFloat(n.porcentaje).toFixed(2) + '%').join(' / '));
        actualizarGraficoBarras(nivel);
    }

    // ---- KPI 2 y 3 ----
    if (rango && sedentarismo) {
        const avgMin = Math.round(rango.reduce((s, r) => s + parseFloat(r.promedio_minutos || 0), 0) / rango.length);
        const avgSed = Math.round(sedentarismo.reduce((s, r) => s + parseFloat(r.porcentaje_sedentario || 0), 0) / sedentarismo.length);
        setText('kpi-minutos-rango', avgMin + ' min promedio');
        setText('hero-minutos', avgMin + ' min');
        setText('kpi-sedentarismo-rango', avgSed + '% promedio');
        actualizarGraficoLinea(rango);
        filtrarTablaRangos(filtroActivos);
    }

    // ---- KPI 4 ----
    if (tipoAct && tipoAct.length) {
        const top = tipoAct.reduce((a, b) => a.total > b.total ? a : b);
        setText('kpi-tipo-actividad', top.actividad + ' (' + top.rango + ')');
        const tbody = document.getElementById('tabla-actividad-body');
        if (tbody) {
            const orden = ['14-24', '25-40', '41-60', '60+'];
            let html = '';
            orden.forEach(r => {
                const item = tipoAct.find(t => t.rango === r);
                html += `<tr><td><strong>${r}</strong></td><td>${item ? item.actividad : '-'}</td></tr>`;
            });
            tbody.innerHTML = html;
        }
    }

    // ---- KPI 5 ----
    if (correlacion) {
        const valorCorr = Number(correlacion.correlacion || 0);
        setText('kpi-correlacion', 'r = ' + valorCorr.toFixed(4));
        setText('hero-correlacion', 'r = ' + valorCorr.toFixed(4));
        const sem = document.getElementById('correlacion-semaforo');
        if (sem) {
            sem.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === (correlacion.color || 'yellow')));
        }
    }

    // ---- KPI 6 ----
    if (usaApp) {
        const si = usaApp.find(a => {
            const valor = normalizarTexto(a.usa_app);
            return valor === 'si' || valor === 'yes' || valor === 'true' || valor === '1';
        }) || usaApp[0] || { porcentaje: 0 };
        setText('kpi-usa-app', Math.round(si.porcentaje) + '%');
        setText('hero-usa-app', Math.round(si.porcentaje) + '%');
        document.getElementById('sla-global-1').textContent = Math.round(si.porcentaje) + '%';
    }

    // ---- KPI 7 ----
    if (sla && sla.length) {
        const order = { green: 0, yellow: 1, red: 2 };
        let worst = 'green';
        sla.forEach(d => {
            const c = d.color.toLowerCase();
            if (order[c] > order[worst]) worst = c;
        });
        const colors = { green: 'VERDE', yellow: 'AMARILLO', red: 'ROJO' };
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

    console.log('✅ Dashboard cargado con datos reales');
}

document.addEventListener('DOMContentLoaded', function() {
    cargarDashboard();
    const toggleBtn = document.getElementById('toggle-etl-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', async function() {
            modoDatos = modoDatos === 'original' ? 'etl' : 'original';
            this.textContent = modoDatos === 'original' ? 'Ver datos filtrados' : 'Ver datos originales';
            await cargarDashboard();
        });
    }
    const sliders = [
        { id: 'slider-1', valueId: 'slider-value-1', statusId: 'slider-status-1', globalId: 'sla-global-1' },
        { id: 'slider-2', valueId: 'slider-value-2', statusId: 'slider-status-2', globalId: 'sla-global-2' },
        { id: 'slider-3', valueId: 'slider-value-3', statusId: 'slider-status-3', globalId: 'sla-global-3' }
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
            if (this.id === 'slider-1') {
                if (val >= 50) { color = 'green'; statusText = 'Óptimo — verde'; }
                else if (val >= 30) { color = 'yellow'; statusText = 'Advertencia — amarillo'; }
                else { color = 'red'; statusText = 'Bajo — rojo'; }
                filtroActivos = val;
                if (globalData.rango && globalData.sedentarismo) {
                    filtrarTablaRangos(filtroActivos);
                }
            } else if (this.id === 'slider-2') {
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