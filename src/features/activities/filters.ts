import type { Activity, ActivityKind } from '../../db/types';
import { isMine } from '../../lib/ownership';

// Filtros da lista de atividades (tecnico, tipo, situacao e busca). Funcoes puras: a tela so desenha.

export interface ActivityFilters {
  /** 'todos' | 'meus' | id da conta de outro tecnico */
  owner: string;
  kind: 'todas' | ActivityKind;
  status: 'todas' | 'aberta' | 'concluida';
  query: string;
}

export const DEFAULT_FILTERS: ActivityFilters = { owner: 'todos', kind: 'todas', status: 'todas', query: '' };

/** Quantos filtros estao ligados (a busca conta). */
export const activeFilterCount = (f: ActivityFilters) =>
  [f.owner !== 'todos', f.kind !== 'todas', f.status !== 'todas', f.query.trim() !== ''].filter(Boolean).length;

/** minusculas e sem acentos: "Manutenção" casa com "manutencao". */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterActivities(list: Activity[], f: ActivityFilters): Activity[] {
  const q = normalize(f.query.trim());
  return list.filter((a) => {
    if (f.owner === 'meus' && !isMine(a)) return false;
    if (f.owner !== 'todos' && f.owner !== 'meus' && a.ownerId !== f.owner) return false;
    if (f.kind !== 'todas' && a.kind !== f.kind) return false;
    if (f.status !== 'todas' && a.status !== f.status) return false;
    if (q && !normalize(`${a.title} ${a.osNumber ?? ''} ${a.technician} ${a.description}`).includes(q)) return false;
    return true;
  });
}

export interface OwnerOption {
  value: string;
  label: string;
  count: number;
}

/** Os outros tecnicos que aparecem na lista (nome mais recente de cada um), do que tem mais atividades ao que tem menos. */
export function ownerOptions(list: Activity[]): OwnerOption[] {
  const byOwner = new Map<string, { label: string; at: number; count: number }>();
  for (const a of list) {
    if (!a.ownerId || isMine(a)) continue;
    const cur = byOwner.get(a.ownerId);
    byOwner.set(a.ownerId, {
      label: !cur || a.startedAt >= cur.at ? a.technician : cur.label,
      at: Math.max(cur?.at ?? 0, a.startedAt),
      count: (cur?.count ?? 0) + 1,
    });
  }
  return [...byOwner.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}
