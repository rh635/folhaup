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
  bonusModels: [],
  currentView: 'funcionarios',
  currentLancamentoDate: null,
  currentLancamentoMonthInput: null,
  currentEntryMap: new Map(),
  currentComprasMap: new Map(),
  currentBonificacaoDate: null,
  currentBonusIndicators: [],
  currentBonusAchievedSet: new Set(),
  standardFuelAidValue: 0,
  standardMealAllowanceValue: 0,
  salaryPositions: [],
  salaryUpdates: [],
  proposals: [],
  calendarYear: null,
  calendarEvents: [],
  registrations: [],
  regChildrenDraft: [],
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
function formatDateBR(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}
function numOrNull(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}
function formatBRL(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// Horas extras/desconto são guardadas como número decimal (2.5h), mas exibidas e
// digitadas no formato "H:MM" (2:30) — sem limite de 24h, pois são totais do mês.
function hoursToClock(value) {
  const totalMinutes = Math.round((Number(value) || 0) * 60);
  const sign = totalMinutes < 0 ? '-' : '';
  const abs = Math.abs(totalMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, '0')}`;
}
// ---------- Regra de proporcionalidade/desconto de bonificação e premiação ----------
// Dias do mês da competência (competencia = "YYYY-MM-01").
function daysInMonthOfCompetencia(competenciaDateStr) {
  const [y, m] = competenciaDateStr.split('-').map(Number);
  return new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último dia deste mês
}
// Dias efetivamente trabalhados no mês: desconta dias antes da admissão (se admitido
// neste mesmo mês) e dias de férias.
function computeWorkedDays(competencia, admissionDate, vacationDays) {
  const totalDays = daysInMonthOfCompetencia(competencia);
  let daysAvailable = totalDays;
  if (admissionDate) {
    const [ay, am, ad] = admissionDate.split('-').map(Number);
    const [cy, cm] = competencia.split('-').map(Number);
    if (ay === cy && am === cm) daysAvailable = totalDays - ad + 1;
  }
  const worked = Math.max(0, Math.min(totalDays, daysAvailable - (Number(vacationDays) || 0)));
  return { totalDays, worked };
}
// Fator de desconto por horas de desconto / faltas: retorna a fração que SOBRA
// (1 = paga integral, 0 = zera). Faixas pedidas: qualquer falta ou >8:00 de desconto
// de horas -> zera (100%); exatamente 4:00 -> desconta 30% (fica 70%); acima de 4:00
// e até 8:00 -> desconta 60% (fica 40%); abaixo de 4:00 -> sem desconto.
function bonusAwardKeepFactor(absenceDays, hourDiscountHours) {
  const hd = Number(hourDiscountHours) || 0;
  if ((Number(absenceDays) || 0) > 0 || hd > 8) return 0;
  if (Math.abs(hd - 4) < 0.005) return 0.70;
  if (hd > 4 && hd <= 8) return 0.40;
  return 1;
}
// Valor final = (valor integral / dias do mês) x dias trabalhados x fator de desconto.
function computeFinalBonusAward(nominalValue, ctx) {
  const { totalDays, worked } = computeWorkedDays(ctx.competencia, ctx.admissionDate, ctx.vacationDays);
  const prorationFactor = totalDays > 0 ? worked / totalDays : 1;
  const keepFactor = bonusAwardKeepFactor(ctx.absenceDays, ctx.hourDiscountHours);
  return round2((Number(nominalValue) || 0) * prorationFactor * keepFactor);
}

function clockToHours(text) {
  if (!text) return 0;
  const s = String(text).trim();
  const match = s.match(/^(-)?(\d+):(\d{1,2})$/);
  if (match) {
    const sign = match[1] ? -1 : 1;
    const h = parseInt(match[2], 10);
    const m = parseInt(match[3], 10);
    return sign * round2(h + m / 60);
  }
  const n = parseFloat(s.replace(',', '.'));
  return isNaN(n) ? 0 : round2(n);
}
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
  dashboard: 'Dashboard',
  funcionarios: 'Funcionários',
  lancamentos: 'Lançamentos mensais',
  compras: 'Compras parceladas',
  bonificacao: 'Modelos de bonificação',
  'plano-salarios': 'Plano de salários',
  'atualizacoes-salario': 'Atualizações de salário',
  propostas: 'Propostas',
  exportar: 'Exportar',
  'calendario-rh': 'Calendário RH',
  'fichas-registro': 'Fichas de registro',
};

function switchView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.getElementById('topbar-title').textContent = VIEW_TITLES[name] || '';
  document.querySelector('.sidebar').classList.remove('open');
  if (name === 'dashboard') loadDashboard();
  if (name === 'lancamentos') loadLancamentos();
  if (name === 'compras') loadPurchases();
  if (name === 'bonificacao') loadBonusModelsView();
  if (name === 'plano-salarios') loadSalaryPlan();
  if (name === 'atualizacoes-salario') loadSalaryUpdates();
  if (name === 'propostas') loadProposals();
  if (name === 'exportar') loadExportPreview();
  if (name === 'calendario-rh') loadCalendarRH();
  if (name === 'fichas-registro') loadRegistrations();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
document.getElementById('btn-mobile-nav').addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('open');
});

async function bootstrapApp() {
  document.getElementById('competencia-dashboard').value = currentMonthInput();
  document.getElementById('competencia-lancamentos').value = currentMonthInput();
  document.getElementById('competencia-exportar').value = currentMonthInput();
  document.getElementById('competencia-bonificacao').value = currentMonthInput();
  await loadBonusModels();
  await loadAppSettings();
  await loadEmployees();
  await loadProposals();
  switchView('funcionarios');
}

/* ==========================================================
   Configurações (valor único, tipo chave/valor)
   ========================================================== */
async function loadAppSettings() {
  const { data, error } = await sb.from('app_settings').select('*');
  if (error) { showToast(error.message, true); return; }
  const byKey = new Map((data || []).map((row) => [row.key, Number(row.value) || 0]));
  state.standardFuelAidValue = byKey.get('standard_fuel_aid_value') || 0;
  state.standardMealAllowanceValue = byKey.get('standard_meal_allowance_value') || 0;
  document.getElementById('standard-fuel-aid-display').textContent = formatBRL(state.standardFuelAidValue);
  document.getElementById('standard-meal-allowance-display').textContent = formatBRL(state.standardMealAllowanceValue);
}

// Atualiza um valor único de app_settings e recarrega o estado + a tela de
// funcionários — usado para os reajustes anuais em lote (auxílio combustível
// padrão, vale alimentação, etc.).
async function updateAppSetting(key, promptLabel) {
  const currentByKey = { standard_fuel_aid_value: state.standardFuelAidValue, standard_meal_allowance_value: state.standardMealAllowanceValue };
  const current = currentByKey[key] || 0;
  const raw = prompt(promptLabel, current.toFixed(2).replace('.', ','));
  if (raw === null) return;
  const value = parseBRNumber(raw);
  if (!value || value <= 0) { showToast('Informe um valor válido.', true); return; }

  const { error } = await sb.from('app_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) { showToast(error.message, true); return; }

  await loadAppSettings();
  renderEmployees();
  showToast('Valor padrão atualizado — já vale para todos que recebem o valor padrão.');
}

// Auxílio combustível efetivo do funcionário: VT tira o direito ao auxílio;
// diferenciado usa o valor próprio; caso contrário, vale o valor padrão vigente.
function effectiveFuelAidValue(emp) {
  if (emp.transporte_optante) return 0;
  if (emp.fuel_aid_differentiated) return emp.fuel_aid_value || 0;
  return state.standardFuelAidValue || 0;
}

document.getElementById('btn-edit-standard-fuel-aid').addEventListener('click', () => {
  updateAppSetting('standard_fuel_aid_value', 'Novo valor padrão de auxílio combustível (R$):');
});
document.getElementById('btn-edit-standard-meal-allowance').addEventListener('click', () => {
  updateAppSetting('standard_meal_allowance_value', 'Novo valor de vale alimentação (R$):');
});

/* ==========================================================
   Dashboard
   ========================================================== */
// Variante por competência: usa o optante de VT daquele mês (lançamento), se
// houver, em vez do valor padrão atual do cadastro do funcionário.
function effectiveFuelAidValueForMonth(emp, entry) {
  const vtOptante = entry ? (entry.transporte_optante ?? emp.transporte_optante) : emp.transporte_optante;
  if (vtOptante) return 0;
  if (emp.fuel_aid_differentiated) return emp.fuel_aid_value || 0;
  return state.standardFuelAidValue || 0;
}

// Agrega todas as métricas do dashboard para um mês, a partir dos funcionários
// ativos (foto atual) cruzados com os lançamentos daquele mês (histórico real).
function computeDashboardMetrics(activeEmployees, entryMap) {
  const metrics = {
    fuelAidDifferentiatedTotal: 0,
    fuelAidStandardTotal: 0,
    mealAllowanceTotal: round2(activeEmployees.length * (state.standardMealAllowanceValue || 0)),
    healthPlanTotal: 0,
    overtimeHours: 0,
    overtimeHours100: 0,
    absenceDays: 0,
    hourDiscountValue: 0,
    vtByCity: new Map(),
    byCompany: new Map(),
  };
  activeEmployees.forEach((emp) => {
    const entry = entryMap.get(emp.id) || null;
    const fuelAid = effectiveFuelAidValueForMonth(emp, entry);
    if (emp.fuel_aid_differentiated) metrics.fuelAidDifferentiatedTotal += fuelAid;
    else metrics.fuelAidStandardTotal += fuelAid;

    metrics.healthPlanTotal += (emp.health_plan_fixed_value || 0) + (entry ? (entry.health_coparticipation || 0) : 0);
    metrics.overtimeHours += entry ? (entry.overtime_hours || 0) : 0;
    metrics.overtimeHours100 += entry ? (entry.overtime_hours_100 || 0) : 0;
    metrics.absenceDays += entry ? (entry.absence_days || 0) : 0;
    metrics.hourDiscountValue += entry ? (entry.hour_discount_value || 0) : 0;

    const vtOptante = entry ? (entry.transporte_optante ?? emp.transporte_optante) : emp.transporte_optante;
    if (vtOptante) {
      const city = emp.transporte_city || 'Não informado';
      metrics.vtByCity.set(city, (metrics.vtByCity.get(city) || 0) + 1);
    }

    const company = emp.company || 'Não informado';
    metrics.byCompany.set(company, (metrics.byCompany.get(company) || 0) + 1);
  });
  metrics.fuelAidDifferentiatedTotal = round2(metrics.fuelAidDifferentiatedTotal);
  metrics.fuelAidStandardTotal = round2(metrics.fuelAidStandardTotal);
  metrics.healthPlanTotal = round2(metrics.healthPlanTotal);
  return metrics;
}

async function loadDashboard() {
  const monthInput = document.getElementById('competencia-dashboard').value || currentMonthInput();
  document.getElementById('competencia-dashboard').value = monthInput;

  const months = [-5, -4, -3, -2, -1, 0].map((n) => addMonths(monthInput, n));
  const firstDate = monthInputToDate(months[0]);
  const lastDate = monthInputToDate(months[months.length - 1]);

  const { data: entries, error } = await sb.from('monthly_entries').select('*').gte('competencia', firstDate).lte('competencia', lastDate);
  if (error) { showToast(error.message, true); return; }

  const entriesByMonth = new Map();
  (entries || []).forEach((en) => {
    if (!entriesByMonth.has(en.competencia)) entriesByMonth.set(en.competencia, []);
    entriesByMonth.get(en.competencia).push(en);
  });

  const activeEmployees = state.employees.filter((e) => e.active);
  const monthsData = months.map((mInput) => {
    const dateStr = monthInputToDate(mInput);
    const entryMap = new Map((entriesByMonth.get(dateStr) || []).map((en) => [en.employee_id, en]));
    return { monthInput: mInput, dateStr, entryMap, metrics: computeDashboardMetrics(activeEmployees, entryMap) };
  });
  const selectedMonth = monthsData[monthsData.length - 1];

  renderDashboardStats(selectedMonth.metrics);
  renderDashboardVtByCity(selectedMonth.metrics);
  renderDashboardByCompany(selectedMonth.metrics);
  renderDashboardTopLists(computeDashboardRankings(activeEmployees, selectedMonth.entryMap));
  renderDashboardTrend(monthsData);
}

function renderDashboardByCompany(m) {
  const tbody = document.getElementById('tbody-dashboard-empresa');
  const rows = [...m.byCompany.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-row">Nenhum funcionário ativo.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(([company, count]) => `
    <tr><td>${escapeHTML(company)}</td><td class="num">${count}</td></tr>`).join('');
}

// Top 10 funcionários por métrica, no mês selecionado — só entram quem tem
// valor maior que zero (sem poluir a lista quando quase ninguém teve o item).
function computeDashboardRankings(activeEmployees, entryMap) {
  const rows = activeEmployees.map((emp) => {
    const entry = entryMap.get(emp.id) || null;
    return {
      employee: emp,
      overtimeHours: entry ? (entry.overtime_hours || 0) : 0,
      overtimeHours100: entry ? (entry.overtime_hours_100 || 0) : 0,
      absenceDays: entry ? (entry.absence_days || 0) : 0,
      hourDiscountValue: entry ? (entry.hour_discount_value || 0) : 0,
    };
  });
  const top = (key) => [...rows].filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 10);
  return {
    overtimeHours: top('overtimeHours'),
    overtimeHours100: top('overtimeHours100'),
    absenceDays: top('absenceDays'),
    hourDiscountValue: top('hourDiscountValue'),
  };
}

function renderDashboardTopList(tbodyId, rows, key, format) {
  const tbody = document.getElementById(tbodyId);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">Nenhum registro neste mês.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${escapeHTML(r.employee.full_name)}</td>
      <td>${escapeHTML(r.employee.company || '—')}</td>
      <td class="num">${format(r[key])}</td>
    </tr>`).join('');
}

