-- RotaFibra - Fase 2 - administrador: CONFERENCIA das migrations 10 e 11 (...150500_admin_auditoria e ...150510_admin_edita_tudo).
-- Se TODAS as linhas disserem OK, o banco esta completo para o administrador. Se alguma disser FALTA, me diga qual.

select item, esperado, encontrado, case when esperado = encontrado then 'OK' else 'FALTA' end as resultado
from (
  select 1 as n, 'coluna updated_by (quem alterou por ultimo) nas 5 tabelas de dados' as item, '5' as esperado,
         (select count(*) from information_schema.columns
          where table_schema = 'public' and column_name = 'updated_by'
            and table_name in ('activities', 'elements', 'cables', 'photos', 'track_points'))::text as encontrado
  union all select 2, 'tabela admin_edits (registro das alteracoes) com RLS ligada', '1',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'admin_edits' and c.relrowsecurity)::text
  union all select 3, 'so o admin le o registro (politica admin_edits_select)', '1',
         (select count(*) from pg_policies where schemaname = 'public' and policyname = 'admin_edits_select')::text
  union all select 4, 'ninguem escreve em admin_edits pela API (INSERT/UPDATE/DELETE)', '0',
         (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'admin_edits' and grantee in ('anon', 'authenticated')
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::text
  union all select 5, 'gatilho que registra quem alterou o que e de outro (trg_3_admin_audit)', '5',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_3_admin_audit')::text
  union all select 6, 'politicas do administrador (alterar e inserir em nome proprio)', '10',
         (select count(*) from pg_policies where schemaname = 'public' and policyname ~ '_adm_(edit|insert)$')::text
  union all select 7, 'registro novo so em atividade propria (trg_4_own_activity)', '4',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_4_own_activity')::text
  union all select 8, 'a regra de conflito grava quem alterou (sync_guard atualizada)', '1',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'sync_guard' and p.prosrc like '%updated_by%')::text
) x
order by n;
