-- RotaFibra - fibras e ligacao de cabos: CONFERENCIA da migration 15 (...150800_cabos_fibras).
-- Se TODAS as linhas disserem OK, o banco esta completo. Se alguma disser FALTA, me diga qual.

select item, esperado, encontrado, case when esperado = encontrado then 'OK' else 'FALTA' end as resultado
from (
  select 1 as n, 'colunas color_standard e links em cables' as item, '2' as esperado,
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'cables' and column_name in ('color_standard', 'links'))::text as encontrado
  union all select 2, 'regras do padrao de cores e das ligacoes (cables_color_standard_valid e cables_links_valid)', '2',
         (select count(*) from pg_constraint where conname in ('cables_color_standard_valid', 'cables_links_valid'))::text
  union all select 3, 'funcao que confere as ligacoes (cable_links_valid)', '1',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'cable_links_valid')::text
) x
order by n;
