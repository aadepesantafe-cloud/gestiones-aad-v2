// ============================================================
// Gestiones AAD — lógica de la aplicación
// ============================================================

// ---- Altura real de pantalla (arregla el bug de 100vh en navegadores mobile,
//      donde la barra de direcciones aparece/desaparece y genera scroll fantasma) ----
function setRealViewportHeight() {
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}
setRealViewportHeight();
window.addEventListener('resize', setRealViewportHeight);
window.addEventListener('orientationchange', setRealViewportHeight);

// ---- Tipos de campo para generar el formulario automáticamente ----
const DATE_FIELDS = new Set([
  'fechaInicioExpte','fechaPedidoCompras','fechaActoAdmin',
  'fechaInicioReal','fechaFinContrato','fechaFinPlazoAmpliada'
]);
const NUMBER_FIELDS = new Set([
  'anio','plazoEntrega','cantidadesIIBB','presOficialUnitario','presupuestoOficialRubro',
  'adjudicadoUnitario','totalAdjudicado','ampliacionPlazo','cantidadProyectos','kmLineaPC',
  'cantTotalIIBBProyectados','proyectadosAcumulados','pctIIBBProyectados','certificadosAAD',
  'pctAvanceCertificacion','sumatoriaMultas','cantidadCertificadosProcesados'
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
// Campos con opciones dinámicas: se cargan a partir de los valores ya existentes en la base
// (evita errores de tipeo, obliga a elegir uno de los que ya existen).
const DYNAMIC_SELECT_FIELDS = new Set(['pospre']);
const LONG_FIELDS = new Set(['detalleRubro','observaciones']);

// ---- Campos calculados automáticamente: no se editan a mano ----
const DERIVED_FIELDS = new Set(['presupuestoOficialRubro','totalAdjudicado','fechaFinContrato','fechaFinPlazoAmpliada','pctAvanceCertificacion']);
// Campos "fuente" que, al cambiar, disparan el recálculo
const RECALC_TRIGGER_FIELDS = new Set(['cantidadesIIBB','presOficialUnitario','adjudicadoUnitario','fechaInicioReal','plazoEntrega','ampliacionPlazo','certificadosAAD']);

const FILTER_KEYS = ['pospre','expediente','anio','nroPedidoCompras','adjudicatario','sucursal','rubro','estado'];

// ---- Estado en memoria ----
const state = {
  session: null,      // { usuario, nombre, rol, clave }
  campos: [],
  etapas: [],
  registros: [],
  filtros: {},
  dashFiltros: { fechaPCDesde: '', fechaPCHasta: '' },
  riesgoPlazoActivo: false,
  editingId: null,
  activeStage: null
};

const DASH_FILTER_KEYS = ['anio','sucursal','rubro','pospre','nroPedidoCompras','adjudicatario','estado'];

// ============================================================
// API
// ============================================================
async function apiCall(action, payload) {
  const body = Object.assign({ action }, payload || {});
  if (state.session) {
    body.usuario = state.session.usuario;
    body.clave = state.session.clave;
  }
  let res;
  try {
    res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
      body: JSON.stringify(body)
    });
  } catch (networkErr) {
    throw new Error('No se pudo conectar con el servidor. Puede ser un corte de conexión momentáneo o que Google esté demorado — esperá unos segundos y volvé a intentar.');
  }
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

function setLoginStatus(state_, text) {
  const box = document.getElementById('loginStatus');
  const usuarioEl = document.getElementById('loginUsuario');
  const claveEl = document.getElementById('loginClave');
  box.dataset.state = state_;
  box.querySelector('.login-status-icon').textContent = state_ === 'ok' ? '✓' : (state_ === 'err' ? '✕' : '');
  box.querySelector('.login-status-text').textContent = text || '';
  box.classList.toggle('show', state_ !== 'idle');
  usuarioEl.classList.remove('input-ok', 'input-err');
  claveEl.classList.remove('input-ok', 'input-err');
  if (state_ === 'ok') { usuarioEl.classList.add('input-ok'); claveEl.classList.add('input-ok'); }
  if (state_ === 'err') { usuarioEl.classList.add('input-err'); claveEl.classList.add('input-err'); }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const clave = document.getElementById('loginClave').value;
  setLoginStatus('idle', '');
  try {
    const data = await apiCallLogin(usuario, clave);
    state.session = { usuario: data.user.usuario, nombre: data.user.nombre, rol: data.user.rol, clave };
    saveSession();
    setLoginStatus('ok', 'Ingreso correcto');
    setTimeout(() => boot(), 350); // deja ver el indicador verde un instante antes de entrar
  } catch (err) {
    setLoginStatus('err', err.message);
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
  recalcDerivedFields(); // completa los campos calculados con los valores ya cargados (modo edición)
}

// ---- Recalcula los campos derivados en vivo, a partir de los campos "fuente" del formulario ----
function getFormValue(name) {
  const el = document.querySelector('#stagePanels [name="' + name + '"]');
  return el ? el.value : '';
}
function setFormValue(name, value) {
  const el = document.querySelector('#stagePanels [name="' + name + '"]');
  if (el) el.value = value;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (parseInt(days) || 0));
  return d.toISOString().slice(0, 10);
}
function recalcDerivedFields() {
  const cantidad = parseFloat(getFormValue('cantidadesIIBB')) || 0;
  const presUnit = parseFloat(getFormValue('presOficialUnitario')) || 0;
  const adjUnit = parseFloat(getFormValue('adjudicadoUnitario')) || 0;

  const presOficial = cantidad * presUnit;
  const totalAdj = cantidad * adjUnit;
  setFormValue('presupuestoOficialRubro', presOficial ? presOficial.toFixed(2) : '');
  setFormValue('totalAdjudicado', totalAdj ? totalAdj.toFixed(2) : '');

  const fInicioReal = getFormValue('fechaInicioReal');
  const plazoEntrega = parseInt(getFormValue('plazoEntrega')) || 0;
  const ampliacion = parseInt(getFormValue('ampliacionPlazo')) || 0;
  if (fInicioReal) {
    setFormValue('fechaFinContrato', addDays(fInicioReal, plazoEntrega));
    setFormValue('fechaFinPlazoAmpliada', addDays(fInicioReal, plazoEntrega + ampliacion));
  }

  const certificado = parseFloat(getFormValue('certificadosAAD')) || 0;
  const pct = totalAdj > 0 ? (certificado / totalAdj) * 100 : 0;
  setFormValue('pctAvanceCertificacion', pct ? pct.toFixed(2) : '');

  // Aviso visual: un % de avance fuera de rango razonable casi siempre indica un dato mal
  // cargado en Cantidad/IIBB o $ Adjudicado Unitario (no un error de fórmula).
  const pctEl = document.querySelector('#stagePanels [name="pctAvanceCertificacion"]');
  if (pctEl) {
    const fueraDeRango = pct > 200 || pct < 0;
    pctEl.classList.toggle('valor-sospechoso', fueraDeRango);
    pctEl.title = fueraDeRango ? 'Este % parece incorrecto. Revisá Cantidad/IIBB y $ Adjudicado Unitario de este trámite.' : '';
  }
}
document.getElementById('stagePanels').addEventListener('input', (e) => {
  if (e.target.name && RECALC_TRIGGER_FIELDS.has(e.target.name)) {
    recalcDerivedFields();
  }
});

function buildFieldInput(f, record) {
  const label = document.createElement('label');
  if (LONG_FIELDS.has(f.key)) label.classList.add('span-2');
  const value = record[f.key] != null ? record[f.key] : '';
  const isDerived = DERIVED_FIELDS.has(f.key);
  const readonlyAttr = isDerived ? 'readonly tabindex="-1"' : '';

  let inputHtml;
  if (SELECT_FIELDS[f.key]) {
    const opts = ['<option value="">—</option>'].concat(
      SELECT_FIELDS[f.key].map(o => `<option value="${o}" ${value === o ? 'selected' : ''}>${o}</option>`)
    );
    inputHtml = `<select name="${f.key}">${opts.join('')}</select>`;
  } else if (DYNAMIC_SELECT_FIELDS.has(f.key)) {
    const existentes = uniqueValues(f.key);
    // Si el registro que se está editando tiene un valor que ya no está en la lista (caso raro), lo incluimos igual para no perderlo.
    if (value && !existentes.includes(value)) existentes.unshift(value);
    const opts = ['<option value="">— Elegí un ' + escapeHtml(f.label) + ' existente —</option>'].concat(
      existentes.map(o => `<option value="${escapeHtml(o)}" ${value === o ? 'selected' : ''}>${escapeHtml(o)}</option>`)
    );
    inputHtml = `<select name="${f.key}">${opts.join('')}</select>`;
  } else if (LONG_FIELDS.has(f.key)) {
    inputHtml = `<textarea name="${f.key}">${escapeHtml(value)}</textarea>`;
  } else if (DATE_FIELDS.has(f.key)) {
    inputHtml = `<input type="date" name="${f.key}" value="${escapeHtml(value)}" ${readonlyAttr} />`;
  } else if (NUMBER_FIELDS.has(f.key)) {
    inputHtml = `<input type="number" step="any" name="${f.key}" value="${escapeHtml(value)}" ${readonlyAttr} />`;
  } else {
    inputHtml = `<input type="text" name="${f.key}" value="${escapeHtml(value)}" ${readonlyAttr} />`;
  }
  label.innerHTML = `${f.label}${isDerived ? ' <span class="calc-badge">calculado</span>' : ''}${inputHtml}`;
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

// ---- Componente de selección múltiple por tildado (checkboxes) ----
function closeAllMultiselects(except) {
  document.querySelectorAll('.multiselect.open').forEach(ms => { if (ms !== except) ms.classList.remove('open'); });
}
document.addEventListener('click', () => closeAllMultiselects());

function msLabel(selected) {
  if (!selected || selected.length === 0) return 'Todos';
  if (selected.length === 1) return selected[0];
  return selected.length + ' seleccionados';
}

function getCheckedValues(el) {
  return Array.from(el.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
}

function renderMultiselect(el, options, selected, onChange) {
  const sel = new Set(selected || []);
  el.innerHTML =
    '<button type="button" class="ms-toggle"><span class="ms-toggle-label">' + escapeHtml(msLabel(selected)) + '</span><span class="ms-caret">▾</span></button>' +
    '<div class="ms-panel">' +
      (options.length > 6 ? '<input type="text" class="ms-search" placeholder="Buscar..." />' : '') +
      '<button type="button" class="ms-clear">Limpiar selección</button>' +
      '<div class="ms-options">' +
      (options.length
        ? options.map(o => '<label class="ms-option"><input type="checkbox" value="' + escapeHtml(o) + '" ' + (sel.has(o) ? 'checked' : '') + '/><span>' + escapeHtml(o) + '</span></label>').join('')
        : '<div class="ms-empty">Sin opciones</div>') +
      '</div>' +
    '</div>';

  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.ms-toggle')) {
        const willOpen = !el.classList.contains('open');
        closeAllMultiselects(el);
        el.classList.toggle('open', willOpen);
        const search = el.querySelector('.ms-search');
        if (willOpen && search) {
          search.value = '';
          filtrarOpcionesMultiselect(el, '');
          setTimeout(() => search.focus(), 0);
        }
      } else if (e.target.closest('.ms-clear')) {
        el.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
        const label = el.querySelector('.ms-toggle-label');
        if (label) label.textContent = 'Todos';
        el._msOnChange && el._msOnChange([]);
      }
    });
    el.addEventListener('input', (e) => {
      if (e.target.matches('.ms-search')) {
        filtrarOpcionesMultiselect(el, e.target.value);
      }
    });
    el.addEventListener('change', (e) => {
      if (e.target.matches('input[type=checkbox]')) {
        const checked = getCheckedValues(el);
        const label = el.querySelector('.ms-toggle-label');
        if (label) label.textContent = msLabel(checked);
        el._msOnChange && el._msOnChange(checked);
      }
    });
  }
  el._msOnChange = onChange; // siempre apunta al callback más reciente
}

