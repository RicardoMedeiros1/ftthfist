-- RotaFibra - projetos designados: o administrador cria um projeto e o entrega a um tecnico; quando o tecnico o inicia,
-- a atividade nasce ligada a ele. Aplicar depois dos arquivos 1 a 12, em ordem do nome.

set search_path = public, extensions;

do $$ begin
  if to_regprocedure('public.admin_list_people()') is null then
    raise exception 'Faltam as migrations anteriores (arquivos 1 a 12). Aplique-as na ordem do nome.';
  end if;
end $$;

-- O projeto e escrito so pelo administrador (pela internet, nunca offline); o tecnico so le o que e dele.
-- Quem acompanha o andamento sao as atividades ligadas (activities.project_id), que o tecnico escreve como sempre.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id),   -- quem criou (administrador)
  assigned_to uuid not null references public.profiles (id),                   -- tecnico responsavel
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),            -- cursor do "puxar", como nas outras tabelas
  deleted boolean not null default false,                                      -- exclusao logica
  kind text not null check (kind in ('implantacao', 'manutencao')),
  title text not null check (length(btrim(title)) > 0),
  os_number text,
  description text not null default '',
  address text not null default '',
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  due_date date,
  status text not null default 'aberto' check (status in ('aberto', 'concluido', 'cancelado')),
  check ((lat is null) = (lng is null))
);
alter table public.projects enable row level security;

create index on public.projects (assigned_to, server_updated_at);
create index on public.projects (server_updated_at);

-- O servidor manda no relogio e em quem alterou; so se designa a tecnico (ou administrador) ativo.
create function public.projects_guard() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if tg_op = 'UPDATE' and new.owner_id <> old.owner_id then
    raise exception 'owner_id nao pode mudar' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or new.assigned_to <> old.assigned_to)
     and not exists (select 1 from public.profiles where id = new.assigned_to and active and role in ('tecnico', 'admin')) then
    raise exception 'o projeto so pode ser designado a um tecnico (ou administrador) ativo' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  new.server_updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end $$;

revoke execute on function public.projects_guard() from public, anon, authenticated;
create trigger trg_1_projects_guard before insert or update on public.projects for each row execute function public.projects_guard();

revoke all on public.projects from anon, authenticated;
grant select, insert, update on public.projects to authenticated;   -- ninguem apaga linha

-- Leitura: administrador e escritorio veem todos; o tecnico, so os designados a ele (inclusive os excluidos, para a
-- exclusao chegar ao celular). Escrita: so o administrador ativo.
create policy projects_read on public.projects for select to authenticated
  using (public.my_role() in ('admin', 'escritorio') or (public.my_role() = 'tecnico' and assigned_to = auth.uid()));
create policy projects_admin_insert on public.projects for insert to authenticated
  with check (public.my_role() = 'admin' and owner_id = auth.uid());
create policy projects_admin_update on public.projects for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- A atividade guarda de qual projeto veio e se, com ela, o projeto terminou. De proposito o servidor NAO confere se o
-- projeto ainda e do tecnico ou ainda esta aberto: o trabalho feito sem internet nunca pode ser recusado porque o
-- administrador cancelou ou reatribuiu o projeto nesse meio tempo (so a existencia do projeto e exigida, pela chave).
alter table public.activities add column project_id uuid references public.projects (id);
alter table public.activities add column completes_project boolean not null default false;
alter table public.activities add constraint activities_completes_needs_project check (not completes_project or project_id is not null);
create index on public.activities (project_id) where project_id is not null;
-- fim: projetos
