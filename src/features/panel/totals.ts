import type { Activity, ActivityKind, Cable, ElementType, NetworkElement } from '../../db/types';
import { round2 } from '../../lib/geo';
import { ELEMENT_TYPES } from '../elements/meta';
import { buildCsv, type CsvCell } from './csv';
import { dayEnd, dayStart, liveItems, ownerKey } from './mapFilters';

// Totais por tecnico e periodo (secao "Totais" do painel). Funcoes puras; os mesmos numeros que o tecnico viu no app.
//
// O periodo vale pela data em que cada CABO e cada ELEMENTO foi registrado (a mesma regra da funcao cable_totals do
// servidor); as atividades entram pela data de inicio.

export interface TotalsFilters {
  owner: string;
  kind: 'todas' | ActivityKind;
  from: string;
  to: string;
}

export const DEFAULT_TOTALS_FILTERS: TotalsFilters = { owner: 'todos', kind: 'todas', from: '', to: '' };

export const activeTotalsFilterCount = (f: TotalsFilters): number =>
  [f.owner !== 'todos', f.kind !== 'todas', f.from !== '' || f.to !== ''].filter(Boolean).length;

export interface TotalsRow {
  /** Chave do tecnico (ver ownerKey). */
  owner: string;
  label: string;
  activities: number;
  cables: number;
  lengthMeters: number;
  reserveMeters: number;
  totalMeters: number;
  elements: number;
  byType: Record<ElementType, number>;
}

export interface TotalsData {
  activities: Activity[];
  elements: NetworkElement[];
  cables: Cable[];
}

const emptyByType = (): Record<ElementType, number> => Object.fromEntries(ELEMENT_TYPES.map((t) => [t.type, 0])) as Record<ElementType, number>;

/** Dono do registro: a conta e, nos registros antigos sem dono, o nome de quem registrou. */
const recordOwner = (r: { ownerId?: string; createdBy: string }) => r.ownerId ?? `nome:${r.createdBy}`;

export function computeTotals(data: TotalsData, f: TotalsFilters): TotalsRow[] {
  const from = f.from ? dayStart(f.from) : null;
  const to = f.to ? dayEnd(f.to) : null;
  const inPeriod = (ms: number) => (from === null || ms >= from) && (to === null || ms <= to);
  const acts = data.activities.filter((a) => !a.deleted);
  const kindOf = new Map(acts.map((a) => [a.id, a.kind]));
  // atividade que ainda nao chegou: so entra quando nao se filtra por tipo
  const kindOk = (activityId: string) => f.kind === 'todas' || kindOf.get(activityId) === f.kind;

  // o nome mais recente de cada tecnico
  const labels = new Map<string, { label: string; at: number }>();
  for (const a of acts) {
    const k = ownerKey(a);
    const cur = labels.get(k);
    if (!cur || a.startedAt >= cur.at) labels.set(k, { label: a.technician, at: a.startedAt });
  }

  const rows = new Map<string, TotalsRow>();
  const row = (owner: string, fallbackLabel: string): TotalsRow => {
    let r = rows.get(owner);
    if (!r) {
      r = { owner, label: labels.get(owner)?.label ?? fallbackLabel, activities: 0, cables: 0, lengthMeters: 0, reserveMeters: 0, totalMeters: 0, elements: 0, byType: emptyByType() };
      rows.set(owner, r);
    }
    return r;
  };
  const wanted = (owner: string) => f.owner === 'todos' || f.owner === owner;

  for (const a of acts) {
    const owner = ownerKey(a);
    if (wanted(owner) && (f.kind === 'todas' || a.kind === f.kind) && inPeriod(a.startedAt)) row(owner, a.technician).activities++;
  }
  for (const c of liveItems(data.cables, data.activities)) {
    const owner = recordOwner(c);
    if (!wanted(owner) || !kindOk(c.activityId) || !inPeriod(c.createdAt)) continue;
    const r = row(owner, c.createdBy);
    r.cables++;
    r.lengthMeters += c.lengthMeters;
    r.reserveMeters += c.reserveMeters;
    r.totalMeters += c.totalMeters;
  }
  for (const e of liveItems(data.elements, data.activities)) {
    const owner = recordOwner(e);
    if (!wanted(owner) || !kindOk(e.activityId) || !inPeriod(e.createdAt)) continue;
    const r = row(owner, e.createdBy);
    r.elements++;
    r.byType[e.type]++;
  }
  return [...rows.values()]
    .map((r) => ({ ...r, lengthMeters: round2(r.lengthMeters), reserveMeters: round2(r.reserveMeters), totalMeters: round2(r.totalMeters) }))
    .sort((a, b) => b.totalMeters - a.totalMeters || a.label.localeCompare(b.label, 'pt-BR'));
}

export function sumTotals(rows: TotalsRow[]): TotalsRow {
  const t: TotalsRow = { owner: '*', label: 'Total', activities: 0, cables: 0, lengthMeters: 0, reserveMeters: 0, totalMeters: 0, elements: 0, byType: emptyByType() };
  for (const r of rows) {
    t.activities += r.activities;
    t.cables += r.cables;
    t.lengthMeters += r.lengthMeters;
    t.reserveMeters += r.reserveMeters;
    t.totalMeters += r.totalMeters;
    t.elements += r.elements;
    for (const k of Object.keys(t.byType) as ElementType[]) t.byType[k] += r.byType[k];
  }
  return { ...t, lengthMeters: round2(t.lengthMeters), reserveMeters: round2(t.reserveMeters), totalMeters: round2(t.totalMeters) };
}

/** O CSV da tabela como ela esta na tela (com a linha de total no fim). */
export function totalsCsv(rows: TotalsRow[]): string {
  const headers = ['Técnico', 'Atividades', 'Cabos', 'Traçado (m)', 'Reservas (m)', 'Total de cabo (m)', 'Elementos', ...ELEMENT_TYPES.map((t) => `Elementos: ${t.label}`)];
  const line = (r: TotalsRow): CsvCell[] => [
    r.label,
    { n: r.activities, decimals: 0 },
    { n: r.cables, decimals: 0 },
    { n: r.lengthMeters },
    { n: r.reserveMeters },
    { n: r.totalMeters },
    { n: r.elements, decimals: 0 },
    ...ELEMENT_TYPES.map((t): CsvCell => ({ n: r.byType[t.type], decimals: 0 })),
  ];
  return buildCsv(headers, rows.length > 0 ? [...rows.map(line), line(sumTotals(rows))] : []);
}

/** "totais-2026-10-01_a_2026-10-31.csv" (ou "totais-2026-10-07.csv" sem periodo, com a data de hoje). */
export function totalsFileName(f: Pick<TotalsFilters, 'from' | 'to'>, today: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (f.from && f.to) return `totais-${f.from}_a_${f.to}.csv`;
  if (f.from) return `totais-desde-${f.from}.csv`;
  if (f.to) return `totais-ate-${f.to}.csv`;
  return `totais-${day}.csv`;
}