// ---- Filtra visualmente las opciones de un multiselect según el texto buscado (sin tocar la selección) ----
function filtrarOpcionesMultiselect(el, query) {
  const q = query.trim().toLowerCase();
  el.querySelectorAll('.ms-option').forEach(opt => {
    const texto = opt.textContent.trim().toLowerCase();
    opt.style.display = (!q || texto.includes(q)) ? '' : 'none';
  });
}

function populateFilterOptions() {
  FILTER_KEYS.filter(k => k !== 'expediente').forEach(key => {
    const el = document.querySelector('#filtersBar [data-filter="' + key + '"]');
    if (!el) return;
    const opts = uniqueValues(key);
    state.filtros[key] = (state.filtros[key] || []).filter(v => opts.includes(v));
    renderMultiselect(el, opts, state.filtros[key], (vals) => {
      state.filtros[key] = vals;
      renderRegistros();
    });
  });

  DASH_FILTER_KEYS.forEach(key => {
    const el = document.querySelector('#dashFiltersBar [data-dashfilter="' + key + '"]');
    if (!el) return;
    const opts = uniqueValues(key);
    state.dashFiltros[key] = (state.dashFiltros[key] || []).filter(v => opts.includes(v));
    renderMultiselect(el, opts, state.dashFiltros[key], (vals) => {
      state.dashFiltros[key] = vals;
      renderDashboard();
    });
  });
}

