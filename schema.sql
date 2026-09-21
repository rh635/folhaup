-- =====================================================================
-- Sistema de Lançamentos de Folha (DP) — schema Supabase/Postgres
-- Rode este arquivo inteiro em: Supabase Dashboard > SQL Editor > New query
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funcionários (dados cadastrais + parâmetros fixos usados nos cálculos)
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  registration_number text,          -- matrícula
  company text,                       -- empresa/unidade (ex: UPEXPRESS, PRC, FILIAL UPEXPRESS)
  role text,                          -- cargo
  department text,                    -- setor
  admission_date date,
  transporte_optante boolean not null default false,  -- optante padrão de vale-transporte
  sindical_optante boolean not null default false,    -- optante padrão de contribuição sindical
  salary_advance_optante boolean not null default false, -- optante de adiantamento salarial
  health_plan_fixed_value numeric(12,2) not null default 0, -- valor fixo mensal do plano de saúde
  dental_plan_fixed_value numeric(12,2) not null default 0, -- valor fixo mensal do plano odontológico
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.employees is 'Cadastro de funcionários e parâmetros fixos usados para pré-preencher os lançamentos mensais.';

-- ---------------------------------------------------------------------
-- Lançamentos mensais (um registro por funcionário por competência)
-- ---------------------------------------------------------------------
create table if not exists public.monthly_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  competencia date not null,          -- sempre armazenar como dia 01 do mês, ex: 2026-09-01

  dental_discount numeric(12,2) not null default 0,        -- desconto plano odontológico
  health_plan_fixed numeric(12,2) not null default 0,       -- valor fixo do plano de saúde no mês
  health_coparticipation numeric(12,2) not null default 0,  -- coparticipação do mês
  pharmacy_discount numeric(12,2) not null default 0,       -- desconto farmácia

  transporte_optante boolean not null default false,        -- optante de VT nesse mês
  transporte_value numeric(12,2) not null default 0,        -- valor do desconto (6% do salário)

  sindical_optante boolean not null default false,          -- optante de contribuição sindical nesse mês
  sindical_value numeric(12,2) not null default 0,          -- valor do desconto (1% do salário)

  absence_days numeric(6,2) not null default 0,             -- dias de falta (quantidade)
  absence_dates text,                                        -- dias específicos da falta (ex: "12, 13, 24")
  overtime_hours numeric(6,2) not null default 0,           -- horas extras diurna (importado do cartão ponto)
  overtime_hours_100 numeric(6,2) not null default 0,       -- horas extras totais pagas a 100%
  night_shift_hours numeric(6,2) not null default 0,        -- adicional noturno (horas)
  overtime_value numeric(12,2) not null default 0,          -- (não usado na UI atual; mantido por compatibilidade)
  hour_discount_value numeric(6,2) not null default 0,      -- horas totais de desconto (em horas, não R$)

  commission_value numeric(12,2) not null default 0,        -- comissão
  bonus_value numeric(12,2) not null default 0,              -- bonificação
  award_value numeric(12,2) not null default 0,              -- premiação

  psychological_discount numeric(12,2) not null default 0,  -- desconto atendimento psicológico

  reimbursement_value numeric(12,2) not null default 0,      -- reembolso
  payroll_loan_discount numeric(12,2) not null default 0,    -- desconto de empréstimo consignado

  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (employee_id, competencia)
);

comment on table public.monthly_entries is 'Um lançamento por funcionário por competência (mês/ano), com todos os descontos e proventos variáveis do mês.';

-- ---------------------------------------------------------------------
-- Compras parceladas feitas na empresa
-- ---------------------------------------------------------------------
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  description text not null,                 -- descrição do pedido
  purchase_date date not null default current_date,
  total_value numeric(12,2) not null check (total_value > 0),
  installments_count int not null default 1 check (installments_count > 0),
  first_competencia date not null,           -- mês (dia 01) em que a 1ª parcela é descontada
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.purchases is 'Pedido de compra feito por um funcionário diretamente na empresa, a ser descontado em parcelas.';

-- Parcelas geradas a partir de cada compra (uma linha por parcela/mês)
create table if not exists public.purchase_installments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade, -- desnormalizado p/ somar por funcionário/mês sem join
  installment_number int not null,
  competencia date not null,          -- mês em que essa parcela específica é descontada
  value numeric(12,2) not null,
  unique (purchase_id, installment_number)
);

comment on table public.purchase_installments is 'Parcelas individuais de cada compra, uma por mês; várias compras do mesmo funcionário podem acumular parcelas na mesma competência.';

create index if not exists idx_monthly_entries_competencia on public.monthly_entries(competencia);
create index if not exists idx_purchase_installments_competencia on public.purchase_installments(competencia);
create index if not exists idx_purchase_installments_employee_competencia on public.purchase_installments(employee_id, competencia);
create index if not exists idx_purchases_employee on public.purchases(employee_id);
create index if not exists idx_employees_company on public.employees(company);

-- ---------------------------------------------------------------------
-- Perfis dos usuários do RH (nome de quem lançou cada informação)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
  before update on public.employees
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_monthly_entries_updated_at on public.monthly_entries;
create trigger trg_monthly_entries_updated_at
  before update on public.monthly_entries
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- Row Level Security
-- Regra: só usuários autenticados (colegas do RH convidados) acessam
-- qualquer dado; não há acesso anônimo em nenhuma tabela.
-- =====================================================================
alter table public.employees enable row level security;
alter table public.monthly_entries enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_installments enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "employees_authenticated_all" on public.employees;
create policy "employees_authenticated_all" on public.employees
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "monthly_entries_authenticated_all" on public.monthly_entries;
create policy "monthly_entries_authenticated_all" on public.monthly_entries
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "purchases_authenticated_all" on public.purchases;
create policy "purchases_authenticated_all" on public.purchases
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "purchase_installments_authenticated_all" on public.purchase_installments;
create policy "purchase_installments_authenticated_all" on public.purchase_installments
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
  for select
  using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- =====================================================================
-- Fim. Depois de rodar este script:
-- 1) Authentication > Sign In / Providers > Email > desative "Allow new
--    users to sign up" (o sistema é só por convite).
-- 2) Authentication > URL Configuration > adicione a URL do sistema
--    publicado em "Redirect URLs" e "Site URL".
-- 3) Authentication > Users > Add user > convide cada colega do RH.
-- =====================================================================
