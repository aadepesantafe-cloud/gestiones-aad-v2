// ============================================================
// Gestiones AAD — lógica de la aplicación
// ============================================================

// ---- Tipos de campo para generar el formulario automáticamente ----
const DATE_FIELDS = new Set([
  'fechaInicioExpte','fechaPedidoCompras','fechaActoAdmin',
  'fechaInicioReal','fechaFinContrato','fechaFinPlazoAmpliada'
]);
const NUMBER_FIELDS = new Set([
  'anio','plazoEntrega','cantidadesIIBB','presOficialUnitario','presupuestoOficialRubro',
  'adjudicadoUnitario','totalAdjudicado','ampliacionPlazo','cantidadProyectos','kmLineaPC',
  'cantTotalIIBBProyectados','proyectadosAcumulados','pctIIBBProyectados','certificadosAAD',
  'pctAvanceCertificacion','sumatoriaMultas'
]);
const CURRENCY_FIELDS = new Set([
  'presOficialUnitario','presupuestoOficialRubro','adjudicadoUnitario','totalAdjudicado',
  'kmLineaPC','proyectadosAcumulados','certificadosAAD','sumatoriaMultas'
]);
const SELECT_FIELDS = {
  previstoPlan: ['Si','No'],
  movilidadInspeccion: ['Si','No'],
  estado: ['Adjudicado','Desierto','Relanzado','Finalizado']
};
const LONG_FIELDS = new Set(['detalleRubro','observaciones']);

const FILTER_KEYS = ['pospre','expediente','anio','nroPedidoCompras','adjudicatario','sucursal','rubro','estado'];

// ---- Estado en memoria ----
const state = {
  session: null,      // { usuario, nombre, rol, clave }
  campos: [],
  etapas: [],
  registros: [],
  filtros: {},
  dashFiltros: {},
  editingId: null,
  activeStage: null
};

const DASH_FILTER_KEYS = ['anio','sucursal','rubro','pospre','estado'];

// ============================================================
// API
// ============================================================
async function apiCall(action, payload) {
  const body = Object.assign({ action }, payload || {});
  if (state.session) {
    body.usuario = state.session.usuario;
    body.clave = state.session.clave;
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error('Error de red (' + res.status + ')');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Error desconocido');
  return data;
}

// ============================================================
// SESIÓN
// ============================================================
function restoreSession() {
  const raw = sessionStorage.getItem('aad_session');
  if (raw) {
    try { state.session = JSON.parse(raw); } catch (e) { state.session = null; }
  }
}
function saveSession() {
  sessionStorage.setItem('aad_session', JSON.stringify(state.session));
}
function clearSession() {
  sessionStorage.removeItem('aad_session');
  state.session = null;
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const clave = document.getElementById('loginClave').value;
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;
  try {
    const data = await apiCallLogin(usuario, clave);
    state.session = { usuario: data.user.usuario, nombre: data.user.nombre, rol: data.user.rol, clave };
    saveSession();
    await boot();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

async function apiCallLogin(usuario, clave) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'login', usuario, clave })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'No se pudo iniciar sesión.');
  return data;
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  clearSession();
  location.reload();
});

// ---- Mostrar la contraseña momentáneamente mientras el mouse está sobre el botón ----
(function setupPasswordToggle() {
  const btn = document.getElementById('togglePass');
  const input = document.getElementById('loginClave');
  const eyeOpen = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');

  function reveal() {
    input.type = 'text';
    eyeOpen.hidden = true;
    eyeClosed.hidden = false;
  }
  function hide() {
    input.type = 'password';
    eyeOpen.hidden = false;
    eyeClosed.hidden = true;
  }

  btn.addEventListener('mouseenter', reveal);
  btn.addEventListener('mouseleave', hide);
  // Soporte táctil: mantener presionado para revelar
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); reveal(); });
  btn.addEventListener('touchend', hide);
  btn.addEventListener('touchcancel', hide);
  // Evita que el botón robe el foco del campo de contraseña
  btn.addEventListener('mousedown', (e) => e.preventDefault());
})();

// ============================================================
// NAVEGACIÓN
// ============================================================
document.getElementById('sidenav').addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  showView(btn.dataset.view);
});

