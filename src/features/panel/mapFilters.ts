import type { Activity, ActivityKind, Cable, ElementType, NetworkElement } from '../../db/types';
import { normalize } from '../activities/filters';
import { ELEMENT_META } from '../elements/meta';

// Filtros e busca do mapa da rede (painel). Funcoes puras: a tela so desenha.

export interface MapFilters {
  /** 'todos' ou a chave de um tecnico (ver ownerKey). */
  owner: string;
  kind: 'todas' | ActivityKind;
  status: 'todas' | 'aberta' | 'concluida';
  /** Datas locais "AAAA-MM-DD" (vazio = sem limite). Valem para o INICIO da atividade. */
  from: string;
  to: string;
  /** Vazio = todos os tipos. */
  types: ElementType[];
  showElements: boolean;
  showCables: boolean;
  /** 'todas' ou o numero de fibras. */
  fibers: 'todas' | number;
  query: string;
}

export const DEFAULT_MAP_FILTERS: MapFilters = {
  owner: 'todos',
  kind: 'todas',
  status: 'todas',
  from: '',
  to: '',
  types: [],
  showElements: true,
  showCables: true,
  fibers: 'todas',
  query: '',
};

/** Quantos filtros estao ligados (a busca conta; os dois interruptores "mostrar" contam quando desligados). */
export function activeMapFilterCount(f: MapFilters): number {
  return [
    f.owner !== 'todos',
    f.kind !== 'todas',
    f.status !== 'todas',
    f.from !== '' || f.to !== '',
    f.types.length > 0,
    !f.showElements,
    !f.showCables,
    f.fibers !== 'todas',
    f.query.trim() !== '',
  ].filter(Boolean).length;
}

/** Quem registrou: a conta (ownerId) e, nos registros antigos sem dono, o nome do tecnico. */
export const ownerKey = (a: Pick<Activity, 'ownerId' | 'technician'>) => a.ownerId ?? `nome:${a.technician}`;

export interface TechnicianOption {
  value: string;
  label: string;
  count: number;
}