document.querySelector('#filtersBar [data-filter="expediente"]').addEventListener('input', (e) => {
  state.filtros.expediente = e.target.value.trim();
  renderRegistros();
});
document.getElementById('clearFilters').addEventListener('click', () => {
  FILTER_KEYS.forEach(k => { state.filtros[k] = (k === 'expediente') ? '' : []; });
  const expEl = document.querySelector('#filtersBar [data-filter="expediente"]');
  if (expEl) expEl.value = '';
  populateFilterOptions();
  renderRegistros();
});

document.getElementById('dashClearFilters').addEventListener('click', () => {
  DASH_FILTER_KEYS.forEach(k => { state.dashFiltros[k] = []; });
  state.dashFiltros.fechaPCDesde = '';
  state.dashFiltros.fechaPCHasta = '';
  document.getElementById('dashFechaPCDesde').value = '';
  document.getElementById('dashFechaPCHasta').value = '';
  state.riesgoPlazoActivo = false;
  document.getElementById('riesgoPlazoBtn').classList.remove('active');
  populateFilterOptions();
  renderDashboard();
});

document.getElementById('dashFechaPCDesde').addEventListener('change', (e) => {
  state.dashFiltros.fechaPCDesde = e.target.value;
  renderDashboard();
});
document.getElementById('dashFechaPCHasta').addEventListener('change', (e) => {
  state.dashFiltros.fechaPCHasta = e.target.value;
  renderDashboard();
});
document.getElementById('riesgoPlazoBtn').addEventListener('click', () => {
  state.riesgoPlazoActivo = !state.riesgoPlazoActivo;
  document.getElementById('riesgoPlazoBtn').classList.toggle('active', state.riesgoPlazoActivo);
  renderDashboard();
});

// ---- Criterio de "Riesgo por Plazo": vencido o vence en <=30 días, y no está Finalizado ----
const DIAS_RIESGO = 30;
function esRiesgoPorPlazo(r) {
  if (r.estado === 'Finalizado') return false;
  const fechaLimite = r.fechaFinPlazoAmpliada || r.fechaFinContrato;
  if (!fechaLimite) return false;
  const dLimite = new Date(fechaLimite + 'T00:00:00');
  if (isNaN(dLimite.getTime())) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const diffDias = (dLimite - hoy) / (1000 * 60 * 60 * 24);
  return diffDias <= DIAS_RIESGO;
}

function filteredForDashboardBase() {
  let rows = applyFilters(state.registros, state.dashFiltros, DASH_FILTER_KEYS);
  const desde = state.dashFiltros.fechaPCDesde;
  const hasta = state.dashFiltros.fechaPCHasta;
  if (desde || hasta) {
    rows = rows.filter(r => {
      const v = r.fechaPedidoCompras;
      if (!v) return false;
      if (desde && v < desde) return false;
      if (hasta && v > hasta) return false;
      return true;
    });
  }
  return rows;
}

