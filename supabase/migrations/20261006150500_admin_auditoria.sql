-- RotaFibra - Fase 2 - administrador (parte 1 de 2): quem alterou por ultimo e registro das alteracoes feitas por quem
-- NAO e o dono (so o administrador consegue; ver a parte 2). Aplicar depois dos arquivos 1 a 9, em ordem do nome.

set search_path = public, extensions;

do $$ begin
  if to_regprocedure('public.sync_guard()') is null or to_regclass('public.track_points') is null then
    raise exception 'Faltam as migrations anteriores (arquivos 1 a 9). Aplique-as na ordem do nome.';
  end if;
  if not exists (select from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'reviewed_at') then
    raise exception 'Falta o arquivo ...150400_aprovacao_de_acesso. Aplique-o antes deste.';
  end if;
end $$;

-- Quem fez a ultima alteracao (o SERVIDOR preenche, a partir do login; vazio quando a mudanca vem do SQL Editor).
alter table public.activities add column if not exists updated_by uuid references public.profiles (id);
alter table public.elements add column if not exists updated_by uuid references public.profiles (id);
alter table public.cables add column if not exists updated_by uuid references public.profiles (id);
alter table public.photos add column if not exists updated_by uuid references public.profiles (id);
alter table public.track_points add column if not exists updated_by uuid references public.profiles (id);

-- Registro das alteracoes feitas por quem nao e o dono do registro: quem, quando, como era e como ficou.
create table public.admin_edits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  record_id uuid not null,
  owner_id uuid not null,
  edited_by uuid not null references public.profiles (id),
  before jsonb not null,
  after jsonb not null
);
alter table public.admin_edits enable row level security;

create index on public.admin_edits (record_id, at desc);
create index on public.admin_edits (at desc);

-- So o administrador le. Ninguem escreve pela API: o registro e feito pelo gatilho abaixo.
revoke all on public.admin_edits from anon, authenticated;
grant select on public.admin_edits to authenticated;
create policy admin_edits_select on public.admin_edits for select to authenticated using (public.my_role() = 'admin');

create function public.log_admin_edit() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  -- depois de gravar de verdade (o envio atrasado ou repetido nao chega aqui) e so quando quem altera nao e o dono
  if auth.uid() is not null and old.owner_id <> auth.uid() then
    insert into public.admin_edits (table_name, record_id, owner_id, edited_by, before, after)
    values (tg_table_name, old.id, old.owner_id, auth.uid(), to_jsonb(old) - 'geom', to_jsonb(new) - 'geom');
  end if;
  return null;
end $$;

revoke execute on function public.log_admin_edit() from public, anon, authenticated;

create trigger trg_3_admin_audit after update on public.activities for each row execute function public.log_admin_edit();
create trigger trg_3_admin_audit after update on public.elements for each row execute function public.log_admin_edit();
create trigger trg_3_admin_audit after update on public.cables for each row execute function public.log_admin_edit();
create trigger trg_3_admin_audit after update on public.photos for each row execute function public.log_admin_edit();
create trigger trg_3_admin_audit after update on public.track_points for each row execute function public.log_admin_edit();
-- fim: administrador, parte 1 (auditoria)
