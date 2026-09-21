-- =====================================================================
-- Indicadores de cada modelo de bonificação/premiação, extraídos da planilha
-- "bonificação.xlsx" enviada. Rode DEPOIS do schema.sql (precisa das tabelas
-- bonus_models / bonus_indicators já criadas).
--
-- IMPORTANTE: várias das planilhas originais tinham linhas de "TOTAL" com
-- rótulos trocados/fórmulas quebradas (#REF!). Os valores abaixo vêm da coluna
-- de referência ("META") de cada indicador individual, que é onde a
-- informação estava mais confiável — não das linhas de total. Revise com
-- calma antes de considerar definitivo; onde um indicador tinha valores
-- inconsistentes entre meses na planilha antiga, usei o valor de referência.
-- =====================================================================

do $$
declare
  m_id uuid;
begin

  -- ---------------- Loja Clube ----------------
  select id into m_id from public.bonus_models where name = 'Loja Clube';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','Meta de vendas',50,'meta_vendas',1),
    (m_id,'bonificacao','95% da meta de venda atingida',30,'meta_vendas',2),
    (m_id,'bonificacao','89 a 94,9% da meta de venda atingida',15,'meta_vendas',3),
    (m_id,'bonificacao','Meta faturamento',50,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'premiacao','Superar em 5% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 10% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 15% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 95% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',10,'entrega_prazo',5);

  -- ---------------- Clube ----------------
  select id into m_id from public.bonus_models where name = 'Clube';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','90% Pedidos entregues no prazo',30,'prazo_entrega',1),
    (m_id,'bonificacao','85 a 89,9% dos pedidos entregues no prazo',25,'prazo_entrega',2),
    (m_id,'bonificacao','80 a 84,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','NPS',30,'nps',4),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',5),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',6),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',7),
    (m_id,'premiacao','Superar em 5% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 10% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 15% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 95% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',10,'entrega_prazo',5);

  -- ---------------- Marketplace ----------------
  select id into m_id from public.bonus_models where name = 'Marketplace';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','Meta Venda Marketplace',60,'meta_venda_mkt',1),
    (m_id,'bonificacao','95% da meta de venda marketplace atingida',45,'meta_venda_mkt',2),
    (m_id,'bonificacao','90 a 94,9% da meta de venda marketplace atingida',35,'meta_venda_mkt',3),
    (m_id,'bonificacao','Reputação no Mercado Livre',40,'reputacao',4),
    (m_id,'bonificacao','Meta Venda Ecommerce Próprio',10,'meta_ecommerce',5),
    (m_id,'bonificacao','95% da meta de venda ecommerce atingida',5,'meta_ecommerce',6),
    (m_id,'premiacao','Superar em 5% a meta de venda global',5,'superar_venda_global',1),
    (m_id,'premiacao','Superar em 10% a meta de venda global',10,'superar_venda_global',2),
    (m_id,'premiacao','Superar em 15% a meta de venda global',15,'superar_venda_global',3);

  -- ---------------- Fábrica DC ----------------
  select id into m_id from public.bonus_models where name = 'Fábrica DC';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',20,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',10,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',5,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',35,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',25,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',15,'meta_faturamento',6),
    (m_id,'bonificacao','76% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',5,'meta_faturamento',8),
    (m_id,'bonificacao','NPS (80%)',15,'nps',9),
    (m_id,'bonificacao','Peças produzidas',30,'pecas_produzidas',10),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 80% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

  -- ---------------- Comercial ----------------
  select id into m_id from public.bonus_models where name = 'Comercial';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','Lucratividade 73%',30,'lucratividade',1),
    (m_id,'bonificacao','72% da meta de lucratividade',20,'lucratividade',2),
    (m_id,'bonificacao','70% da meta de lucratividade',10,'lucratividade',3),
    (m_id,'bonificacao','NPS (80%)',40,'nps',4),
    (m_id,'bonificacao','Meta faturamento',30,'meta_faturamento',5),
    (m_id,'bonificacao','95% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','76% da meta de faturamento atingida',30,'meta_faturamento',8),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',20,'meta_faturamento',9),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Lucratividade 80%',5,'lucratividade_premio',4),
    (m_id,'premiacao','Lucratividade 90%',10,'lucratividade_premio',5),
    (m_id,'premiacao','Lucratividade 100%',15,'lucratividade_premio',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9);

  -- ---------------- Fábrica ----------------
  select id into m_id from public.bonus_models where name = 'Fábrica';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',25,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',20,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','76% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',5,'meta_faturamento',8),
    (m_id,'bonificacao','NPS (80%)',15,'nps',9),
    (m_id,'bonificacao','Peças produzidas',20,'pecas_produzidas',10),
    (m_id,'bonificacao','95% da meta de peças produzidas atingida',15,'pecas_produzidas',11),
    (m_id,'bonificacao','89 a 94,9% da meta de peças produzidas atingida',10,'pecas_produzidas',12),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 85% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 85%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

  -- ---------------- Evilyn-Diego-Barbara-Kelly ----------------
  select id into m_id from public.bonus_models where name = 'Evilyn-Diego-Barbara-Kelly';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',25,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',20,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','76% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',5,'meta_faturamento',8),
    (m_id,'bonificacao','NPS (80%)',15,'nps',9),
    (m_id,'bonificacao','Peças produzidas',20,'pecas_produzidas',10),
    (m_id,'bonificacao','95% da meta de peças produzidas atingida',15,'pecas_produzidas',11),
    (m_id,'bonificacao','89 a 94,9% da meta de peças produzidas atingida',10,'pecas_produzidas',12),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 85% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

  -- ---------------- Atendimento fábrica e líderes ----------------
  select id into m_id from public.bonus_models where name = 'Atendimento fábrica e líderes';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',25,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',20,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','76% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',5,'meta_faturamento',8),
    (m_id,'bonificacao','NPS (80%)',15,'nps',9),
    (m_id,'bonificacao','Peças produzidas',20,'pecas_produzidas',10),
    (m_id,'bonificacao','95% da meta de peças produzidas atingida',15,'pecas_produzidas',11),
    (m_id,'bonificacao','89 a 94,9% da meta de peças produzidas atingida',10,'pecas_produzidas',12),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 85% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

  -- ---------------- Analistas ----------------
  select id into m_id from public.bonus_models where name = 'Analistas';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',25,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',20,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','76% da meta de faturamento atingida',10,'meta_faturamento',7),
    (m_id,'bonificacao','70 a 75,9% da meta de faturamento atingida',5,'meta_faturamento',8),
    (m_id,'bonificacao','NPS (80%)',15,'nps',9),
    (m_id,'bonificacao','Peças produzidas',20,'pecas_produzidas',10),
    (m_id,'bonificacao','95% da meta de peças produzidas atingida',15,'pecas_produzidas',11),
    (m_id,'bonificacao','89 a 94,9% da meta de peças produzidas atingida',10,'pecas_produzidas',12),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 85% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

  -- ---------------- Coordenador ----------------
  select id into m_id from public.bonus_models where name = 'Coordenador';
  delete from public.bonus_indicators where bonus_model_id = m_id;
  insert into public.bonus_indicators (bonus_model_id, category, name, points, tier_group, sort_order) values
    (m_id,'bonificacao','80% Pedidos entregues no prazo',25,'prazo_entrega',1),
    (m_id,'bonificacao','75 a 79,9% dos pedidos entregues no prazo',20,'prazo_entrega',2),
    (m_id,'bonificacao','70 a 74,9% dos pedidos entregues no prazo',15,'prazo_entrega',3),
    (m_id,'bonificacao','Meta faturamento',40,'meta_faturamento',4),
    (m_id,'bonificacao','95% da meta de faturamento atingida',30,'meta_faturamento',5),
    (m_id,'bonificacao','89 a 94,9% da meta de faturamento atingida',20,'meta_faturamento',6),
    (m_id,'bonificacao','NPS (80%)',15,'nps',7),
    (m_id,'bonificacao','Peças produzidas',20,'pecas_produzidas',8),
    (m_id,'bonificacao','95% da meta de peças produzidas atingida',15,'pecas_produzidas',9),
    (m_id,'bonificacao','89 a 94,9% da meta de peças produzidas atingida',10,'pecas_produzidas',10),
    (m_id,'premiacao','Superar em 2% a meta faturamento',5,'superar_faturamento',1),
    (m_id,'premiacao','Superar em 5% a meta faturamento',10,'superar_faturamento',2),
    (m_id,'premiacao','Superar em 10% a meta faturamento',15,'superar_faturamento',3),
    (m_id,'premiacao','Entregar os pedidos com 85% do prazo',5,'entrega_prazo',4),
    (m_id,'premiacao','Entregar os pedidos com 90% do prazo',10,'entrega_prazo',5),
    (m_id,'premiacao','Entregar os pedidos com 100% do prazo',15,'entrega_prazo',6),
    (m_id,'premiacao','NPS 80%',5,'nps_premio',7),
    (m_id,'premiacao','NPS 90%',10,'nps_premio',8),
    (m_id,'premiacao','NPS 100%',15,'nps_premio',9),
    (m_id,'premiacao','Superar em 5% a meta de peças produzidas',5,'superar_pecas',10),
    (m_id,'premiacao','Superar em 10% a meta de peças produzidas',10,'superar_pecas',11),
    (m_id,'premiacao','Superar em 15% a meta de peças produzidas',15,'superar_pecas',12);

end $$;

notify pgrst, 'reload schema';
