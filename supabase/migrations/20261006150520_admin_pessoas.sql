-- RotaFibra - Fase 2 - administrador (parte 3): lista de pessoas com e-mail (so o administrador ve) e a trava que
-- impede ficar sem nenhum administrador ativo. Aplicar depois da parte 2 (...150510).

set search_path = public, extensions;

do $$ begin
  if to_regclass('public.admin_edits') is null then
    raise exception 'Faltam os arquivos ...150500 e ...150510 (administrador). Aplique-os antes deste.';
  end if;
end $$;

-- O e-mail fica em auth.users e NAO deve chegar a quem nao e administrador (os tecnicos leem os perfis uns dos outros).
-- Por isso a lista sai de uma funcao que so devolve linhas para o administrador ativo.
create function public.admin_list_people() returns table (
  id uuid, email text, full_name text, role public.app_role, active boolean,
  created_at timestamptz, reviewed_at timestamptz, reviewed_by_name text
) language sql stable security definer set search_path = public as
$$
  select p.id, u.email::text, p.full_name, p.role, p.active, p.created_at, p.reviewed_at, r.full_name
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles r on r.id = p.reviewed_by
  where public.my_role() = 'admin'
  order by p.active, p.created_at desc
$$;

revoke execute on function public.admin_list_people() from public, anon;
grant execute on function public.admin_list_people() to authenticated;

-- Nunca ficar sem administrador: ninguem rebaixa nem desativa o ULTIMO administrador ativo (nem o proprio, nem pelo SQL).
create function public.keep_one_admin() returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles p where p.id <> old.id and p.role = 'admin' and p.active) then
      raise exception 'precisa existir pelo menos um administrador ativo' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.keep_one_admin() from public, anon, authenticated;

create trigger trg_keep_one_admin before update on public.profiles for each row execute function public.keep_one_admin();
-- fim: administrador, parte 3 (pessoas)
