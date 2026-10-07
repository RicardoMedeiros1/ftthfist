-- RotaFibra - desenho do projeto: CONFERENCIA da migration 14 (...150700_projetos_desenho).
-- Se TODAS as linhas disserem OK, o banco esta completo para o desenho. Se alguma disser FALTA, me diga qual.

select item, esperado, encontrado, case when esperado = encontrado then 'OK' else 'FALTA' end as resultado
from (
  select 1 as n, 'coluna plan (o desenho) em projects' as item, '1' as esperado,
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'projects' and column_name = 'plan')::text as encontrado
  union all select 2, 'regra que confere o formato do desenho (projects_plan_valid)', '1',
         (select count(*) from pg_constraint where conname = 'projects_plan_valid')::text
  union all select 3, 'funcoes que conferem o desenho (plan_is_valid e plan_coord_ok)', '2',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('plan_is_valid', 'plan_coord_ok'))::text
) x
order by n;
