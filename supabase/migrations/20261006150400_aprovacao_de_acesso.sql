-- RotaFibra - Fase 2 - passo 1 (ajuste): CADASTRO COM APROVACAO.
-- Quem se cadastra pelo app nasce PENDENTE: nao le nem grava nada ate o admin aprovar (active = true).
-- Aplicar depois dos arquivos 1 a 8 (perfis ... painel). Pode rodar de novo sem problema.

do $$ begin
  if to_regclass('public.profiles') is null or to_regprocedure('public.my_role()') is null then
    raise exception 'Falta aplicar antes o arquivo 1 (perfis). Rode os arquivos na ordem.';
  end if;
end $$;

-- 1) Padrao novo: perfil nasce inativo (pendente). Quem ja esta ativo continua ativo.
alter table public.profiles alter column active set default false;
alter table public.profiles add column if not exists reviewed_at timestamptz;
alter table public.profiles add column if not exists reviewed_by uuid references public.profiles (id);
alter table public.profiles drop constraint if exists profiles_full_name_len;
alter table public.profiles add constraint profiles_full_name_len check (char_length(full_name) <= 100);

-- 2) O perfil nasce sempre como tecnico pendente. So o NOME vem do cadastro (e e limitado a 100 letras):
--    papel e "ativo" digitados no cadastro sao ignorados (raw_user_meta_data e controlado por quem se cadastra).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 100),
    'tecnico',
    false
  );
  return new;
end $$;

-- 3) O pendente enxerga SO o proprio perfil (para o app mostrar "aguardando aprovacao"); nada mais.
drop policy if exists profiles_read_self on public.profiles;
create policy profiles_read_self on public.profiles for select to authenticated using (id = auth.uid());

-- 4) Registro de quem aprovou e quando: preenchido pelo servidor sempre que "active" ou o papel mudam.
create or replace function public.profiles_review_audit() returns trigger language plpgsql as
$$ begin
  if new.active is distinct from old.active or new.role is distinct from old.role then
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();     -- vazio quando a mudanca e feita pelo SQL Editor / Table Editor
  else
    new.reviewed_at := old.reviewed_at;  -- ninguem edita o registro de aprovacao diretamente
    new.reviewed_by := old.reviewed_by;
  end if;
  return new;
end $$;

revoke execute on function public.profiles_review_audit() from public, anon, authenticated;

drop trigger if exists profiles_review_audit on public.profiles;
create trigger profiles_review_audit before update on public.profiles
  for each row execute function public.profiles_review_audit();

-- fim: aprovacao de acesso