function renderDashboardTopLists(rankings) {
  renderDashboardTopList('tbody-dashboard-top-overtime', rankings.overtimeHours, 'overtimeHours', hoursToClock);
  renderDashboardTopList('tbody-dashboard-top-overtime100', rankings.overtimeHours100, 'overtimeHours100', hoursToClock);
  renderDashboardTopList('tbody-dashboard-top-absence', rankings.absenceDays, 'absenceDays', (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0 }));
  renderDashboardTopList('tbody-dashboard-top-discount', rankings.hourDiscountValue, 'hourDiscountValue', hoursToClock);
}

function renderDashboardStats(m) {
  const tiles = [
    { label: 'Aux. combustível diferenciado', value: formatBRL(m.fuelAidDifferentiatedTotal) },
    { label: 'Aux. combustível padrão', value: formatBRL(m.fuelAidStandardTotal) },
    { label: 'Vale alimentação', value: formatBRL(m.mealAllowanceTotal) },
    { label: 'Plano de saúde + coparticipação', value: formatBRL(m.healthPlanTotal) },
    { label: 'Horas extras diurnas', value: hoursToClock(m.overtimeHours) },
    { label: 'Horas extras 100%', value: hoursToClock(m.overtimeHours100) },
    { label: 'Faltas (dias)', value: m.absenceDays.toLocaleString('pt-BR', { minimumFractionDigits: 0 }) },
    { label: 'Descontos de horas', value: hoursToClock(m.hourDiscountValue) },
  ];
  document.getElementById('dashboard-stats').innerHTML = tiles.map((t) => `
    <div class="stat-tile"><span class="stat-label">${escapeHTML(t.label)}</span><span class="stat-value">${escapeHTML(t.value)}</span></div>`).join('');
}

