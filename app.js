'use strict';

/* ==========================================================
   Configuração Supabase
   ========================================================== */
const SUPABASE_URL = 'https://eknugasbqkxqktdfytca.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrbnVnYXNicWt4cWt0ZGZ5dGNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzAzODYsImV4cCI6MjEwNTUwNjM4Nn0.VJhVD4h_Re5QKTT4XHCDYEy24epM-rj3OkoSTwwjva4';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const downloadsReady = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads')
  : Promise.resolve(null);

/* ==========================================================
   Estado
   ========================================================== */
const state = {
  session: null,
  employees: [],
  purchases: [],
  currentView: 'funcionarios',
  currentLancamentoDate: null,
  currentLancamentoMonthInput: null,
  currentEntryMap: new Map(),
  currentComprasMap: new Map(),
};
let appBootstrapped = false;
let currentExportRows = [];
let importState = { headers: [], rows: [], mapping: [] };

/* ==========================================================
   Helpers genéricos
   ========================================================== */
function pad2(n) { return String(n).padStart(2, '0'); }

function currentMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function monthInputToDate(v) { return v ? `${v}-01` : null; }
function dateToMonthInput(d) { return d ? d.slice(0, 7) : ''; }
function addMonths(monthInputValue, n) {
  const [y, m] = monthInputValue.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}
function formatCompetenciaLabel(dateStr) {
  if (!dateStr) return '';
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function formatBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function parseBRNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return raw;
  let s = String(raw).trim();
  if (!s) return 0;
  s = s.replace(/[^\d,.\-]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function parseBRBoolean(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'boolean') return raw;
  const s = normalize(raw);
  return ['sim', 's', 'true', '1', 'x', 'yes', 'optante'].includes(s);
}
function excelSerialOrStringToISODate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) return toISODate(raw);
  if (typeof raw === 'number') {
    const utcDays = raw - 25569;
    const date = new Date(utcDays * 86400 * 1000);
    return toISODate(date);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${pad2(+mo)}-${pad2(+d)}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  return null;
}
function numVal(id) { return parseFloat(document.getElementById(id).value) || 0; }
function setVal(id, value, fallback) { document.getElementById(id).value = (value ?? fallback ?? 0); }

function showToast(message, isError) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('toast-error', !!isError);
  el.classList.toggle('toast-success', !isError);
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.hidden = true; }, 3500);
}

function openModal(id) {
  // enforce a single-modal-at-a-time invariant: never let two backdrops be
  // visible simultaneously (stacked full-screen overlays look broken).
  document.querySelectorAll('.modal-backdrop').forEach((m) => { m.hidden = (m.id !== id); });
  document.getElementById(id).hidden = false;
}
function closeModal(id) { document.getElementById(id).hidden = true; }

document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => { btn.closest('.modal-backdrop').hidden = true; });
});
document.querySelectorAll('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.hidden = true; });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop:not([hidden])').forEach((m) => { m.hidden = true; });
  }
});

function handleDownloadError(err) {
  const code = err && err.code;
  if (code === 'declined') return;
  if (code === 'rate_limited') { showToast('Aguarde um instante e tente novamente.', true); return; }
  showToast('Não foi possível salvar o arquivo agora.', true);
}

/* ==========================================================
   Autenticação
   ========================================================== */
function showLoginForm(which) {
  document.getElementById('screen-app').hidden = true;
  document.getElementById('screen-login').hidden = false;
  document.getElementById('form-login').hidden = which !== 'login';
  document.getElementById('form-forgot').hidden = which !== 'forgot';
  document.getElementById('form-set-password').hidden = which !== 'set-password';
}

function handleAuthEvent(event, session) {
  state.session = session;
  if (event === 'PASSWORD_RECOVERY') {
    showLoginForm('set-password');
    return;
  }
  if (session && session.user) {
    document.getElementById('user-email').textContent = session.user.email || '';
    document.getElementById('screen-login').hidden = true;
    document.getElementById('screen-app').hidden = false;
    if (!appBootstrapped) {
      appBootstrapped = true;
      bootstrapApp();
    }
  } else {
    appBootstrapped = false;
    showLoginForm('login');
  }
}

function initAuth() {
  // onAuthStateChange must be registered before any await on the client
  // (e.g. getSession()): Supabase notifies a one-shot PASSWORD_RECOVERY
  // event while parsing a recovery link from the URL during client init,
  // and it also fires an initial event with the current session (or null)
  // as soon as it is subscribed — so this alone covers first load too.
  sb.auth.onAuthStateChange((event, session) => handleAuthEvent(event, session));
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('btn-login');
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Entrando…';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.textContent = originalLabel;
  if (error) {
    errEl.textContent = 'E-mail ou senha inválidos.';
    errEl.hidden = false;
  }
});

document.getElementById('btn-show-forgot').addEventListener('click', () => showLoginForm('forgot'));
document.getElementById('btn-back-login').addEventListener('click', () => showLoginForm('login'));

document.getElementById('form-forgot').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value.trim();
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  const msg = document.getElementById('forgot-message');
  msg.hidden = false;
  msg.textContent = error ? error.message : 'Se este e-mail estiver cadastrado, você receberá um link em instantes.';
});

