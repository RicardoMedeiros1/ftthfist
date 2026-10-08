-- RotaFibra - fibras e ligacao de cabos: o cabo guarda o padrao de cores das fibras (ABNT ou internacional) e as ligacoes com
-- outros cabos (neste elemento, este cabo continua no cabo X). Aplicar depois do arquivo 14 (...150700_projetos_desenho).
-- Pode ser colado de novo sem erro (so cria o que ainda nao existe).

set search_path = public, extensions;

do $$ begin
  if to_regclass('public.cables') is null then
    raise exception 'Faltam as migrations anteriores (arquivos 1 a 14). Aplique-as na ordem do nome.';
  end if;
end $$;

-- Ligacoes: [{"elementId": "<uuid>", "cableId": "<uuid>"}, ...]. Sao so referencias (nao ha chave estrangeira): se um cabo ou
-- elemento some, a ligacao fica sem efeito no app. No maximo 200 por cabo.
create or replace function public.cable_links_valid(p jsonb) returns boolean language plpgsql immutable set search_path = public as
$$
declare l jsonb;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) > 200 then return false; end if;
  for l in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(l) is distinct from 'object' then return false; end if;
    if jsonb_typeof(l -> 'elementId') is distinct from 'string' or jsonb_typeof(l -> 'cableId') is distinct from 'string' then return false; end if;
    if (l ->> 'elementId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (l ->> 'cableId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  end loop;
  return true;
end $$;

-- Sem padrao gravado = ABNT. Sem ligacoes = lista vazia.
alter table public.cables add column if not exists color_standard text;
alter table public.cables add column if not exists links jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cables_color_standard_valid' and conrelid = 'public.cables'::regclass) then
    alter table public.cables add constraint cables_color_standard_valid check (color_standard is null or color_standard in ('abnt', 'tia598'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cables_links_valid' and conrelid = 'public.cables'::regclass) then
    alter table public.cables add constraint cables_links_valid check (public.cable_links_valid(links));
  end if;
end $$;
-- fim: fibras e ligacao de cabos
