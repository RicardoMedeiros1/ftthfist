-- RotaFibra - Fase 2 - passo 1: tabelas de cabos e fotos (parte 2 de 5 dos dados de campo).
-- Aplicar na ordem do nome do arquivo.

set search_path = public, extensions;

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
  geom geography(LineString, 4326),                   -- calculada de `vertices` (trigger); nao vem do aparelho
  length_m numeric not null check (length_m >= 0),    -- metros como o tecnico viu no app
  reserve_m numeric not null check (reserve_m >= 0),
  total_m numeric not null check (total_m >= 0),
  notes text not null default ''
);
alter table public.cables enable row level security;

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
  storage_path text                                   -- fotos/<owner_id>/<id>.jpg; null enquanto a foto nao subiu
);
alter table public.photos enable row level security;
-- fim: tabelas cabos e fotos