document.getElementById('form-set-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = document.getElementById('new-password').value;
  const p2 = document.getElementById('new-password-confirm').value;
  const errEl = document.getElementById('set-password-error');
  errEl.hidden = true;
  if (p1.length < 6) { errEl.textContent = 'A senha deve ter pelo menos 6 caracteres.'; errEl.hidden = false; return; }
  if (p1 !== p2) { errEl.textContent = 'As senhas não conferem.'; errEl.hidden = false; return; }
  const { error } = await sb.auth.updateUser({ password: p1 });
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  history.replaceState(null, '', window.location.pathname);
  showToast('Senha definida com sucesso.');
  const { data: { session } } = await sb.auth.getSession();
  handleAuthEvent('SIGNED_IN', session);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await sb.auth.signOut();
});

/* ==========================================================
   Navegação
   ========================================================== */
const VIEW_TITLES = {
  funcionarios: 'Funcionários',
  lancamentos: 'Lançamentos mensais',
  compras: 'Compras parceladas',
  exportar: 'Exportar',
};

function switchView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('topbar-title').textContent = VIEW_TITLES[name] || '';
  document.querySelector('.sidebar').classList.remove('open');
  if (name === 'lancamentos') loadLancamentos();
  if (name === 'compras') loadPurchases();
  if (name === 'exportar') loadExportPreview();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.getElementById('btn-mobile-nav').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

async function bootstrapApp() {
  document.getElementById('competencia-lancamentos').value = currentMonthInput();
  document.getElementById('competencia-exportar').value = currentMonthInput();
  await loadEmployees();
  switchView('funcionarios');
}

/* ==========================================================
   Funcionários
   ========================================================== */
async function loadEmployees() {
  const { data, error } = await sb.from('employees').select('*').order('full_name');
  if (error) { showToast(error.message, true); return; }
  state.employees = data || [];
  renderEmployees();
  refreshEmployeeSelects();
}

