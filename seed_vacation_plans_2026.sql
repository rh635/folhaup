-- =====================================================================
-- Popula "Planejamento de férias" com os dados de 2026 da planilha
-- "Planejamento de férias - calculo.xlsx" (aba Cálculo).
-- Rode no SQL Editor do Supabase, depois de já ter rodado o schema.sql
-- (precisa da tabela public.vacation_plans).
--
-- O funcionário é casado por nome (ilike, só entre ativos). Só insere
-- quando encontra EXATAMENTE um funcionário correspondente; o SELECT no
-- final mostra a situação de cada linha da planilha (importado / ambíguo /
-- não encontrado), pra você conferir e completar manualmente pela tela
-- quando precisar.
--
-- Ficaram de fora deste seed (a planilha não tinha a base de cálculo, ou
-- não tinha o mês, preenchidos ainda — sem isso não dá pra calcular nada):
-- Barbara Cristina, denise, Renan, Mariangela, Aryege, João Rodrigues,
-- Gabriela Santos, Jaqueline, Silmara, Lucas Jara, Nathalia.
-- Valores de férias/abono usam a mesma fórmula do app: (base / 30) x dias x 4/3.
-- =====================================================================

with dados(nome_busca, competencia, base_calculo, abono_dias, gozo_dias, gozo_periodo, rhgestor_ok) as (
  values
    ('Airton Ribeiro',               date '2026-06-01', 10534.60::numeric, 10::numeric, 0::numeric, null::text,        false),
    ('Luis Henrique',                date '2026-06-01',  3159.60,          10,           0,           null,            false),
    ('Maicon André',                 date '2026-06-01',  3159.60,           5,           0,           null,            false),
    ('Hannah',                       date '2026-06-01',  4319.35,           0,           0,          '15 a 29/6',      false),
    ('Adenilto Aparecido',           date '2026-06-01',  5112.22,           7,           0,           null,            false),
    ('Alexandre Rodrigues Soares',   date '2026-06-01',  2175.43,           0,          10,          '22/6 a 1/7',     false),
    ('Priscila Roberta',             date '2026-07-01',  2615.80,          10,           0,           null,            false),
    ('Greicy De Souza',              date '2026-07-01',  2338.08,           0,          10,          '8 a 17/7',       false),
    ('Wanessa Rodrigues de Souza',   date '2026-07-01',  3087.98,           0,          10,          '13 a 22/7',      false),
    ('Mariany de Souza',             date '2026-07-01',  2512.96,           5,           5,          '27 a 31/7',      false),
    ('Emilia Crispino Pereira',      date '2026-07-01',  2794.38,           5,           0,           null,            false),
    ('Angela Aparecida',             date '2026-07-01',  3104.94,          10,           0,           null,            false),
    ('Elaine Juliana',               date '2026-07-01',  2153.56,           5,           0,           null,            false),
    ('Adriano Furtado',              date '2026-07-01',  2995.86,           5,           5,          '9 a 13/7',       false),
    ('Debora Vanessa',               date '2026-07-01',  2195.66,           0,          10,          '13 a 22/7',      false),
    ('Cristiane Machado',            date '2026-08-01',  3159.60,           0,          20,          '03/08/2026',     false),
    ('Bruna Suellen',                date '2026-08-01',  2449.85,           0,          10,          '10 a 19/8',      false),
    ('Robson Alegre',                date '2026-08-01',  3209.10,           0,           5,          '31/08 a 4/9',    false),
    ('Angelo Augusto',               date '2026-08-01',  2963.17,           5,           5,          '31/8 a 4/9',     false),
    ('Angela Regina Tardim',         date '2026-08-01',  2570.59,           5,           0,           null,            false),
    ('Camila de Oliveira',           date '2026-08-01',  2452.98,          10,           0,           null,            false),
    ('Izadora da Silva',             date '2026-08-01',  2253.17,           0,          10,          '10 dias',        false),
    ('Gustavo Zavaski',              date '2026-09-01',  4364.35,          10,           0,           null,            false),
    ('Fernanda Cristina Moi',        date '2026-09-01',  3846.48,           5,           5,          '14/09/2026',     false),
    ('Ailton Moi Junior',            date '2026-09-01',  2971.49,          10,           0,           null,            false),
    ('Aparecida do Carmo',           date '2026-09-01',  2216.92,          10,           0,           null,            false),
    ('Givailda',                     date '2026-09-01',  2793.80,           5,           0,           null,            false),
    ('Evilyn Vizotto',               date '2026-09-01',  5712.42,           5,           5,          '21/9 a 25/9',    false),
    ('Fabiana Francisca',            date '2026-09-01',  4838.10,           0,           5,          '08/09 a 17/9',   false),
    ('Karoline Oliveira de Paula',   date '2026-10-01',  2483.80,          10,           0,           null,            false)
),
casados as (
  select
    d.*,
    (
      select array_agg(e.id)
      from public.employees e
      where e.active = true and e.full_name ilike '%' || d.nome_busca || '%'
    ) as ids_encontrados
  from dados d
),
inseridos as (
  insert into public.vacation_plans (
    employee_id, competencia, base_calculo, abono_dias, gozo_dias, gozo_periodo,
    valor_ferias_gozo, valor_abono, valor_total, rhgestor_ok
  )
  select
    c.ids_encontrados[1],
    c.competencia,
    c.base_calculo,
    c.abono_dias,
    c.gozo_dias,
    c.gozo_periodo,
    round(c.base_calculo / 30 * c.gozo_dias * 4 / 3, 2),
    round(c.base_calculo / 30 * c.abono_dias * 4 / 3, 2),
    round(c.base_calculo / 30 * c.gozo_dias * 4 / 3, 2) + round(c.base_calculo / 30 * c.abono_dias * 4 / 3, 2),
    c.rhgestor_ok
  from casados c
  where coalesce(array_length(c.ids_encontrados, 1), 0) = 1
  returning employee_id
)
select
  d.nome_busca as "Funcionário (planilha)",
  case
    when coalesce(array_length(c.ids_encontrados, 1), 0) = 0 then 'NÃO ENCONTRADO — cadastre pela tela'
    when array_length(c.ids_encontrados, 1) > 1 then 'AMBÍGUO (' || array_length(c.ids_encontrados, 1) || ' funcionários) — cadastre pela tela'
    else 'importado'
  end as "Situação"
from dados d
join casados c on c.nome_busca = d.nome_busca
order by 2, 1;
