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

// Ordem fixa de empresas pedida pelo usuário: PRC primeiro, depois FILIAL UPEXPRESS,
// por último UPEXPRESS; dentro de cada empresa, ordem alfabética. Empresas fora dessa
// lista (ou em branco) ficam no fim, também em ordem alfabética.
const COMPANY_SORT_ORDER = { PRC: 0, 'FILIAL UPEXPRESS': 1, UPEXPRESS: 2 };
function sortByCompanyThenName(employees) {
  return [...employees].sort((a, b) => {
    const orderA = COMPANY_SORT_ORDER[a.company] ?? 99;
    const orderB = COMPANY_SORT_ORDER[b.company] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.full_name.localeCompare(b.full_name, 'pt-BR');
  });
}

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
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Nenhum funcionário encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((e) => `
    <tr>
      <td>${escapeHTML(e.full_name)}</td>
      <td>${escapeHTML(e.registration_number || '—')}</td>
      <td>${escapeHTML(e.company || '—')}</td>
      <td>${escapeHTML(e.role || '—')}</td>
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
    document.getElementById('employee-transporte').checked = !!emp.transporte_optante;
    document.getElementById('employee-sindical').checked = !!emp.sindical_optante;
    document.getElementById('employee-health-fixed').value = emp.health_plan_fixed_value ?? '';
    document.getElementById('employee-dental-fixed').value = emp.dental_plan_fixed_value ?? '';
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
    transporte_optante: document.getElementById('employee-transporte').checked,
    sindical_optante: document.getElementById('employee-sindical').checked,
    health_plan_fixed_value: parseFloat(document.getElementById('employee-health-fixed').value) || 0,
    dental_plan_fixed_value: parseFloat(document.getElementById('employee-dental-fixed').value) || 0,
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
  { field: 'company', keywords: ['empresa', 'unidade', 'filial'] },
  { field: 'role', keywords: ['cargo', 'funcao'] },
  { field: 'department', keywords: ['setor', 'departamento', 'area'] },
  { field: 'admission_date', keywords: ['admissao', 'contratacao'] },
  { field: 'transporte_optante', keywords: ['vt', 'transporte'] },
  { field: 'sindical_optante', keywords: ['sindical', 'sindicato'] },
  { field: 'health_plan_fixed_value', keywords: ['saude', 'plano de saude'] },
  { field: 'dental_plan_fixed_value', keywords: ['odonto', 'dental'] },
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
  { value: 'company', label: 'Empresa/Unidade' },
  { value: 'role', label: 'Cargo' },
  { value: 'department', label: 'Setor' },
  { value: 'admission_date', label: 'Data de admissão' },
  { value: 'transporte_optante', label: 'Optante VT (Sim/Não)' },
  { value: 'sindical_optante', label: 'Optante sindical (Sim/Não)' },
  { value: 'health_plan_fixed_value', label: 'Plano de saúde (valor fixo)' },
  { value: 'dental_plan_fixed_value', label: 'Plano odontológico (valor fixo)' },
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
      if (field === 'health_plan_fixed_value' || field === 'dental_plan_fixed_value') {
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

  const activeEmployees = sortByCompanyThenName(state.employees.filter((e) => e.active));

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

  renderLancamentosGrid(activeEmployees, entryMap, comprasMap);
}

function renderLancamentosGrid(employees, entryMap, comprasMap) {
  const tbody = document.getElementById('tbody-lancamentos');
  if (!employees.length) {
    tbody.innerHTML = '<tr><td colspan="23" class="empty-row">Nenhum funcionário ativo.</td></tr>';
    return;
  }
  const num = (uid, field, value) => `<input type="number" step="0.01" min="0" id="ln-${uid}-${field}" data-field="${field}" value="${value || 0}">`;
  const chk = (uid, field, checked) => `<input type="checkbox" id="ln-${uid}-${field}" data-field="${field}" ${checked ? 'checked' : ''}>`;
  const txt = (uid, field, value) => `<input type="text" id="ln-${uid}-${field}" data-field="${field}" value="${escapeHTML(value || '')}">`;

  tbody.innerHTML = employees.map((emp) => {
    const entry = entryMap.get(emp.id) || {};
    const compras = comprasMap.get(emp.id) || 0;
    const uid = emp.id;
    return `
      <tr data-emp-id="${uid}">
        <td class="readonly">${escapeHTML(emp.company || '—')}</td>
        <td>${escapeHTML(emp.full_name)}</td>
        <td class="readonly">${escapeHTML(emp.registration_number || '—')}</td>
        <td class="num readonly">${formatBRL(emp.dental_plan_fixed_value)}</td>
        <td class="num readonly">${formatBRL(emp.health_plan_fixed_value)}</td>
        <td>${num(uid, 'health_coparticipation', entry.health_coparticipation)}</td>
        <td>${num(uid, 'pharmacy_discount', entry.pharmacy_discount)}</td>
        <td>${num(uid, 'psychological_discount', entry.psychological_discount)}</td>
        <td>${chk(uid, 'transporte_optante', entry.transporte_optante ?? emp.transporte_optante)}</td>
        <td>${chk(uid, 'sindical_optante', entry.sindical_optante ?? emp.sindical_optante)}</td>
        <td>${num(uid, 'absence_days', entry.absence_days)}</td>
        <td>${txt(uid, 'absence_dates', entry.absence_dates)}</td>
        <td>${num(uid, 'overtime_hours', entry.overtime_hours)}</td>
        <td>${num(uid, 'overtime_hours_100', entry.overtime_hours_100)}</td>
        <td>${num(uid, 'night_shift_hours', entry.night_shift_hours)}</td>
        <td>${num(uid, 'hour_discount_value', entry.hour_discount_value)}</td>
        <td>${num(uid, 'commission_value', entry.commission_value)}</td>
        <td>${num(uid, 'bonus_value', entry.bonus_value)}</td>
        <td>${num(uid, 'award_value', entry.award_value)}</td>
        <td>${num(uid, 'reimbursement_value', entry.reimbursement_value)}</td>
        <td>${num(uid, 'payroll_loan_discount', entry.payroll_loan_discount)}</td>
        <td class="num readonly">${formatBRL(compras)}</td>
        <td>${txt(uid, 'notes', entry.notes)}</td>
      </tr>`;
  }).join('');
}

document.getElementById('competencia-lancamentos').addEventListener('change', loadLancamentos);

function buildLancamentoRowPayload(tr, employeeId) {
  const payload = {
    employee_id: employeeId,
    competencia: state.currentLancamentoDate,
    created_by: state.session.user.id,
  };
  tr.querySelectorAll('[data-field]').forEach((el) => {
    const field = el.dataset.field;
    if (el.type === 'checkbox') payload[field] = el.checked;
    else if (el.type === 'number') payload[field] = parseFloat(el.value) || 0;
    else payload[field] = el.value.trim() || null;
  });
  return payload;
}

document.getElementById('tbody-lancamentos').addEventListener('change', async (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.field) return;
  const tr = el.closest('tr');
  const employeeId = tr.dataset.empId;
  const payload = buildLancamentoRowPayload(tr, employeeId);
  const status = document.getElementById('lancamentos-save-status');
  status.textContent = 'Salvando…';
  const { error } = await sb.from('monthly_entries').upsert(payload, { onConflict: 'employee_id,competencia' });
  if (error) { showToast(error.message, true); status.textContent = ''; return; }
  state.currentEntryMap.set(employeeId, payload);
  tr.classList.add('row-saved');
  setTimeout(() => tr.classList.remove('row-saved'), 500);
  status.textContent = 'Salvo.';
  setTimeout(() => { if (status.textContent === 'Salvo.') status.textContent = ''; }, 2000);
});

// Spreadsheet-style keyboard navigation: once a cell in the grid has focus, arrow
// keys move between cells (up/down keep the same column; left/right skip over
// read-only cells like Nome/Matrícula/valores fixos to the next editable one).
function gridCellPosition(el) {
  const td = el.closest('td');
  const tr = td.closest('tr');
  const tbody = tr.parentElement;
  return {
    tbody,
    rowIndex: Array.prototype.indexOf.call(tbody.children, tr),
    colIndex: Array.prototype.indexOf.call(tr.children, td),
  };
}
function focusCellAt(tbody, rowIndex, colIndex) {
  const tr = tbody.children[rowIndex];
  if (!tr) return false;
  const td = tr.children[colIndex];
  if (!td) return false;
  const input = td.querySelector('input');
  if (!input) return false;
  input.focus();
  return true;
}
function focusCellSkipReadonly(tbody, rowIndex, colIndex, step) {
  const tr = tbody.children[rowIndex];
  if (!tr) return false;
  let idx = colIndex;
  while (idx >= 0 && idx < tr.children.length) {
    const input = tr.children[idx].querySelector('input');
    if (input) { input.focus(); return true; }
    idx += step;
  }
  return false;
}
document.getElementById('tbody-lancamentos').addEventListener('keydown', (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.field) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const { tbody, rowIndex, colIndex } = gridCellPosition(el);
  let handled = false;
  if (e.key === 'ArrowUp') handled = focusCellAt(tbody, rowIndex - 1, colIndex);
  else if (e.key === 'ArrowDown') handled = focusCellAt(tbody, rowIndex + 1, colIndex);
  else if (e.key === 'ArrowLeft') handled = focusCellSkipReadonly(tbody, rowIndex, colIndex - 1, -1);
  else if (e.key === 'ArrowRight') handled = focusCellSkipReadonly(tbody, rowIndex, colIndex + 1, 1);
  if (handled) e.preventDefault();
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
        <td class="row-actions">
          <button class="btn btn-ghost btn-edit-purchase" data-id="${p.id}" type="button">Editar</button>
          <button class="btn btn-ghost btn-view-purchase" data-id="${p.id}" type="button">Ver parcelas</button>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('.btn-view-purchase').forEach((btn) => btn.addEventListener('click', () => openPurchaseDetail(btn.dataset.id)));
  tbody.querySelectorAll('.btn-edit-purchase').forEach((btn) => btn.addEventListener('click', () => openPurchaseModal(btn.dataset.id)));
}

document.getElementById('compras-filtro-funcionario').addEventListener('change', loadPurchases);

function openPurchaseModal(purchaseId) {
  const form = document.getElementById('form-purchase');
  form.reset();
  document.getElementById('purchase-form-error').hidden = true;
  document.getElementById('purchase-id').value = purchaseId || '';
  const isEdit = !!purchaseId;
  document.getElementById('modal-purchase-title').textContent = isEdit ? 'Editar pedido de compra' : 'Novo pedido de compra';
  document.getElementById('purchase-edit-note').hidden = !isEdit;
  document.getElementById('btn-save-purchase').textContent = isEdit ? 'Salvar alterações' : 'Salvar pedido';

  if (isEdit) {
    const purchase = state.purchases.find((p) => p.id === purchaseId);
    if (!purchase) return;
    document.getElementById('purchase-employee').value = purchase.employee_id;
    document.getElementById('purchase-description').value = purchase.description || '';
    document.getElementById('purchase-total').value = purchase.total_value;
    document.getElementById('purchase-installments').value = purchase.installments_count;
    document.getElementById('purchase-date').value = purchase.purchase_date || toISODate(new Date());
    document.getElementById('purchase-first-competencia').value = dateToMonthInput(purchase.first_competencia);
  } else {
    document.getElementById('purchase-date').value = toISODate(new Date());
    document.getElementById('purchase-first-competencia').value = addMonths(currentMonthInput(), 1);
    document.getElementById('purchase-installments').value = 1;
  }
  updatePurchasePreview();
  openModal('modal-purchase');
}

document.getElementById('btn-new-purchase').addEventListener('click', () => openPurchaseModal(null));
document.getElementById('btn-edit-purchase').addEventListener('click', () => {
  const id = document.getElementById('btn-delete-purchase').dataset.id;
  if (id) openPurchaseModal(id);
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
  const purchaseId = document.getElementById('purchase-id').value;
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
  const installments = computeInstallments(total_value, installments_count, firstMonth);

  let purchaseRowId = purchaseId;
  if (purchaseId) {
    const { error: updateErr } = await sb.from('purchases').update({
      employee_id, description, total_value, installments_count, purchase_date, first_competencia,
    }).eq('id', purchaseId);
    if (updateErr) { errEl.textContent = updateErr.message; errEl.hidden = false; return; }
    // installments are derived from total/count/first_competencia — recompute from scratch
    const { error: delErr } = await sb.from('purchase_installments').delete().eq('purchase_id', purchaseId);
    if (delErr) { errEl.textContent = delErr.message; errEl.hidden = false; return; }
  } else {
    const { data: purchase, error: purchaseErr } = await sb.from('purchases')
      .insert({
        employee_id, description, total_value, installments_count, purchase_date, first_competencia, created_by: state.session.user.id,
      })
      .select().single();
    if (purchaseErr) { errEl.textContent = purchaseErr.message; errEl.hidden = false; return; }
    purchaseRowId = purchase.id;
  }

  const installmentRows = installments.map((i) => ({
    purchase_id: purchaseRowId, employee_id, installment_number: i.installment_number, competencia: i.competencia, value: i.value,
  }));
  const { error: instErr } = await sb.from('purchase_installments').insert(installmentRows);
  if (instErr) { errEl.textContent = instErr.message; errEl.hidden = false; return; }

  closeModal('modal-purchase');
  showToast(purchaseId ? 'Pedido atualizado.' : 'Pedido registrado.');
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
  { label: 'Horas extras diurna', value: (r) => (r.entry ? r.entry.overtime_hours : 0), numeric: 'plain' },
  { label: 'Horas extras totais 100%', value: (r) => (r.entry ? r.entry.overtime_hours_100 : 0), numeric: 'plain' },
  { label: 'Adicional noturno (horas)', value: (r) => (r.entry ? r.entry.night_shift_hours : 0), numeric: 'plain' },
  { label: 'Horas totais de desconto', value: (r) => (r.entry ? r.entry.hour_discount_value : 0), numeric: 'plain' },
  { label: 'Desconto odontológico', value: (r) => (r.employee.dental_plan_fixed_value || 0), numeric: 'currency' },
  { label: 'Plano de saúde (fixo)', value: (r) => (r.employee.health_plan_fixed_value || 0), numeric: 'currency' },
  { label: 'Coparticipação saúde', value: (r) => (r.entry ? r.entry.health_coparticipation : 0), numeric: 'currency' },
  { label: 'Desconto farmácia', value: (r) => (r.entry ? r.entry.pharmacy_discount : 0), numeric: 'currency' },
  { label: 'Vale-transporte (6%)', value: (r) => ((r.entry ? r.entry.transporte_optante : r.employee.transporte_optante) ? 'Sim' : 'Não') },
  { label: 'Contribuição sindical (1%)', value: (r) => ((r.entry ? r.entry.sindical_optante : r.employee.sindical_optante) ? 'Sim' : 'Não') },
  { label: 'Comissão', value: (r) => (r.entry ? r.entry.commission_value : 0), numeric: 'currency' },
  { label: 'Bonificação', value: (r) => (r.entry ? r.entry.bonus_value : 0), numeric: 'currency' },
  { label: 'Premiação', value: (r) => (r.entry ? r.entry.award_value : 0), numeric: 'currency' },
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

  const activeEmployees = sortByCompanyThenName(state.employees.filter((e) => e.active));
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

// Saves a Blob to the visitor's device. Inside the Claude Artifact viewer, a plain
// <a download> click is inert (sandboxed), so the "downloads" capability is used when
// present; everywhere else (localhost, GitHub Pages, any normal browser) window.claude
// does not exist at all, so this falls back to the standard browser download dance.
async function saveFile(filename, blob) {
  const downloads = await downloadsReady;
  if (downloads) {
    const result = await downloads.save({ filename, data: blob });
    return result.status;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

async function exportXLSX() {
  if (!currentExportRows.length) { showToast('Nada para exportar.', true); return; }
  const headerRow = EXPORT_COLUMNS.map((c) => c.label);
  const dataRows = currentExportRows.map((r) => EXPORT_COLUMNS.map((c) => c.value(r)));
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Folha');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const monthLabel = document.getElementById('competencia-exportar').value || 'export';
  try {
    const status = await saveFile(`folha_${monthLabel}.xlsx`, blob);
    if (status === 'saved') showToast('Planilha salva.');
    else if (status === 'delivered') showToast('Planilha enviada.');
  } catch (err) {
    handleDownloadError(err);
  }
}

async function exportCSVFile() {
  if (!currentExportRows.length) { showToast('Nada para exportar.', true); return; }
  const csv = buildCSV();
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const monthLabel = document.getElementById('competencia-exportar').value || 'export';
  try {
    const status = await saveFile(`folha_${monthLabel}.csv`, blob);
    if (status === 'saved') showToast('CSV salvo.');
    else if (status === 'delivered') showToast('CSV enviado.');
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