function renderEmployees() {
  const q = normalize(document.getElementById('employee-search').value);
  const tbody = document.getElementById('tbody-employees');
  const list = state.employees.filter((e) => !q || normalize(e.full_name).includes(q));
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Nenhum funcionário encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((e) => `
    <tr>
      <td>${escapeHTML(e.full_name)}</td>
      <td>${escapeHTML(e.registration_number || '—')}</td>
      <td>${escapeHTML(e.company || '—')}</td>
      <td>${escapeHTML(e.role || '—')}</td>
      <td class="num">${formatBRL(e.base_salary)}</td>
      <td>${e.transporte_optante ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td>${e.sindical_optante ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td class="num">${formatBRL(e.health_plan_fixed_value)}</td>
      <td>${e.active ? '<span class="chip chip-success">Ativo</span>' : '<span class="chip chip-muted">Inativo</span>'}</td>
      <td class="row-actions"><button class="btn btn-ghost btn-edit-employee" data-id="${e.id}" type="button">Editar</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit-employee').forEach((btn) => {
    btn.addEventListener('click', () => openEmployeeModal(btn.dataset.id));
  });
}

function refreshEmployeeSelects() {
  const activeOptions = state.employees.filter((e) => e.active)
    .map((e) => `<option value="${e.id}">${escapeHTML(e.full_name)}</option>`).join('');
  document.getElementById('purchase-employee').innerHTML = `<option value="">Selecione…</option>${activeOptions}`;

  const allOptions = state.employees
    .map((e) => `<option value="${e.id}">${escapeHTML(e.full_name)}</option>`).join('');
  document.getElementById('compras-filtro-funcionario').innerHTML = `<option value="">Todos os funcionários</option>${allOptions}`;
}

document.getElementById('employee-search').addEventListener('input', renderEmployees);
document.getElementById('btn-new-employee').addEventListener('click', () => openEmployeeModal(null));

function openEmployeeModal(id) {
  const form = document.getElementById('form-employee');
  form.reset();
  document.getElementById('employee-form-error').hidden = true;
  document.getElementById('employee-id').value = id || '';
  document.getElementById('employee-active').checked = true;
  const isEdit = !!id;
  document.getElementById('modal-employee-title').textContent = isEdit ? 'Editar funcionário' : 'Novo funcionário';
  document.getElementById('btn-delete-employee').hidden = !isEdit;
  document.getElementById('btn-inactivate-employee').hidden = !isEdit;
  if (isEdit) {
    const emp = state.employees.find((e) => e.id === id);
    if (!emp) return;
    document.getElementById('employee-full-name').value = emp.full_name || '';
    document.getElementById('employee-registration').value = emp.registration_number || '';
    document.getElementById('employee-company').value = emp.company || '';
    document.getElementById('employee-role').value = emp.role || '';
    document.getElementById('employee-department').value = emp.department || '';
    document.getElementById('employee-admission').value = emp.admission_date || '';
    document.getElementById('employee-salary').value = emp.base_salary ?? '';
    document.getElementById('employee-transporte').checked = !!emp.transporte_optante;
    document.getElementById('employee-sindical').checked = !!emp.sindical_optante;
    document.getElementById('employee-health-fixed').value = emp.health_plan_fixed_value ?? '';
    document.getElementById('employee-active').checked = !!emp.active;
    document.getElementById('employee-notes').value = emp.notes || '';
    document.getElementById('btn-inactivate-employee').textContent = emp.active ? 'Inativar' : 'Reativar';
  }
  openModal('modal-employee');
}

document.getElementById('form-employee').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('employee-id').value;
  const payload = {
    full_name: document.getElementById('employee-full-name').value.trim(),
    registration_number: document.getElementById('employee-registration').value.trim() || null,
    company: document.getElementById('employee-company').value.trim() || null,
    role: document.getElementById('employee-role').value.trim() || null,
    department: document.getElementById('employee-department').value.trim() || null,
    admission_date: document.getElementById('employee-admission').value || null,
    base_salary: parseFloat(document.getElementById('employee-salary').value) || 0,
    transporte_optante: document.getElementById('employee-transporte').checked,
    sindical_optante: document.getElementById('employee-sindical').checked,
    health_plan_fixed_value: parseFloat(document.getElementById('employee-health-fixed').value) || 0,
    active: document.getElementById('employee-active').checked,
    notes: document.getElementById('employee-notes').value.trim() || null,
  };
  const errEl = document.getElementById('employee-form-error');
  if (!payload.full_name) { errEl.textContent = 'Informe o nome.'; errEl.hidden = false; return; }
  let error;
  if (id) {
    ({ error } = await sb.from('employees').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('employees').insert(payload));
  }
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  closeModal('modal-employee');
  showToast('Funcionário salvo.');
  await loadEmployees();
});

document.getElementById('btn-inactivate-employee').addEventListener('click', async () => {
  const id = document.getElementById('employee-id').value;
  const emp = state.employees.find((e) => e.id === id);
  if (!emp) return;
  const { error } = await sb.from('employees').update({ active: !emp.active }).eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-employee');
  showToast(emp.active ? 'Funcionário inativado.' : 'Funcionário reativado.');
  await loadEmployees();
});

document.getElementById('btn-delete-employee').addEventListener('click', async () => {
  const id = document.getElementById('employee-id').value;
  if (!id) return;
  const { count: entryCount } = await sb.from('monthly_entries').select('id', { count: 'exact', head: true }).eq('employee_id', id);
  const { count: purchaseCount } = await sb.from('purchases').select('id', { count: 'exact', head: true }).eq('employee_id', id);
  if ((entryCount || 0) > 0 || (purchaseCount || 0) > 0) {
    showToast('Este funcionário já tem lançamentos ou compras — inative-o em vez de excluir.', true);
    return;
  }
  if (!confirm('Excluir definitivamente este funcionário?')) return;
  const { error } = await sb.from('employees').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-employee');
  showToast('Funcionário excluído.');
  await loadEmployees();
});

/* ---------- Importação de planilha ---------- */
const MAPPING_GUESSES = [
  { field: 'full_name', keywords: ['nome', 'funcionario', 'colaborador'] },
  { field: 'registration_number', keywords: ['matricula', 'registro', 'codigo'] },
  { field: 'role', keywords: ['cargo', 'funcao'] },
  { field: 'department', keywords: ['setor', 'departamento', 'area'] },
  { field: 'admission_date', keywords: ['admissao', 'contratacao'] },
  { field: 'base_salary', keywords: ['salario'] },
  { field: 'transporte_optante', keywords: ['vt', 'transporte'] },
  { field: 'sindical_optante', keywords: ['sindical', 'sindicato'] },
  { field: 'health_plan_fixed_value', keywords: ['saude', 'plano de saude'] },
];
function guessField(header) {
  const h = normalize(header);
  for (const g of MAPPING_GUESSES) {
    if (g.keywords.some((k) => h.includes(k))) return g.field;
  }
  return '';
}
const MAPPING_FIELDS = [
  { value: '', label: 'Ignorar' },
  { value: 'full_name', label: 'Nome (obrigatório)' },
  { value: 'registration_number', label: 'Matrícula' },
  { value: 'role', label: 'Cargo' },
  { value: 'department', label: 'Setor' },
  { value: 'admission_date', label: 'Data de admissão' },
  { value: 'base_salary', label: 'Salário base' },
  { value: 'transporte_optante', label: 'Optante VT (Sim/Não)' },
  { value: 'sindical_optante', label: 'Optante sindical (Sim/Não)' },
  { value: 'health_plan_fixed_value', label: 'Plano de saúde (valor fixo)' },
];

document.getElementById('btn-import-employees').addEventListener('click', () => {
  importState = { headers: [], rows: [], mapping: [] };
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-step-file').hidden = false;
  document.getElementById('import-step-mapping').hidden = true;
  document.getElementById('import-step-result').hidden = true;
  document.getElementById('btn-confirm-import').hidden = true;
  document.getElementById('import-error').hidden = true;
  openModal('modal-import');
});

document.getElementById('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  } catch (err) {
    showToast('Não foi possível ler o arquivo.', true);
    return;
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rows.length) { showToast('Planilha vazia.', true); return; }
  const headers = rows[0].map((h) => String(h || '').trim());
  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

  importState.headers = headers;
  importState.rows = dataRows;
  importState.mapping = headers.map((h) => guessField(h));

  renderImportMapping();
  document.getElementById('import-step-mapping').hidden = false;
  document.getElementById('btn-confirm-import').hidden = false;
  document.getElementById('import-row-count').textContent = `${dataRows.length} linha(s) encontradas.`;
});

function renderImportMapping() {
  const tbody = document.getElementById('tbody-import-mapping');
  tbody.innerHTML = importState.headers.map((h, idx) => {
    const sample = importState.rows[0] ? importState.rows[0][idx] : '';
    const options = MAPPING_FIELDS.map((f) => `<option value="${f.value}" ${importState.mapping[idx] === f.value ? 'selected' : ''}>${f.label}</option>`).join('');
    return `<tr><td>${escapeHTML(h || '(sem título)')}</td><td class="muted">${escapeHTML(String(sample ?? ''))}</td><td><select class="input-select import-map-select" data-idx="${idx}">${options}</select></td></tr>`;
  }).join('');
  tbody.querySelectorAll('.import-map-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      importState.mapping[Number(e.target.dataset.idx)] = e.target.value;
    });
  });
}

document.getElementById('btn-confirm-import').addEventListener('click', async () => {
  const nameIdx = importState.mapping.indexOf('full_name');
  const errEl = document.getElementById('import-error');
  errEl.hidden = true;
  if (nameIdx === -1) {
    errEl.textContent = 'Selecione qual coluna corresponde ao Nome.';
    errEl.hidden = false;
    return;
  }
  const records = [];
  let skipped = 0;
  importState.rows.forEach((row) => {
    const rec = {};
    importState.mapping.forEach((field, idx) => {
      if (!field) return;
      const raw = row[idx];
      if (field === 'base_salary' || field === 'health_plan_fixed_value') {
        rec[field] = parseBRNumber(raw);
      } else if (field === 'transporte_optante' || field === 'sindical_optante') {
        rec[field] = parseBRBoolean(raw);
      } else if (field === 'admission_date') {
        rec[field] = excelSerialOrStringToISODate(raw);
      } else {
        rec[field] = String(raw ?? '').trim() || null;
      }
    });
    if (!rec.full_name) { skipped += 1; return; }
    records.push(rec);
  });
  if (!records.length) {
    errEl.textContent = 'Nenhuma linha válida para importar.';
    errEl.hidden = false;
    return;
  }

  const btn = document.getElementById('btn-confirm-import');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  const chunkSize = 200;
  let inserted = 0;
  let importError = null;
  for (let i = 0; i < records.length; i += chunkSize) {
    const chunk = records.slice(i, i + chunkSize);
    const { error } = await sb.from('employees').insert(chunk);
    if (error) { importError = error; break; }
    inserted += chunk.length;
  }
  btn.disabled = false;
  btn.textContent = 'Importar';

  document.getElementById('import-step-mapping').hidden = true;
  document.getElementById('import-step-result').hidden = false;
  document.getElementById('btn-confirm-import').hidden = true;
  document.getElementById('import-result-message').textContent = importError
    ? `Importados ${inserted} de ${records.length} antes de um erro: ${importError.message}`
    : `${inserted} funcionário(s) importado(s) com sucesso${skipped ? ` (${skipped} linha(s) ignoradas por falta de nome)` : ''}.`;
  await loadEmployees();
});

/* ==========================================================
   Lançamentos mensais
   ========================================================== */
let lancamentosSeq = 0;
async function loadLancamentos() {
  const mySeq = ++lancamentosSeq;
  const input = document.getElementById('competencia-lancamentos');
  const monthInput = input.value || currentMonthInput();
  input.value = monthInput;
  const dateStr = monthInputToDate(monthInput);

  const activeEmployees = state.employees.filter((e) => e.active);

  const [{ data: entries, error: entriesErr }, { data: installs }] = await Promise.all([
    sb.from('monthly_entries').select('*').eq('competencia', dateStr),
    sb.from('purchase_installments').select('employee_id, value').eq('competencia', dateStr),
  ]);
  if (mySeq !== lancamentosSeq) return; // a newer competência change already superseded this request
  if (entriesErr) { showToast(entriesErr.message, true); return; }

  const entryMap = new Map((entries || []).map((en) => [en.employee_id, en]));
  const comprasMap = new Map();
  (installs || []).forEach((i) => comprasMap.set(i.employee_id, round2((comprasMap.get(i.employee_id) || 0) + Number(i.value))));

  state.currentLancamentoDate = dateStr;
  state.currentLancamentoMonthInput = monthInput;
  state.currentEntryMap = entryMap;
  state.currentComprasMap = comprasMap;

  renderLancamentos(activeEmployees, entryMap, comprasMap);
}

function renderLancamentos(employees, entryMap, comprasMap) {
  const tbody = document.getElementById('tbody-lancamentos');
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum funcionário ativo.</td></tr>';
    document.getElementById('lancamentos-stats').innerHTML = '';
    return;
  }
  let lancados = 0;
  tbody.innerHTML = employees.map((emp) => {
    const entry = entryMap.get(emp.id);
    if (entry) lancados += 1;
    const totalDescontos = entry ? round2(
      (entry.dental_discount || 0) + (entry.health_plan_fixed || 0) + (entry.health_coparticipation || 0)
      + (entry.pharmacy_discount || 0) + (entry.sindical_value || 0)
      + (entry.psychological_discount || 0) + (entry.payroll_loan_discount || 0),
    ) : 0;
    const totalProventos = entry ? round2(
      (entry.commission_value || 0) + (entry.bonus_value || 0) + (entry.award_value || 0)
      + (entry.gratification_value || 0) + (entry.reimbursement_value || 0),
    ) : 0;
    const compras = comprasMap.get(emp.id) || 0;
    const statusChip = entry ? '<span class="chip chip-success">Lançado</span>' : '<span class="chip chip-warning">Pendente</span>';
    return `
      <tr>
        <td>${escapeHTML(emp.full_name)}</td>
        <td>${statusChip}</td>
        <td class="num">${formatBRL(totalDescontos)}</td>
        <td class="num">${formatBRL(totalProventos)}</td>
        <td class="num">${formatBRL(compras)}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-open-lancamento" data-id="${emp.id}" type="button">${entry ? 'Editar' : 'Lançar'}</button></td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('.btn-open-lancamento').forEach((btn) => btn.addEventListener('click', () => openLancamentoModal(btn.dataset.id)));

  document.getElementById('lancamentos-stats').innerHTML = `
    <div class="stat-tile"><span class="stat-value">${lancados}/${employees.length}</span><span class="stat-label">Lançados</span></div>
    <div class="stat-tile"><span class="stat-value">${employees.length - lancados}</span><span class="stat-label">Pendentes</span></div>`;
}

document.getElementById('competencia-lancamentos').addEventListener('change', loadLancamentos);

document.getElementById('btn-gerar-pendentes').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.disabled) return;
  const dateStr = state.currentLancamentoDate;
  const pending = state.employees.filter((emp) => emp.active && !state.currentEntryMap.has(emp.id));
  if (!pending.length) { showToast('Não há pendências para esta competência.'); return; }
  const rows = pending.map((emp) => ({
    employee_id: emp.id,
    competencia: dateStr,
    health_plan_fixed: emp.health_plan_fixed_value || 0,
    transporte_optante: emp.transporte_optante,
    sindical_optante: emp.sindical_optante,
    sindical_value: emp.sindical_optante ? round2(emp.base_salary * 0.01) : 0,
    created_by: state.session.user.id,
  }));
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Gerando…';
  // ignoreDuplicates: a stale pending list (double-click, or a colleague who just
  // saved the same competência in another tab) must skip the conflicting rows
  // instead of failing the whole batch — and must never overwrite real data.
  const { error } = await sb.from('monthly_entries')
    .upsert(rows, { onConflict: 'employee_id,competencia', ignoreDuplicates: true });
  btn.disabled = false;
  btn.textContent = originalLabel;
  if (error) { showToast(error.message, true); return; }
  showToast('Lançamentos pendentes gerados.');
  await loadLancamentos();
});

