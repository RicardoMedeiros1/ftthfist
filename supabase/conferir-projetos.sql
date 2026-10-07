-- RotaFibra - projetos designados: CONFERENCIA da migration 13 (...150600_projetos).
-- Se TODAS as linhas disserem OK, o banco esta completo para os projetos. Se alguma disser FALTA, me diga qual.

select item, esperado, encontrado, case when esperado = encontrado then 'OK' else 'FALTA' end as resultado
from (
  select 1 as n, 'tabela projects com RLS ligada' as item, '1' as esperado,
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'projects' and c.relrowsecurity)::text as encontrado
  union all select 2, 'politicas de projects (ler, criar e alterar)', '3',
         (select count(*) from pg_policies where schemaname = 'public' and tablename = 'projects'
            and policyname in ('projects_read', 'projects_admin_insert', 'projects_admin_update'))::text
  union all select 3, 'ninguem apaga projeto pela API (DELETE) e anonimo nao toca em nada', '0',
         (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'projects'
            and ((grantee = 'authenticated' and privilege_type = 'DELETE') or grantee = 'anon'))::text
  union all select 4, 'gatilho que confere a designacao e carimba o servidor (trg_1_projects_guard)', '1',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_1_projects_guard')::text
  union all select 5, 'atividade com project_id e completes_project', '2',
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'activities' and column_name in ('project_id', 'completes_project'))::text
  union all select 6, 'regra: concluir o projeto exige o projeto (activities_completes_needs_project)', '1',
         (select count(*) from pg_constraint where conname = 'activities_completes_needs_project')::text
) x
order by n;
