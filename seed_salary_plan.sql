-- =====================================================================
-- Plano de salários — seed inicial extraído de "PLANO DE SALARIOS - sistema.xlsx".
-- Rode DEPOIS do schema.sql (precisa das tabelas salary_plan_positions,
-- salary_progression_notes e salary_updates já criadas).
--
-- IMPORTANTE: a coluna "Total com bonificação cadeira I" da planilha original
-- foi descartada — em vários cargos ela não batia com a soma real (ex.:
-- "Gerente de produção" aparecia como R$287.500, claramente um erro de
-- fórmula), então não é confiável como dado. Regras de comissão, "cargo de
-- confiança" e bonificações condicionais de cada cargo foram preservadas no
-- campo "observações" em vez de colunas próprias, já que variam demais de
-- cargo para cargo.
-- =====================================================================

delete from public.salary_plan_positions;

insert into public.salary_plan_positions (cargo, cadeira_1, cadeira_2, cadeira_3, cadeira_4, bonificacao_geral, aumento_avaliacao, observacoes, sort_order) values
  ('Auxiliares', 1871.10, 1971.10, 2071.10, 2171.10, 200, 100, null, 1),
  ('Inspetor de qualidade (revisor)', 1956.94, 2106.94, 2256.94, 2406.94, 200, 150, null, 2),
  ('Auxiliar de almoxarifado', 2080, 2180, 2280, 2380, 200, 100, null, 3),
  ('Almoxarife', 2500, 2700, 2900, 3100, 200, 200, null, 4),
  ('Enfestador, Expedidor e inspetor de qualidade externa (facções)', 2310, 2460, 2610, 2760, 200, 150, null, 5),
  ('Operador de máquina de bordado, acabamento e costura, assistente de customização', 2126.25, 2276.25, 2426.25, 2576.25, 200, 150, null, 6),
  ('Operador de máquina de bordado, 12x36', 2426.25, 2576.25, 2726.25, 2876.25, 200, 150, null, 7),
  ('Operador (pilotista)', 2676.25, 2926.25, 3176.25, 3426.25, 200, 250, null, 8),
  ('Operador de máquina de corte, enfesto automático', 2205, 2405, 2605, 2805, 200, 200, null, 9),
  ('Assistentes PCP, produto, financeiro, compras, RH e customização', 2152.50, 2352.50, 2552.50, 2752.50, 200, 200, null, 10),
  ('Motorista', 2619.07, 2794.35, 3094.35, 3394.35, 200, 300, null, 11),
  ('Analista PCP, produto, financeiro, RH e financeiro, arte finalista', 2795, 3395, 3995, 4595, 300, 600, null, 12),
  ('Cronometrista', 2500, 2800, 3100, 3400, 300, 300, null, 13),
  ('Analista de Compras', 2750, 3350, 3950, 4550, 300, 600, null, 14),
  ('Executivo de vendas (< 1000 colaboradores)', 3200, 3800, null, null, 400, 600,
    'Comissão: cadeira I a partir de R$20 mil em vendas; cadeira II a partir de R$50 mil em vendas. Progride para a cadeira II ao superar R$100 mil em vendas.', 15),
  ('Executivo de vendas (> 1000 colaboradores)', null, null, 3800, 4400, 400, 600,
    'Ao migrar para a cadeira III passa a receber comissão por colaborador da empresa cliente; se a comissão for menor que R$1.000, recebe ajuda de custo de R$1.000 por 6 meses.', 16),
  ('Analista comercial (suporte comercial)', 2750, 3100, 3450, 3800, 300, 350,
    '% de comissão (consultor de novos negócios): 1,20 a 2,00 por colaborador. Bonificação por atingir meta de novos clientes: até R$700,00.', 17),
  ('Analista comercial (atendimento fábrica)', 3200, 4200, 5200, 6200, 400, 1000, null, 18),
  ('Líder operacional', 2642.22, 2942.22, 3242.22, 3542.22, 400, 300, null, 19),
  ('Coordenador de estoque, costura', 4000, 4500, 5000, 5500, 500, 500, null, 20),
  ('Coordenador PCP, produto, financeiro, compras, RH e financeiro', 4700, 5400, 6100, 6800, 500, 700, null, 21),
  ('Gerente de produção', 7000, 7700, 8400, 9100, 500, 700, 'Cargo de confiança (40%).', 22),
  ('Gerente de loja', 4070, 4770, 5470, 6170, 500, 700, 'Cargo de confiança (40%). Comissão: 10% do lucro.', 23),
  ('Vendedor loja', 2500, 2750, 3000, 3250, 300, 250, 'Comissão: 1%.', 24),
  ('Coordenador de expansão (PJ)', 8000, null, null, null, null, null, 'Contrato PJ. Bonificação: R$3.000,00.', 25),
  ('Coordenador financeiro (PJ)', 8000, null, null, null, null, null, 'Contrato PJ. Bonificação: R$1.000,00 + R$500,00.', 26),
  ('Coordenador de loja - Londrina (PJ)', 6500, null, null, null, 500, null, 'Contrato PJ.', 27),
  ('Coordenador de costura (PJ)', 7500, null, null, null, 2000, null, 'Contrato PJ.', 28);

delete from public.salary_progression_notes;

insert into public.salary_progression_notes (key, title, content) values
  ('regras_gerais', 'Regras gerais de progressão',
'Pensando no desenvolvimento e crescimento profissional dos nossos colaboradores, no ano de 2020 criamos um plano de crescimento individual, um programa estruturado que estipula o caminho que cada funcionário vai percorrer dentro de nossa empresa. Determinando as competências necessárias para cada posição hierárquica e também qual é a expectativa da empresa em relação àquela posição.

Para definirmos o grau de maturidade do colaborador para elevar sua posição, será feito duas avaliações de desempenho anuais: uma acontece quando o colaborador completa 6 meses de empresa, e outra na data em que o colaborador completa aniversário de empresa. Caso o colaborador atinja a média necessária na avaliação de desempenho de aniversário, estará apto para progredir de cargo.

Cada cargo dentro da empresa pode progredir em até 4 níveis, que chamamos de "cadeiras". A depender de seu conhecimento, habilidade e atitude.

O colaborador receberá mensalmente feedback individual de seu líder, com o intuito de desenvolvimento.'),
  ('executivo_vendas', 'Progressão — Executivo de vendas',
'Executivo de vendas (< 1000 colaboradores na empresa cliente): cadeira I = R$3.200 (comissão a partir de R$20 mil em vendas), cadeira II = R$3.800 (comissão a partir de R$50 mil em vendas). Progride da cadeira I para a II ao superar R$100 mil em vendas.

Executivo de vendas (> 1000 colaboradores na empresa cliente): cadeira III = R$3.800, cadeira IV = R$4.400.

Ao migrar para a cadeira III, o executivo passa a receber comissão por colaborador da empresa cliente. Caso essa comissão fique abaixo de R$1.000, ele recebe no lugar uma ajuda de custo de R$1.000 por 6 meses.');
