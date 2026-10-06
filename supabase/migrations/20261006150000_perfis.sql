-- RotaFibra - Fase 2 - passo 1/4: extensao, perfis e papeis.
-- Aplicar as 4 migrations em ordem (CLI: `supabase db push`; ou colar no SQL Editor, uma por vez).

set search_path = public, extensions;

create extension if not exists postgis with schema extensions;

create type public.app_role as enum ('tecnico', 'escritorio', 'admin');

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (length(btrim(full_name)) > 0),
  role       public.app_role not null default 'tecnico',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Papel de quem esta logado. null = sem perfil ou conta desativada (nao le nem escreve nada).
-- security definer: as politicas de RLS consultam esta funcao sem cair em recursao.
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

revoke execute on function public.my_role() from public, anon;
grant  execute on function public.my_role() to authenticated;

-- O admin cadastra o usuario em Authentication -> Users; o perfil nasce junto, como tecnico.
-- (Para tornar alguem escritorio/admin: ver supabase/README.md.)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS (ja ligada logo apos o create table) ----------

-- Qualquer perfil ativo ve os nomes e papeis (os filtros do painel precisam deles).
create policy profiles_read on public.profiles for select to authenticated
  using (public.my_role() is not null);

-- So o admin altera perfis: ninguem se promove sozinho. Nao ha insert (vem do trigger) nem delete.
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

revoke all on public.profiles from anon, authenticated;
grant select, update on public.profiles to authenticated;