function renderDashboardVtByCity(m) {
  const tbody = document.getElementById('tbody-dashboard-vt-cidade');
  const rows = [...m.vtByCity.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-row">Nenhum optante de vale-transporte neste mês.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(([city, count]) => `
    <tr><td>${escapeHTML(city)}</td><td class="num">${count}</td></tr>`).join('');
}

function renderDashboardTrend(monthsData) {
  const thead = document.getElementById('thead-dashboard-trend');
  thead.innerHTML = `<tr><th>Indicador</th>${monthsData.map((md) => `<th class="num">${formatCompetenciaLabel(md.dateStr)}</th>`).join('')}</tr>`;

  const rows = [
    { label: 'Aux. combustível diferenciado', pick: (m) => formatBRL(m.fuelAidDifferentiatedTotal) },
    { label: 'Aux. combustível padrão', pick: (m) => formatBRL(m.fuelAidStandardTotal) },
    { label: 'Vale alimentação', pick: (m) => formatBRL(m.mealAllowanceTotal) },
    { label: 'Plano de saúde + coparticipação', pick: (m) => formatBRL(m.healthPlanTotal) },
    { label: 'Horas extras diurnas', pick: (m) => hoursToClock(m.overtimeHours) },
    { label: 'Horas extras 100%', pick: (m) => hoursToClock(m.overtimeHours100) },
    { label: 'Faltas (dias)', pick: (m) => m.absenceDays.toLocaleString('pt-BR', { minimumFractionDigits: 0 }) },
    { label: 'Descontos de horas', pick: (m) => hoursToClock(m.hourDiscountValue) },
  ];
  document.getElementById('tbody-dashboard-trend').innerHTML = rows.map((r) => `
    <tr><td>${escapeHTML(r.label)}</td>${monthsData.map((md) => `<td class="num">${escapeHTML(r.pick(md.metrics))}</td>`).join('')}</tr>`).join('');
}

document.getElementById('competencia-dashboard').addEventListener('change', loadDashboard);

/* ==========================================================
   Modelos de bonificação
   ========================================================== */
async function loadBonusModels() {
  const { data, error } = await sb.from('bonus_models').select('*').order('name');
  if (error) { showToast(error.message, true); return; }
  state.bonusModels = data || [];
  const select = document.getElementById('employee-bonus-model');
  const options = state.bonusModels.map((m) => `<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
  select.innerHTML = `<option value="">Nenhum</option>${options}`;
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
  // Inativos sempre por último, mantendo a ordem alfabética (já vinda do banco) dentro de cada grupo.
  const list = state.employees
    .filter((e) => !q || normalize(e.full_name).includes(q))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="16" class="empty-row">Nenhum funcionário encontrado.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((e) => `
    <tr>
      <td>${escapeHTML(e.full_name)}</td>
      <td>${escapeHTML(e.registration_number || '—')}</td>
      <td>${escapeHTML(e.company || '—')}</td>
      <td>${escapeHTML(e.role || '—')}</td>
      <td>${e.transporte_optante ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td>${escapeHTML(e.transporte_city || '—')}</td>
      <td>${e.sindical_optante ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td>${e.salary_advance_optante ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td>${e.fuel_aid_differentiated ? '<span class="chip chip-success">Sim</span>' : '<span class="chip chip-muted">Não</span>'}</td>
      <td>${escapeHTML(e.fuel_aid_differentiated ? (e.fuel_aid_city || '—') : '—')}</td>
      <td class="num">${formatBRL(effectiveFuelAidValue(e))}</td>
      <td class="num">${formatBRL(state.standardMealAllowanceValue)}</td>
      <td class="num">${formatBRL(e.health_plan_fixed_value)}</td>
      <td class="num">${formatBRL(e.dental_plan_fixed_value)}</td>
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

function updateInactiveReasonVisibility() {
  document.getElementById('field-inactive-reason').hidden = document.getElementById('employee-active').checked;
}
document.getElementById('employee-active').addEventListener('change', updateInactiveReasonVisibility);

function updateFuelAidFieldsVisibility() {
  document.getElementById('fields-fuel-aid-differentiated').hidden = !document.getElementById('employee-fuel-aid-differentiated').checked;
}
document.getElementById('employee-fuel-aid-differentiated').addEventListener('change', updateFuelAidFieldsVisibility);

function openEmployeeModal(id) {
  const form = document.getElementById('form-employee');
  form.reset();
  document.getElementById('employee-form-error').hidden = true;
  document.getElementById('employee-id').value = id || '';
  document.getElementById('employee-active').checked = true;
  document.getElementById('employee-inactive-reason').value = '';
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
    document.getElementById('employee-transporte-city').value = emp.transporte_city || '';
    document.getElementById('employee-sindical').checked = !!emp.sindical_optante;
    document.getElementById('employee-salary-advance').checked = !!emp.salary_advance_optante;
    document.getElementById('employee-fuel-aid-differentiated').checked = !!emp.fuel_aid_differentiated;
    document.getElementById('employee-fuel-aid-city').value = emp.fuel_aid_city || '';
    document.getElementById('employee-fuel-aid-value').value = emp.fuel_aid_value ?? '';
    document.getElementById('employee-health-fixed').value = emp.health_plan_fixed_value ?? '';
    document.getElementById('employee-dental-fixed').value = emp.dental_plan_fixed_value ?? '';
    document.getElementById('employee-bonus-reference').value = emp.bonus_reference_value ?? '';
    document.getElementById('employee-bonus-model').value = emp.bonus_model_id || '';
    document.getElementById('employee-active').checked = !!emp.active;
    document.getElementById('employee-inactive-reason').value = emp.inactive_reason || '';
    document.getElementById('employee-notes').value = emp.notes || '';
    document.getElementById('btn-inactivate-employee').textContent = emp.active ? 'Inativar' : 'Reativar';
  }
  updateInactiveReasonVisibility();
  updateFuelAidFieldsVisibility();
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
    transporte_city: document.getElementById('employee-transporte-city').value.trim() || null,
    sindical_optante: document.getElementById('employee-sindical').checked,
    salary_advance_optante: document.getElementById('employee-salary-advance').checked,
    fuel_aid_differentiated: document.getElementById('employee-fuel-aid-differentiated').checked,
    fuel_aid_city: document.getElementById('employee-fuel-aid-differentiated').checked ? (document.getElementById('employee-fuel-aid-city').value.trim() || null) : null,
    fuel_aid_value: document.getElementById('employee-fuel-aid-differentiated').checked ? (parseFloat(document.getElementById('employee-fuel-aid-value').value) || 0) : 0,
    health_plan_fixed_value: parseFloat(document.getElementById('employee-health-fixed').value) || 0,
    dental_plan_fixed_value: parseFloat(document.getElementById('employee-dental-fixed').value) || 0,
    bonus_reference_value: parseFloat(document.getElementById('employee-bonus-reference').value) || 0,
    bonus_model_id: document.getElementById('employee-bonus-model').value || null,
    active: document.getElementById('employee-active').checked,
    inactive_reason: document.getElementById('employee-active').checked ? null : (document.getElementById('employee-inactive-reason').value || null),
    notes: document.getElementById('employee-notes').value.trim() || null,
  };
  const errEl = document.getElementById('employee-form-error');
  if (!payload.full_name) { errEl.textContent = 'Informe o nome.'; errEl.hidden = false; return; }
  if (!payload.active && !payload.inactive_reason) { errEl.textContent = 'Selecione o motivo da inativação.'; errEl.hidden = false; return; }
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

  if (emp.active) {
    // Inativar exige motivo: só desmarca "Ativo" e pede pra escolher o motivo
    // e clicar em Salvar, em vez de gravar direto.
    document.getElementById('employee-active').checked = false;
    updateInactiveReasonVisibility();
    document.getElementById('employee-inactive-reason').focus();
    showToast('Selecione o motivo da inativação e clique em Salvar.');
    return;
  }

  const { error } = await sb.from('employees').update({ active: true, inactive_reason: null }).eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-employee');
  showToast('Funcionário reativado.');
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
  { field: 'salary_advance_optante', keywords: ['adiantamento'] },
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
  { value: 'salary_advance_optante', label: 'Optante adiantamento salarial (Sim/Não)' },
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
      } else if (field === 'transporte_optante' || field === 'sindical_optante' || field === 'salary_advance_optante') {
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
    tbody.innerHTML = '<tr><td colspan="26" class="empty-row">Nenhum funcionário ativo.</td></tr>';
    return;
  }
  const num = (uid, field, value) => `<input type="number" step="0.01" min="0" id="ln-${uid}-${field}" data-field="${field}" value="${value || 0}">`;
  const chk = (uid, field, checked) => `<input type="checkbox" id="ln-${uid}-${field}" data-field="${field}" ${checked ? 'checked' : ''}>`;
  const txt = (uid, field, value) => `<input type="text" id="ln-${uid}-${field}" data-field="${field}" value="${escapeHTML(value || '')}">`;
  const clock = (uid, field, value) => `<input type="text" placeholder="0:00" id="ln-${uid}-${field}" data-field="${field}" data-hours="1" value="${hoursToClock(value)}">`;

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
        <td>${num(uid, 'vacation_days', entry.vacation_days)}</td>
        <td>${clock(uid, 'overtime_hours', entry.overtime_hours)}</td>
        <td>${clock(uid, 'overtime_hours_100', entry.overtime_hours_100)}</td>
        <td>${clock(uid, 'night_shift_hours', entry.night_shift_hours)}</td>
        <td>${clock(uid, 'hour_discount_value', entry.hour_discount_value)}</td>
        <td>${num(uid, 'commission_value', entry.commission_value)}</td>
        <td>${num(uid, 'bonus_nominal_value', entry.bonus_nominal_value)}</td>
        <td class="num readonly" id="disp-${uid}-bonus_value">${formatBRL(entry.bonus_value)}</td>
        <td>${num(uid, 'award_nominal_value', entry.award_nominal_value)}</td>
        <td class="num readonly" id="disp-${uid}-award_value">${formatBRL(entry.award_value)}</td>
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
    else if (el.dataset.hours) payload[field] = clockToHours(el.value);
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
  const emp = state.employees.find((x) => x.id === employeeId);
  const bonusCtx = {
    competencia: payload.competencia,
    admissionDate: emp?.admission_date,
    vacationDays: payload.vacation_days,
    absenceDays: payload.absence_days,
    hourDiscountHours: payload.hour_discount_value,
  };
  payload.bonus_value = computeFinalBonusAward(payload.bonus_nominal_value, bonusCtx);
  payload.award_value = computeFinalBonusAward(payload.award_nominal_value, bonusCtx);

  const status = document.getElementById('lancamentos-save-status');
  status.textContent = 'Salvando…';
  const { error } = await sb.from('monthly_entries').upsert(payload, { onConflict: 'employee_id,competencia' });
  if (error) { showToast(error.message, true); status.textContent = ''; return; }
  state.currentEntryMap.set(employeeId, payload);
  if (el.dataset.hours) el.value = hoursToClock(payload[el.dataset.field]);
  document.getElementById(`disp-${employeeId}-bonus_value`).textContent = formatBRL(payload.bonus_value);
  document.getElementById(`disp-${employeeId}-award_value`).textContent = formatBRL(payload.award_value);
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
   Modelos de bonificação (indicadores por modelo)
   ========================================================== */
function existingEntryFields(existing) {
  const { id, created_at, updated_at, employee_id, competencia, ...rest } = existing || {};
  return rest;
}

// Cada ponto de indicador vale 1 ponto percentual: a % de bonificação/premiação
// é simplesmente a soma dos pontos dos indicadores marcados (a planilha já foi
// calibrada para somar até 100 quando todas as metas-base são batidas). O
// tier_group só serve para impedir que dois níveis do mesmo KPI (ex.: "Meta
// faturamento" e "95% da meta") sejam contados ao mesmo tempo — marcar um
// desmarca os demais do grupo (ver handleBonusIndicatorToggle).
function bonusCategoryAchievedPoints(indicators, achievedSet) {
  return indicators.reduce((sum, ind) => sum + (achievedSet.has(ind.id) ? (Number(ind.points) || 0) : 0), 0);
}
function bonusCategoryPercent(indicators, achievedSet) {
  return round2(bonusCategoryAchievedPoints(indicators, achievedSet));
}

async function loadBonusModelSelect() {
  const select = document.getElementById('bonificacao-modelo-select');
  const previous = select.value;
  if (!state.bonusModels.length) {
    select.innerHTML = '';
    return;
  }
  select.innerHTML = state.bonusModels.map((m) => `<option value="${m.id}">${escapeHTML(m.name)}</option>`).join('');
  if (previous && state.bonusModels.some((m) => m.id === previous)) select.value = previous;
}

async function loadBonusModelsView() {
  const monthInput = document.getElementById('competencia-bonificacao').value || currentMonthInput();
  document.getElementById('competencia-bonificacao').value = monthInput;
  const dateStr = monthInputToDate(monthInput);
  state.currentBonificacaoDate = dateStr;

  await loadBonusModelSelect();
  await renderBonusIndicators();
}

document.getElementById('btn-new-bonus-model').addEventListener('click', async () => {
  const name = (prompt('Nome do novo modelo de bonificação:') || '').trim();
  if (!name) return;
  if (state.bonusModels.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    showToast('Já existe um modelo com esse nome.', true);
    return;
  }

  const { data, error } = await sb.from('bonus_models').insert({ name }).select().single();
  if (error) { showToast(error.message, true); return; }

  await loadBonusModels();
  await loadBonusModelSelect();
  document.getElementById('bonificacao-modelo-select').value = data.id;
  await renderBonusIndicators();
  showToast(`Modelo "${name}" criado. Use "+ Novo indicador" para adicionar os indicadores dele.`);
});

async function renderBonusIndicators() {
  const modelId = document.getElementById('bonificacao-modelo-select').value;
  const competencia = state.currentBonificacaoDate;
  const tbodyBon = document.getElementById('tbody-indicadores-bonificacao');
  const tbodyPre = document.getElementById('tbody-indicadores-premiacao');
  const countEl = document.getElementById('bonificacao-employee-count');
  const totaisEl = document.getElementById('bonificacao-totais');

  if (!modelId) {
    tbodyBon.innerHTML = '<tr><td colspan="4" class="empty-row">Selecione um modelo.</td></tr>';
    tbodyPre.innerHTML = '<tr><td colspan="4" class="empty-row">Selecione um modelo.</td></tr>';
    countEl.textContent = '';
    totaisEl.innerHTML = '';
    return;
  }

  const { data: indicators, error: indErr } = await sb.from('bonus_indicators')
    .select('*').eq('bonus_model_id', modelId).order('sort_order');
  if (indErr) { showToast(indErr.message, true); return; }
  state.currentBonusIndicators = indicators || [];

  const { data: achievements, error: achErr } = await sb.from('bonus_indicator_achievements')
    .select('*').eq('competencia', competencia)
    .in('bonus_indicator_id', (indicators || []).map((i) => i.id).length ? (indicators || []).map((i) => i.id) : ['00000000-0000-0000-0000-000000000000']);
  if (achErr) { showToast(achErr.message, true); return; }
  const achievedSet = new Set((achievements || []).filter((a) => a.achieved).map((a) => a.bonus_indicator_id));
  state.currentBonusAchievedSet = achievedSet;

  const renderCategory = (category, tbody) => {
    const rows = (indicators || []).filter((i) => i.category === category);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Nenhum indicador cadastrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((ind) => `
      <tr data-indicator-id="${ind.id}" data-tier-group="${escapeHTML(ind.tier_group || '')}">
        <td><input type="checkbox" data-category="${category}" ${achievedSet.has(ind.id) ? 'checked' : ''}></td>
        <td><input type="text" data-field="name" value="${escapeHTML(ind.name)}"></td>
        <td class="num"><input type="number" step="0.01" min="0" data-field="points" value="${ind.points}"></td>
        <td><button type="button" class="icon-btn" data-action="delete-indicator" aria-label="Excluir indicador">✕</button></td>
      </tr>`).join('');
  };
  renderCategory('bonificacao', tbodyBon);
  renderCategory('premiacao', tbodyPre);

  const employeesForModel = state.employees.filter((emp) => emp.active && emp.bonus_model_id === modelId);
  countEl.textContent = `${employeesForModel.length} funcionário(s) neste modelo`;
  updateBonusTotaisDisplay();
}

function updateBonusTotaisDisplay() {
  const indicators = state.currentBonusIndicators || [];
  const achievedSet = state.currentBonusAchievedSet || new Set();
  const bonIndicators = indicators.filter((i) => i.category === 'bonificacao');
  const preIndicators = indicators.filter((i) => i.category === 'premiacao');
  const bonPct = bonusCategoryPercent(bonIndicators, achievedSet);
  const prePct = bonusCategoryPercent(preIndicators, achievedSet);
  document.getElementById('bonificacao-totais').innerHTML = `
    <div class="stat-tile"><span class="stat-label">Bonificação</span><span class="stat-value">${bonPct.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</span></div>
    <div class="stat-tile"><span class="stat-label">Premiação</span><span class="stat-value">${prePct.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</span></div>`;
  return { bonPct, prePct };
}

document.getElementById('competencia-bonificacao').addEventListener('change', loadBonusModelsView);
document.getElementById('bonificacao-modelo-select').addEventListener('change', renderBonusIndicators);

// Único caso hoje em que a premiação usa uma base diferente da bonificação:
// no modelo Coordenador a premiação incide sobre um valor fixo de R$ 833,33,
// não sobre o valor de bonificação integral do funcionário.
const COORDENADOR_AWARD_REFERENCE_VALUE = 833.33;

async function cascadeBonusModelToEmployees(modelId, competencia, bonPct, prePct) {
  const employeesForModel = state.employees.filter((emp) => emp.active && emp.bonus_model_id === modelId);
  if (!employeesForModel.length) return 0;

  const model = state.bonusModels.find((m) => m.id === modelId);
  const isCoordenador = model && model.name === 'Coordenador';

  const { data: existingEntries, error: fetchErr } = await sb.from('monthly_entries')
    .select('*')
    .eq('competencia', competencia)
    .in('employee_id', employeesForModel.map((emp) => emp.id));
  if (fetchErr) { showToast(fetchErr.message, true); return 0; }
  const entryByEmployee = new Map((existingEntries || []).map((en) => [en.employee_id, en]));

  const rows = employeesForModel.map((emp) => {
    const existing = entryByEmployee.get(emp.id) || {};
    const reference = emp.bonus_reference_value || 0;
    const awardReference = isCoordenador ? COORDENADOR_AWARD_REFERENCE_VALUE : reference;
    const bonusNominal = round2(reference * (bonPct / 100));
    const awardNominal = round2(awardReference * (prePct / 100));
    const bonusCtx = {
      competencia,
      admissionDate: emp.admission_date,
      vacationDays: existing.vacation_days || 0,
      absenceDays: existing.absence_days || 0,
      hourDiscountHours: existing.hour_discount_value || 0,
    };
    return {
      ...existingEntryFields(existing),
      employee_id: emp.id,
      competencia,
      transporte_optante: existing.transporte_optante ?? emp.transporte_optante,
      sindical_optante: existing.sindical_optante ?? emp.sindical_optante,
      bonus_nominal_value: bonusNominal,
      bonus_value: computeFinalBonusAward(bonusNominal, bonusCtx),
      award_nominal_value: awardNominal,
      award_value: computeFinalBonusAward(awardNominal, bonusCtx),
      created_by: state.session.user.id,
    };
  });
  const { error: cascadeError } = await sb.from('monthly_entries').upsert(rows, { onConflict: 'employee_id,competencia' });
  if (cascadeError) { showToast(cascadeError.message, true); return 0; }
  return employeesForModel.length;
}

async function handleBonusIndicatorToggle(checkbox) {
  const tr = checkbox.closest('tr');
  const indicatorId = tr.dataset.indicatorId;
  const tierGroup = tr.dataset.tierGroup;
  const category = checkbox.dataset.category;
  const competencia = state.currentBonificacaoDate;
  const modelId = document.getElementById('bonificacao-modelo-select').value;
  const achievedSet = state.currentBonusAchievedSet;

  // Indicadores do mesmo tier_group são níveis exclusivos: marcar um desmarca
  // os demais do grupo (na tela e no banco).
  const siblingRows = tierGroup
    ? [...(category === 'bonificacao' ? document.getElementById('tbody-indicadores-bonificacao') : document.getElementById('tbody-indicadores-premiacao')).querySelectorAll(`tr[data-tier-group="${CSS.escape(tierGroup)}"]`)]
    : [tr];

  const writes = [];
  if (checkbox.checked) {
    siblingRows.forEach((row) => {
      const id = row.dataset.indicatorId;
      const cb = row.querySelector('input[type="checkbox"]');
      if (id === indicatorId) {
        achievedSet.add(id);
      } else {
        cb.checked = false;
        achievedSet.delete(id);
        writes.push({ bonus_indicator_id: id, competencia, achieved: false });
      }
    });
    writes.push({ bonus_indicator_id: indicatorId, competencia, achieved: true });
  } else {
    achievedSet.delete(indicatorId);
    writes.push({ bonus_indicator_id: indicatorId, competencia, achieved: false });
  }

  const { error } = await sb.from('bonus_indicator_achievements')
    .upsert(writes, { onConflict: 'bonus_indicator_id,competencia' });
  if (error) { showToast(error.message, true); return; }

  const { bonPct, prePct } = updateBonusTotaisDisplay();
  const count = await cascadeBonusModelToEmployees(modelId, competencia, bonPct, prePct);
  showToast(`Aplicado a ${count} funcionário(s).`);
  if (state.currentLancamentoDate === competencia) await loadLancamentos();
}

async function handleBonusIndicatorFieldEdit(el) {
  const tr = el.closest('tr');
  const indicatorId = tr.dataset.indicatorId;
  const field = el.dataset.field;
  let value = el.value;
  if (field === 'points') {
    value = parseFloat(String(value).replace(',', '.')) || 0;
    el.value = value;
  } else {
    value = value.trim();
    if (!value) { showToast('O nome do indicador não pode ficar vazio.', true); return; }
    el.value = value;
  }

  const { error } = await sb.from('bonus_indicators').update({ [field]: value }).eq('id', indicatorId);
  if (error) { showToast(error.message, true); return; }

  const indicator = (state.currentBonusIndicators || []).find((i) => i.id === indicatorId);
  if (indicator) indicator[field] = value;

  const modelId = document.getElementById('bonificacao-modelo-select').value;
  const competencia = state.currentBonificacaoDate;
  const { bonPct, prePct } = updateBonusTotaisDisplay();
  const count = await cascadeBonusModelToEmployees(modelId, competencia, bonPct, prePct);
  showToast(`Indicador atualizado. Aplicado a ${count} funcionário(s).`);
  if (state.currentLancamentoDate === competencia) await loadLancamentos();
}

async function handleBonusIndicatorDelete(btn) {
  const tr = btn.closest('tr');
  const indicatorId = tr.dataset.indicatorId;
  const indicator = (state.currentBonusIndicators || []).find((i) => i.id === indicatorId);
  if (!confirm(`Excluir o indicador "${indicator ? indicator.name : ''}"? Isso também remove o histórico de marcações dele.`)) return;

  const { error } = await sb.from('bonus_indicators').delete().eq('id', indicatorId);
  if (error) { showToast(error.message, true); return; }

  const modelId = document.getElementById('bonificacao-modelo-select').value;
  const competencia = state.currentBonificacaoDate;
  await renderBonusIndicators();
  const { bonPct, prePct } = updateBonusTotaisDisplay();
  const count = await cascadeBonusModelToEmployees(modelId, competencia, bonPct, prePct);
  showToast(`Indicador excluído. Aplicado a ${count} funcionário(s).`);
  if (state.currentLancamentoDate === competencia) await loadLancamentos();
}

async function handleAddIndicator(category) {
  const modelId = document.getElementById('bonificacao-modelo-select').value;
  if (!modelId) return;
  const existing = (state.currentBonusIndicators || []).filter((i) => i.category === category);
  const maxSort = existing.reduce((m, i) => Math.max(m, i.sort_order || 0), 0);

  const { error } = await sb.from('bonus_indicators')
    .insert({ bonus_model_id: modelId, category, name: 'Novo indicador', points: 0, sort_order: maxSort + 1 });
  if (error) { showToast(error.message, true); return; }
  await renderBonusIndicators();
}

document.getElementById('tbody-indicadores-bonificacao').addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') handleBonusIndicatorToggle(e.target);
  else if (e.target.dataset.field) handleBonusIndicatorFieldEdit(e.target);
});
document.getElementById('tbody-indicadores-premiacao').addEventListener('change', (e) => {
  if (e.target.type === 'checkbox') handleBonusIndicatorToggle(e.target);
  else if (e.target.dataset.field) handleBonusIndicatorFieldEdit(e.target);
});
document.getElementById('tbody-indicadores-bonificacao').addEventListener('click', (e) => {
  if (e.target.dataset.action === 'delete-indicator') handleBonusIndicatorDelete(e.target);
});
document.getElementById('tbody-indicadores-premiacao').addEventListener('click', (e) => {
  if (e.target.dataset.action === 'delete-indicator') handleBonusIndicatorDelete(e.target);
});
document.getElementById('btn-add-indicador-bonificacao').addEventListener('click', () => handleAddIndicator('bonificacao'));
document.getElementById('btn-add-indicador-premiacao').addEventListener('click', () => handleAddIndicator('premiacao'));

/* ==========================================================
   Plano de salários
   ========================================================== */
async function loadSalaryPlan() {
  const [{ data: positions, error: posErr }, { data: notes, error: notesErr }] = await Promise.all([
    sb.from('salary_plan_positions').select('*').order('sort_order'),
    sb.from('salary_progression_notes').select('*'),
  ]);
  if (posErr) { showToast(posErr.message, true); return; }
  if (notesErr) { showToast(notesErr.message, true); return; }

  state.salaryPositions = positions || [];
  renderSalaryPositions();

  const notesByKey = new Map((notes || []).map((n) => [n.key, n]));
  document.getElementById('note-regras-gerais').value = notesByKey.get('regras_gerais')?.content || '';
  document.getElementById('note-executivo-vendas').value = notesByKey.get('executivo_vendas')?.content || '';
}

function renderSalaryPositions() {
  const tbody = document.getElementById('tbody-salary-positions');
  if (!state.salaryPositions.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Nenhum cargo cadastrado.</td></tr>';
    return;
  }
  const num = (field, value) => `<input type="number" step="0.01" data-field="${field}" value="${value ?? ''}">`;
  const txt = (field, value) => `<input type="text" data-field="${field}" value="${escapeHTML(value || '')}">`;
  tbody.innerHTML = state.salaryPositions.map((p) => `
    <tr data-id="${p.id}">
      <td>${txt('cargo', p.cargo)}</td>
      <td class="num">${num('cadeira_1', p.cadeira_1)}</td>
      <td class="num">${num('cadeira_2', p.cadeira_2)}</td>
      <td class="num">${num('cadeira_3', p.cadeira_3)}</td>
      <td class="num">${num('cadeira_4', p.cadeira_4)}</td>
      <td class="num">${num('bonificacao_geral', p.bonificacao_geral)}</td>
      <td class="num">${num('aumento_avaliacao', p.aumento_avaliacao)}</td>
      <td>${txt('observacoes', p.observacoes)}</td>
      <td><button type="button" class="icon-btn" data-action="delete-position" aria-label="Excluir cargo">✕</button></td>
    </tr>`).join('');
}

document.getElementById('tbody-salary-positions').addEventListener('change', async (e) => {
  const field = e.target.dataset.field;
  if (!field) return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const value = e.target.type === 'number' ? numOrNull(e.target.value) : (e.target.value.trim() || null);

  const { error } = await sb.from('salary_plan_positions').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { showToast(error.message, true); return; }
  const pos = state.salaryPositions.find((p) => p.id === id);
  if (pos) pos[field] = value;
  showToast('Cargo atualizado.');
});

document.getElementById('tbody-salary-positions').addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete-position') return;
  const tr = e.target.closest('tr');
  const id = tr.dataset.id;
  const pos = state.salaryPositions.find((p) => p.id === id);
  if (!confirm(`Excluir o cargo "${pos ? pos.cargo : ''}"?`)) return;
  const { error } = await sb.from('salary_plan_positions').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  await loadSalaryPlan();
  showToast('Cargo excluído.');
});

document.getElementById('btn-new-salary-position').addEventListener('click', async () => {
  const maxSort = state.salaryPositions.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
  const { error } = await sb.from('salary_plan_positions').insert({ cargo: 'Novo cargo', sort_order: maxSort + 1 });
  if (error) { showToast(error.message, true); return; }
  await loadSalaryPlan();
});

const SALARY_NOTE_TITLES = {
  regras_gerais: 'Regras gerais de progressão',
  executivo_vendas: 'Progressão — Executivo de vendas',
};
async function saveSalaryNote(key, textareaId) {
  const content = document.getElementById(textareaId).value.trim();
  const { error } = await sb.from('salary_progression_notes')
    .upsert({ key, title: SALARY_NOTE_TITLES[key], content, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) { showToast(error.message, true); return; }
  showToast('Observação salva.');
}
document.getElementById('btn-save-note-regras-gerais').addEventListener('click', () => saveSalaryNote('regras_gerais', 'note-regras-gerais'));
document.getElementById('btn-save-note-executivo-vendas').addEventListener('click', () => saveSalaryNote('executivo_vendas', 'note-executivo-vendas'));

/* ==========================================================
   Atualizações de salário
   ========================================================== */
async function loadSalaryUpdates() {
  const { data, error } = await sb.from('salary_updates').select('*').order('data_mudanca', { ascending: false, nullsFirst: false });
  if (error) { showToast(error.message, true); return; }
  state.salaryUpdates = data || [];
  renderSalaryUpdates();
}

function renderSalaryUpdates() {
  const q = normalize(document.getElementById('salary-update-search').value);
  const tbody = document.getElementById('tbody-salary-updates');
  const list = state.salaryUpdates.filter((u) => !q || normalize(u.employee_name).includes(q));
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Nenhuma atualização encontrada.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((u) => `
    <tr>
      <td>${escapeHTML(u.employee_name)}</td>
      <td>${escapeHTML(u.cargo || '—')}</td>
      <td class="num">${u.salario_atual != null ? formatBRL(u.salario_atual) : '—'}</td>
      <td class="num">${u.salario_atualizado != null ? formatBRL(u.salario_atualizado) : '—'}</td>
      <td>${escapeHTML(u.cadeira || '—')}</td>
      <td>${u.data_mudanca ? formatDateBR(u.data_mudanca) : '—'}</td>
      <td class="num">${u.nota_avaliacao != null ? u.nota_avaliacao : '—'}</td>
      <td>${u.data_avaliacao ? formatDateBR(u.data_avaliacao) : '—'}</td>
      <td class="row-actions"><button class="btn btn-ghost btn-edit-salary-update" data-id="${u.id}" type="button">Editar</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit-salary-update').forEach((btn) => {
    btn.addEventListener('click', () => openSalaryUpdateModal(btn.dataset.id));
  });
}
document.getElementById('salary-update-search').addEventListener('input', renderSalaryUpdates);
document.getElementById('btn-new-salary-update').addEventListener('click', () => openSalaryUpdateModal(null));

function openSalaryUpdateModal(id) {
  const form = document.getElementById('form-salary-update');
  form.reset();
  document.getElementById('salary-update-form-error').hidden = true;
  document.getElementById('salary-update-id').value = id || '';
  const isEdit = !!id;
  document.getElementById('modal-salary-update-title').textContent = isEdit ? 'Editar atualização de salário' : 'Nova atualização de salário';
  document.getElementById('btn-delete-salary-update').hidden = !isEdit;
  if (isEdit) {
    const u = state.salaryUpdates.find((x) => x.id === id);
    if (!u) return;
    document.getElementById('salary-update-name').value = u.employee_name || '';
    document.getElementById('salary-update-cargo').value = u.cargo || '';
    document.getElementById('salary-update-cadeira').value = u.cadeira || '';
    document.getElementById('salary-update-current').value = u.salario_atual ?? '';
    document.getElementById('salary-update-new').value = u.salario_atualizado ?? '';
    document.getElementById('salary-update-bonus').value = u.bonificacao_variavel ?? '';
    document.getElementById('salary-update-date').value = u.data_mudanca || '';
    document.getElementById('salary-update-score').value = u.nota_avaliacao ?? '';
    document.getElementById('salary-update-score-date').value = u.data_avaliacao || '';
    document.getElementById('salary-update-notes').value = u.notes || '';
  }
  openModal('modal-salary-update');
}

document.getElementById('form-salary-update').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('salary-update-id').value;
  const payload = {
    employee_name: document.getElementById('salary-update-name').value.trim(),
    cargo: document.getElementById('salary-update-cargo').value.trim() || null,
    cadeira: document.getElementById('salary-update-cadeira').value || null,
    salario_atual: numOrNull(document.getElementById('salary-update-current').value),
    salario_atualizado: numOrNull(document.getElementById('salary-update-new').value),
    bonificacao_variavel: numOrNull(document.getElementById('salary-update-bonus').value),
    data_mudanca: document.getElementById('salary-update-date').value || null,
    nota_avaliacao: numOrNull(document.getElementById('salary-update-score').value),
    data_avaliacao: document.getElementById('salary-update-score-date').value || null,
    notes: document.getElementById('salary-update-notes').value.trim() || null,
  };
  const errEl = document.getElementById('salary-update-form-error');
  if (!payload.employee_name) { errEl.textContent = 'Informe o nome do colaborador.'; errEl.hidden = false; return; }
  let error;
  if (id) {
    ({ error } = await sb.from('salary_updates').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('salary_updates').insert(payload));
  }
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  closeModal('modal-salary-update');
  showToast('Atualização de salário salva.');
  await loadSalaryUpdates();
});