function showView(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.hidden = (v.id !== 'view-' + name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'registros') renderRegistros();
  if (name === 'usuarios') renderUsuarios();
}

document.getElementById('formNewBtn').addEventListener('click', () => {
  state.editingId = null;
  document.getElementById('formTitle').textContent = 'Nuevo trámite';
  buildForm({});
});

// ============================================================
// ARRANQUE
// ============================================================
function showAppError(msg) {
  const box = document.getElementById('appError');
  box.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = '⚠ ' + msg;
  const btn = document.createElement('button');
  btn.textContent = 'Reintentar';
  btn.addEventListener('click', () => {
    hideAppError();
    boot().catch(err => showAppError(err.message));
  });
  box.appendChild(span);
  box.appendChild(btn);
  box.hidden = false;
  console.error('Gestiones AAD - error:', msg);
}
function hideAppError() {
  document.getElementById('appError').hidden = true;
}

async function boot() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('app').hidden = false;
  document.getElementById('userName').textContent = state.session.nombre + ' (' + state.session.rol + ')';
  document.getElementById('navUsuarios').hidden = state.session.rol !== 'admin';
  hideAppError();

  try {
    const data = await apiCall('listar');
    state.campos = data.campos;
    state.etapas = data.etapas;
    state.registros = data.registros;
    if (!state.registros.length) {
      showAppError('Conectado correctamente, pero la hoja "Gestiones Plan" no devolvió ninguna fila. Revisá que esa pestaña tenga tus datos y que su nombre sea exactamente "Gestiones Plan".');
    }
  } catch (err) {
    showAppError('No se pudieron cargar los datos: ' + err.message);
    return; // no seguimos si no hay datos
  }

  populateFilterOptions();
  buildForm({});
  showView('dashboard');
}

window.addEventListener('DOMContentLoaded', () => {
  restoreSession();
  if (state.session) {
    boot().catch(err => {
      alert('No se pudo restaurar la sesión: ' + err.message);
      clearSession();
      location.reload();
    });
  }
});

// ============================================================
// FORMULARIO (alta / edición por etapas)
// ============================================================
function fieldByKey(key) {
  return state.campos.find(f => f.key === key);
}
function stageColorVar(idx) {
  return 'var(--stage-' + (idx + 1) + ')';
}

function buildForm(record) {
  const lifeline = document.getElementById('lifeline');
  const panelsWrap = document.getElementById('stagePanels');
  lifeline.innerHTML = '';
  panelsWrap.innerHTML = '';

  const rubroVal = (record.rubro || '').toLowerCase();
  const isOM = rubroVal.includes('obra menor') || rubroVal === 'om';

  state.etapas.forEach((etapa, idx) => {
    const isProyectos = etapa.id === 'proyectos';
    const disabled = isProyectos && !isOM;

    // --- nodo del stepper ---
    const node = document.createElement('div');
    node.className = 'stage-node' + (disabled ? ' disabled' : '');
    node.style.setProperty('--stage-color', stageColorVar(idx));
    node.dataset.stage = etapa.id;
    node.innerHTML = `<div class="stage-line"></div><div class="stage-dot"></div><div class="stage-label">${etapa.label}</div>`;
    node.addEventListener('click', () => {
      if (disabled) return;
      setActiveStage(etapa.id);
    });
    lifeline.appendChild(node);

    // --- panel de campos ---
    const panel = document.createElement('div');
    panel.className = 'stage-panel';
    panel.id = 'panel-' + etapa.id;
    panel.hidden = idx !== 0;
    if (disabled) panel.hidden = true;

    const title = document.createElement('div');
    title.className = 'stage-panel-title';
    title.innerHTML = `<span class="dot" style="background:${stageColorVar(idx)}"></span> ${etapa.label}` +
      (isProyectos ? ' <span style="font-weight:400;color:var(--text-soft);font-size:12px;">(solo aplica a Obra Menor)</span>' : '');
    panel.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'field-grid';
    state.campos.filter(f => f.col >= etapa.from && f.col <= etapa.to).forEach(f => {
      grid.appendChild(buildFieldInput(f, record));
    });
    panel.appendChild(grid);
    panelsWrap.appendChild(panel);
  });

  // Si cambia el rubro dinámicamente, re-evaluar si Proyectos aplica
  const rubroInput = panelsWrap.querySelector('[name="rubro"]');
  if (rubroInput) {
    rubroInput.addEventListener('input', () => {
      const val = rubroInput.value.toLowerCase();
      const om = val.includes('obra menor') || val === 'om';
      const proyNode = lifeline.querySelector('[data-stage="proyectos"]');
      const proyPanel = document.getElementById('panel-proyectos');
      proyNode.classList.toggle('disabled', !om);
      if (!om) proyPanel.hidden = true;
    });
  }

  state.activeStage = state.etapas[0].id;
  setActiveStage(state.activeStage);
  document.getElementById('formMsg').hidden = true;
}