function openLancamentoModal(employeeId) {
  const emp = state.employees.find((e) => e.id === employeeId);
  if (!emp) return;
  const entry = state.currentEntryMap.get(employeeId);
  const dateStr = state.currentLancamentoDate;

  document.getElementById('lancamento-form-error').hidden = true;
  document.getElementById('lancamento-id').value = entry ? entry.id : '';
  document.getElementById('lancamento-employee-id').value = employeeId;
  document.getElementById('lancamento-competencia').value = dateStr;
  document.getElementById('modal-lancamento-title').textContent = `${emp.full_name} — ${formatCompetenciaLabel(dateStr)}`;

  const sindDefault = emp.sindical_optante ? round2(emp.base_salary * 0.01) : 0;

  setVal('f-dental', entry?.dental_discount, 0);
  setVal('f-health-fixed', entry?.health_plan_fixed, emp.health_plan_fixed_value || 0);
  setVal('f-health-copart', entry?.health_coparticipation, 0);
  setVal('f-pharmacy', entry?.pharmacy_discount, 0);
  setVal('f-psychological', entry?.psychological_discount, 0);
  document.getElementById('f-transporte-opt').checked = entry ? !!entry.transporte_optante : !!emp.transporte_optante;
  document.getElementById('f-sindical-opt').checked = entry ? !!entry.sindical_optante : !!emp.sindical_optante;
  setVal('f-sindical-value', entry?.sindical_value, sindDefault);
  setVal('f-absence-days', entry?.absence_days, 0);
  document.getElementById('f-absence-dates').value = entry?.absence_dates || '';
  setVal('f-overtime-hours', entry?.overtime_hours, 0);
  setVal('f-hour-discount', entry?.hour_discount_value, 0);
  setVal('f-commission', entry?.commission_value, 0);
  setVal('f-bonus', entry?.bonus_value, 0);
  setVal('f-award', entry?.award_value, 0);
  setVal('f-gratification', entry?.gratification_value, 0);
  setVal('f-reimbursement', entry?.reimbursement_value, 0);
  setVal('f-loan-discount', entry?.payroll_loan_discount, 0);
  document.getElementById('f-notes').value = entry?.notes || '';

  const compras = state.currentComprasMap.get(employeeId) || 0;
  document.getElementById('lancamento-compras-info').textContent = compras > 0
    ? `Compras parceladas neste mês: ${formatBRL(compras)} (gerenciado em "Compras parceladas").`
    : 'Nenhuma compra parcelada neste mês.';

  openModal('modal-lancamento');
}