function filteredForDashboard() {
  const rows = filteredForDashboardBase();
  return state.riesgoPlazoActivo ? rows.filter(esRiesgoPorPlazo) : rows;
}

function applyFilters(rows, filtros, keys) {
  return rows.filter(r => {
    return keys.every(k => {
      const fval = filtros[k];
      if (k === 'expediente') {
        if (!fval) return true;
        return String(r.expediente || '').toLowerCase().includes(String(fval).toLowerCase());
      }
      if (!fval || !fval.length) return true; // sin selección = sin filtro
      const rval = String(r[k] || '').trim();
      return fval.includes(rval);
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
  { key: 'certificadosAAD', label: 'Certificado' },
  { key: 'pctAvance', label: '% Avance' },
  { key: 'estado', label: 'Estado' }
];

function renderRegistros() {
  const rows = filteredRecords();
  document.getElementById('resultsCount').textContent = rows.length + ' trámite(s) encontrados de ' + state.registros.length + ' totales.';
  const table = document.getElementById('recordsTable');
  const isAdmin = state.session && state.session.rol === 'admin';
  const thead = '<thead><tr>' + REGISTROS_COLS.map(c => `<th>${c.label}</th>`).join('') + '<th class="col-sticky">Acciones</th></tr></thead>';
  const tbody = '<tbody>' + rows.map(r => {
    const tds = REGISTROS_COLS.map(c => {
      if (c.key === 'estado') {
        const cls = r.estado && ['Adjudicado','Desierto','Relanzado','Finalizado'].includes(r.estado) ? 'state-' + r.estado : 'state-default';
        return `<td>${r.estado ? `<span class="state-pill ${cls}">${escapeHtml(r.estado)}</span>` : ''}</td>`;
      }
      if (c.key === 'presupuestoOficialRubro' || c.key === 'totalAdjudicado' || c.key === 'certificadosAAD') {
        return `<td>${formatMoney(r[c.key])}</td>`;
      }
      if (c.key === 'pctAvance') {
        const adj = num(r.totalAdjudicado);
        const avance = adj > 0 ? (num(r.certificadosAAD) / adj) * 100 : 0;
        return `<td>${avance.toFixed(1)}%</td>`;
      }
      return `<td>${escapeHtml(r[c.key] != null ? r[c.key] : '')}</td>`;
    }).join('');
    const acciones = `<td class="row-actions col-sticky">
        <button class="icon-btn" data-action="copiar" title="Copiar datos">📋</button>
        <button class="icon-btn" data-action="clonar" title="Clonar trámite">🧬</button>
        ${isAdmin ? '<button class="icon-btn danger" data-action="eliminar" title="Eliminar trámite">🗑️</button>' : ''}
      </td>`;
    return `<tr data-id="${r._id}">${tds}${acciones}</tr>`;
  }).join('') + '</tbody>';
  table.innerHTML = thead + tbody;
  setupScrollShadow(table.closest('.table-wrap'));

  table.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return; // los botones de acción no abren el formulario
      const rec = state.registros.find(r => r._id === tr.dataset.id);
      if (rec) openRecordForEdit(rec);
    });
  });

  table.querySelectorAll('.row-actions [data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tr = btn.closest('tr');
      const rec = state.registros.find(r => r._id === tr.dataset.id);
      if (!rec) return;
      if (btn.dataset.action === 'copiar') copiarTramite(rec, btn);
      if (btn.dataset.action === 'clonar') clonarTramite(rec);
      if (btn.dataset.action === 'eliminar') eliminarTramite(rec);
    });
  });
}

// ---- Oculta la sombra de "hay más contenido" cuando el scroll horizontal llega al final,
//      y sincroniza la barra de scroll duplicada de arriba con la tabla de abajo ----
function setupScrollShadow(wrap) {
  if (!wrap) return;
  function update() {
    const alFinal = wrap.scrollLeft + wrap.clientWidth >= wrap.scrollWidth - 2;
    wrap.classList.toggle('scrolled-end', alFinal || wrap.scrollWidth <= wrap.clientWidth);
  }
  update();
  if (!wrap.dataset.scrollWired) {
    wrap.dataset.scrollWired = '1';
    wrap.addEventListener('scroll', update);
    window.addEventListener('resize', update);
  }

  // Barra superior duplicada (solo aplica a la tabla de Registros, que es la que puede ser muy ancha)
  const topBar = document.getElementById('recordsScrollTop');
  const topInner = document.getElementById('recordsScrollTopInner');
  if (topBar && topInner && wrap.querySelector('#recordsTable')) {
    topInner.style.width = wrap.scrollWidth + 'px';
    if (!topBar.dataset.scrollWired) {
      topBar.dataset.scrollWired = '1';
      let syncing = false;
      topBar.addEventListener('scroll', () => {
        if (syncing) return; syncing = true;
        wrap.scrollLeft = topBar.scrollLeft;
        syncing = false;
      });
      wrap.addEventListener('scroll', () => {
        if (syncing) return; syncing = true;
        topBar.scrollLeft = wrap.scrollLeft;
        syncing = false;
      });
      window.addEventListener('resize', () => { topInner.style.width = wrap.scrollWidth + 'px'; });
    }
  }
}

