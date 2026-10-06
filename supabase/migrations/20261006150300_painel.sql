-- RotaFibra - Fase 2 - passo 4/4: visoes e totais usados pelo painel web (rodam com as permissoes de quem consulta).

set search_path = public, extensions;

-- Uma linha por atividade: a trilha como linhas separadas por trecho (pausa/tela apagada nao liga dois trechos),
-- com inicio, fim e distancia. Como e security_invoker, a RLS de track_points vale aqui tambem.
create view public.activity_tracks with (security_invoker = true) as
select activity_id,
       owner_id,
       min(start_ts) as started_at,
       max(end_ts) as ended_at,
       sum(st_length(line))::numeric as length_m,
       st_multi(st_collect(line::geometry))::geography as geom
from (
  select activity_id, owner_id, segment,
         min(ts) as start_ts, max(ts) as end_ts,
         st_makeline(geom::geometry order by ts)::geography as line
  from public.track_points
  where not deleted
  group by activity_id, owner_id, segment
  having count(*) > 1
) s
group by activity_id, owner_id;

-- Totais de cabo por tecnico e periodo. Soma os metros que o tecnico viu no app (length/reserve/total),
-- para o painel e o celular mostrarem o mesmo numero.
create function public.cable_totals(p_from timestamptz, p_to timestamptz)
returns table (owner_id uuid, technician text, cables bigint, length_m numeric, reserve_m numeric, total_m numeric)
language sql stable security invoker set search_path = public as
$$
  select c.owner_id, p.full_name, count(*), sum(c.length_m), sum(c.reserve_m), sum(c.total_m)
  from public.cables c
  join public.profiles p on p.id = c.owner_id
  where not c.deleted and c.created_at >= p_from and c.created_at < p_to
  group by c.owner_id, p.full_name
  order by sum(c.total_m) desc
$$;

revoke execute on function public.cable_totals(timestamptz, timestamptz) from public, anon;
grant  execute on function public.cable_totals(timestamptz, timestamptz) to authenticated;

revoke all on public.activity_tracks from anon, authenticated;
grant select on public.activity_tracks to authenticated;
