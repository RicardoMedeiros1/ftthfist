-- RotaFibra - Fase 2 - administrador (parte 2 de 2): o administrador ATIVO altera qualquer registro (inclusive
-- "excluir", que e sempre logico). O dono original nunca muda. Aplicar depois da parte 1.

set search_path = public, extensions;

do $$ begin
  if to_regclass('public.admin_edits') is null then
    raise exception 'Falta o arquivo ...150500_admin_auditoria. Aplique-o antes deste.';
  end if;
end $$;

-- A regra de conflito agora tambem grava quem alterou (updated_by). O resto e igual a antes.
create or replace function public.sync_guard() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  -- relogio adiantado nao "ganha para sempre"
  new.updated_at := least(new.updated_at, clock_timestamp() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then
      raise exception 'owner_id nao pode mudar' using errcode = '42501';
    end if;
    if new.updated_at <= old.updated_at then
      -- (geom e calculada depois dos gatilhos; updated_by so muda com quem grava: ficam fora da comparacao)
      if new.updated_at < old.updated_at
         and to_jsonb(new) - 'updated_at' - 'server_updated_at' - 'geom' - 'updated_by'
             is distinct from to_jsonb(old) - 'updated_at' - 'server_updated_at' - 'geom' - 'updated_by' then
        insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept)
        values (tg_table_name, old.id, old.owner_id, to_jsonb(new), to_jsonb(old));
      end if;
      return null;   -- reenvio identico ou atrasado: nao altera nada
    end if;
  end if;
  new.updated_by := auth.uid();
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

-- O administrador ativo pode ALTERAR qualquer linha. Leitura ja e de todos; ninguem apaga linha.
-- O envio do app e um INSERT ... ON CONFLICT DO UPDATE e o Postgres confere a politica de INSERT na linha proposta antes
-- de decidir que e uma alteracao: por isso o admin tambem ganha insert, mas so em nome dele (owner_id = ele).
do $$
declare t text;
begin
  foreach t in array array['activities', 'elements', 'cables', 'photos', 'track_points'] loop
    execute format($f$create policy %1$s_adm_edit on public.%1$s for update to authenticated
      using (public.my_role() = 'admin') with check (public.my_role() = 'admin')$f$, t);
    execute format($f$create policy %1$s_adm_insert on public.%1$s for insert to authenticated
      with check (public.my_role() = 'admin' and owner_id = auth.uid())$f$, t);
  end loop;
end $$;

-- Com o insert do admin, a RLS deixou de exigir "atividade do mesmo dono"; este gatilho (so dispara em insercao de
-- verdade, nunca na alteracao) devolve a regra: registro NOVO so entra na atividade de quem o cria.
create function public.check_child_owner() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if not exists (select 1 from public.activities a where a.id = new.activity_id and a.owner_id = new.owner_id) then
    raise exception 'registro novo so pode ser criado em uma atividade propria' using errcode = '42501';
  end if;
  return null;
end $$;

revoke execute on function public.check_child_owner() from public, anon, authenticated;

create trigger trg_4_own_activity after insert on public.elements for each row execute function public.check_child_owner();
create trigger trg_4_own_activity after insert on public.cables for each row execute function public.check_child_owner();
create trigger trg_4_own_activity after insert on public.photos for each row execute function public.check_child_owner();
create trigger trg_4_own_activity after insert on public.track_points for each row execute function public.check_child_owner();
-- fim: administrador, parte 2 (edita tudo)