// ---- Copiar: pasa un resumen del trámite al portapapeles ----
function copiarTramite(r, btn) {
  const resumen = [
    'Pospre: ' + (r.pospre || ''),
    'Expediente: ' + (r.expediente || ''),
    'Año: ' + (r.anio || ''),
    'Sucursal: ' + (r.sucursal || ''),
    'Rubro: ' + (r.rubro || ''),
    'N° Pedido de Compras: ' + (r.nroPedidoCompras || ''),
    'Contratista/Proveedor: ' + (r.adjudicatario || ''),
    'Estado: ' + (r.estado || ''),
    'Presupuesto Oficial: ' + formatMoney(r.presupuestoOficialRubro),
    'Total Adjudicado: ' + formatMoney(r.totalAdjudicado),
    'Total Certificado: ' + formatMoney(r.certificadosAAD),
  ].join('\n');

  navigator.clipboard.writeText(resumen).then(() => {
    const original = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = original; }, 1200);
  }).catch(() => {
    alert('No se pudo copiar. Tu navegador puede estar bloqueando el acceso al portapapeles.');
  });
}

// ---- Clonar: crea un trámite nuevo con los mismos datos ----
async function clonarTramite(r) {
  const confirmado = confirm('¿Clonar este trámite? Se va a crear un trámite nuevo con los mismos datos (podés editarlo después).');
  if (!confirmado) return;
  const datos = {};
  state.campos.forEach(f => { datos[f.key] = r[f.key]; });
  try {
    await apiCall('crear', { datos });
    const data = await apiCall('listar');
    state.registros = data.registros;
    populateFilterOptions();
    renderRegistros();
  } catch (err) {
    alert('Error al clonar: ' + err.message);
  }
}

// ---- Eliminar: borra el trámite (solo admin, lo valida también el backend) ----
async function eliminarTramite(r) {
  const confirmado = confirm('¿Eliminar definitivamente el trámite "' + (r.expediente || r.pospre || '') + '"? Esta acción no se puede deshacer.');
  if (!confirmado) return;
  try {
    await apiCall('eliminar', { id: r._id });
    const data = await apiCall('listar');
    state.registros = data.registros;
    populateFilterOptions();
    renderRegistros();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
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
let chartMontos, chartAdjCertSucursal, chartCertificacion, chartCertificacionPC;

document.getElementById('dashGroupBy').addEventListener('change', renderDashboard);

// Plugin de Chart.js "casero" para dibujar el valor sobre cada punto de la curva
const pointLabelPlugin = {
  id: 'pointLabelPlugin',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, i) => {
      if (dataset.type && dataset.type !== 'line') return; // solo dibuja sobre datasets de línea
      if (dataset.pointRadius === 0) return; // no dibujar sobre la línea de promedio (sin puntos)
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((point, index) => {
        const value = dataset.data[index];
        if (value == null) return;
        ctx.save();
        ctx.fillStyle = '#16202A';
        ctx.font = '600 11px "IBM Plex Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(value.toFixed(1) + '%', point.x, point.y - 12);
        ctx.restore();
      });
    });
  }
};

function semColor(pct) {
  return pct >= 75 ? '#16A34A' : (pct >= 40 ? '#D97706' : '#DC2626');
}
function truncateLabel(text, maxLen) {
  if (!text) return text;
  return text.length > maxLen ? text.slice(0, maxLen - 1).trim() + '…' : text;
}

