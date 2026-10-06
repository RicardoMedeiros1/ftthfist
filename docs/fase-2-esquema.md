# Fase 2 — esquema SQL (RASCUNHO para aprovação)

> **Atualização:** o cadastro agora é **com aprovação** (a pessoa pede acesso pelo app e o admin aprova), não mais
> "o admin cria os usuários". As migrations reais estão em `supabase/migrations/` e são a fonte da verdade; este
> rascunho ficou desatualizado em vários pontos (arquivos divididos, geometria calculada no servidor, perfil pendente).

> Isto **não é** a migration. É o desenho para você revisar. Depois da sua confirmação ele vira
> `supabase/migrations/0001_*.sql` e é testado em um Postgres 16 + PostGIS local.

## Ideias que sustentam o desenho

- **Reenviar nunca duplica.** Todo registro já nasce com UUID no aparelho; o envio é um *upsert* por `id`.
- **O servidor decide o dono.** `owner_id` vem de `auth.uid()`, nunca do aparelho. Ninguém troca o dono depois.
- **Conflito: vence o `updated_at` mais recente** (do aparelho, como pede o roteiro). Um *trigger* ignora o envio atrasado e
  o registra em `sync_conflicts`. Relógio adiantado é limitado a "agora + 5 min", senão um celular com a hora errada
  ganharia para sempre.
- **Cursor do "puxar" usa o relógio do servidor** (`server_updated_at`), não o do aparelho: um celular com a hora errada
  não faz o outro perder alterações.
- **Ninguém apaga linha.** Não existe política de `delete`: a exclusão é lógica (`deleted = true`), como no app.
- **Como só o dono edita, conflito de verdade só acontece quando o mesmo técnico usa dois aparelhos.**

## Colunas comuns (todas as tabelas de dados)

| coluna | para quê |
|---|---|
| `id uuid primary key` | gerado no aparelho |
| `owner_id uuid not null default auth.uid()` | quem enviou; define o que a pessoa pode editar |
| `created_by text` | nome do técnico, como aparece no app |
| `created_at`, `updated_at timestamptz` | do aparelho; decidem o conflito |
| `server_updated_at timestamptz default now()` | do servidor; cursor da sincronização |
| `deleted boolean default false` | exclusão lógica |

## SQL