function buildFieldInput(f, record) {
  const label = document.createElement('label');
  if (LONG_FIELDS.has(f.key)) label.classList.add('span-2');
  const value = record[f.key] != null ? record[f.key] : '';

  let inputHtml;
  if (SELECT_FIELDS[f.key]) {
    const opts = ['<option value="">—</option>'].concat(
      SELECT_FIELDS[f.key].map(o => `<option value="${o}" ${value === o ? 'selected' : ''}>${o}</option>`)
    );
    inputHtml = `<select name="${f.key}">${opts.join('')}</select>`;
  } else if (LONG_FIELDS.has(f.key)) {
    inputHtml = `<textarea name="${f.key}">${escapeHtml(value)}</textarea>`;
  } else if (DATE_FIELDS.has(f.key)) {
    inputHtml = `<input type="date" name="${f.key}" value="${escapeHtml(value)}" />`;
  } else if (NUMBER_FIELDS.has(f.key)) {
    inputHtml = `<input type="number" step="any" name="${f.key}" value="${escapeHtml(value)}" />`;
  } else {
    inputHtml = `<input type="text" name="${f.key}" value="${escapeHtml(value)}" />`;
  }
  label.innerHTML = `${f.label}${inputHtml}`;
  return label;
}

function setActiveStage(stageId) {
  state.activeStage = stageId;
  document.querySelectorAll('.lifeline .stage-node').forEach(n => n.classList.toggle('active', n.dataset.stage === stageId));
  state.etapas.forEach(et => {
    const panel = document.getElementById('panel-' + et.id);
    const node = document.querySelector('.stage-node[data-stage="' + et.id + '"]');
    if (node.classList.contains('disabled')) { panel.hidden = true; return; }
    panel.hidden = et.id !== stageId;
  });
}

document.getElementById('recordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('formMsg');
  msg.hidden = true;
  const datos = {};
  document.querySelectorAll('#stagePanels [name]').forEach(input => {
    datos[input.name] = input.value;
  });
  try {
    if (state.editingId) {
      await apiCall('actualizar', { id: state.editingId, datos });
      msg.textContent = 'Trámite actualizado correctamente.';
    } else {
      const r = await apiCall('crear', { datos });
      state.editingId = r.id;
      msg.textContent = 'Trámite creado correctamente.';
    }
    msg.className = 'form-msg ok';
    msg.hidden = false;
    const data = await apiCall('listar');
    state.registros = data.registros;
    populateFilterOptions();
  } catch (err) {
    msg.textContent = 'Error: ' + err.message;
    msg.className = 'form-msg err';
    msg.hidden = false;
  }
});

function openRecordForEdit(record) {
  state.editingId = record._id;
  document.getElementById('formTitle').textContent = 'Editar trámite — ' + (record.expediente || record.pospre || '');
  buildForm(record);
  showView('formulario');
}

// ============================================================
// REGISTROS + FILTROS
// ============================================================
function uniqueValues(key) {
  const set = new Set();
  state.registros.forEach(r => { if (r[key]) set.add(String(r[key]).trim()); });
  return Array.from(set).sort();
}

function populateFilterOptions() {
  document.querySelectorAll('#filtersBar select[data-filter]').forEach(sel => {
    const key = sel.dataset.filter;
    const current = sel.value;
    const opts = uniqueValues(key);
    sel.innerHTML = '<option value="">Todos</option>' + opts.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (opts.includes(current)) sel.value = current;
  });
  document.querySelectorAll('#dashFiltersBar select[data-dashfilter]').forEach(sel => {
    const key = sel.dataset.dashfilter;
    const current = sel.value;
    const opts = uniqueValues(key);
    sel.innerHTML = '<option value="">Todos</option>' + opts.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (opts.includes(current)) sel.value = current;
  });
}