function renderDashboard() {
  const groupKey = document.getElementById('dashGroupBy').value;
  const rows = filteredForDashboard();

  // ---- Badge de "Riesgo por Plazo": cuenta sobre el resto de los filtros, sin aplicar el toggle de riesgo ----
  const riesgoCount = filteredForDashboardBase().filter(esRiesgoPorPlazo).length;
  document.getElementById('riesgoPlazoBadge').textContent = riesgoCount;

  // ---- KPIs generales (montos en millones, 2 decimales) ----
  const totalPresOficial = sumField(rows, 'presupuestoOficialRubro');
  const totalAdjudicado = sumField(rows, 'totalAdjudicado');
  const totalCertificado = sumField(rows, 'certificadosAAD');
  const totalMultas = sumField(rows, 'sumatoriaMultas');
  const pctEjecucion = totalAdjudicado > 0 ? (totalCertificado / totalAdjudicado) * 100 : 0;
  const desvioPresupuestario = totalPresOficial > 0 ? ((totalAdjudicado - totalPresOficial) / totalPresOficial) * 100 : 0;
  // % de Avance por Certificación: misma fórmula que el campo calculado (Certificado / Adjudicado * 100),
  // aplicada sobre los totales del filtro actual — para que coincida con el dato individual, no un promedio aparte.
  const avanceCertificacion = totalAdjudicado > 0 ? (totalCertificado / totalAdjudicado) * 100 : 0;

  const kpiRow = document.getElementById('kpiRow');
  kpiRow.innerHTML = [
    kpiCard('Trámites (filtro actual)', rows.length, 'de ' + state.registros.length + ' totales'),
    kpiCard('Presupuesto oficial total', formatMillions(totalPresOficial), 'sin IVA'),
    kpiCard('Total adjudicado', formatMillions(totalAdjudicado), 'sin IVA'),
    kpiCard('Certificado por AAD', formatMillions(totalCertificado), 'IVA incluido'),
    kpiCard('% Ejecución', pctEjecucion.toFixed(1) + '%', 'certificado / adjudicado'),
    kpiCard('Desvío presupuestario', (desvioPresupuestario >= 0 ? '+' : '') + desvioPresupuestario.toFixed(1) + '%', desvioPresupuestario >= 0 ? 'por encima del oficial' : 'por debajo del oficial'),
    kpiCard('Multas acumuladas', formatMillions(totalMultas), 'IVA incluido'),
  ].join('');


  // ---- Gráfico 1: Presupuesto Oficial vs Adjudicado vs Certificado, por Sucursal ----
  // (siempre agrupado por Sucursal, respeta los filtros del dashboard incluido Pospre)
  const bySucursal = {};
  rows.forEach(r => {
    const key = (r.sucursal || '(sin sucursal)').toString().trim() || '(sin sucursal)';
    if (!bySucursal[key]) bySucursal[key] = { presOficial:0, adjudicado:0, certificado:0 };
    bySucursal[key].presOficial += num(r.presupuestoOficialRubro);
    bySucursal[key].adjudicado += num(r.totalAdjudicado);
    bySucursal[key].certificado += num(r.certificadosAAD);
  });
  const sucursalEntries = Object.entries(bySucursal).sort((a,b) => b[1].presOficial - a[1].presOficial);

  const ctx1 = document.getElementById('chartMontos').getContext('2d');
  if (chartMontos) chartMontos.destroy();
  chartMontos = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: sucursalEntries.map(e => e[0]),
      datasets: [
        { label: 'Presupuesto Oficial', data: sucursalEntries.map(e => e[1].presOficial / 1000000), backgroundColor: '#2563EB' },
        { label: 'Total Adjudicado', data: sucursalEntries.map(e => e[1].adjudicado / 1000000), backgroundColor: '#7C3AED' },
        { label: 'Certificado AAD', data: sucursalEntries.map(e => e[1].certificado / 1000000), backgroundColor: '#16A34A' }
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{ autoSkip:false, maxRotation:60, minRotation:30 } },
        y:{ beginAtZero:true, title:{ display:true, text:'Millones de $' } }
      },
      plugins:{
        legend:{ position:'bottom' },
        tooltip:{ callbacks:{ label: (ctx) => ctx.dataset.label + ': $ ' + ctx.parsed.y.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' M' } }
      }
    }
  });

  // ---- Combo: Adjudicado vs Certificado por Sucursal, con % de Avance (semáforo) ----
  const pctPorSucursal = sucursalEntries.map(e => e[1].adjudicado > 0 ? (e[1].certificado / e[1].adjudicado) * 100 : 0);
  const promedioAvanceSucursal = totalAdjudicado > 0 ? (totalCertificado / totalAdjudicado) * 100 : 0;

  const ctxAC = document.getElementById('chartAdjCertSucursal').getContext('2d');
  if (chartAdjCertSucursal) chartAdjCertSucursal.destroy();
  chartAdjCertSucursal = new Chart(ctxAC, {
    type: 'bar',
    data: {
      labels: sucursalEntries.map(e => e[0]),
      datasets: [
        { type:'bar', label:'Adjudicado', data: sucursalEntries.map(e => e[1].adjudicado / 1000000), backgroundColor:'#93C5FD', order:2 },
        { type:'bar', label:'Certificado', data: sucursalEntries.map(e => e[1].certificado / 1000000), backgroundColor:'#6EE7B7', order:2 },
        { type:'line', label:'% Avance por Sucursal', data: pctPorSucursal, yAxisID:'y1', borderColor:'#64748B', tension:0.3,
          pointRadius:5, pointBackgroundColor: pctPorSucursal.map(semColor), pointBorderColor: pctPorSucursal.map(semColor), order:1 },
        { type:'line', label:'Promedio General (' + promedioAvanceSucursal.toFixed(0) + '%)', data: sucursalEntries.map(() => promedioAvanceSucursal),
          yAxisID:'y1', borderColor:'#D97706', borderDash:[6,4], pointRadius:0, order:0 }
      ]
    },
    plugins: [pointLabelPlugin],
    options: {
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{ autoSkip:false, maxRotation:60, minRotation:30 } },
        y:{ beginAtZero:true, title:{ display:true, text:'Millones de $' } },
        y1:{ beginAtZero:true, max:130, position:'right', grid:{ drawOnChartArea:false }, title:{ display:true, text:'% Avance' } }
      },
      plugins:{ legend:{ position:'bottom' } }
    }
  });

  // ---- Gráfico 2: % de Certificación por Sucursal + Contratista (curva) ----
  const byCombo = {};
  rows.forEach(r => {
    if (!r.adjudicatario) return;
    const key = (r.sucursal || '(sin sucursal)').trim() + ' · ' + r.adjudicatario.trim();
    if (!byCombo[key]) byCombo[key] = { adjudicado:0, certificado:0 };
    byCombo[key].adjudicado += num(r.totalAdjudicado);
    byCombo[key].certificado += num(r.certificadosAAD);
  });
  const comboEntries = Object.entries(byCombo)
    .map(([k, v]) => [k, v.adjudicado > 0 ? (v.certificado / v.adjudicado) * 100 : 0])
    .sort((a,b) => b[1] - a[1])
    .slice(0, 15);

  const ctx4 = document.getElementById('chartCertificacion').getContext('2d');
  if (chartCertificacion) chartCertificacion.destroy();
  const comboNombresCompletos = comboEntries.map(e => e[0]);
  chartCertificacion = new Chart(ctx4, {
    type: 'line',
    data: {
      labels: comboEntries.map(e => truncateLabel(e[0], 22)),
      datasets: [{
        label: '% Certificación',
        data: comboEntries.map(e => e[1]),
        borderColor: '#0D9488',
        backgroundColor: '#0D9488',
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#0D9488'
      }]
    },
    plugins: [pointLabelPlugin],
    options: {
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{ autoSkip:false, maxRotation:60, minRotation:30, font:{ size:10 } } },
        y:{ beginAtZero:true, title:{ display:true, text:'% Certificación' } }
      },
      plugins:{
        legend:{ display:false },
        tooltip:{ callbacks:{ title: (items) => comboNombresCompletos[items[0].dataIndex] || '' } }
      }
    }
  });

  // ---- Gráfico 3: % de Certificación por Pedido de Compras (curva, otro color) ----
  const byPC = {};
  rows.forEach(r => {
    if (!r.nroPedidoCompras) return;
    const key = String(r.nroPedidoCompras).trim();
    if (!byPC[key]) byPC[key] = { adjudicado:0, certificado:0 };
    byPC[key].adjudicado += num(r.totalAdjudicado);
    byPC[key].certificado += num(r.certificadosAAD);
  });
  const pcEntries = Object.entries(byPC)
    .map(([k, v]) => [k, v.adjudicado > 0 ? (v.certificado / v.adjudicado) * 100 : 0])
    .sort((a,b) => b[1] - a[1])
    .slice(0, 15);

  const ctx5 = document.getElementById('chartCertificacionPC').getContext('2d');
  if (chartCertificacionPC) chartCertificacionPC.destroy();
  chartCertificacionPC = new Chart(ctx5, {
    type: 'line',
    data: {
      labels: pcEntries.map(e => e[0]),
      datasets: [{
        label: '% Certificación',
        data: pcEntries.map(e => e[1]),
        borderColor: '#D97706',
        backgroundColor: '#D97706',
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#D97706'
      }]
    },
    plugins: [pointLabelPlugin],
    options: {
      responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ ticks:{ autoSkip:false, maxRotation:60, minRotation:30, font:{ size:10 } } },
        y:{ beginAtZero:true, title:{ display:true, text:'% Certificación' } }
      },
      plugins:{ legend:{ display:false } }
    }
  });

  // ---- Resumen por Contratista (tarjetas con semáforo) ----
  renderContratistaResumen(rows);

  // ---- Tabla de detalle (según "Agrupar por") ----
  const groups = {};
  rows.forEach(r => {
    const key = (r[groupKey] || '(sin dato)').toString().trim() || '(sin dato)';
    if (!groups[key]) groups[key] = { n:0, presOficial:0, adjudicado:0, certificado:0 };
    groups[key].n++;
    groups[key].presOficial += num(r.presupuestoOficialRubro);
    groups[key].adjudicado += num(r.totalAdjudicado);
    groups[key].certificado += num(r.certificadosAAD);
  });
  const allEntries = Object.entries(groups).sort((a,b) => b[1].presOficial - a[1].presOficial);
  const entries = allEntries.slice(0, 12);
  const hayMasGrupos = allEntries.length > entries.length;

  // Totales sobre TODOS los grupos (no solo los 12 que se muestran), para que coincida con los KPIs de arriba
  const totalGeneral = allEntries.reduce((acc, [, v]) => {
    acc.n += v.n; acc.presOficial += v.presOficial; acc.adjudicado += v.adjudicado; acc.certificado += v.certificado;
    return acc;
  }, { n:0, presOficial:0, adjudicado:0, certificado:0 });
  const avanceGeneral = totalGeneral.adjudicado > 0 ? (totalGeneral.certificado / totalGeneral.adjudicado) * 100 : 0;

  const table = document.getElementById('dashTable');
  table.innerHTML = '<thead><tr><th>' + labelForGroup(groupKey) + '</th><th>Trámites</th><th>Pres. Oficial</th><th>Total Adjudicado</th><th>Certificado AAD</th><th>% de Avance</th></tr></thead>' +
    '<tbody>' + entries.map(([k, v]) => {
      const avanceGrupo = v.adjudicado > 0 ? (v.certificado / v.adjudicado) * 100 : 0;
      return `<tr><td>${escapeHtml(k)}</td><td>${v.n}</td><td>${formatMillions(v.presOficial)}</td><td>${formatMillions(v.adjudicado)}</td><td>${formatMillions(v.certificado)}</td><td>${avanceGrupo.toFixed(1)}%</td></tr>`;
    }).join('') +
    `<tr class="dash-table-total"><td>TOTAL${hayMasGrupos ? ' (' + allEntries.length + ' grupos)' : ''}</td><td>${totalGeneral.n}</td><td>${formatMillions(totalGeneral.presOficial)}</td><td>${formatMillions(totalGeneral.adjudicado)}</td><td>${formatMillions(totalGeneral.certificado)}</td><td>${avanceGeneral.toFixed(1)}%</td></tr>` +
    '</tbody>';

  const nota = document.getElementById('dashTableNota');
  if (nota) {
    nota.textContent = hayMasGrupos
      ? `Se muestran los 12 grupos con mayor Presupuesto Oficial, de ${allEntries.length} en total. La fila TOTAL suma los ${allEntries.length}, no solo los 12 visibles.`
      : '';
    nota.hidden = !hayMasGrupos;
  }
}