```sql
create extension if not exists postgis;

-- ---------- perfis e papéis ----------
create type public.app_role as enum ('tecnico', 'escritorio', 'admin');

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       public.app_role not null default 'tecnico',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Papel de quem está logado (null = sem perfil ou desativado). security definer: as políticas
-- podem consultar sem cair em recursão de RLS.
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

-- Perfil criado quando o admin cadastra o usuário em Authentication → Users.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- dados de campo ----------
create table public.activities (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  created_by text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  kind text not null check (kind in ('implantacao', 'manutencao')),
  title text not null, os_number text, technician text not null,
  started_at timestamptz not null, ended_at timestamptz,
  status text not null check (status in ('aberta', 'concluida')),
  description text not null default '', materials jsonb not null default '[]'
);

create table public.elements (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  created_by text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities(id),
  type text not null check (type in ('poste', 'cto', 'ceo', 'reserva', 'ocorrencia', 'outro')),
  geom geography(Point, 4326) not null,
  accuracy_m real,                                   -- só quando a posição veio do GPS
  position_source text not null check (position_source in ('gps', 'manual')),
  code text not null default '', notes text not null default '',
  attrs jsonb not null default '{}'                  -- atributos por tipo, como no app
);

create table public.cables (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  created_by text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities(id),
  cable_type text not null,
  fiber_count int not null check (fiber_count in (1, 2, 4, 6, 12, 24, 36, 48, 72, 144)),
  geom geography(LineString, 4326) not null,
  vertices jsonb not null,                           -- [{elementId?, lat, lng}] na ordem do traçado
  length_m numeric not null, reserve_m numeric not null, total_m numeric not null,  -- como o técnico viu no app
  notes text not null default ''
);

create table public.photos (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  created_by text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities(id),
  element_id uuid references public.elements(id),
  geom geography(Point, 4326),
  taken_at timestamptz not null,
  storage_path text                                  -- fotos/<owner_id>/<id>.jpg; null enquanto a foto não subiu
);

create table public.track_points (                   -- um ponto por linha, enviado em lotes
  id uuid primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  created_by text not null,
  created_at timestamptz not null, updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  activity_id uuid not null references public.activities(id),
  geom geography(Point, 4326) not null, accuracy_m real not null,
  ts timestamptz not null, speed real, segment int not null default 0
);

create table public.sync_conflicts (                 -- visível ao admin
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null, record_id uuid not null, owner_id uuid not null,
  incoming jsonb not null, kept jsonb not null       -- o que chegou (perdeu) e o que o servidor manteve
);

create index on public.elements (activity_id);  create index on public.elements using gist (geom);
create index on public.cables   (activity_id);  create index on public.cables   using gist (geom);
create index on public.photos   (element_id);   create index on public.photos   using gist (geom);
create index on public.track_points (activity_id, ts);
create index on public.track_points using gist (geom);
-- e (server_updated_at, id) em cada tabela de dados, para o "puxar desde a última sincronização"

-- ---------- regra de conflito (todas as tabelas de dados) ----------
create function public.sync_guard() returns trigger language plpgsql as
$$ begin
  new.updated_at := least(new.updated_at, now() + interval '5 minutes');   -- relógio adiantado não ganha para sempre
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then raise exception 'owner_id não pode mudar'; end if;
    if new.updated_at <= old.updated_at then
      if new.updated_at < old.updated_at then      -- chegou atrasado e diferente: registra e mantém o do servidor
        insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept)
        values (tg_table_name, old.id, old.owner_id, to_jsonb(new), to_jsonb(old));
      end if;
      return null;                                 -- reenvio idêntico ou atrasado: não altera nada
    end if;
  end if;
  new.server_updated_at := now();
  return new;
end $$;
-- create trigger sync_guard before insert or update on public.<tabela> for each row execute function public.sync_guard();

-- ---------- RLS ----------
-- Leitura: qualquer perfil ativo lê a rede toda. Escrita: só o dono, e só técnico/admin.
alter table public.elements enable row level security;
create policy elements_read   on public.elements for select to authenticated
  using (public.my_role() is not null);
create policy elements_insert on public.elements for insert to authenticated
  with check (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'));
create policy elements_update on public.elements for update to authenticated
  using      (owner_id = auth.uid() and public.my_role() in ('tecnico', 'admin'))
  with check (owner_id = auth.uid());
-- (sem política de delete: ninguém apaga linha)
-- Mesmo padrão em activities, cables e photos.
-- track_points: leitura só do dono e de escritório/admin (trilha de colega não vai para o celular de ninguém).

alter table public.profiles enable row level security;
create policy profiles_read   on public.profiles for select to authenticated using (public.my_role() is not null);
create policy profiles_admin  on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');   -- ninguém se promove sozinho

alter table public.sync_conflicts enable row level security;
create policy conflicts_admin on public.sync_conflicts for select to authenticated using (public.my_role() = 'admin');

-- ---------- fotos (Storage, bucket privado) ----------
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', false);
create policy fotos_read   on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and public.my_role() is not null);
create policy fotos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy fotos_update on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
-- (sem delete: foto "excluída" fica no bucket; o registro marca deleted = true)

-- ---------- visões e totais do painel ----------
create view public.activity_tracks with (security_invoker = true) as
select activity_id, owner_id, min(start_ts) as started_at, max(end_ts) as ended_at,
       sum(ST_Length(line))::numeric as length_m,
       ST_Multi(ST_Collect(line::geometry))::geography as geom
from (
  select activity_id, owner_id, segment, min(ts) as start_ts, max(ts) as end_ts,
         ST_MakeLine(geom::geometry order by ts)::geography as line
  from public.track_points where not deleted
  group by activity_id, owner_id, segment having count(*) > 1
) s group by activity_id, owner_id;

-- Totais de cabo por técnico e período: soma o metro que o técnico viu no app (total_m),
-- para o painel e o celular mostrarem o mesmo número.
create function public.cable_totals(p_from timestamptz, p_to timestamptz)
returns table (technician text, cables bigint, length_m numeric, reserve_m numeric, total_m numeric)
language sql stable security invoker as
$$ select c.created_by, count(*), sum(c.length_m), sum(c.reserve_m), sum(c.total_m)
   from public.cables c where not c.deleted and c.created_at >= p_from and c.created_at < p_to
   group by c.created_by order by 5 desc $$;
```

## O que fica de fora do servidor (de propósito)

- **Camadas de referência (KML/KMZ importados):** continuam só no aparelho. São arquivos de terceiros.
- **Chaves:** o servidor só recebe a *anon key* do app. A *service key* nunca entra no repositório nem no navegador.
