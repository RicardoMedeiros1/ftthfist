import type { Cable, ElementType, NetworkElement, Photo } from '../../db/types';
import { round2 } from '../../lib/geo';
import { ELEMENT_TYPES } from '../elements/meta';

const PLURAL: Record<ElementType, string> = { poste: 'postes', cto: 'CTOs', ceo: 'CEOs', reserva: 'reservas', ocorrencia: 'ocorrências', outro: 'outros' };

export interface ActivitySummary {
  /** So os tipos que existem, na ordem padrao dos tipos. `label` ja concorda com a quantidade ("1 poste", "2 postes"). */
  byType: Array<{ type: ElementType; label: string; count: number }>;
  elements: number;
  cables: number;
  lengthMeters: number;
  reserveMeters: number;
  totalMeters: number;
  photos: number;
}

/** Totais de uma atividade (sem os registros excluidos). Os metros sao os que o tecnico viu no app (tracado + reservas). */
export function summarizeActivity(elements: NetworkElement[], cables: Cable[], photos: Photo[]): ActivitySummary {
  const els = elements.filter((e) => !e.deleted);
  const cbs = cables.filter((c) => !c.deleted);
  const counts = new Map<ElementType, number>();
  for (const e of els) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return {
    byType: ELEMENT_TYPES.filter((m) => counts.has(m.type)).map((m) => {
      const count = counts.get(m.type)!;
      return { type: m.type, label: count === 1 ? m.label : PLURAL[m.type], count };
    }),
    elements: els.length,
    cables: cbs.length,
    lengthMeters: round2(cbs.reduce((s, c) => s + c.lengthMeters, 0)),
    reserveMeters: round2(cbs.reduce((s, c) => s + c.reserveMeters, 0)),
    totalMeters: round2(cbs.reduce((s, c) => s + c.totalMeters, 0)),
    photos: photos.filter((p) => !p.deleted).length,
  };
}

/** [sul, oeste, norte, leste] de todos os pontos da atividade (elementos e vertices dos cabos); null se nao ha pontos. */
export function activityBounds(elements: NetworkElement[], cables: Cable[]): [number, number, number, number] | null {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  const add = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    s = Math.min(s, lat);
    n = Math.max(n, lat);
    w = Math.min(w, lng);
    e = Math.max(e, lng);
  };
  for (const el of elements) if (!el.deleted) add(el.lat, el.lng);
  for (const c of cables) if (!c.deleted) for (const v of c.vertices) add(v.lat, v.lng);
  return Number.isFinite(s) ? [s, w, n, e] : null;
}