document.getElementById('dashFiltersBar').addEventListener('input', () => {
  DASH_FILTER_KEYS.forEach(k => {
    const el = document.querySelector('[data-dashfilter="' + k + '"]');
    state.dashFiltros[k] = el ? el.value.trim() : '';
  });
  renderDashboard();
});
document.getElementById('dashClearFilters').addEventListener('click', () => {
  state.dashFiltros = {};
  document.querySelectorAll('#dashFiltersBar [data-dashfilter]').forEach(el => el.value = '');
  renderDashboard();
});

function filteredForDashboard() {
  return applyFilters(state.registros, state.dashFiltros, DASH_FILTER_KEYS);
}

// ---- Determina la última etapa alcanzada por un trámite, según qué campos tiene cargados ----
function computeStageIndex(r) {
  const has = (k) => r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '';
  const rubroVal = (r.rubro || '').toLowerCase();
  const isOM = rubroVal.includes('obra menor') || rubroVal === 'om';

  if (has('sumatoriaMultas') || has('pctAvanceCertificacion') || has('certificadosAAD')) return 4; // Certificación
  if (isOM && (has('cantidadProyectos') || has('proyectadosAcumulados') || has('cantTotalIIBBProyectados'))) return 3; // Proyectos
  if (has('fechaActoAdmin') || has('fechaInicioReal') || has('fechaFinContrato')) return 2; // Ejecución
  if (has('nroPedidoCompras') || has('adjudicatario') || has('estado')) return 1; // Adjudicación
  return 0; // Lanzamiento
}

document.getElementById('filtersBar').addEventListener('input', () => {
  FILTER_KEYS.forEach(k => {
    const el = document.querySelector('[data-filter="' + k + '"]');
    state.filtros[k] = el ? el.value.trim() : '';
  });
  renderRegistros();
});
document.getElementById('clearFilters').addEventListener('click', () => {
  state.filtros = {};
  document.querySelectorAll('#filtersBar [data-filter]').forEach(el => el.value = '');
  renderRegistros();
});

function applyFilters(rows, filtros, keys) {
  return rows.filter(r => {
    return keys.every(k => {
      const fval = filtros[k];
      if (!fval) return true;
      const rval = String(r[k] || '').toLowerCase();
      if (k === 'expediente') return rval.includes(fval.toLowerCase());
      return rval === String(fval).toLowerCase();
    });
  });
}

function filteredRecords() {
  return applyFilters(state.registros, state.filtros, FILTER_KEYS);
}

const REGISTROS_COLS = [
  { key: 'pospre', label: 'Pospre' },
  { key: 'expediente', label: 'Expediente' },
  { key: 'anio', label: 'Año' },
  { key: 'sucursal', label: 'Sucursal' },
  { key: 'rubro', label: 'Rubro' },
  { key: 'nroPedidoCompras', label: 'Pedido Compras' },
  { key: 'adjudicatario', label: 'Contratista' },
  { key: 'presupuestoOficialRubro', label: 'Pres. Oficial' },
  { key: 'totalAdjudicado', label: 'Total Adjudicado' },
  { key: 'estado', label: 'Estado' }
];

function renderRegistros() {
  const rows = filteredRecords();
  document.getElementById('resultsCount').textContent = rows.length + ' trámite(s) encontrados de ' + state.registros.length + ' totales.';
  const table = document.getElementById('recordsTable');
  const thead = '<thead><tr>' + REGISTROS_COLS.map(c => `<th>${c.label}</th>`).join('') + '</tr></thead>';
  const tbody = '<tbody>' + rows.map(r => {
    const tds = REGISTROS_COLS.map(c => {
      if (c.key === 'estado') {
        const cls = r.estado && ['Adjudicado','Desierto','Relanzado','Finalizado'].includes(r.estado) ? 'state-' + r.estado : 'state-default';
        return `<td>${r.estado ? `<span class="state-pill ${cls}">${escapeHtml(r.estado)}</span>` : ''}</td>`;
      }
      if (c.key === 'presupuestoOficialRubro' || c.key === 'totalAdjudicado') {
        return `<td>${formatMoney(r[c.key])}</td>`;
      }
      return `<td>${escapeHtml(r[c.key] != null ? r[c.key] : '')}</td>`;
    }).join('');
    return `<tr data-id="${r._id}">${tds}</tr>`;
  }).join('') + '</tbody>';
  table.innerHTML = thead + tbody;
  table.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const rec = state.registros.find(r => r._id === tr.dataset.id);
      if (rec) openRecordForEdit(rec);
    });
  });
}

