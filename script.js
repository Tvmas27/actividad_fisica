const API_BASE = '';

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    return await res.json();
  } catch (err) {
    console.error('Fetch error', path, err);
    return null;
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

let mainChart = null;

const demoState = {
  nivelOms: { sedentario: 34, insuficiente: 27, activo: 39 },
  rangoEtario: [
    { rango: '14-24', promedio_minutos: 82 },
    { rango: '25-40', promedio_minutos: 96 },
    { rango: '41-60', promedio_minutos: 71 },
    { rango: '60+', promedio_minutos: 54 },
  ],
  sedentarismo: [
    { rango: '14-24', porcentaje_sedentario: 18 },
    { rango: '25-40', porcentaje_sedentario: 24 },
    { rango: '41-60', porcentaje_sedentario: 31 },
    { rango: '60+', porcentaje_sedentario: 36 },
  ],
  tipoActividad: [
    { rango: '25-40', tipo_actividad: 'Caminata', total: 48 },
    { rango: '41-60', tipo_actividad: 'Ejercicio en casa', total: 33 },
    { rango: '14-24', tipo_actividad: 'Deporte', total: 51 },
  ],
  correlacion: { promedio_horas_sentado: 5.4, promedio_percepcion_salud: 3.8, correlacion: -0.42 },
  usaApp: [{ usa_app: 'Sí', porcentaje: 67 }, { usa_app: 'No', porcentaje: 33 }],
  sla: [
    { dimension: 'Completitud', valor: 90, umbral: '>= 95%', color: 'yellow', descripcion: '90/100 filas completas' },
    { dimension: 'Freshness (días)', valor: 3, umbral: '<= 21 días', color: 'green', descripcion: 'Última actualización hace 3 días' },
    { dimension: 'Error Rate', valor: 0.4, umbral: '<= 1%', color: 'green', descripcion: '0.4% errores' },
  ],
};

function normalizeColor(value) {
  const c = String(value || '').toLowerCase();
  if (c.startsWith('g') || c.includes('verde') || c.includes('green')) return 'green';
  if (c.startsWith('y') || c.includes('amar') || c.includes('yellow')) return 'yellow';
  return 'red';
}

function renderSlaSemaforo(color) {
  const normalized = normalizeColor(color);
  const container = document.getElementById('kpi-sla-semaforo');
  if (!container) return;
  const luces = container.querySelectorAll('.luz');
  luces.forEach((luz) => {
    const isActive = luz.dataset.color === normalized;
    luz.classList.toggle('activa', isActive);
    luz.setAttribute('aria-label', `${luz.dataset.color}${isActive ? ' activo' : ''}`);
  });
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

function applyDemoValues() {
  // Hero
  setText('hero-sla', 'SLA AMARILLO');
  setText('hero-sla-desc', 'Completitud: yellow • Freshness: green • Error rate: green');
  setText('hero-minutos', '76 min');
  setText('hero-usa-app', '67%');
  setText('hero-correlacion', 'r = -0.42');

  // KPIs
  setText('kpi-nivel-oms', `${demoState.nivelOms.sedentario}% / ${demoState.nivelOms.insuficiente}% / ${demoState.nivelOms.activo}%`);
  setText('kpi-minutos', '76 min');
  setText('kpi-sedentarismo', '27%');
  setText('kpi-tipo-actividad', 'Caminata (14-24)');
  setText('kpi-correlacion', 'r = -0.42');
  setText('kpi-correlacion-desc', 'Promedio horas sentado: 5.4 hrs');
  setText('kpi-usa-app', '67%');
  setText('kpi-sla', 'Semáforo AMARILLO');
  setText('kpi-sla-desc', 'Completitud: yellow | Freshness: green | Error rate: green');

  // Semáforo
  renderSlaSemaforo('yellow');

  // Gráfico
  renderChart(
    demoState.rangoEtario.map((x) => x.rango),
    demoState.rangoEtario.map((x) => x.promedio_minutos),
  );
}

async function init() {
  const [nivelRes, rangoRes, sedentarismoRes, tipoRes, correlRes, usaAppRes, slaRes] = await Promise.all([
    fetchJson(API_BASE + '/api/kpi/nivel_oms'),
    fetchJson(API_BASE + '/api/kpi/rango_etario'),
    fetchJson(API_BASE + '/api/kpi/sedentarismo'),
    fetchJson(API_BASE + '/api/kpi/tipo_actividad'),
    fetchJson(API_BASE + '/api/kpi/correlacion'),
    fetchJson(API_BASE + '/api/kpi/usa_app'),
    fetchJson(API_BASE + '/api/sla'),
  ]);

  const apiOnline = Boolean(nivelRes || rangoRes || sedentarismoRes || tipoRes || correlRes || usaAppRes || slaRes);

  if (!apiOnline) {
    applyDemoValues();
    return;
  }

  // KPI 1: Nivel OMS
  if (nivelRes && nivelRes.ok) {
    const rows = nivelRes.data || [];
    const findPct = (name) => {
      const r = rows.find(x => String(x.nivel).toLowerCase() === String(name).toLowerCase());
      return r ? (r.porcentaje != null ? r.porcentaje : Math.round((r.total || 0) / (nivelRes.total || 1) * 100)) : 0;
    };
    const sedentario = findPct('sedentario');
    const insuficiente = findPct('insuficiente');
    const activo = findPct('activo');
    setText('kpi-nivel-oms', `${sedentario}% / ${insuficiente}% / ${activo}%`);
  }

  // KPI 2: Minutos promedio
  if (rangoRes && rangoRes.ok) {
    const arr = rangoRes.data || [];
    const minutes = arr.map(x => Number(x.promedio_minutos || x.promedio || 0));
    const avg = minutes.length ? Math.round(minutes.reduce((s, v) => s + v, 0) / minutes.length) : 0;
    setText('kpi-minutos', `${avg} min`);
    setText('hero-minutos', `${avg} min`);
    const labels = arr.map(x => x.rango || x.range || '-');
    renderChart(labels, minutes);
  }

  // KPI 3: Sedentarismo
  if (sedentarismoRes && sedentarismoRes.ok) {
    const arr = sedentarismoRes.data || [];
    const pcts = arr.map(x => Number(x.porcentaje_sedentario || x.porcentaje || 0));
    const overall = pcts.length ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length) : 0;
    setText('kpi-sedentarismo', `${overall}%`);
  }

  // KPI 4: Tipo actividad
  if (tipoRes && tipoRes.ok) {
    const arr = tipoRes.data || [];
    const top = arr.reduce((a, b) => (b.total > (a.total || 0) ? b : a), {});
    setText('kpi-tipo-actividad', `${top.tipo_actividad || top.activity || '-'} (${top.rango || ''})`);
  }

  // KPI 5: Correlación
  if (correlRes && correlRes.ok) {
    const d = correlRes.data || {};
    const r = d.correlacion != null ? d.correlacion : d.r || 'N/A';
    setText('kpi-correlacion', `r = ${r}`);
    setText('kpi-correlacion-desc', `Promedio horas sentado: ${d.promedio_horas_sentado || 'N/A'} hrs`);
    setText('hero-correlacion', `r = ${r}`);
  }

  // KPI 6: Uso de app
  if (usaAppRes && usaAppRes.ok) {
    const arr = usaAppRes.data || [];
    const yes = arr.find(x => 
      String(x.usa_app).toLowerCase().startsWith('s') || 
      String(x.usa_app).toLowerCase().startsWith('y') || 
      String(x.usa_app).toLowerCase() === 'sí'
    );
    const pct = yes ? (yes.porcentaje || yes.percent || 0) : (arr[0] ? (arr[0].porcentaje || arr[0].percent || 0) : 0);
    setText('kpi-usa-app', `${pct}%`);
    setText('hero-usa-app', `${pct}%`);
  }

  // KPI 7: SLA
  if (slaRes && slaRes.ok) {
    const dims = slaRes.data || [];
    if (dims.length) {
      const overallColor = worstSlaColor(dims);
      const summary = overallColor === 'green' ? 'VERDE' : overallColor === 'yellow' ? 'AMARILLO' : 'ROJO';
      setText('kpi-sla', `Semáforo ${summary}`);
      setText('kpi-sla-desc', dims.map(d => `${d.dimension}: ${d.color}`).join(' | '));
      setText('hero-sla', `SLA ${summary}`);
      setText('hero-sla-desc', dims.map(d => `${d.dimension}: ${d.color}`).join(' • '));
      renderSlaSemaforo(overallColor);
    } else {
      setText('kpi-sla', 'Semáforo ROJO');
      setText('kpi-sla-desc', 'Sin datos SLA');
      setText('hero-sla', 'SLA ROJO');
      setText('hero-sla-desc', 'Sin datos SLA');
      renderSlaSemaforo('red');
    }
  } else {
    renderSlaSemaforo('red');
  }

  // Fallback: si algún KPI quedó vacío, aplicar demo
  if (!nivelRes || !rangoRes || !sedentarismoRes || !tipoRes || !correlRes || !usaAppRes || !slaRes) {
    if (!document.getElementById('kpi-minutos')?.textContent || document.getElementById('kpi-minutos').textContent === '--') {
      applyDemoValues();
    }
  }
}

function renderChart(labels, data) {
  const ctx = document.getElementById('mainChart');
  if (!ctx) return;
  if (mainChart) mainChart.destroy();
  mainChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.length ? labels : ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
      datasets: [{
        label: 'Minutos promedio',
        data: data.length ? data : [32, 45, 38, 52, 48, 60, 55],
        borderColor: '#3ab795',
        backgroundColor: 'rgba(58, 183, 149, 0.08)',
        pointBackgroundColor: '#3ab795',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        tension: 0.38,
        fill: true,
        borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 3,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#ffffff',
          bodyColor: '#e2e8f0',
          padding: 12,
          displayColors: false,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#7b8ba8' }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#7b8ba8' }
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);