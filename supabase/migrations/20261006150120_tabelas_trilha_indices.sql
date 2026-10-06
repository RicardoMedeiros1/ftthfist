-- RotaFibra - Fase 2 - passo 1: trilha GPS, log de conflitos e indices (parte 3 de 5 dos dados de campo).
-- Aplicar na ordem do nome do arquivo.

set search_path = public, extensions;

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
alter table public.track_points enable row level security;

-- Conflitos: o envio que chegou atrasado e diferente (perdeu) e o que o servidor manteve. So o admin le.
create table public.sync_conflicts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  record_id uuid not null,
  owner_id uuid not null,
  incoming jsonb not null,
  kept jsonb not null
);
alter table public.sync_conflicts enable row level security;

-- ---------- indices ----------
create index on public.elements (activity_id);
create index on public.elements using gist (geom);
create index on public.cables (activity_id);
create index on public.cables using gist (geom);
create index on public.photos (element_id);
create index on public.photos (activity_id);
create index on public.photos using gist (geom);
create index on public.track_points (activity_id, ts);
create index on public.track_points using gist (geom);
-- cursor do "puxar desde a ultima sincronizacao"
create index on public.activities (server_updated_at, id);
create index on public.elements (server_updated_at, id);
create index on public.cables (server_updated_at, id);
create index on public.photos (server_updated_at, id);
create index on public.track_points (server_updated_at, id);
-- fim: trilha, conflitos e indices
