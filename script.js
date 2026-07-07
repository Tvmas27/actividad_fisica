const API_BASE = 'http://localhost:5000';
let globalData = { rango: null, sedentarismo: null, tipoAct: null, nivel: null, correlacion: null, usaApp: null, sla: null };
let chartLineaInstance = null;
let chartBarrasInstance = null;
let modoDatos = 'original';
let registrosMeta = null;
let registrosUltimos = [];

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

async function fetchJson(path, options = {}) {
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
        return json.data ?? json;
    } catch (e) {
        console.error('❌ Error en request:', e.message);
        throw e;
    }
}

function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

function setKpiText(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const changed = el.textContent !== text;
    el.textContent = text;
    if (!changed) return;
    const card = el.closest('.kpi-card');
    if (!card) return;
    card.classList.remove('kpi-flash');
    void card.offsetWidth;
    card.classList.add('kpi-flash');
    setTimeout(() => card.classList.remove('kpi-flash'), 900);
}

function setFeedback(text, status) {
    const el = document.getElementById('registro-feedback');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-ok', 'is-error');
    if (status === 'ok') el.classList.add('is-ok');
    if (status === 'error') el.classList.add('is-error');
}

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

// --- MODAL PERSONALIZADO (eliminación) ---
function mostrarModalConfirm(mensaje) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('modal-confirm');
        const msg = document.getElementById('modal-message');
        const btnConfirm = document.getElementById('modal-confirm-btn');
        const btnCancel = document.getElementById('modal-cancel');

        msg.textContent = mensaje;
        overlay.classList.add('is-open');

        const cleanup = () => {
            overlay.classList.remove('is-open');
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                onCancel();
            }
        });
    });
}

// --- FUNCIÓN PARA ABRIR MODAL SLA ---
async function abrirModalSLA() {
    const modal = document.getElementById('modal-sla');
    if (!modal) return;

    modal.classList.add('is-open');

    let slaData = globalData.sla;
    if (!slaData || !slaData.length) {
        try {
            slaData = await fetchDataMode('/api/sla');
            if (slaData && slaData.length) {
                globalData.sla = slaData;
            } else {
                slaData = [];
            }
        } catch (e) {
            console.error('Error al cargar SLA:', e);
            slaData = [];
        }
    }

    const completitud = slaData.find(d => d.dimension === 'Completitud');
    const freshness = slaData.find(d => d.dimension === 'Freshness (días)');
    const errorRate = slaData.find(d => d.dimension === 'Error Rate');

    document.getElementById('sla-completitud').textContent = completitud ? completitud.descripcion : '--';
    document.getElementById('sla-freshness').textContent = freshness ? freshness.descripcion : '--';
    document.getElementById('sla-errorrate').textContent = errorRate ? errorRate.descripcion : '--';

    const colors = { green: 0, yellow: 1, red: 2 };
    let worst = 'green';
    slaData.forEach(d => {
        const c = d.color.toLowerCase();
        if (colors[c] > colors[worst]) worst = c;
    });
    const badge = document.getElementById('sla-semaforo-global');
    if (badge) {
        badge.textContent = worst === 'green' ? 'Verde' : worst === 'yellow' ? 'Amarillo' : 'Rojo';
        badge.style.background = worst === 'green' ? '#22c55e' : worst === 'yellow' ? '#facc15' : '#f43f5e';
        badge.style.color = worst === 'yellow' ? '#000' : '#fff';
    }
}

function cerrarModalSLA() {
    const modal = document.getElementById('modal-sla');
    if (modal) modal.classList.remove('is-open');
}

// --- FORMULARIO Y TABLA CRUD ---
function crearCampoRegistro(field) {
    const wrap = document.createElement('label');
    wrap.className = 'registro-field';

    const title = document.createElement('span');
    title.className = 'registro-label';
    title.textContent = field.label + (field.required ? ' *' : '');
    wrap.appendChild(title);

    let input;
    if (field.options && field.options.length) {
        input = document.createElement('select');
        input.name = field.name;
        input.innerHTML = '<option value="">Selecciona una opción</option>' + field.options.map(opt => `<option value="${String(opt.value).replace(/"/g, '&quot;')}">${opt.label}</option>`).join('');
    } else {
        input = document.createElement('input');
        input.name = field.name;
        input.type = field.inputType || 'text';
        if (input.type === 'number') input.step = 'any';
    }
    input.required = field.required;
    input.className = 'registro-input';
    wrap.appendChild(input);
    return wrap;
}