/** Todos os tecnicos que tem atividade (nome mais recente de cada um), do que tem mais atividades ao que tem menos. */
export function technicianOptions(activities: Activity[]): TechnicianOption[] {
  const by = new Map<string, { label: string; at: number; count: number }>();
  for (const a of activities) {
    if (a.deleted) continue;
    const k = ownerKey(a);
    const cur = by.get(k);
    by.set(k, { label: !cur || a.startedAt >= cur.at ? a.technician : cur.label, at: Math.max(cur?.at ?? 0, a.startedAt), count: (cur?.count ?? 0) + 1 });
  }
  return [...by.entries()]
    .map(([value, v]) => ({ value, label: v.label, count: v.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}

// ---------- periodo ----------

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Meia-noite LOCAL do dia "AAAA-MM-DD" (null se invalido). */
export function dayStart(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.getTime();
}

/** Ultimo instante do dia local "AAAA-MM-DD" (null se invalido). */
export function dayEnd(s: string): number | null {
  const start = dayStart(s);
  if (start === null) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + 1);
  return d.getTime() - 1;
}

export type PeriodPreset = 'hoje' | '7d' | '30d';

/** "Hoje", "ultimos 7 dias" (contando hoje) e "ultimos 30 dias". */
export function presetRange(preset: PeriodPreset, now: number): { from: string; to: string } {
  const days = preset === 'hoje' ? 0 : preset === '7d' ? 6 : 29;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return { from: toDateInput(d.getTime()), to: toDateInput(now) };
}

// ---------- texto de busca ----------

const activityText = (a: Activity) => normalize(`${a.title} ${a.osNumber ?? ''} ${a.technician} ${a.description}`);

export function elementLabel(e: Pick<NetworkElement, 'type' | 'code'>): string {
  return `${ELEMENT_META[e.type].label}${e.code ? ` ${e.code}` : ''}`;
}

function elementText(e: NetworkElement): string {
  const attrs = Object.values(e.attrs as Record<string, unknown>).filter((v) => typeof v === 'string' || typeof v === 'number');
  return normalize(`${elementLabel(e)} ${e.notes} ${attrs.join(' ')}`);
}

const cableText = (c: Cable) => normalize(`${c.cableType} ${c.fiberCount} fibras ${c.notes}`);

// ---------- aplicar ----------

/**
 * Os registros vivos de uma lista: sem os excluidos E sem os de uma atividade excluida (a exclusao da atividade leva tudo junto,
 * mas um registro que chegou depois, de um aparelho que ainda nao sabia, nao pode reaparecer no painel).
 */
export function liveItems<T extends { activityId: string; deleted: boolean }>(items: T[], activities: Pick<Activity, 'id' | 'deleted'>[]): T[] {
  const gone = new Set(activities.filter((a) => a.deleted).map((a) => a.id));
  return items.filter((x) => !x.deleted && !gone.has(x.activityId));
}

export interface MapData {
  activities: Activity[];
  elements: NetworkElement[];
  cables: Cable[];
}

export interface MapView {
  activities: Activity[];
  elements: NetworkElement[];
  cables: Cable[];
  /** Totais SEM filtro (o que existe), para "mostrando X de Y". */
  totals: { activities: number; elements: number; cables: number };
}

/** Os filtros que valem para a ATIVIDADE (os mesmos no mapa e na tabela). */
export type ActivityFilterValues = Pick<MapFilters, 'owner' | 'kind' | 'status' | 'from' | 'to'>;

/** Passa pelos filtros da ATIVIDADE (tecnico, tipo, situacao, periodo)? `from`/`to` ja em ms (ver dayStart/dayEnd). */
export function activityPasses(a: Activity, f: ActivityFilterValues, from: number | null, to: number | null): boolean {
  if (f.owner !== 'todos' && ownerKey(a) !== f.owner) return false;
  if (f.kind !== 'todas' && a.kind !== f.kind) return false;
  if (f.status !== 'todas' && a.status !== f.status) return false;
  if (from !== null && a.startedAt < from) return false;
  if (to !== null && a.startedAt > to) return false;
  return true;
}

export function applyMapFilters(data: MapData, f: MapFilters): MapView {
  const acts = data.activities.filter((a) => !a.deleted);
  const els = liveItems(data.elements, data.activities);
  const cbs = liveItems(data.cables, data.activities);
  const byId = new Map(acts.map((a) => [a.id, a]));
  const from = f.from ? dayStart(f.from) : null;
  const to = f.to ? dayEnd(f.to) : null;
  const q = normalize(f.query.trim());
  const structural = f.owner !== 'todos' || f.kind !== 'todas' || f.status !== 'todas' || from !== null || to !== null;

  const allowed = new Set(acts.filter((a) => activityPasses(a, f, from, to)).map((a) => a.id));
  const textHit = new Map(acts.map((a) => [a.id, q !== '' && activityText(a).includes(q)]));
  // registro de atividade que ainda nao chegou: so aparece quando nenhum filtro de atividade esta ligado
  const actOk = (id: string) => (byId.has(id) ? allowed.has(id) : !structural);

  const types = new Set(f.types);
  const elements = f.showElements
    ? els.filter((e) => actOk(e.activityId) && (types.size === 0 || types.has(e.type)) && (q === '' || textHit.get(e.activityId) === true || elementText(e).includes(q)))
    : [];
  const cables = f.showCables
    ? cbs.filter((c) => actOk(c.activityId) && (f.fibers === 'todas' || c.fiberCount === f.fibers) && (q === '' || textHit.get(c.activityId) === true || cableText(c).includes(q)))
    : [];

  const withItems = new Set([...elements.map((e) => e.activityId), ...cables.map((c) => c.activityId)]);
  const activities = acts.filter((a) => allowed.has(a.id) && (q === '' ? true : textHit.get(a.id) === true || withItems.has(a.id)));
  return { activities, elements, cables, totals: { activities: acts.length, elements: els.length, cables: cbs.length } };
}

// ---------- resultados da busca ----------

export interface SearchHit {
  kind: 'atividade' | 'elemento' | 'cabo';
  id: string;
  title: string;
  subtitle: string;
}

/** Lista de resultados para a busca (atividades que combinam, depois elementos e cabos que combinam). */
export function searchHits(view: MapView, query: string, limit = 30): { hits: SearchHit[]; total: number } {
  const q = normalize(query.trim());
  if (q === '') return { hits: [], total: 0 };
  const byId = new Map(view.activities.map((a) => [a.id, a]));
  const who = (id: string) => {
    const a = byId.get(id);
    return a ? `${a.title} · ${a.technician}` : 'atividade ainda não sincronizada';
  };
  const hits: SearchHit[] = [
    ...view.activities.filter((a) => activityText(a).includes(q)).map((a): SearchHit => ({ kind: 'atividade', id: a.id, title: a.title, subtitle: `${a.technician}${a.osNumber ? ` · OS ${a.osNumber}` : ''}` })),
    ...view.elements.filter((e) => elementText(e).includes(q)).map((e): SearchHit => ({ kind: 'elemento', id: e.id, title: elementLabel(e), subtitle: who(e.activityId) })),
    ...view.cables.filter((c) => cableText(c).includes(q)).map((c): SearchHit => ({ kind: 'cabo', id: c.id, title: `${c.cableType} · ${c.fiberCount} fibras`, subtitle: who(c.activityId) })),
  ];
  return { hits: hits.slice(0, limit), total: hits.length };
}