document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = filteredRecords();
  if (!rows.length) { alert('No hay trámites para exportar con los filtros actuales.'); return; }
  const data = rows.map(r => {
    const obj = {};
    state.campos.forEach(f => { obj[f.label] = r[f.key]; });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vida de Trámites');
  XLSX.writeFile(wb, 'gestiones_aad_export.xlsx');
});

// ============================================================
// DASHBOARD
// ============================================================
let chartMontos, chartEstados, chartEtapas;

document.getElementById('dashGroupBy').addEventListener('change', renderDashboard);

function renderDashboard() {
  const groupKey = document.getElementById('dashGroupBy').value;
  const rows = filteredForDashboard();

  // KPIs generales
  const totalPresOficial = sumField(rows, 'presupuestoOficialRubro');
  const totalAdjudicado = sumField(rows, 'totalAdjudicado');
  const totalCertificado = sumField(rows, 'certificadosAAD');
  const totalMultas = sumField(rows, 'sumatoriaMultas');
  const pctEjecucion = totalPresOficial > 0 ? (totalAdjudicado / totalPresOficial) * 100 : 0;
  const desvioPresupuestario = totalPresOficial > 0 ? ((totalAdjudicado - totalPresOficial) / totalPresOficial) * 100 : 0;
  const avanceCertVals = rows.map(r => num(r.pctAvanceCertificacion)).filter(v => v > 0);
  const avanceCertProm = avanceCertVals.length ? (avanceCertVals.reduce((a,b) => a+b, 0) / avanceCertVals.length) : 0;

  const kpiRow = document.getElementById('kpiRow');
  kpiRow.innerHTML = [
    kpiCard('Trámites (filtro actual)', rows.length, 'de ' + state.registros.length + ' totales'),
    kpiCard('Presupuesto oficial total', formatMoney(totalPresOficial), 'sin IVA'),
    kpiCard('Total adjudicado', formatMoney(totalAdjudicado), 'sin IVA'),
    kpiCard('Certificado por AAD', formatMoney(totalCertificado), 'IVA incluido'),
    kpiCard('% Ejecución', pctEjecucion.toFixed(1) + '%', 'adjudicado / presupuesto oficial'),
    kpiCard('Desvío presupuestario', (desvioPresupuestario >= 0 ? '+' : '') + desvioPresupuestario.toFixed(1) + '%', desvioPresupuestario >= 0 ? 'por encima del oficial' : 'por debajo del oficial'),
    kpiCard('Multas acumuladas', formatMoney(totalMultas), 'IVA incluido'),
    kpiCard('Avance de certificación', avanceCertProm.toFixed(1) + '%', 'promedio sobre trámites con dato'),
  ].join('');

  // ---- Gráfico de avance por etapa ----
  const stageCounts = [0,0,0,0,0];
  rows.forEach(r => { stageCounts[computeStageIndex(r)]++; });
  const stageLabels = state.etapas.map(e => e.label);
  const stageColors = ['#2563EB','#7C3AED','#D97706','#0D9488','#16A34A'];
  const ctx3 = document.getElementById('chartEtapas').getContext('2d');
  if (chartEtapas) chartEtapas.destroy();
  chartEtapas = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: stageLabels,
      datasets: [{ label: 'Trámites', data: stageCounts, backgroundColor: stageColors }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });

  // Agrupación
  const groups = {};
  rows.forEach(r => {
    const key = (r[groupKey] || '(sin dato)').toString().trim() || '(sin dato)';
    if (!groups[key]) groups[key] = { n:0, presOficial:0, adjudicado:0, certificado:0 };
    groups[key].n++;
    groups[key].presOficial += num(r.presupuestoOficialRubro);
    groups[key].adjudicado += num(r.totalAdjudicado);
    groups[key].certificado += num(r.certificadosAAD);
  });
  const entries = Object.entries(groups).sort((a,b) => b[1].presOficial - a[1].presOficial).slice(0, 12);

  // Chart de montos por grupo
  const ctx1 = document.getElementById('chartMontos').getContext('2d');
  if (chartMontos) chartMontos.destroy();
  chartMontos = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [
        { label: 'Presupuesto Oficial', data: entries.map(e => e[1].presOficial), backgroundColor: '#2563EB' },
        { label: 'Total Adjudicado', data: entries.map(e => e[1].adjudicado), backgroundColor: '#7C3AED' },
        { label: 'Certificado AAD', data: entries.map(e => e[1].certificado), backgroundColor: '#16A34A' }
      ]
    },
    options: {
      responsive:true,
      scales:{ x:{ ticks:{ autoSkip:false, maxRotation:60, minRotation:30 } }, y:{ beginAtZero:true } },
      plugins:{ legend:{ position:'bottom' } }
    }
  });

  // Chart de estados
  const estadoCounts = {};
  rows.forEach(r => {
    const e = (r.estado || 'Sin estado').trim() || 'Sin estado';
    estadoCounts[e] = (estadoCounts[e] || 0) + 1;
  });
  const ctx2 = document.getElementById('chartEstados').getContext('2d');
  if (chartEstados) chartEstados.destroy();
  chartEstados = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: Object.keys(estadoCounts),
      datasets: [{ data: Object.values(estadoCounts), backgroundColor: ['#16A34A','#DC2626','#D97706','#3730A3','#94A3B8','#0D9488'] }]
    },
    options: { responsive:true, plugins:{ legend:{ position:'bottom' } } }
  });

  // Tabla de detalle
  const table = document.getElementById('dashTable');
  table.innerHTML = '<thead><tr><th>' + labelForGroup(groupKey) + '</th><th>Trámites</th><th>Pres. Oficial</th><th>Total Adjudicado</th><th>Certificado AAD</th></tr></thead>' +
    '<tbody>' + entries.map(([k, v]) =>
      `<tr><td>${escapeHtml(k)}</td><td>${v.n}</td><td>${formatMoney(v.presOficial)}</td><td>${formatMoney(v.adjudicado)}</td><td>${formatMoney(v.certificado)}</td></tr>`
    ).join('') + '</tbody>';
}