function renderFormularioRegistro(meta) {
    const form = document.getElementById('registro-form');
    if (!form || !meta) return;
    form.innerHTML = '';
    meta.fields.forEach(field => form.appendChild(crearCampoRegistro(field)));
}

function renderTablaRegistros(data) {
    const tbody = document.getElementById('tabla-registros-body');
    if (!tbody || !data) return;
    const pk = data.primaryKey;
    registrosUltimos = data.rows || [];
    if (!registrosUltimos.length) {
        tbody.innerHTML = '<tr><td colspan="100%">No hay registros</td></tr>';
        return;
    }
    const campos = data.fields || [];
    const columnas = pk ? [{ name: pk, label: 'ID' }, ...campos] : campos;

    tbody.innerHTML = registrosUltimos.map(row => {
        const celdas = columnas.map(field => {
            let valor = row[field.name] ?? '-';
            if (field.options) {
                const opt = field.options.find(o => String(o.value) === String(valor));
                valor = opt ? opt.label : valor;
            }
            return `<td>${valor}</td>`;
        }).join('');
        const idVal = row[pk] ?? '';
        return `<tr>${celdas}<td><button type="button" class="btn btn-secondary btn-mini js-delete-registro" data-id="${idVal}">Eliminar</button></td></tr>`;
    }).join('');
}

async function cargarMetadatosRegistros() {
    try {
        registrosMeta = await fetchJson('/api/registros/meta');
        renderFormularioRegistro(registrosMeta);
        const metaTbody = document.getElementById('tabla-registros-head');
        if (metaTbody) {
            const pk = registrosMeta.primaryKey;
            const cols = (registrosMeta.fields || []).map(f => `<th>${f.label}</th>`).join('');
            metaTbody.innerHTML = `<tr>${pk ? '<th>ID</th>' : ''}${cols}<th>Acciones</th></tr>`;
        }
    } catch (e) {
        console.error(e);
        const form = document.getElementById('registro-form');
        if (form) form.innerHTML = `<p class="registro-error">No se pudo cargar el formulario: ${e.message}. Verifica que el backend (app.py) esté corriendo en ${API_BASE}.</p>`;
    }
}

async function cargarRegistros() {
    try {
        const data = await fetchJson('/api/registros?limit=8');
        renderTablaRegistros(data);
    } catch (e) {
        console.error(e);
        const tbody = document.getElementById('tabla-registros-body');
        if (tbody) tbody.innerHTML = `<tr><td colspan="100%" class="registro-error">No se pudieron cargar los registros: ${e.message}</td></tr>`;
    }
}

async function refrescarVistaCompleta() {
    await Promise.all([cargarDashboard(), cargarRegistros()]);
}

