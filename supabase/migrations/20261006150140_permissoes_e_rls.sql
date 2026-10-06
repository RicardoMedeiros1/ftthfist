-- RotaFibra - Fase 2 - passo 1: permissoes e politicas de acesso (RLS) (parte 5 de 5 dos dados de campo).
-- Aplicar na ordem do nome do arquivo.

set search_path = public, extensions;

-- ---------- permissoes e RLS ----------
-- Camada 1 (privilegios): ninguem, nem logado, apaga linha; anonimo nao toca em nada.
revoke all on public.activities, public.elements, public.cables, public.photos, public.track_points, public.sync_conflicts
  from anon, authenticated;
grant select, insert, update on public.activities, public.elements, public.cables, public.photos, public.track_points to authenticated;
grant select on public.sync_conflicts to authenticated;

-- Camada 2 (RLS). Leitura: qualquer perfil ativo le a rede toda. Escrita: so o dono, e so tecnico/admin.
-- Filhos so podem ser ligados a uma atividade do proprio dono (ninguem "pendura" registro na atividade de outro).
create policy activities_read on public.activities for select to authenticated using (public.my_role() is not null);
create policy activities_insert on public.activities for insert to authenticated
  with check (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'));
create policy activities_update on public.activities for update to authenticated
  using (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'))
  with check (owner_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['elements', 'cables', 'photos'] loop
    execute format($f$create policy %1$s_read on public.%1$s for select to authenticated using (public.my_role() is not null)$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated
      with check (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin')
        and exists (select 1 from public.activities a where a.id = activity_id and a.owner_id = auth.uid()))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$s for update to authenticated
      using (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'))
      with check (owner_id = auth.uid()
        and exists (select 1 from public.activities a where a.id = activity_id and a.owner_id = auth.uid()))$f$, t);
  end loop;
end $$;

-- Trilha: leitura so do dono e de escritorio/admin (a trilha de um colega nao vai para o celular de ninguem).
create policy track_points_read on public.track_points for select to authenticated
  using (owner_id = auth.uid() or public.my_role() in ('escritorio', 'admin'));
create policy track_points_insert on public.track_points for insert to authenticated
  with check (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin')
    and exists (select 1 from public.activities a where a.id = activity_id and a.owner_id = auth.uid()));
create policy track_points_update on public.track_points for update to authenticated
  using (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'))
  with check (owner_id = auth.uid()
    and exists (select 1 from public.activities a where a.id = activity_id and a.owner_id = auth.uid()));

create policy sync_conflicts_admin on public.sync_conflicts for select to authenticated using (public.my_role() = 'admin');
-- fim: permissoes e RLS
