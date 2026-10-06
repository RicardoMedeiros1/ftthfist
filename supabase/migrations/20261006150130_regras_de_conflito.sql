-- RotaFibra - Fase 2 - passo 1: geometria do cabo e regra de conflito (parte 4 de 5 dos dados de campo).
-- Aplicar na ordem do nome do arquivo.

set search_path = public, extensions;

-- ---------- geometria do cabo (de vertices) ----------
create function public.cables_set_geom() returns trigger language plpgsql set search_path = public, extensions as
$$
declare bad int;
begin
  if jsonb_typeof(new.vertices) is distinct from 'array' or jsonb_array_length(new.vertices) < 2 then
    raise exception 'o cabo precisa de pelo menos 2 pontos' using errcode = '23514';
  end if;
  select count(*) into bad
  from jsonb_array_elements(new.vertices) v
  where coalesce(jsonb_typeof(v -> 'lat'), '') <> 'number' or coalesce(jsonb_typeof(v -> 'lng'), '') <> 'number'
     or (v ->> 'lat')::float8 not between -90 and 90 or (v ->> 'lng')::float8 not between -180 and 180;
  if bad > 0 then
    raise exception 'vertices invalidos: cada ponto precisa de lat (-90..90) e lng (-180..180)' using errcode = '22023';
  end if;
  new.geom := (
    select st_makeline(st_setsrid(st_makepoint((v ->> 'lng')::float8, (v ->> 'lat')::float8), 4326) order by ord)::geography
    from jsonb_array_elements(new.vertices) with ordinality as t (v, ord)
  );
  return new;
end $$;

-- ---------- regra de conflito (todas as tabelas de dados) ----------
-- security definer: grava em sync_conflicts mesmo quando quem enviou nao tem permissao nessa tabela.
create function public.sync_guard() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  -- relogio adiantado nao "ganha para sempre"
  new.updated_at := least(new.updated_at, clock_timestamp() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then
      raise exception 'owner_id nao pode mudar' using errcode = '42501';
    end if;
    if new.updated_at <= old.updated_at then
      -- (geom e calculada depois dos triggers; fica fora da comparacao)
      if new.updated_at < old.updated_at
         and to_jsonb(new) - 'updated_at' - 'server_updated_at' - 'geom' is distinct from to_jsonb(old) - 'updated_at' - 'server_updated_at' - 'geom' then
        insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept)
        values (tg_table_name, old.id, old.owner_id, to_jsonb(new), to_jsonb(old));
      end if;
      return null;   -- reenvio identico ou atrasado: nao altera nada
    end if;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

revoke execute on function public.sync_guard() from public, anon, authenticated;
revoke execute on function public.cables_set_geom() from public, anon, authenticated;

create trigger trg_1_geom       before insert or update on public.cables for each row execute function public.cables_set_geom();
create trigger trg_2_sync_guard before insert or update on public.activities    for each row execute function public.sync_guard();
create trigger trg_2_sync_guard before insert or update on public.elements      for each row execute function public.sync_guard();
create trigger trg_2_sync_guard before insert or update on public.cables        for each row execute function public.sync_guard();
create trigger trg_2_sync_guard before insert or update on public.photos        for each row execute function public.sync_guard();
create trigger trg_2_sync_guard before insert or update on public.track_points  for each row execute function public.sync_guard();
-- fim: regras de conflito