function labelForGroup(key) {
  return { sucursal:'Sucursal', pospre:'PosPre', nroPedidoCompras:'Pedido de Compras', adjudicatario:'Contratista/Proveedor' }[key] || key;
}
function kpiCard(label, value, sub) {
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}
function sumField(rows, key) { return rows.reduce((acc, r) => acc + num(r[key]), 0); }
function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function formatMoney(v) {
  const n = num(v);
  return '$ ' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}

// ============================================================
// USUARIOS (admin)
// ============================================================
async function renderUsuarios() {
  if (state.session.rol !== 'admin') return;
  const data = await apiCall('usuarios_listar');
  const table = document.getElementById('usersTable');
  table.innerHTML = '<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th></tr></thead><tbody>' +
    data.usuarios.map(u => `<tr><td>${escapeHtml(u.usuario)}</td><td>${escapeHtml(u.nombre)}</td><td>${escapeHtml(u.rol)}</td></tr>`).join('') +
    '</tbody>';
}

document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('userMsg');
  msg.hidden = true;
  try {
    await apiCall('usuarios_crear', {
      usuario_nuevo: document.getElementById('newUsuario').value.trim(),
      nombre_nuevo: document.getElementById('newNombre').value.trim(),
      clave_nueva: document.getElementById('newClave').value,
      rol_nuevo: document.getElementById('newRol').value
    });
    msg.textContent = 'Usuario creado correctamente.';
    msg.className = 'form-msg ok';
    msg.hidden = false;
    document.getElementById('userForm').reset();
    renderUsuarios();
  } catch (err) {
    msg.textContent = 'Error: ' + err.message;
    msg.className = 'form-msg err';
    msg.hidden = false;
  }
});

// ============================================================
// UTILIDADES
// ============================================================
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[s]));
}
