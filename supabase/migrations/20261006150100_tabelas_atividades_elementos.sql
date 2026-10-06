-- RotaFibra - Fase 2 - passo 1: dados de campo (espelham o modelo local do app), geometria PostGIS,
-- regra de conflito e RLS (parte 1 de 5: tabelas atividades e elementos). Aplicar na ordem do nome do arquivo.
--
-- Colunas comuns:
--   id               uuid gerado no aparelho -> o envio e um upsert por id: reenviar nunca duplica
--   owner_id         quem enviou. O SERVIDOR define (default auth.uid()); ninguem troca depois
--   created_by       nome do tecnico, como aparece no app
--   created_at / updated_at   do aparelho; o updated_at mais recente vence o conflito
--   server_updated_at         relogio do servidor; e o cursor do "puxar" (o app puxa com ~5 min de sobreposicao,
--                             porque uma transacao longa pode confirmar depois de outra mais nova)
--   deleted          exclusao logica (nao existe delete para ninguem)

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
alter table public.activities enable row level security;

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
  accuracy_m real check (accuracy_m >= 0),            -- so quando a posicao veio do GPS
  position_source text not null check (position_source in ('gps', 'manual')),
  code text not null default '',
  notes text not null default '',
  attrs jsonb not null default '{}' check (jsonb_typeof(attrs) = 'object')
);
alter table public.elements enable row level security;
-- fim: tabelas atividades e elementos