document.getElementById('btn-delete-salary-update').addEventListener('click', async () => {
  const id = document.getElementById('salary-update-id').value;
  if (!id) return;
  if (!confirm('Excluir esta atualização de salário?')) return;
  const { error } = await sb.from('salary_updates').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-salary-update');
  showToast('Atualização excluída.');
  await loadSalaryUpdates();
});

/* ==========================================================
   Propostas de contratação (PJ/CLT)
   ========================================================== */
async function loadProposals() {
  const { data, error } = await sb.from('salary_proposals').select('*').order('created_at', { ascending: false });
  if (error) { showToast(error.message, true); return; }
  state.proposals = data || [];
  renderProposals();
  populateProposalExportSelect();
}

function renderProposals() {
  const tipoFilter = document.getElementById('propostas-filtro-tipo').value;
  const tbody = document.getElementById('tbody-proposals');
  const list = state.proposals.filter((p) => !tipoFilter || p.tipo === tipoFilter);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhuma proposta cadastrada.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((p) => `
    <tr>
      <td>${escapeHTML(p.candidate_name)}</td>
      <td>${escapeHTML(p.tipo)}</td>
      <td>${escapeHTML(p.cargo || '—')}</td>
      <td>${escapeHTML(p.cadeira || '—')}</td>
      <td class="num">${formatBRL(p.salario)}</td>
      <td>${formatDateBR((p.created_at || '').slice(0, 10))}</td>
      <td class="row-actions"><button class="btn btn-ghost btn-edit-proposal" data-id="${p.id}" type="button">Editar</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit-proposal').forEach((btn) => {
    btn.addEventListener('click', () => openProposalModal(btn.dataset.id));
  });
}
document.getElementById('propostas-filtro-tipo').addEventListener('change', renderProposals);
document.getElementById('btn-new-proposal').addEventListener('click', () => openProposalModal(null));

function openProposalModal(id) {
  const form = document.getElementById('form-proposal');
  form.reset();
  document.getElementById('proposal-form-error').hidden = true;
  document.getElementById('proposal-id').value = id || '';
  const isEdit = !!id;
  document.getElementById('modal-proposal-title').textContent = isEdit ? 'Editar proposta' : 'Nova proposta';
  document.getElementById('btn-delete-proposal').hidden = !isEdit;
  if (isEdit) {
    const p = state.proposals.find((x) => x.id === id);
    if (!p) return;
    document.getElementById('proposal-candidate').value = p.candidate_name || '';
    document.getElementById('proposal-tipo').value = p.tipo || 'PJ';
    document.getElementById('proposal-cargo').value = p.cargo || '';
    document.getElementById('proposal-cadeira').value = p.cadeira || '';
    document.getElementById('proposal-salario').value = p.salario ?? '';
    document.getElementById('proposal-bonificacao').value = p.bonificacao_variavel ?? '';
    document.getElementById('proposal-va').value = p.vale_alimentacao ?? '';
    document.getElementById('proposal-combustivel-vt').value = p.auxilio_combustivel_vt ?? '';
    document.getElementById('proposal-odonto').value = p.plano_odontologico || '';
    document.getElementById('proposal-saude').value = p.plano_saude || '';
    document.getElementById('proposal-clube').value = p.beneficios_clube || '';
    document.getElementById('proposal-horario').value = p.horario_trabalho || '';
    document.getElementById('proposal-observacoes').value = p.observacoes || '';
  } else {
    document.getElementById('proposal-tipo').value = 'PJ';
  }
  openModal('modal-proposal');
}

document.getElementById('form-proposal').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('proposal-id').value;
  const payload = {
    candidate_name: document.getElementById('proposal-candidate').value.trim(),
    tipo: document.getElementById('proposal-tipo').value,
    cargo: document.getElementById('proposal-cargo').value.trim() || null,
    cadeira: document.getElementById('proposal-cadeira').value || null,
    salario: numOrNull(document.getElementById('proposal-salario').value),
    bonificacao_variavel: numOrNull(document.getElementById('proposal-bonificacao').value),
    vale_alimentacao: numOrNull(document.getElementById('proposal-va').value),
    auxilio_combustivel_vt: numOrNull(document.getElementById('proposal-combustivel-vt').value),
    plano_odontologico: document.getElementById('proposal-odonto').value.trim() || null,
    plano_saude: document.getElementById('proposal-saude').value.trim() || null,
    beneficios_clube: document.getElementById('proposal-clube').value.trim() || null,
    horario_trabalho: document.getElementById('proposal-horario').value.trim() || null,
    observacoes: document.getElementById('proposal-observacoes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const errEl = document.getElementById('proposal-form-error');
  if (!payload.candidate_name) { errEl.textContent = 'Informe o nome do candidato.'; errEl.hidden = false; return; }
  let error;
  if (id) {
    ({ error } = await sb.from('salary_proposals').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('salary_proposals').insert(payload));
  }
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  closeModal('modal-proposal');
  showToast('Proposta salva.');
  await loadProposals();
});

document.getElementById('btn-delete-proposal').addEventListener('click', async () => {
  const id = document.getElementById('proposal-id').value;
  if (!id) return;
  if (!confirm('Excluir esta proposta?')) return;
  const { error } = await sb.from('salary_proposals').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-proposal');
  showToast('Proposta excluída.');
  await loadProposals();
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
  { label: 'Horas extras diurna', value: (r) => hoursToClock(r.entry ? r.entry.overtime_hours : 0), numeric: 'plain' },
  { label: 'Horas extras totais 100%', value: (r) => hoursToClock(r.entry ? r.entry.overtime_hours_100 : 0), numeric: 'plain' },
  { label: 'Adicional noturno (horas)', value: (r) => hoursToClock(r.entry ? r.entry.night_shift_hours : 0), numeric: 'plain' },
  { label: 'Horas totais de desconto', value: (r) => hoursToClock(r.entry ? r.entry.hour_discount_value : 0), numeric: 'plain' },
  { label: 'Desconto odontológico', value: (r) => (r.employee.dental_plan_fixed_value || 0), numeric: 'currency' },
  { label: 'Plano de saúde (fixo + coparticipação)', value: (r) => round2((r.employee.health_plan_fixed_value || 0) + (r.entry ? (r.entry.health_coparticipation || 0) : 0)), numeric: 'currency' },
  { label: 'Desconto farmácia', value: (r) => (r.entry ? r.entry.pharmacy_discount : 0), numeric: 'currency' },
  { label: 'Vale-transporte (6%)', value: (r) => ((r.entry ? r.entry.transporte_optante : r.employee.transporte_optante) ? 'Sim' : 'Não') },
  { label: 'Contribuição sindical (1%)', value: (r) => ((r.entry ? r.entry.sindical_optante : r.employee.sindical_optante) ? 'Sim' : 'Não') },
  { label: 'Comissão', value: (r) => (r.entry ? r.entry.commission_value : 0), numeric: 'currency' },
  { label: 'Bonificação', value: (r) => (r.entry ? r.entry.bonus_value : 0), numeric: 'currency' },
  { label: 'Premiação', value: (r) => (r.entry ? r.entry.award_value : 0), numeric: 'currency' },
  { label: 'Reembolso', value: (r) => (r.entry ? r.entry.reimbursement_value : 0), numeric: 'currency' },
  { label: 'Desconto atend. psicológico', value: (r) => (r.entry ? r.entry.psychological_discount : 0), numeric: 'currency' },
  { label: 'Desconto autorizado', value: (r) => r.comprasSum || 0, numeric: 'currency' },
  { label: 'Observações', value: (r) => (r.entry ? (r.entry.notes || '') : '') },
];

// Relatório reduzido usado quando "Somente optantes de adiantamento salarial" está
// marcado: só identificação do funcionário + confirmação do percentual fixo (40%),
// sem nenhuma coluna de folha.
const SALARY_ADVANCE_COLUMNS = [
  { label: 'Nome', value: (r) => r.employee.full_name },
  { label: 'Matrícula', value: (r) => r.employee.registration_number || '' },
  { label: 'Empresa', value: (r) => r.employee.company || '' },
  { label: 'Adiantamento salarial', value: () => '40%' },
];

// Relatório reduzido usado quando "Somente optantes de vale-transporte" está
// marcado: identificação do funcionário + a cidade onde ele pega o transporte.
const VT_COLUMNS = [
  { label: 'Nome', value: (r) => r.employee.full_name },
  { label: 'Matrícula', value: (r) => r.employee.registration_number || '' },
  { label: 'Empresa', value: (r) => r.employee.company || '' },
  { label: 'Vale-transporte', value: () => 'Sim' },
  { label: 'Cidade', value: (r) => r.employee.transporte_city || '' },
];

// Relatório reduzido usado quando "Somente auxílio combustível diferenciado" está
// marcado: identificação do funcionário + a cidade e o valor combinado com ele.
const FUEL_AID_COLUMNS = [
  { label: 'Nome', value: (r) => r.employee.full_name },
  { label: 'Matrícula', value: (r) => r.employee.registration_number || '' },
  { label: 'Empresa', value: (r) => r.employee.company || '' },
  { label: 'Cidade', value: (r) => r.employee.fuel_aid_city || '' },
  { label: 'Valor do auxílio combustível', value: (r) => r.employee.fuel_aid_value || 0, numeric: 'currency' },
];

// Relatório reduzido usado quando "Somente optantes de auxílio combustível padrão"
// está marcado: quem não é diferenciado nem optante de VT, com o valor padrão vigente.
const STANDARD_FUEL_AID_COLUMNS = [
  { label: 'Nome', value: (r) => r.employee.full_name },
  { label: 'Matrícula', value: (r) => r.employee.registration_number || '' },
  { label: 'Empresa', value: (r) => r.employee.company || '' },
  { label: 'Valor do auxílio combustível', value: (r) => effectiveFuelAidValue(r.employee), numeric: 'currency' },
];

// Os checkboxes de relatório reduzido são mutuamente exclusivos — no máximo um
// modo reduzido ativo por vez; sem nenhum marcado, é o relatório completo.
function getExportMode() {
  if (document.getElementById('exportar-somente-adiantamento').checked) return 'adiantamento';
  if (document.getElementById('exportar-somente-vt').checked) return 'vt';
  if (document.getElementById('exportar-somente-combustivel').checked) return 'combustivel';
  if (document.getElementById('exportar-somente-combustivel-padrao').checked) return 'combustivel_padrao';
  return 'full';
}

function getActiveExportColumns() {
  const mode = getExportMode();
  if (mode === 'adiantamento') return SALARY_ADVANCE_COLUMNS;
  if (mode === 'vt') return VT_COLUMNS;
  if (mode === 'combustivel') return FUEL_AID_COLUMNS;
  if (mode === 'combustivel_padrao') return STANDARD_FUEL_AID_COLUMNS;
  return EXPORT_COLUMNS;
}

function getExportFilePrefix() {
  const mode = getExportMode();
  if (mode === 'adiantamento') return 'adiantamento_salarial';
  if (mode === 'vt') return 'vale_transporte';
  if (mode === 'combustivel') return 'auxilio_combustivel';
  if (mode === 'combustivel_padrao') return 'auxilio_combustivel_padrao';
  return 'folha';
}

async function loadExportPreview() {
  const monthInput = document.getElementById('competencia-exportar').value || currentMonthInput();
  document.getElementById('competencia-exportar').value = monthInput;
  const dateStr = monthInputToDate(monthInput);

  const mode = getExportMode();
  let activeEmployees = sortByCompanyThenName(state.employees.filter((e) => e.active));
  if (mode === 'adiantamento') activeEmployees = activeEmployees.filter((e) => e.salary_advance_optante);
  if (mode === 'vt') activeEmployees = activeEmployees.filter((e) => e.transporte_optante);
  if (mode === 'combustivel') activeEmployees = activeEmployees.filter((e) => e.fuel_aid_differentiated);
  if (mode === 'combustivel_padrao') activeEmployees = activeEmployees.filter((e) => !e.fuel_aid_differentiated && !e.transporte_optante);

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

  const alertEl = document.getElementById('exportar-alerta');
  if (mode !== 'full') {
    alertEl.hidden = true;
  } else {
    const missing = currentExportRows.filter((r) => !r.entry).map((r) => r.employee.full_name);
    if (missing.length) {
      alertEl.hidden = false;
      alertEl.textContent = `Sem lançamento neste mês: ${missing.join(', ')}. Complete em "Lançamentos mensais" antes de exportar.`;
    } else {
      alertEl.hidden = true;
    }
  }

  renderExportTable();
}

function renderExportTable() {
  const mode = getExportMode();
  const columns = getActiveExportColumns();
  document.getElementById('thead-exportar').innerHTML = `<tr>${columns.map((c) => `<th${c.numeric ? ' class="num"' : ''}>${c.label}</th>`).join('')}</tr>`;
  const tbody = document.getElementById('tbody-exportar');
  if (!currentExportRows.length) {
    const emptyLabel = mode === 'adiantamento' ? 'Nenhum funcionário optante de adiantamento salarial.'
      : mode === 'vt' ? 'Nenhum funcionário optante de vale-transporte.'
      : mode === 'combustivel' ? 'Nenhum funcionário com auxílio combustível diferenciado.'
      : mode === 'combustivel_padrao' ? 'Nenhum funcionário optante de auxílio combustível padrão.'
      : 'Nenhum funcionário ativo.';
    tbody.innerHTML = `<tr><td class="empty-row">${emptyLabel}</td></tr>`;
    return;
  }
  tbody.innerHTML = currentExportRows.map((r) => {
    const rowStyle = mode === 'full' && !r.entry ? ' style="background:var(--warning-soft)"' : '';
    const cells = columns.map((c) => {
      const v = c.value(r);
      const display = c.numeric === 'currency' ? formatBRL(v) : (c.numeric === 'plain' ? String(v) : escapeHTML(v));
      return `<td${c.numeric ? ' class="num"' : ''}>${display}</td>`;
    }).join('');
    return `<tr${rowStyle}>${cells}</tr>`;
  }).join('');
}

document.getElementById('competencia-exportar').addEventListener('change', loadExportPreview);

// Checkboxes de relatório reduzido são mutuamente exclusivos: marcar um desmarca os outros.
const EXPORT_MODE_CHECKBOX_IDS = ['exportar-somente-adiantamento', 'exportar-somente-vt', 'exportar-somente-combustivel', 'exportar-somente-combustivel-padrao'];
EXPORT_MODE_CHECKBOX_IDS.forEach((id) => {
  document.getElementById(id).addEventListener('change', (e) => {
    if (e.target.checked) {
      EXPORT_MODE_CHECKBOX_IDS.filter((otherId) => otherId !== id)
        .forEach((otherId) => { document.getElementById(otherId).checked = false; });
    }
    loadExportPreview();
  });
});

function buildCSV() {
  const sep = ';';
  const columns = getActiveExportColumns();
  const headerRow = columns.map((c) => c.label).join(sep);
  const rows = currentExportRows.map((r) => columns.map((c) => {
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
  const columns = getActiveExportColumns();
  const headerRow = columns.map((c) => c.label);
  const dataRows = currentExportRows.map((r) => columns.map((c) => c.value(r)));
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Folha');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const monthLabel = document.getElementById('competencia-exportar').value || 'export';
  const prefix = getExportFilePrefix();
  try {
    const status = await saveFile(`${prefix}_${monthLabel}.xlsx`, blob);
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
  const prefix = getExportFilePrefix();
  try {
    const status = await saveFile(`${prefix}_${monthLabel}.csv`, blob);
    if (status === 'saved') showToast('CSV salvo.');
    else if (status === 'delivered') showToast('CSV enviado.');
  } catch (err) {
    handleDownloadError(err);
  }
}

document.getElementById('btn-export-xlsx').addEventListener('click', exportXLSX);
document.getElementById('btn-export-csv').addEventListener('click', exportCSVFile);

function populateProposalExportSelect() {
  const select = document.getElementById('exportar-proposta-select');
  const previous = select.value;
  select.innerHTML = '<option value="">Selecione…</option>' + state.proposals.map((p) =>
    `<option value="${p.id}">${escapeHTML(p.candidate_name)} — ${escapeHTML(p.tipo)} — ${formatDateBR((p.created_at || '').slice(0, 10))}</option>`).join('');
  if (previous && state.proposals.some((p) => p.id === previous)) select.value = previous;
}

function getSelectedProposal() {
  const id = document.getElementById('exportar-proposta-select').value;
  const proposal = state.proposals.find((p) => p.id === id);
  if (!proposal) showToast('Selecione uma proposta.', true);
  return proposal;
}

// Busca a logo local e converte para data URL, pro jsPDF poder desenhá-la —
// addImage do jsPDF não aceita uma URL de arquivo direto, só data URL/base64.
let logoDataUrlCache = null;
async function getLogoDataUrl() {
  if (logoDataUrlCache) return logoDataUrlCache;
  try {
    const res = await fetch('logo-icon.png');
    const blob = await res.blob();
    logoDataUrlCache = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    logoDataUrlCache = null;
  }
  return logoDataUrlCache;
}

// Documento em PDF, já no verde da marca, para mandar direto ao candidato —
// bem mais apresentável que uma planilha crua de Item/Valor.
async function buildProposalPdf(proposal) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const darkGreen = [43, 60, 41];
  const medGreen = [59, 117, 59];
  const lightGreen = [227, 239, 226];

  doc.setFillColor(...darkGreen);
  doc.rect(0, 0, pageWidth, 90, 'F');

  const logoDataUrl = await getLogoDataUrl();
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', 40, 20, 50, 50); } catch { /* segue sem logo se o formato não colar */ }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Uniformes Paraná', 105, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Proposta de contratação', 105, 62);

  let y = 125;
  doc.setTextColor(...darkGreen);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(proposal.candidate_name, 40, y);

  y += 20;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  const infoLine = [
    `Tipo de contrato: ${proposal.tipo}`,
    proposal.cargo ? `Cargo: ${proposal.cargo}` : null,
    proposal.cadeira ? `Cadeira: ${proposal.cadeira}` : null,
  ].filter(Boolean).join('   •   ');
  doc.text(infoLine, 40, y);

  y += 20;
  const rows = [
    [proposal.tipo === 'PJ' ? 'Valor (PJ)' : 'Salário', formatBRL(proposal.salario)],
    ['Bonificação variável', formatBRL(proposal.bonificacao_variavel)],
    ['Vale alimentação', formatBRL(proposal.vale_alimentacao)],
    ['Auxílio combustível ou VT', formatBRL(proposal.auxilio_combustivel_vt)],
    ['Plano odontológico', proposal.plano_odontologico || '—'],
    ['Plano de saúde', proposal.plano_saude || '—'],
    ['Clube de convênios / cashback / TotalPass', proposal.beneficios_clube || '—'],
    ['Horário de trabalho', proposal.horario_trabalho || '—'],
  ];

  doc.autoTable({
    startY: y,
    head: [['Benefício', 'Valor']],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: medGreen, textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 8, textColor: [40, 40, 40] },
    alternateRowStyles: { fillColor: lightGreen },
    margin: { left: 40, right: 40 },
  });

  if (proposal.observacoes) {
    const finalY = doc.lastAutoTable.finalY + 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...darkGreen);
    doc.text('Observações', 40, finalY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const lines = doc.splitTextToSize(proposal.observacoes, pageWidth - 80);
    doc.text(lines, 40, finalY + 16);
  }

  return doc;
}

document.getElementById('btn-export-proposal-pdf').addEventListener('click', async () => {
  const proposal = getSelectedProposal();
  if (!proposal) return;
  try {
    const doc = await buildProposalPdf(proposal);
    const blob = doc.output('blob');
    const status = await saveFile(`proposta_${(proposal.candidate_name || 'candidato').replace(/\s+/g, '_')}.pdf`, blob);
    if (status === 'saved') showToast('PDF salvo.');
    else if (status === 'delivered') showToast('PDF enviado.');
  } catch (err) {
    handleDownloadError(err);
  }
});

// Relatório com todas as propostas já criadas (uma linha por proposta),
// em vez do detalhe de uma única proposta acima.
const PROPOSAL_LIST_COLUMNS = [
  { label: 'Candidato', value: (p) => p.candidate_name },
  { label: 'Tipo', value: (p) => p.tipo },
  { label: 'Cargo', value: (p) => p.cargo || '' },
  { label: 'Cadeira', value: (p) => p.cadeira || '' },
  { label: 'Salário', value: (p) => p.salario || 0, numeric: true },
  { label: 'Bonificação variável', value: (p) => p.bonificacao_variavel || 0, numeric: true },
  { label: 'Vale alimentação', value: (p) => p.vale_alimentacao || 0, numeric: true },
  { label: 'Auxílio combustível ou VT', value: (p) => p.auxilio_combustivel_vt || 0, numeric: true },
  { label: 'Plano odontológico', value: (p) => p.plano_odontologico || '' },
  { label: 'Plano de saúde', value: (p) => p.plano_saude || '' },
  { label: 'Clube de convênios / cashback / TotalPass', value: (p) => p.beneficios_clube || '' },
  { label: 'Horário de trabalho', value: (p) => p.horario_trabalho || '' },
  { label: 'Observações', value: (p) => p.observacoes || '' },
  { label: 'Data', value: (p) => formatDateBR((p.created_at || '').slice(0, 10)) },
];

document.getElementById('btn-export-proposals-list-xlsx').addEventListener('click', async () => {
  if (!state.proposals.length) { showToast('Nenhuma proposta cadastrada.', true); return; }
  const header = PROPOSAL_LIST_COLUMNS.map((c) => c.label);
  const dataRows = state.proposals.map((p) => PROPOSAL_LIST_COLUMNS.map((c) => c.value(p)));
  const ws = XLSX.utils.aoa_to_sheet([header, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Propostas');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try {
    const status = await saveFile('propostas.xlsx', blob);
    if (status === 'saved') showToast('Planilha salva.');
    else if (status === 'delivered') showToast('Planilha enviada.');
  } catch (err) {
    handleDownloadError(err);
  }
});

document.getElementById('btn-export-proposals-list-csv').addEventListener('click', async () => {
  if (!state.proposals.length) { showToast('Nenhuma proposta cadastrada.', true); return; }
  const header = PROPOSAL_LIST_COLUMNS.map((c) => c.label);
  const dataRows = state.proposals.map((p) => PROPOSAL_LIST_COLUMNS.map((c) => {
    const v = c.value(p);
    return typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '').replace(/;/g, ',');
  }));
  const csvBody = [header.join(';'), ...dataRows.map((r) => r.join(';'))].join('\r\n');
  const blob = new Blob([`﻿${csvBody}`], { type: 'text/csv;charset=utf-8' });
  try {
    const status = await saveFile('propostas.csv', blob);
    if (status === 'saved') showToast('CSV salvo.');
    else if (status === 'delivered') showToast('CSV enviado.');
  } catch (err) {
    handleDownloadError(err);
  }
});

/* ==========================================================
   Calendário RH / Endomarketing
   ========================================================== */
const CALENDAR_MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const CALENDAR_WEEKDAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const POSTIT_COLORS = ['#FFF3A6', '#FFD1DC', '#BEE3F8', '#C8F0C8', '#FFDAB0', '#E0D4F7'];

function calendarWeekdayName(year, month, day) {
  if (!year || !month || !day) return '';
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return ''; // dia inválido pro mês (ex.: 31 de abril)
  return CALENDAR_WEEKDAY_NAMES[d.getDay()];
}

// Semana do mês em blocos de 7 dias (1-7, 8-14, 15-21, 22-28, 29+) — o bloco
// que contém o último dia do mês é sempre chamado de "Última semana", mesmo
// quando também teria um número (ex.: fevereiro de 28 dias vira só 4 blocos).
function calendarWeekOfMonth(year, month, day) {
  if (!year || !month || !day) return '';
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return '';
  const weekNum = Math.ceil(day / 7);
  const totalWeeks = Math.ceil(daysInMonth / 7);
  if (weekNum === totalWeeks) return 'Última semana';
  return ['1ª semana', '2ª semana', '3ª semana', '4ª semana', '5ª semana'][weekNum - 1];
}

async function loadCalendarRH() {
  if (!state.calendarYear) state.calendarYear = new Date().getFullYear();
  document.getElementById('calendar-year-display').textContent = state.calendarYear;

  const { data, error } = await sb.from('hr_calendar_events').select('*').eq('year', state.calendarYear).order('month').order('sort_order');
  if (error) { showToast(error.message, true); return; }
  state.calendarEvents = data || [];
  renderCalendarGrid();
}

function renderCalendarGrid() {
  const grid = document.getElementById('calendar-grid');
  const byMonth = new Map();
  CALENDAR_MONTH_NAMES.forEach((_, i) => byMonth.set(i + 1, []));
  state.calendarEvents.forEach((ev) => { (byMonth.get(ev.month) || []).push(ev); });
  // Dentro do mês: atividades do mês todo (sem dia) primeiro, depois por dia.
  byMonth.forEach((list) => list.sort((a, b) => (a.day ?? -1) - (b.day ?? -1)));

  grid.innerHTML = CALENDAR_MONTH_NAMES.map((name, idx) => {
    const monthNum = idx + 1;
    const events = byMonth.get(monthNum) || [];
    const notesHtml = events.length
      ? events.map((ev) => `
        <div class="postit" style="background:${escapeHTML(ev.color || POSTIT_COLORS[0])}" data-id="${ev.id}">
          ${ev.day ? `<div class="postit-day">Dia ${ev.day} · ${escapeHTML(calendarWeekdayName(ev.year, ev.month, ev.day))} · ${escapeHTML(calendarWeekOfMonth(ev.year, ev.month, ev.day))}</div>` : ''}
          <div class="postit-title">${escapeHTML(ev.title)}</div>
          <button type="button" class="postit-delete" data-action="delete" aria-label="Excluir">✕</button>
        </div>`).join('')
      : '<p class="muted empty-row">Nenhuma atividade.</p>';
    return `
      <div class="calendar-month-card">
        <div class="calendar-month-header">${name}</div>
        <div class="calendar-month-notes">${notesHtml}</div>
        <button type="button" class="btn-add-month-event" data-month="${monthNum}">+ Atividade</button>
      </div>`;
  }).join('');
}

document.getElementById('calendar-grid').addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('[data-action="delete"]');
  if (deleteBtn) {
    e.stopPropagation();
    deleteCalendarEvent(deleteBtn.closest('.postit').dataset.id);
    return;
  }
  const postit = e.target.closest('.postit');
  if (postit) { openCalendarEventModal(postit.dataset.id); return; }
  const addBtn = e.target.closest('.btn-add-month-event');
  if (addBtn) { openCalendarEventModal(null, Number(addBtn.dataset.month)); }
});

document.getElementById('btn-calendar-prev-year').addEventListener('click', () => {
  state.calendarYear = (state.calendarYear || new Date().getFullYear()) - 1;
  loadCalendarRH();
});
document.getElementById('btn-calendar-next-year').addEventListener('click', () => {
  state.calendarYear = (state.calendarYear || new Date().getFullYear()) + 1;
  loadCalendarRH();
});
document.getElementById('btn-new-calendar-event').addEventListener('click', () => openCalendarEventModal(null));

function renderCalendarColorPicker(selected) {
  const wrap = document.getElementById('calendar-event-color-picker');
  wrap.innerHTML = POSTIT_COLORS.map((c) => `<button type="button" class="postit-swatch${c === selected ? ' selected' : ''}" style="background:${c}" data-color="${c}" aria-label="Cor ${c}"></button>`).join('');
}
document.getElementById('calendar-event-color-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('.postit-swatch');
  if (!btn) return;
  document.getElementById('calendar-event-color').value = btn.dataset.color;
  document.querySelectorAll('#calendar-event-color-picker .postit-swatch').forEach((s) => s.classList.toggle('selected', s === btn));
});

function openCalendarEventModal(id, presetMonth) {
  const form = document.getElementById('form-calendar-event');
  form.reset();
  document.getElementById('calendar-event-form-error').hidden = true;
  document.getElementById('calendar-event-id').value = id || '';
  const isEdit = !!id;
  document.getElementById('modal-calendar-event-title').textContent = isEdit ? 'Editar atividade' : 'Nova atividade';
  document.getElementById('btn-delete-calendar-event').hidden = !isEdit;
  document.getElementById('calendar-event-year').value = state.calendarYear || new Date().getFullYear();

  let color = POSTIT_COLORS[0];
  if (isEdit) {
    const ev = state.calendarEvents.find((x) => x.id === id);
    if (!ev) return;
    document.getElementById('calendar-event-month').value = ev.month;
    document.getElementById('calendar-event-year').value = ev.year;
    document.getElementById('calendar-event-day').value = ev.day || '';
    document.getElementById('calendar-event-title-input').value = ev.title || '';
    color = ev.color || color;
  } else if (presetMonth) {
    document.getElementById('calendar-event-month').value = presetMonth;
  }
  document.getElementById('calendar-event-color').value = color;
  renderCalendarColorPicker(color);
  updateCalendarWeekdayHint();
  openModal('modal-calendar-event');
}

function updateCalendarWeekdayHint() {
  const month = parseInt(document.getElementById('calendar-event-month').value, 10);
  const year = parseInt(document.getElementById('calendar-event-year').value, 10);
  const day = parseInt(document.getElementById('calendar-event-day').value, 10);
  const hintEl = document.getElementById('calendar-event-weekday-hint');
  if (!day) { hintEl.textContent = ''; return; }
  const weekday = calendarWeekdayName(year, month, day);
  if (!weekday) { hintEl.textContent = 'Esse dia não existe nesse mês.'; return; }
  const weekOfMonth = calendarWeekOfMonth(year, month, day);
  hintEl.textContent = `Cai em uma ${weekday}, na ${weekOfMonth.toLowerCase()} do mês.`;
}
['calendar-event-day', 'calendar-event-month', 'calendar-event-year'].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener('input', updateCalendarWeekdayHint);
  el.addEventListener('change', updateCalendarWeekdayHint);
});

document.getElementById('form-calendar-event').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('calendar-event-id').value;
  const payload = {
    month: parseInt(document.getElementById('calendar-event-month').value, 10),
    year: parseInt(document.getElementById('calendar-event-year').value, 10),
    day: numOrNull(document.getElementById('calendar-event-day').value),
    title: document.getElementById('calendar-event-title-input').value.trim(),
    color: document.getElementById('calendar-event-color').value || POSTIT_COLORS[0],
  };
  const errEl = document.getElementById('calendar-event-form-error');
  if (!payload.title) { errEl.textContent = 'Informe a atividade.'; errEl.hidden = false; return; }
  if (!payload.month || !payload.year) { errEl.textContent = 'Informe mês e ano.'; errEl.hidden = false; return; }
  let error;
  if (id) {
    ({ error } = await sb.from('hr_calendar_events').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', id));
  } else {
    ({ error } = await sb.from('hr_calendar_events').insert(payload));
  }
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  closeModal('modal-calendar-event');
  showToast('Atividade salva.');
  if (payload.year === state.calendarYear) await loadCalendarRH();
});

document.getElementById('btn-delete-calendar-event').addEventListener('click', async () => {
  const id = document.getElementById('calendar-event-id').value;
  if (!id) return;
  const ok = await deleteCalendarEvent(id);
  if (ok) closeModal('modal-calendar-event');
});

async function deleteCalendarEvent(id) {
  if (!confirm('Excluir esta atividade?')) return false;
  const { error } = await sb.from('hr_calendar_events').delete().eq('id', id);
  if (error) { showToast(error.message, true); return false; }
  showToast('Atividade excluída.');
  await loadCalendarRH();
  return true;
}

/* ==========================================================
   Fichas de registro de novos colaboradores
   ========================================================== */
const REGISTRATION_COMPANIES = [
  { name: 'PRC Confecções LTDA', cnpj: '13.331.208/0001-35' },
  { name: 'UPEXPRESS UNIFORMES LTDA (Filial)', cnpj: '24.524.857/0002-50' },
  { name: 'UPEXPRESS UNIFORMES LTDA', cnpj: '24.524.857/0001-79' },
];

function populateRegistrationCompanySelect() {
  const select = document.getElementById('reg-company');
  select.innerHTML = REGISTRATION_COMPANIES.map((c) => `<option value="${escapeHTML(c.cnpj)}">${escapeHTML(c.name)} — ${escapeHTML(c.cnpj)}</option>`).join('');
}
document.getElementById('reg-company').addEventListener('change', () => {
  const company = REGISTRATION_COMPANIES.find((c) => c.cnpj === document.getElementById('reg-company').value);
  document.getElementById('reg-company-cnpj').value = company ? company.cnpj : '';
});

async function loadRegistrations() {
  const { data, error } = await sb.from('employee_registration_forms').select('*').order('created_at', { ascending: false });
  if (error) { showToast(error.message, true); return; }
  state.registrations = data || [];
  renderRegistrations();
}

function renderRegistrations() {
  const q = normalize(document.getElementById('registration-search').value);
  const tbody = document.getElementById('tbody-registrations');
  const list = state.registrations.filter((r) => !q || normalize(r.full_name).includes(q));
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Nenhuma ficha cadastrada.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map((r) => `
    <tr>
      <td>${escapeHTML(r.full_name)}</td>
      <td>${escapeHTML(r.company_name)}</td>
      <td>${escapeHTML(r.role || '—')}</td>
      <td>${r.admission_date ? formatDateBR(r.admission_date) : '—'}</td>
      <td class="row-actions"><button class="btn btn-ghost btn-edit-registration" data-id="${r.id}" type="button">Editar</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('.btn-edit-registration').forEach((btn) => {
    btn.addEventListener('click', () => openRegistrationModal(btn.dataset.id));
  });
}
document.getElementById('registration-search').addEventListener('input', renderRegistrations);
document.getElementById('btn-new-registration').addEventListener('click', () => openRegistrationModal(null));

function renderRegChildren() {
  const wrap = document.getElementById('reg-children-list');
  if (!state.regChildrenDraft.length) {
    wrap.innerHTML = '<p class="muted" style="font-size:0.82rem;">Nenhum filho(a) adicionado.</p>';
    return;
  }
  wrap.innerHTML = state.regChildrenDraft.map((child, idx) => `
    <div class="reg-child-row" data-index="${idx}">
      <label><span>Nome</span><input type="text" data-field="name" value="${escapeHTML(child.name || '')}"></label>
      <label><span>Nascimento</span><input type="date" data-field="birth_date" value="${escapeHTML(child.birth_date || '')}"></label>
      <label><span>CPF</span><input type="text" data-field="cpf" value="${escapeHTML(child.cpf || '')}"></label>
      <button type="button" class="icon-btn" data-action="remove-child" aria-label="Remover">✕</button>
    </div>`).join('');
}
document.getElementById('reg-children-list').addEventListener('input', (e) => {
  const row = e.target.closest('.reg-child-row');
  if (!row || !e.target.dataset.field) return;
  state.regChildrenDraft[Number(row.dataset.index)][e.target.dataset.field] = e.target.value;
});
document.getElementById('reg-children-list').addEventListener('click', (e) => {
  if (e.target.dataset.action !== 'remove-child') return;
  const row = e.target.closest('.reg-child-row');
  state.regChildrenDraft.splice(Number(row.dataset.index), 1);
  renderRegChildren();
});
document.getElementById('btn-add-reg-child').addEventListener('click', () => {
  state.regChildrenDraft.push({ name: '', birth_date: '', cpf: '' });
  renderRegChildren();
});

function openRegistrationModal(id) {
  const form = document.getElementById('form-registration');
  form.reset();
  document.getElementById('registration-form-error').hidden = true;
  document.getElementById('reg-id').value = id || '';
  const isEdit = !!id;
  document.getElementById('modal-registration-form-title').textContent = isEdit ? 'Editar ficha de registro' : 'Nova ficha de registro';
  document.getElementById('btn-delete-registration').hidden = !isEdit;
  document.getElementById('btn-download-registration-pdf').hidden = !isEdit;

  populateRegistrationCompanySelect();
  state.regChildrenDraft = [];

  if (isEdit) {
    const r = state.registrations.find((x) => x.id === id);
    if (!r) return;
    document.getElementById('reg-company').value = r.company_cnpj;
    document.getElementById('reg-company-cnpj').value = r.company_cnpj;
    document.getElementById('reg-full-name').value = r.full_name || '';
    document.getElementById('reg-marital-status').value = r.marital_status || '';
    document.getElementById('reg-spouse-name').value = r.spouse_name || '';
    document.getElementById('reg-race').value = r.race || '';
    document.getElementById('reg-education').value = r.education || '';
    document.getElementById('reg-birthplace').value = r.birthplace || '';
    document.getElementById('reg-birth-date').value = r.birth_date || '';
    document.getElementById('reg-gender').value = r.gender || '';
    document.getElementById('reg-first-job').checked = !!r.first_job;
    document.getElementById('reg-address').value = r.address || '';
    document.getElementById('reg-zip').value = r.zip_code || '';
    document.getElementById('reg-phone').value = r.phone || '';
    document.getElementById('reg-email').value = r.email || '';
    document.getElementById('reg-father-name').value = r.father_name || '';
    document.getElementById('reg-mother-name').value = r.mother_name || '';
    document.getElementById('reg-cpf').value = r.cpf || '';
    document.getElementById('reg-voter-title').value = r.voter_title || '';
    document.getElementById('reg-voter-zone').value = r.voter_zone || '';
    document.getElementById('reg-voter-section').value = r.voter_section || '';
    document.getElementById('reg-rg').value = r.rg || '';
    document.getElementById('reg-rg-issuer').value = r.rg_issuer || '';
    document.getElementById('reg-rg-issue-date').value = r.rg_issue_date || '';
    document.getElementById('reg-ctps-number').value = r.ctps_number || '';
    document.getElementById('reg-ctps-series').value = r.ctps_series || '';
    document.getElementById('reg-ctps-issue-date').value = r.ctps_issue_date || '';
    document.getElementById('reg-pis').value = r.pis || '';
    document.getElementById('reg-cnh-number').value = r.cnh_number || '';
    document.getElementById('reg-cnh-category').value = r.cnh_category || '';
    document.getElementById('reg-cnh-expiry').value = r.cnh_expiry || '';
    document.getElementById('reg-reservist-series').value = r.reservist_series || '';
    document.getElementById('reg-reservist-category').value = r.reservist_category || '';
    document.getElementById('reg-admission-date').value = r.admission_date || '';
    document.getElementById('reg-trial-contract').checked = !!r.trial_contract;
    document.getElementById('reg-trial-days').value = r.trial_days ?? '';
    document.getElementById('reg-trial-extension-days').value = r.trial_extension_days ?? '';
    document.getElementById('reg-role').value = r.role || '';
    document.getElementById('reg-department').value = r.department || '';
    document.getElementById('reg-salary').value = r.salary ?? '';
    document.getElementById('reg-work-start').value = r.work_start_time || '';
    document.getElementById('reg-work-end').value = r.work_end_time || '';
    document.getElementById('reg-lunch-start').value = r.lunch_start_time || '';
    document.getElementById('reg-lunch-end').value = r.lunch_end_time || '';
    document.getElementById('reg-saturday-start').value = r.saturday_start_time || '';
    document.getElementById('reg-saturday-end').value = r.saturday_end_time || '';
    state.regChildrenDraft = Array.isArray(r.children) ? r.children.map((c) => ({ ...c })) : [];
  } else {
    document.getElementById('reg-company').value = REGISTRATION_COMPANIES[0].cnpj;
    document.getElementById('reg-company-cnpj').value = REGISTRATION_COMPANIES[0].cnpj;
  }
  renderRegChildren();
  openModal('modal-registration-form');
}

document.getElementById('form-registration').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('reg-id').value;
  const companyCnpj = document.getElementById('reg-company').value;
  const company = REGISTRATION_COMPANIES.find((c) => c.cnpj === companyCnpj);
  const payload = {
    company_name: company ? company.name : '',
    company_cnpj: companyCnpj,
    full_name: document.getElementById('reg-full-name').value.trim(),
    marital_status: document.getElementById('reg-marital-status').value || null,
    spouse_name: document.getElementById('reg-spouse-name').value.trim() || null,
    race: document.getElementById('reg-race').value || null,
    education: document.getElementById('reg-education').value.trim() || null,
    birthplace: document.getElementById('reg-birthplace').value.trim() || null,
    birth_date: document.getElementById('reg-birth-date').value || null,
    gender: document.getElementById('reg-gender').value || null,
    first_job: document.getElementById('reg-first-job').checked,
    address: document.getElementById('reg-address').value.trim() || null,
    zip_code: document.getElementById('reg-zip').value.trim() || null,
    phone: document.getElementById('reg-phone').value.trim() || null,
    email: document.getElementById('reg-email').value.trim() || null,
    father_name: document.getElementById('reg-father-name').value.trim() || null,
    mother_name: document.getElementById('reg-mother-name').value.trim() || null,
    cpf: document.getElementById('reg-cpf').value.trim() || null,
    voter_title: document.getElementById('reg-voter-title').value.trim() || null,
    voter_zone: document.getElementById('reg-voter-zone').value.trim() || null,
    voter_section: document.getElementById('reg-voter-section').value.trim() || null,
    rg: document.getElementById('reg-rg').value.trim() || null,
    rg_issuer: document.getElementById('reg-rg-issuer').value.trim() || null,
    rg_issue_date: document.getElementById('reg-rg-issue-date').value || null,
    ctps_number: document.getElementById('reg-ctps-number').value.trim() || null,
    ctps_series: document.getElementById('reg-ctps-series').value.trim() || null,
    ctps_issue_date: document.getElementById('reg-ctps-issue-date').value || null,
    pis: document.getElementById('reg-pis').value.trim() || null,
    cnh_number: document.getElementById('reg-cnh-number').value.trim() || null,
    cnh_category: document.getElementById('reg-cnh-category').value.trim() || null,
    cnh_expiry: document.getElementById('reg-cnh-expiry').value || null,
    reservist_series: document.getElementById('reg-reservist-series').value.trim() || null,
    reservist_category: document.getElementById('reg-reservist-category').value.trim() || null,
    children: state.regChildrenDraft.filter((c) => (c.name || '').trim()),
    admission_date: document.getElementById('reg-admission-date').value || null,
    trial_contract: document.getElementById('reg-trial-contract').checked,
    trial_days: numOrNull(document.getElementById('reg-trial-days').value),
    trial_extension_days: numOrNull(document.getElementById('reg-trial-extension-days').value),
    role: document.getElementById('reg-role').value.trim() || null,
    department: document.getElementById('reg-department').value.trim() || null,
    salary: numOrNull(document.getElementById('reg-salary').value),
    work_start_time: document.getElementById('reg-work-start').value || null,
    work_end_time: document.getElementById('reg-work-end').value || null,
    lunch_start_time: document.getElementById('reg-lunch-start').value || null,
    lunch_end_time: document.getElementById('reg-lunch-end').value || null,
    saturday_start_time: document.getElementById('reg-saturday-start').value || null,
    saturday_end_time: document.getElementById('reg-saturday-end').value || null,
    updated_at: new Date().toISOString(),
  };
  const errEl = document.getElementById('registration-form-error');
  if (!payload.full_name) { errEl.textContent = 'Informe o nome do(a) funcionário(a).'; errEl.hidden = false; return; }
  let error;
  if (id) {
    ({ error } = await sb.from('employee_registration_forms').update(payload).eq('id', id));
  } else {
    ({ error } = await sb.from('employee_registration_forms').insert(payload));
  }
  if (error) { errEl.textContent = error.message; errEl.hidden = false; return; }
  closeModal('modal-registration-form');
  showToast('Ficha salva.');
  await loadRegistrations();
});

