import type { Activity, ActivityKind, Cable, NetworkElement, Photo } from '../../db/types';
import { normalize } from '../activities/filters';
import { activityPasses, dayEnd, dayStart, elementLabel, ownerKey, type ActivityFilterValues } from './mapFilters';

// A tabela de atividades do painel: uma linha por atividade, com os totais dela. Funcoes puras: a tela so desenha.

export interface ActivityRow {
  id: string;
  activity: Activity;
  title: string;
  technician: string;
  owner: string;
  kind: ActivityKind;
  status: Activity['status'];
  osNumber: string;
  startedAt: number;
  /** Duracao em ms; null enquanto a atividade esta aberta. */
  durationMs: number | null;
  elements: number;
  cables: number;
  /** Cabo total (tracado + reservas), em metros. */
  meters: number;
  photos: number;
  /** Texto (sem acento) em que a busca procura: a atividade E o que ha dentro dela (codigos, tipos de cabo). */
  search: string;
}

export interface RowsData {
  activities: Activity[];
  elements: NetworkElement[];
  cables: Cable[];
  photos: Pick<Photo, 'activityId' | 'deleted'>[];
}

export function buildRows(data: RowsData): ActivityRow[] {
  const acts = data.activities.filter((a) => !a.deleted);
  const els = new Map<string, NetworkElement[]>();
  const cbs = new Map<string, Cable[]>();
  const photos = new Map<string, number>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => (m.get(k)?.push(v) ?? m.set(k, [v]));
  for (const e of data.elements) if (!e.deleted) push(els, e.activityId, e);
  for (const c of data.cables) if (!c.deleted) push(cbs, c.activityId, c);
  for (const p of data.photos) if (!p.deleted) photos.set(p.activityId, (photos.get(p.activityId) ?? 0) + 1);

  return acts.map((a): ActivityRow => {
    const e = els.get(a.id) ?? [];
    const c = cbs.get(a.id) ?? [];
    const inside = [...e.map((x) => `${elementLabel(x)} ${x.notes}`), ...c.map((x) => `${x.cableType} ${x.fiberCount} fibras ${x.notes}`)].join(' ');
    return {
      id: a.id,
      activity: a,
      title: a.title,
      technician: a.technician,
      owner: ownerKey(a),
      kind: a.kind,
      status: a.status,
      osNumber: a.osNumber ?? '',
      startedAt: a.startedAt,
      durationMs: a.endedAt !== undefined ? Math.max(0, a.endedAt - a.startedAt) : null,
      elements: e.length,
      cables: c.length,
      meters: c.reduce((s, x) => s + x.totalMeters, 0),
      photos: photos.get(a.id) ?? 0,
      search: normalize(`${a.title} ${a.osNumber ?? ''} ${a.technician} ${a.description} ${inside}`),
    };
  });
}

export interface RowFilters extends ActivityFilterValues {
  query: string;
}

export const DEFAULT_ROW_FILTERS: RowFilters = { owner: 'todos', kind: 'todas', status: 'todas', from: '', to: '', query: '' };

export const activeRowFilterCount = (f: RowFilters): number =>
  [f.owner !== 'todos', f.kind !== 'todas', f.status !== 'todas', f.from !== '' || f.to !== '', f.query.trim() !== ''].filter(Boolean).length;

export function filterRows(rows: ActivityRow[], f: RowFilters): ActivityRow[] {
  const from = f.from ? dayStart(f.from) : null;
  const to = f.to ? dayEnd(f.to) : null;
  const q = normalize(f.query.trim());
  return rows.filter((r) => activityPasses(r.activity, f, from, to) && (q === '' || r.search.includes(q)));
}

export type SortKey = 'title' | 'technician' | 'kind' | 'status' | 'startedAt' | 'durationMs' | 'elements' | 'cables' | 'meters' | 'photos';
export type SortDir = 'asc' | 'desc';
export interface Sort {
  key: SortKey;
  dir: SortDir;
}
export const DEFAULT_SORT: Sort = { key: 'startedAt', dir: 'desc' };

/** Colunas de texto comecam em ordem alfabetica; as de numero e data, do maior (mais recente) para o menor. */
export const firstDir = (key: SortKey): SortDir => (key === 'title' || key === 'technician' || key === 'kind' || key === 'status' ? 'asc' : 'desc');

/** Clicar na coluna: a primeira vez ordena, clicar de novo na mesma inverte. */
export const nextSort = (cur: Sort, key: SortKey): Sort => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) });

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/** Ordem estavel: empate desempata pelo inicio (mais recente primeiro) e depois pelo id. Atividade aberta (sem duracao) vai para o fim. */
export function sortRows(rows: ActivityRow[], s: Sort): ActivityRow[] {
  const sign = s.dir === 'asc' ? 1 : -1;
  const cmp = (a: ActivityRow, b: ActivityRow): number => {
    const x = a[s.key];
    const y = b[s.key];
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // vazio sempre no fim, em qualquer sentido
    const c = typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : Number(x) - Number(y);
    return c * sign;
  };
  return [...rows].sort((a, b) => cmp(a, b) || b.startedAt - a.startedAt || (a.id < b.id ? -1 : 1));
}

export interface RowTotals {
  activities: number;
  elements: number;
  cables: number;
  meters: number;
  photos: number;
}

export const totalsOf = (rows: ActivityRow[]): RowTotals =>
  rows.reduce((t, r) => ({ activities: t.activities + 1, elements: t.elements + r.elements, cables: t.cables + r.cables, meters: t.meters + r.meters, photos: t.photos + r.photos }), { activities: 0, elements: 0, cables: 0, meters: 0, photos: 0 });