async function insertarRegistroDesdeFormulario(form) {
    const payload = {};
    const data = new FormData(form);
    data.forEach((value, key) => {
        if (value !== '') payload[key] = value;
    });
    await fetchJson('/api/registros', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    await refrescarVistaCompleta();
}

async function eliminarRegistro(id) {
    if (!id) return;
    const confirmado = await mostrarModalConfirm(`¿Eliminar el registro ${id}?`);
    if (!confirmado) return;
    await fetchJson(`/api/registros/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refrescarVistaCompleta();
}

// --- GRÁFICOS ---
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
    const colores = {
        sedentario: '#1e40af',
        insuficiente: '#3b82f6',
        activo: '#60a5fa'
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

    setText('hero-total-registros', nivel.reduce((s, n) => s + n.total, 0) || 0);
    setText('hero-periodo', 'Jul 2026');

    if (nivel) {
        setKpiText('kpi-nivel-oms', nivel.map(n => parseFloat(n.porcentaje).toFixed(2) + '%').join(' / '));
        actualizarGraficoBarras(nivel);
    }

    if (rango && sedentarismo) {
        const avgMin = Math.round(rango.reduce((s, r) => s + parseFloat(r.promedio_minutos || 0), 0) / rango.length);
        const avgSed = Math.round(sedentarismo.reduce((s, r) => s + parseFloat(r.porcentaje_sedentario || 0), 0) / sedentarismo.length);
        setKpiText('kpi-minutos-rango', avgMin + ' min promedio');
        setText('hero-minutos', avgMin + ' min');
        setKpiText('kpi-sedentarismo-rango', avgSed + '% promedio');
        actualizarGraficoLinea(rango);
    }

    if (tipoAct && tipoAct.length) {
        const top = tipoAct.reduce((a, b) => a.total > b.total ? a : b);
        setKpiText('kpi-tipo-actividad', top.actividad + ' (' + top.rango + ')');
    }

    if (correlacion) {
        const valorCorr = Number(correlacion.correlacion || 0);
        setKpiText('kpi-correlacion', 'r = ' + valorCorr.toFixed(4));
        setText('hero-correlacion', 'r = ' + valorCorr.toFixed(4));
        const sem = document.getElementById('correlacion-semaforo');
        if (sem) {
            sem.querySelectorAll('.luz').forEach(luz => luz.classList.toggle('activa', luz.dataset.color === (correlacion.color || 'yellow')));
        }
    }

    if (usaApp) {
        const si = usaApp.find(a => {
            const valor = normalizarTexto(a.usa_app);
            return valor === 'si' || valor === 'yes' || valor === 'true' || valor === '1';
        }) || usaApp[0] || { porcentaje: 0 };
        setKpiText('kpi-usa-app', Math.round(si.porcentaje) + '%');
        setText('hero-usa-app', Math.round(si.porcentaje) + '%');
    }

    if (sla && sla.length) {
        const order = { green: 0, yellow: 1, red: 2 };
        let worst = 'green';
        sla.forEach(d => {
            const c = d.color.toLowerCase();
            if (order[c] > order[worst]) worst = c;
        });
        const colors = { green: 'VERDE', yellow: 'AMARILLO', red: 'ROJO' };
        setKpiText('kpi-sla', 'Semáforo ' + colors[worst]);
        setText('kpi-sla-desc', sla.map(d => d.dimension + ': ' + d.color).join(' | '));
        renderSlaSemaforo(worst);
    }

    globalData.sla = sla;
    console.log('✅ Dashboard cargado con datos reales');
}

// --- EVENTOS ---
document.addEventListener('DOMContentLoaded', function() {
    cargarMetadatosRegistros();
    cargarRegistros();
    cargarDashboard();

    const btnSla = document.getElementById('btn-ver-sla');
    if (btnSla) {
        btnSla.addEventListener('click', abrirModalSLA);
    }

    const btnCerrarSla = document.getElementById('modal-sla-cerrar');
    if (btnCerrarSla) {
        btnCerrarSla.addEventListener('click', cerrarModalSLA);
    }

    const modalSla = document.getElementById('modal-sla');
    if (modalSla) {
        modalSla.addEventListener('click', function(e) {
            if (e.target === this) cerrarModalSLA();
        });
    }

    const form = document.getElementById('registro-form');
    if (form) {
        form.addEventListener('submit', async function(event) {
            event.preventDefault();
            try {
                await insertarRegistroDesdeFormulario(this);
                setFeedback('Registro insertado y dashboard actualizado.', 'ok');
            } catch (e) {
                setFeedback(e.message || 'No se pudo insertar', 'error');
            }
        });
    }

    const tablaRegistros = document.getElementById('tabla-registros-body');
    if (tablaRegistros) {
        tablaRegistros.addEventListener('click', async function(event) {
            const btn = event.target.closest('.js-delete-registro');
            if (!btn) return;
            try {
                await eliminarRegistro(btn.dataset.id);
                setFeedback('Registro eliminado y dashboard actualizado.', 'ok');
            } catch (e) {
                setFeedback(e.message || 'No se pudo eliminar', 'error');
            }
        });
    }
});