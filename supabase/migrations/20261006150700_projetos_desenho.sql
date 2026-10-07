-- RotaFibra - desenho do projeto: o administrador desenha no mapa o tracado e os pontos projetados, e o tecnico ve como guia.
-- Aplicar depois do arquivo 13 (...150600_projetos), em ordem do nome. Pode ser rodado de novo sem erro (nao repete o que ja existe).

set search_path = public, extensions;

do $$ begin
  if to_regclass('public.projects') is null then
    raise exception 'Falta o arquivo ...150600_projetos. Aplique-o antes deste.';
  end if;
end $$;

-- [lat, lng] dentro do mundo.
create or replace function public.plan_coord_ok(v jsonb) returns boolean language plpgsql immutable set search_path = public as
$$
begin
  if jsonb_typeof(v) is distinct from 'array' then return false; end if;
  if jsonb_array_length(v) <> 2 then return false; end if;
  if jsonb_typeof(v -> 0) is distinct from 'number' or jsonb_typeof(v -> 1) is distinct from 'number' then return false; end if;
  return (v ->> 0)::float8 between -90 and 90 and (v ->> 1)::float8 between -180 and 180;
exception when others then
  return false;   -- numero grande demais para caber (ex.: 1e999) tambem e recusado
end $$;

-- O desenho: {"lines": [{"id", "points": [[lat, lng], ...]}], "points": [{"id", "type", "lat", "lng", "code"?}]}
-- Mesmos limites do app (src/features/projects/plan.ts): 200 tracados, 2000 pontos, 5000 vertices por tracado, 20000 no total.
create or replace function public.plan_is_valid(p jsonb) returns boolean language plpgsql immutable set search_path = public as
$$
declare l jsonb; v jsonb; pt jsonb; total int := 0;
begin
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text) > 400000 then return false; end if;
  if coalesce(jsonb_typeof(p -> 'lines'), '') <> 'array' or coalesce(jsonb_typeof(p -> 'points'), '') <> 'array' then return false; end if;
  if jsonb_array_length(p -> 'lines') > 200 or jsonb_array_length(p -> 'points') > 2000 then return false; end if;
  for l in select value from jsonb_array_elements(p -> 'lines') loop
    if coalesce(jsonb_typeof(l -> 'points'), '') <> 'array' then return false; end if;   -- (l que nao e objeto nao tem 'points')
    if jsonb_array_length(l -> 'points') not between 2 and 5000 then return false; end if;
    for v in select value from jsonb_array_elements(l -> 'points') loop
      if not public.plan_coord_ok(v) then return false; end if;
      total := total + 1;
    end loop;
  end loop;
  if total > 20000 then return false; end if;
  for pt in select value from jsonb_array_elements(p -> 'points') loop
    if coalesce(pt ->> 'type', '') not in ('poste', 'cto', 'ceo', 'reserva', 'outro') then return false; end if;
    if not public.plan_coord_ok(jsonb_build_array(pt -> 'lat', pt -> 'lng')) then return false; end if;
    if jsonb_exists(pt, 'code') and (jsonb_typeof(pt -> 'code') <> 'string' or length(pt ->> 'code') > 60) then return false; end if;
  end loop;
  return true;
end $$;

-- Sem desenho = nulo. Quem escreve (administrador) e quem le (como o resto do projeto) nao muda.
alter table public.projects add column if not exists plan jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'projects_plan_valid' and conrelid = 'public.projects'::regclass) then
    alter table public.projects add constraint projects_plan_valid check (plan is null or public.plan_is_valid(plan));
  end if;
end $$;
-- fim: desenho do projeto