let contratistaMode = 'top10';

document.getElementById('contratistaTop10Btn').addEventListener('click', () => {
  contratistaMode = 'top10';
  toggleContratistaButtons();
  renderDashboard();
});
document.getElementById('contratistaTodosBtn').addEventListener('click', () => {
  contratistaMode = 'todos';
  toggleContratistaButtons();
  renderDashboard();
});
function toggleContratistaButtons() {
  document.getElementById('contratistaTop10Btn').classList.toggle('btn-toggle-active', contratistaMode === 'top10');
  document.getElementById('contratistaTodosBtn').classList.toggle('btn-toggle-active', contratistaMode === 'todos');
}

document.getElementById('printDashboardBtn').addEventListener('click', () => {
  document.getElementById('printDate').textContent = new Date().toLocaleString('es-AR');
  window.print();
});

function renderContratistaResumen(rows) {
  const byContratista = {};
  rows.forEach(r => {
    if (!r.adjudicatario) return;
    const key = r.adjudicatario.trim();
    if (!byContratista[key]) byContratista[key] = { adjudicado: 0, certificado: 0, n: 0 };
    byContratista[key].adjudicado += num(r.totalAdjudicado);
    byContratista[key].certificado += num(r.certificadosAAD);
    byContratista[key].n++;
  });

  const entries = Object.entries(byContratista).map(([nombre, v]) => ({
    nombre,
    adjudicado: v.adjudicado,
    certificado: v.certificado,
    n: v.n,
    pendiente: v.adjudicado - v.certificado,
    avance: v.adjudicado > 0 ? (v.certificado / v.adjudicado) * 100 : 0
  })).sort((a, b) => b.adjudicado - a.adjudicado);

  const shown = contratistaMode === 'top10' ? entries.slice(0, 10) : entries;

  const grid = document.getElementById('contratistaGrid');
  grid.innerHTML = shown.length ? shown.map((c, idx) => {
    const semaforo = c.avance >= 75 ? '🟢' : (c.avance >= 40 ? '🟡' : '🔴');
    const barColor = semColor(c.avance);
    return `<div class="contratista-card">
      <span class="semaforo">${semaforo}</span>
      <div class="rank">#${idx + 1}</div>
      <div class="name">${escapeHtml(c.nombre)}</div>
      <div class="row-line"><span>Adjudicado</span><b>${formatMillions(c.adjudicado)}</b></div>
      <div class="row-line"><span>Certificado</span><b>${formatMillions(c.certificado)}</b></div>
      <div class="avance-bar-wrap"><div class="avance-bar" style="width:${Math.min(c.avance,100)}%;background:${barColor}"></div></div>
      <div class="row-line"><span>Avance</span><b>${c.avance.toFixed(1)}%</b></div>
      <div class="row-line"><span>${c.n} contrato${c.n === 1 ? '' : 's'}</span><span>Pend: ${formatMillions(c.pendiente)}</span></div>
    </div>`;
  }).join('') : '<div class="empty-state">Sin contratistas para este filtro.</div>';
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
function formatMillions(v) {
  const n = num(v) / 1000000;
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' M';
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

// ---- Completar valores iniciales faltantes (una sola vez, base original) ----
// ---- Corrección de IVA (una sola vez, doble confirmación por ser una operación sensible) ----
document.getElementById('corregirIvaBtn').addEventListener('click', async () => {
  const msg = document.getElementById('corregirIvaMsg');
  msg.hidden = true;
  const c1 = confirm('Esto va a dividir por 1,21 los campos monetarios de TODOS los trámites (Pres. Oficial Unitario, Adjudicado Unitario, Km de Línea, Proyectados Acumulados, Certificados AAD y Multas), y va a recalcular Presupuesto Oficial, Total Adjudicado y % de Avance con esos valores corregidos.\n\n¿Ya hiciste una copia de seguridad del Google Sheet?');
  if (!c1) return;
  const c2 = confirm('Confirmación final: esta operación debe ejecutarse UNA SOLA VEZ. Si la corrés dos veces, va a dividir el IVA otra vez sobre datos que ya están corregidos.\n\n¿Confirmás que querés continuar ahora?');
  if (!c2) return;
  try {
    const r = await apiCall('corregir_iva');
    msg.textContent = 'Listo: se corrigieron ' + r.corregidos + ' trámites.';
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

document.getElementById('completarBtn').addEventListener('click', async () => {
  const msg = document.getElementById('completarMsg');
  msg.hidden = true;
  const confirmado = confirm('Esto va a completar Cantidades/IIBB, $ Pres. Oficial Unitario, $ Adjudicado Unitario y $ Total Adjudicado SOLO en los trámites donde esos 4 campos estén vacíos, usando el Presupuesto Oficial ya cargado. No modifica trámites que ya tengan esos datos. ¿Continuar?');
  if (!confirmado) return;
  try {
    const r = await apiCall('completar_valores_iniciales');
    msg.textContent = 'Listo: se completaron ' + r.completados + ' trámites.';
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

// ---- Recalcular campos derivados de todos los trámites existentes ----
document.getElementById('recalcBtn').addEventListener('click', async () => {
  const msg = document.getElementById('recalcMsg');
  msg.hidden = true;
  const confirmado = confirm('Esto va a recalcular Presupuesto Oficial, Total Adjudicado, Fechas de fin y % de Avance para TODOS los trámites cargados, sobrescribiendo esos valores. ¿Continuar?');
  if (!confirmado) return;
  try {
    const r = await apiCall('recalcular_todos');
    msg.textContent = 'Listo: se recalcularon ' + r.actualizados + ' trámites.';
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

// ============================================================
// UTILIDADES
// ============================================================
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[s]));
}