document.getElementById('btn-delete-registration').addEventListener('click', async () => {
  const id = document.getElementById('reg-id').value;
  if (!id) return;
  if (!confirm('Excluir esta ficha de registro?')) return;
  const { error } = await sb.from('employee_registration_forms').delete().eq('id', id);
  if (error) { showToast(error.message, true); return; }
  closeModal('modal-registration-form');
  showToast('Ficha excluída.');
  await loadRegistrations();
});

// PDF da ficha de registro, seguindo as mesmas seções do formulário em papel
// que a contabilidade já usa, pra poder simplesmente encaminhar por e-mail.
function buildRegistrationPdfRows(r) {
  const childrenText = (r.children || []).length
    ? (r.children || []).map((c) => `${c.name || ''}${c.birth_date ? ' — nasc. ' + formatDateBR(c.birth_date) : ''}${c.cpf ? ' — CPF ' + c.cpf : ''}`).join('\n')
    : '—';
  const workSchedule = [
    r.work_start_time && r.work_end_time ? `Das ${r.work_start_time} às ${r.work_end_time}` : null,
    r.lunch_start_time && r.lunch_end_time ? `Intervalo das ${r.lunch_start_time} às ${r.lunch_end_time}` : null,
    r.saturday_start_time && r.saturday_end_time ? `Sábado das ${r.saturday_start_time} às ${r.saturday_end_time}` : null,
  ].filter(Boolean).join(' | ') || '—';

  return {
    preliminares: [
      ['Estado civil', r.marital_status || '—'],
      ['Cônjuge', r.spouse_name || '—'],
      ['Cor declarada', r.race || '—'],
      ['Escolaridade', r.education || '—'],
      ['Naturalidade', r.birthplace || '—'],
      ['Data de nascimento', r.birth_date ? formatDateBR(r.birth_date) : '—'],
      ['Sexo', r.gender || '—'],
      ['Primeiro emprego', r.first_job ? 'Sim' : 'Não'],
      ['Endereço', r.address || '—'],
      ['CEP', r.zip_code || '—'],
      ['E-mail', r.email || '—'],
      ['Celular', r.phone || '—'],
      ['Pai', r.father_name || '—'],
      ['Mãe', r.mother_name || '—'],
    ],
    documentos: [
      ['CPF', r.cpf || '—'],
      ['Título eleitoral', [r.voter_title, r.voter_zone && `Zona ${r.voter_zone}`, r.voter_section && `Seção ${r.voter_section}`].filter(Boolean).join(' — ') || '—'],
      ['RG', [r.rg, r.rg_issuer, r.rg_issue_date && formatDateBR(r.rg_issue_date)].filter(Boolean).join(' — ') || '—'],
      ['CTPS', [r.ctps_number, r.ctps_series, r.ctps_issue_date && formatDateBR(r.ctps_issue_date)].filter(Boolean).join(' — ') || '—'],
      ['PIS', r.pis || '—'],
      ['CNH', [r.cnh_number, r.cnh_category, r.cnh_expiry && ('venc. ' + formatDateBR(r.cnh_expiry))].filter(Boolean).join(' — ') || '—'],
      ['Certificado reservista', [r.reservist_series, r.reservist_category].filter(Boolean).join(' — ') || '—'],
    ],
    filhos: [['Filhos/dependentes', childrenText]],
    admissao: [
      ['Data de admissão', r.admission_date ? formatDateBR(r.admission_date) : '—'],
      ['Contrato de experiência', r.trial_contract ? `Sim — prazo ${r.trial_days || 0} dias, prorrogação ${r.trial_extension_days || 0} dias` : 'Não'],
      ['Função', r.role || '—'],
      ['Setor', r.department || '—'],
      ['Salário', r.salary != null ? formatBRL(r.salary) : '—'],
      ['Horário de trabalho', workSchedule],
    ],
  };
}