document.getElementById('f-sindical-opt').addEventListener('change', (e) => {
  const empId = document.getElementById('lancamento-employee-id').value;
  const emp = state.employees.find((x) => x.id === empId);
  const field = document.getElementById('f-sindical-value');
  if (e.target.checked) {
    if (emp && (!field.value || Number(field.value) === 0)) field.value = round2(emp.base_salary * 0.01);
  } else {
    field.value = 0;
  }
});

document.getElementById('form-lancamento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('lancamento-id').value;
  const employee_id = document.getElementById('lancamento-employee-id').value;
  const competencia = document.getElementById('lancamento-competencia').value;
  const payload = {
    employee_id,
    competencia,
    dental_discount: numVal('f-dental'),
    health_plan_fixed: numVal('f-health-fixed'),
    health_coparticipation: numVal('f-health-copart'),
    pharmacy_discount: numVal('f-pharmacy'),
    transporte_optante: document.getElementById('f-transporte-opt').checked,
    sindical_optante: document.getElementById('f-sindical-opt').checked,
    sindical_value: numVal('f-sindical-value'),
    absence_days: numVal('f-absence-days'),
    absence_dates: document.getElementById('f-absence-dates').value.trim() || null,
    overtime_hours: numVal('f-overtime-hours'),
    hour_discount_value: numVal('f-hour-discount'),
    commission_value: numVal('f-commission'),
    bonus_value: numVal('f-bonus'),
    award_value: numVal('f-award'),
    gratification_value: numVal('f-gratification'),
    reimbursement_value: numVal('f-reimbursement'),
    payroll_loan_discount: numVal('f-loan-discount'),
    psychological_discount: numVal('f-psychological'),
    notes: document.getElementById('f-notes').value.trim() || null,
    created_by: state.session.user.id,
  };
  let error;
  if (id) {
    ({ error } = await sb.from('monthly_entries').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('monthly_entries').upsert(payload, { onConflict: 'employee_id,competencia' }));
  }
  if (error) {
    const el = document.getElementById('lancamento-form-error');
    el.textContent = error.message;
    el.hidden = false;
    return;
  }
  closeModal('modal-lancamento');
  showToast('Lançamento salvo.');
  await loadLancamentos();
});

