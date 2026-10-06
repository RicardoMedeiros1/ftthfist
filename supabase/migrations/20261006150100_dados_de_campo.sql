-- RotaFibra · Fase 2 · passo 2/4: dados de campo (espelham o modelo local do app), geometria PostGIS,
-- regra de conflito e RLS.
--
-- Colunas comuns:
--   id               uuid gerado no aparelho → o envio é um upsert por id: reenviar nunca duplica
--   owner_id         quem enviou. O SERVIDOR define (default auth.uid()); ninguém troca depois
--   created_by       nome do técnico, como aparece no app
--   created_at / updated_at   do aparelho; o updated_at mais recente vence o conflito
--   server_updated_at         relógio do servidor; é o cursor do "puxar" (o app puxa com ~5 min de sobreposição,
--                             porque uma transação longa pode confirmar depois de outra mais nova)
--   deleted          exclusão lógica (não existe delete para ninguém)

set search_path = public, extensions;

create table public.activities (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted boolean not null default false,
  kind text not null check (kind in ('implantacao', 'manutencao')),
  title text not null,
  os_number text,
  technician text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null check (status in ('aberta', 'concluida')),
  description text not null default '',
  materials jsonb not null default '[]' check (jsonb_typeof(materials) = 'array')
);

create table public.elements (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities (id),
  type text not null check (type in ('poste', 'cto', 'ceo', 'reserva', 'ocorrencia', 'outro')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geom geography(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  accuracy_m real check (accuracy_m >= 0),            -- só quando a posição veio do GPS
  position_source text not null check (position_source in ('gps', 'manual')),
  code text not null default '',
  notes text not null default '',
  attrs jsonb not null default '{}' check (jsonb_typeof(attrs) = 'object')
);

create table public.cables (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities (id),
  cable_type text not null,
  fiber_count int not null check (fiber_count in (1, 2, 4, 6, 12, 24, 36, 48, 72, 144)),
  vertices jsonb not null check (jsonb_typeof(vertices) = 'array' and jsonb_array_length(vertices) >= 2),
  geom geography(LineString, 4326),                   -- calculada de `vertices` (trigger); não vem do aparelho
  length_m numeric not null check (length_m >= 0),    -- metros como o técnico viu no app
  reserve_m numeric not null check (reserve_m >= 0),
  total_m numeric not null check (total_m >= 0),
  notes text not null default ''
);

create table public.photos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities (id),
  element_id uuid references public.elements (id),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  geom geography(Point, 4326) generated always as (
    case when lat is not null and lng is not null then st_setsrid(st_makepoint(lng, lat), 4326)::geography end
  ) stored,
  taken_at timestamptz not null,
  storage_path text                                   -- fotos/<owner_id>/<id>.jpg; null enquanto a foto não subiu
);

create table public.track_points (                    -- um ponto por linha, enviado em lotes
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles (id),
  created_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default clock_timestamp(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities (id),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  geom geography(Point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  accuracy_m real not null check (accuracy_m >= 0),
  ts timestamptz not null,
  speed real,
  segment int not null default 0
);

-- Conflitos: o envio que chegou atrasado e diferente (perdeu) e o que o servidor manteve. Só o admin lê.
create table public.sync_conflicts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  record_id uuid not null,
  owner_id uuid not null,
  incoming jsonb not null,
  kept jsonb not null
);

-- ---------- índices ----------
create index on public.elements (activity_id);
create index on public.elements using gist (geom);
create index on public.cables (activity_id);
create index on public.cables using gist (geom);
create index on public.photos (element_id);
create index on public.photos (activity_id);
create index on public.photos using gist (geom);
create index on public.track_points (activity_id, ts);
create index on public.track_points using gist (geom);
-- cursor do "puxar desde a última sincronização"
create index on public.activities (server_updated_at, id);
create index on public.elements (server_updated_at, id);
create index on public.cables (server_updated_at, id);
create index on public.photos (server_updated_at, id);
create index on public.track_points (server_updated_at, id);

-- ---------- geometria do cabo (de vertices) ----------
create function public.cables_set_geom() returns trigger language plpgsql as
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
    raise exception 'vertices inválidos: cada ponto precisa de lat (-90..90) e lng (-180..180)' using errcode = '22023';
  end if;
  new.geom := (
    select st_makeline(st_setsrid(st_makepoint((v ->> 'lng')::float8, (v ->> 'lat')::float8), 4326) order by ord)::geography
    from jsonb_array_elements(new.vertices) with ordinality as t (v, ord)
  );
  return new;
end $$;

-- ---------- regra de conflito (todas as tabelas de dados) ----------
-- security definer: grava em sync_conflicts mesmo quando quem enviou não tem permissão nessa tabela.
create function public.sync_guard() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  -- relógio adiantado não "ganha para sempre"
  new.updated_at := least(new.updated_at, clock_timestamp() + interval '5 minutes');
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then
      raise exception 'owner_id não pode mudar' using errcode = '42501';
    end if;
    if new.updated_at <= old.updated_at then
      -- (geom é calculada depois dos triggers; fica fora da comparação)
      if new.updated_at < old.updated_at
         and to_jsonb(new) - 'updated_at' - 'server_updated_at' - 'geom' is distinct from to_jsonb(old) - 'updated_at' - 'server_updated_at' - 'geom' then
        insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept)
        values (tg_table_name, old.id, old.owner_id, to_jsonb(new), to_jsonb(old));
      end if;
      return null;   -- reenvio idêntico ou atrasado: não altera nada
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

-- ---------- permissões e RLS ----------
-- Camada 1 (privilégios): ninguém, nem logado, apaga linha; anônimo não toca em nada.
revoke all on public.activities, public.elements, public.cables, public.photos, public.track_points, public.sync_conflicts
  from anon, authenticated;
grant select, insert, update on public.activities, public.elements, public.cables, public.photos, public.track_points to authenticated;
grant select on public.sync_conflicts to authenticated;

-- Camada 2 (RLS). Leitura: qualquer perfil ativo lê a rede toda. Escrita: só o dono, e só técnico/admin.
-- Filhos só podem ser ligados a uma atividade do próprio dono (ninguém "pendura" registro na atividade de outro).
alter table public.activities enable row level security;
alter table public.elements enable row level security;
alter table public.cables enable row level security;
alter table public.photos enable row level security;
alter table public.track_points enable row level security;
alter table public.sync_conflicts enable row level security;

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

-- Trilha: leitura só do dono e de escritório/admin (a trilha de um colega não vai para o celular de ninguém).
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