async function buildRegistrationPdf(r) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const darkGreen = [43, 60, 41];
  const medGreen = [59, 117, 59];
  const lightGreen = [227, 239, 226];
  const margin = 40;

  doc.setFillColor(...darkGreen);
  doc.rect(0, 0, pageWidth, 80, 'F');
  const logoDataUrl = await getLogoDataUrl();
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', margin, 15, 44, 44); } catch { /* segue sem logo */ }
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Formulário para admissão de funcionários', margin + 56, 36);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${r.company_name}  —  CNPJ: ${r.company_cnpj}`, margin + 56, 54);

  let y = 105;
  doc.setTextColor(...darkGreen);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(r.full_name, margin, y);
  y += 20;

  const rows = buildRegistrationPdfRows(r);
  const sections = [
    ['Informações preliminares', rows.preliminares],
    ['Documentos', rows.documentos],
    ['Filhos / dependentes', rows.filhos],
    ['Dados da admissão (preenchido pela empresa)', rows.admissao],
  ];

  sections.forEach(([title, body]) => {
    if (y > pageHeight - 120) { doc.addPage(); y = 40; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...darkGreen);
    doc.text(title, margin, y);
    doc.autoTable({
      startY: y + 6,
      body,
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 6, textColor: [40, 40, 40] },
      columnStyles: { 0: { fontStyle: 'bold', fillColor: lightGreen, cellWidth: 150 } },
      margin: { left: margin, right: margin },
    });
    y = doc.lastAutoTable.finalY + 20;
  });

  if (y > pageHeight - 140) { doc.addPage(); y = 40; }
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...darkGreen);
  doc.text('Documentação a anexar', margin, y);
  y += 16;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  const checklist = [
    'Exame Médico Admissional (emitido antes da data de admissão, por médico do trabalho)',
    'Exame Toxicológico para funções de motorista (emitido antes da data de admissão)',
    '1 Foto 3x4 e Carteira de Trabalho (CTPS)',
    'Cópia de todos os documentos pessoais (RG, CPF, Título Eleitoral, CNH, Certificado de Reservista)',
    'Cópia de comprovante de residência',
    'Certidão de casamento (se casado) ou outras situações',
    'Cópia de certidão de nascimento e CPF dos filhos — dependente só é cadastrado se tiver CPF',
  ];
  checklist.forEach((item) => {
    const lines = doc.splitTextToSize(`•  ${item}`, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 4;
  });

  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('A documentação completa deverá ser enviada à contabilidade com prazo mínimo de 48 horas antes da data de início de trabalho do funcionário.', margin, y, { maxWidth: pageWidth - margin * 2 });
  y += 24;
  doc.text('A admissão só será realizada se não faltar nenhum documento.', margin, y, { maxWidth: pageWidth - margin * 2 });

  return doc;
}

document.getElementById('btn-download-registration-pdf').addEventListener('click', async () => {
  const id = document.getElementById('reg-id').value;
  const r = state.registrations.find((x) => x.id === id);
  if (!r) return;
  try {
    const doc = await buildRegistrationPdf(r);
    const blob = doc.output('blob');
    const status = await saveFile(`ficha_registro_${(r.full_name || 'colaborador').replace(/\s+/g, '_')}.pdf`, blob);
    if (status === 'saved') showToast('PDF salvo.');
    else if (status === 'delivered') showToast('PDF enviado.');
  } catch (err) {
    handleDownloadError(err);
  }
});

/* ==========================================================
   Início
   ========================================================== */
initAuth();
