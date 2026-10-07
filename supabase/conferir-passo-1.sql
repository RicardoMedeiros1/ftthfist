-- RotaFibra - Fase 2 - passo 1: CONFERENCIA das migrations 1 a 9 (as do administrador, 10 e 11, tem o seu: conferir-admin.sql).
-- Mostra cada item esperado e o que foi encontrado. Se TODAS as linhas disserem OK, o banco esta completo.
-- Se alguma disser FALTA, uma migration nao foi aplicada ate o fim: me diga qual linha falhou.

select item, esperado, encontrado, case when esperado = encontrado then 'OK' else 'FALTA' end as resultado
from (
  select 1 as n, 'extensao postgis' as item, '1' as esperado,
         (select count(*) from pg_extension where extname = 'postgis')::text as encontrado
  union all select 2, 'tabelas em public (profiles, activities, elements, cables, photos, track_points, sync_conflicts)', '7',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r'
            and c.relname in ('profiles', 'activities', 'elements', 'cables', 'photos', 'track_points', 'sync_conflicts'))::text
  union all select 3, 'tabelas com RLS ligada', '7',
         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
            and c.relname in ('profiles', 'activities', 'elements', 'cables', 'photos', 'track_points', 'sync_conflicts'))::text
  union all select 4, 'politicas de acesso nas tabelas (sem as do administrador)', '19',
         (select count(*) from pg_policies where schemaname = 'public' and tablename not in ('admin_edits', 'projects') and policyname !~ '_adm_')::text
  union all select 5, 'politicas de acesso as fotos (storage)', '3',
         (select count(*) from pg_policies where schemaname = 'storage' and policyname in ('fotos_read', 'fotos_insert', 'fotos_update'))::text
  union all select 6, 'regra de conflito nas 5 tabelas de dados', '5',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_2_sync_guard')::text
  union all select 7, 'geometria automatica do cabo', '1',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'trg_1_geom')::text
  union all select 8, 'perfil criado ao cadastrar usuario', '1',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'on_auth_user_created')::text
  union all select 9, 'funcoes (my_role, handle_new_user, cables_set_geom, sync_guard, cable_totals)', '5',
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('my_role', 'handle_new_user', 'cables_set_geom', 'sync_guard', 'cable_totals'))::text
  union all select 10, 'visao activity_tracks', '1',
         (select count(*) from pg_views where schemaname = 'public' and viewname = 'activity_tracks')::text
  union all select 11, 'bucket de fotos, privado', '1',
         (select count(*) from storage.buckets where id = 'fotos' and not public)::text
  union all select 12, 'ninguem logado pode apagar linhas (privilegio DELETE em tabelas de dados)', '0',
         (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type = 'DELETE')::text
  union all select 13, 'novos perfis nascem PENDENTES (active padrao = false)', 'false',
         coalesce((select column_default from information_schema.columns
                   where table_schema = 'public' and table_name = 'profiles' and column_name = 'active'), '?')
  union all select 14, 'registro de aprovacao em profiles (reviewed_at, reviewed_by)', '2',
         (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles' and column_name in ('reviewed_at', 'reviewed_by'))::text
  union all select 15, 'trigger do registro de aprovacao', '1',
         (select count(*) from pg_trigger where not tgisinternal and tgname = 'profiles_review_audit')::text
  union all select 16, 'o pendente le o proprio perfil (politica profiles_read_self)', '1',
         (select count(*) from pg_policies where schemaname = 'public' and policyname = 'profiles_read_self')::text
) x
order by n;