/* ==========================================================
   Compras parceladas
   ========================================================== */
function computeInstallments(total, count, firstMonthInput) {
  const base = Math.floor((total / count) * 100) / 100;
  const installments = [];
  let allocated = 0;
  for (let i = 0; i < count; i += 1) {
    let value;
    if (i === count - 1) {
      value = round2(total - allocated);
    } else {
      value = base;
      allocated = round2(allocated + value);
    }
    installments.push({
      installment_number: i + 1,
      competencia: monthInputToDate(addMonths(firstMonthInput, i)),
      value,
    });
  }
  return installments;
}

async function loadPurchases() {
  const filterId = document.getElementById('compras-filtro-funcionario').value;
  let query = sb.from('purchases').select('*, employee:employees(full_name)').order('purchase_date', { ascending: false });
  if (filterId) query = query.eq('employee_id', filterId);
  const { data, error } = await query;
  if (error) { showToast(error.message, true); return; }
  state.purchases = data || [];
  renderPurchases();
}

function renderPurchases() {
  const tbody = document.getElementById('tbody-purchases');
  if (!state.purchases.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum pedido encontrado.</td></tr>';
    return;
  }
  const nowMonth = currentMonthInput();
  tbody.innerHTML = state.purchases.map((p) => {
    const firstMonth = dateToMonthInput(p.first_competencia);
    const lastMonth = addMonths(firstMonth, p.installments_count - 1);
    let situacao;
    if (lastMonth < nowMonth) situacao = '<span class="chip chip-muted">Quitado</span>';
    else if (firstMonth > nowMonth) situacao = '<span class="chip chip-warning">A iniciar</span>';
    else situacao = '<span class="chip chip-success">Em andamento</span>';
    return `
      <tr>
        <td>${escapeHTML(p.employee?.full_name || '—')}</td>
        <td>${escapeHTML(p.description)}</td>
        <td class="num">${formatBRL(p.total_value)}</td>
        <td>${p.installments_count}x</td>
        <td>${formatCompetenciaLabel(p.first_competencia)}</td>
        <td>${situacao}</td>
        <td class="row-actions"><button class="btn btn-ghost btn-view-purchase" data-id="${p.id}" type="button">Ver parcelas</button></td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('.btn-view-purchase').forEach((btn) => btn.addEventListener('click', () => openPurchaseDetail(btn.dataset.id)));
}

document.getElementById('compras-filtro-funcionario').addEventListener('change', loadPurchases);

document.getElementById('btn-new-purchase').addEventListener('click', () => {
  document.getElementById('form-purchase').reset();
  document.getElementById('purchase-form-error').hidden = true;
  document.getElementById('purchase-date').value = toISODate(new Date());
  document.getElementById('purchase-first-competencia').value = addMonths(currentMonthInput(), 1);
  document.getElementById('purchase-installments').value = 1;
  updatePurchasePreview();
  openModal('modal-purchase');
});

['purchase-total', 'purchase-installments', 'purchase-first-competencia'].forEach((id) => {
  document.getElementById(id).addEventListener('input', updatePurchasePreview);
});

function updatePurchasePreview() {
  const total = parseFloat(document.getElementById('purchase-total').value) || 0;
  const count = parseInt(document.getElementById('purchase-installments').value, 10) || 0;
  const firstMonth = document.getElementById('purchase-first-competencia').value;
  const box = document.getElementById('purchase-preview');
  if (total <= 0 || count <= 0 || !firstMonth) {
    box.textContent = 'Informe valor, parcelas e competência para ver a prévia.';
    return;
  }
  const installments = computeInstallments(total, count, firstMonth);
  box.innerHTML = installments.map((i) => `${i.installment_number}ª: ${formatBRL(i.value)} (${formatCompetenciaLabel(i.competencia)})`).join(' · ');
}

document.getElementById('form-purchase').addEventListener('submit', async (e) => {
  e.preventDefault();
  const employee_id = document.getElementById('purchase-employee').value;
  const description = document.getElementById('purchase-description').value.trim();
  const total_value = parseFloat(document.getElementById('purchase-total').value) || 0;
  const installments_count = parseInt(document.getElementById('purchase-installments').value, 10) || 0;
  const purchase_date = document.getElementById('purchase-date').value || toISODate(new Date());
  const firstMonth = document.getElementById('purchase-first-competencia').value;
  const errEl = document.getElementById('purchase-form-error');
  errEl.hidden = true;
  if (!employee_id || !description || total_value <= 0 || installments_count <= 0 || !firstMonth) {
    errEl.textContent = 'Preencha todos os campos obrigatórios.';
    errEl.hidden = false;
    return;
  }
  const first_competencia = monthInputToDate(firstMonth);
  const { data: purchase, error: purchaseErr } = await sb.from('purchases')
    .insert({
      employee_id, description, total_value, installments_count, purchase_date, first_competencia, created_by: state.session.user.id,
    })
    .select().single();
  if (purchaseErr) { errEl.textContent = purchaseErr.message; errEl.hidden = false; return; }

  const installments = computeInstallments(total_value, installments_count, firstMonth).map((i) => ({
    purchase_id: purchase.id, employee_id, installment_number: i.installment_number, competencia: i.competencia, value: i.value,
  }));
  const { error: instErr } = await sb.from('purchase_installments').insert(installments);
  if (instErr) { errEl.textContent = instErr.message; errEl.hidden = false; return; }

  closeModal('modal-purchase');
  showToast('Pedido registrado.');
  await loadPurchases();
});

async function openPurchaseDetail(id) {
  const purchase = state.purchases.find((p) => p.id === id);
  if (!purchase) return;
  const { data, error } = await sb.from('purchase_installments').select('*').eq('purchase_id', id).order('installment_number');
  if (error) { showToast(error.message, true); return; }
  document.getElementById('purchase-detail-summary').textContent = `${purchase.employee?.full_name || ''} — ${purchase.description} — ${formatBRL(purchase.total_value)} em ${purchase.installments_count}x`;
  document.getElementById('tbody-purchase-detail').innerHTML = (data || []).map((i) => `
    <tr><td>${i.installment_number}ª</td><td>${formatCompetenciaLabel(i.competencia)}</td><td class="num">${formatBRL(i.value)}</td></tr>`).join('');
  document.getElementById('btn-delete-purchase').dataset.id = id;
  openModal('modal-purchase-detail');
}

document.getElementById('btn-delete-purchase').addEventListener('click', async (e) => {
  const id = e.target.dataset.id;
  if (!id) return;
  if (!confirm('Excluir este pedido e todas as suas parcelas?')) return;
  const { error } = await sb.from('purchases').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-purchase-detail');
  showToast('Pedido excluído.');
  await loadPurchases();
});

/* ==========================================================
   Exportar
   ========================================================== */
const EXPORT_COLUMNS = [
  { label: 'Nome', value: (r) => r.employee.full_name },
  { label: 'Matrícula', value: (r) => r.employee.registration_number || '' },
  { label: 'Empresa', value: (r) => r.employee.company || '' },
  { label: 'Dias de falta (qtd)', value: (r) => (r.entry ? r.entry.absence_days : 0), numeric: 'plain' },
  { label: 'Dias da falta (datas)', value: (r) => (r.entry ? (r.entry.absence_dates || '') : '') },
  { label: 'Horas extras totais', value: (r) => (r.entry ? r.entry.overtime_hours : 0), numeric: 'plain' },
  { label: 'Horas totais de desconto', value: (r) => (r.entry ? r.entry.hour_discount_value : 0), numeric: 'plain' },
  { label: 'Desconto odontológico', value: (r) => (r.entry ? r.entry.dental_discount : 0), numeric: 'currency' },
  { label: 'Plano de saúde (fixo)', value: (r) => (r.entry ? r.entry.health_plan_fixed : (r.employee.health_plan_fixed_value || 0)), numeric: 'currency' },
  { label: 'Coparticipação saúde', value: (r) => (r.entry ? r.entry.health_coparticipation : 0), numeric: 'currency' },
  { label: 'Desconto farmácia', value: (r) => (r.entry ? r.entry.pharmacy_discount : 0), numeric: 'currency' },
  { label: 'Vale-transporte (6%)', value: (r) => ((r.entry ? r.entry.transporte_optante : r.employee.transporte_optante) ? 'Sim' : 'Não') },
  { label: 'Contribuição sindical', value: (r) => (r.entry ? r.entry.sindical_value : 0), numeric: 'currency' },
  { label: 'Comissão', value: (r) => (r.entry ? r.entry.commission_value : 0), numeric: 'currency' },
  { label: 'Bonificação', value: (r) => (r.entry ? r.entry.bonus_value : 0), numeric: 'currency' },
  { label: 'Premiação', value: (r) => (r.entry ? r.entry.award_value : 0), numeric: 'currency' },
  { label: 'Gratificação', value: (r) => (r.entry ? r.entry.gratification_value : 0), numeric: 'currency' },
  { label: 'Reembolso', value: (r) => (r.entry ? r.entry.reimbursement_value : 0), numeric: 'currency' },
  { label: 'Desconto empréstimo consignado', value: (r) => (r.entry ? r.entry.payroll_loan_discount : 0), numeric: 'currency' },
  { label: 'Desconto atend. psicológico', value: (r) => (r.entry ? r.entry.psychological_discount : 0), numeric: 'currency' },
  { label: 'Compras parceladas (mês)', value: (r) => r.comprasSum || 0, numeric: 'currency' },
  { label: 'Observações', value: (r) => (r.entry ? (r.entry.notes || '') : '') },
];

async function loadExportPreview() {
  const monthInput = document.getElementById('competencia-exportar').value || currentMonthInput();
  document.getElementById('competencia-exportar').value = monthInput;
  const dateStr = monthInputToDate(monthInput);

  const activeEmployees = state.employees.filter((e) => e.active).sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'));
  const [{ data: entries, error: entriesErr }, { data: installs }] = await Promise.all([
    sb.from('monthly_entries').select('*').eq('competencia', dateStr),
    sb.from('purchase_installments').select('employee_id, value').eq('competencia', dateStr),
  ]);
  if (entriesErr) { showToast(entriesErr.message, true); return; }

  const entryMap = new Map((entries || []).map((en) => [en.employee_id, en]));
  const comprasMap = new Map();
  (installs || []).forEach((i) => comprasMap.set(i.employee_id, round2((comprasMap.get(i.employee_id) || 0) + Number(i.value))));

  currentExportRows = activeEmployees.map((emp) => ({
    employee: emp,
    entry: entryMap.get(emp.id) || null,
    comprasSum: comprasMap.get(emp.id) || 0,
  }));

  const missing = currentExportRows.filter((r) => !r.entry).map((r) => r.employee.full_name);
  const alertEl = document.getElementById('exportar-alerta');
  if (missing.length) {
    alertEl.hidden = false;
    alertEl.textContent = `Sem lançamento neste mês: ${missing.join(', ')}. Complete em "Lançamentos mensais" antes de exportar.`;
  } else {
    alertEl.hidden = true;
  }

  renderExportTable();
}

function renderExportTable() {
  document.getElementById('thead-exportar').innerHTML = `<tr>${EXPORT_COLUMNS.map((c) => `<th${c.numeric ? ' class="num"' : ''}>${c.label}</th>`).join('')}</tr>`;
  const tbody = document.getElementById('tbody-exportar');
  if (!currentExportRows.length) {
    tbody.innerHTML = '<tr><td class="empty-row">Nenhum funcionário ativo.</td></tr>';
    return;
  }
  tbody.innerHTML = currentExportRows.map((r) => {
    const rowStyle = r.entry ? '' : ' style="background:var(--warning-soft)"';
    const cells = EXPORT_COLUMNS.map((c) => {
      const v = c.value(r);
      const display = c.numeric === 'currency' ? formatBRL(v) : (c.numeric === 'plain' ? String(v) : escapeHTML(v));
      return `<td${c.numeric ? ' class="num"' : ''}>${display}</td>`;
    }).join('');
    return `<tr${rowStyle}>${cells}</tr>`;
  }).join('');
}

document.getElementById('competencia-exportar').addEventListener('change', loadExportPreview);

function buildCSV() {
  const sep = ';';
  const headerRow = EXPORT_COLUMNS.map((c) => c.label).join(sep);
  const rows = currentExportRows.map((r) => EXPORT_COLUMNS.map((c) => {
    const v = c.value(r);
    if (typeof v === 'number') return v.toFixed(2).replace('.', ',');
    return String(v ?? '').replace(/;/g, ',');
  }).join(sep));
  return [headerRow, ...rows].join('\r\n');
}

async function exportXLSX() {
  if (!currentExportRows.length) { showToast('Nada para exportar.', true); return; }
  const downloads = await downloadsReady;
  if (!downloads) { showToast('Download não disponível neste ambiente.', true); return; }
  const headerRow = EXPORT_COLUMNS.map((c) => c.label);
  const dataRows = currentExportRows.map((r) => EXPORT_COLUMNS.map((c) => c.value(r)));
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Folha');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const monthLabel = document.getElementById('competencia-exportar').value || 'export';
  try {
    const result = await downloads.save({ filename: `folha_${monthLabel}.xlsx`, data: blob });
    showToast(result.status === 'saved' ? 'Planilha salva.' : 'Planilha enviada.');
  } catch (err) {
    handleDownloadError(err);
  }
}

async function exportCSVFile() {
  if (!currentExportRows.length) { showToast('Nada para exportar.', true); return; }
  const downloads = await downloadsReady;
  if (!downloads) { showToast('Download não disponível neste ambiente.', true); return; }
  const csv = buildCSV();
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const monthLabel = document.getElementById('competencia-exportar').value || 'export';
  try {
    const result = await downloads.save({ filename: `folha_${monthLabel}.csv`, data: blob });
    showToast(result.status === 'saved' ? 'CSV salvo.' : 'CSV enviado.');
  } catch (err) {
    handleDownloadError(err);
  }
}

document.getElementById('btn-export-xlsx').addEventListener('click', exportXLSX);
document.getElementById('btn-export-csv').addEventListener('click', exportCSVFile);

/* ==========================================================
   Início
   ========================================================== */
initAuth();
