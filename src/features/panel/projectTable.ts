import type { Activity, Cable, NetworkElement, Project } from '../../db/types';
import { normalize } from '../activities/filters';
import { KIND_LABEL } from '../activities/labels';
import { buildCsv } from './csv';
import { linkedByProject } from '../projects/myProjects';
import { buildRows, filterRows, formatDueDate, sortRows, STATE_LABEL, STATE_ORDER, type ProjectRow, type StateFilter } from '../projects/projectState';

// A tabela de projetos do painel: uma linha por projeto, com o que os tecnicos ja fizeram nele. Funcoes puras: a tela so desenha.

export interface ProjectTableRow extends ProjectRow {
  id: string;
  title: string;
  osNumber: string;
  /** Atividades (nao excluidas) feitas neste projeto. */
  activities: number;
  elements: number;
  cables: number;
  /** Cabo total (tracado + reservas) das atividades do projeto, em metros. */
  meters: number;
  /** Texto (sem acento) em que a busca procura. */
  search: string;
}

export interface TableData {
  projects: readonly Project[];
  activities: readonly Activity[];
  elements: readonly Pick<NetworkElement, 'activityId' | 'deleted'>[];
  cables: readonly Pick<Cable, 'activityId' | 'deleted' | 'totalMeters'>[];
}

/** Uma linha por projeto nao excluido. `names`: id do tecnico -> nome (quem nao esta la ganha um nome honesto). */
export function buildProjectTableRows(data: TableData, names: ReadonlyMap<string, string>, now: number): ProjectTableRow[] {
  const live = data.activities.filter((a) => !a.deleted && a.projectId);
  const byProject = new Map<string, Set<string>>();
  for (const a of live) (byProject.get(a.projectId!) ?? byProject.set(a.projectId!, new Set()).get(a.projectId!)!).add(a.id);
  const count = <T extends { activityId: string; deleted: boolean }>(items: readonly T[], ids: Set<string>) => items.filter((x) => !x.deleted && ids.has(x.activityId));
  const titles = new Map<string, string[]>();
  for (const a of live) (titles.get(a.projectId!) ?? titles.set(a.projectId!, []).get(a.projectId!)!).push(a.title);

  return buildRows(data.projects, linkedByProject(data.activities), names, now).map((r): ProjectTableRow => {
    const ids = byProject.get(r.project.id) ?? new Set<string>();
    const cables = count(data.cables, ids);
    const p = r.project;
    return {
      ...r,
      id: p.id,
      title: p.title,
      osNumber: p.osNumber ?? '',
      activities: ids.size,
      elements: count(data.elements, ids).length,
      cables: cables.length,
      meters: cables.reduce((s, c) => s + c.totalMeters, 0),
      search: normalize(`${p.title} ${p.osNumber ?? ''} ${p.address} ${p.description} ${KIND_LABEL[p.kind]} ${r.technicianName} ${(titles.get(p.id) ?? []).join(' ')}`),
    };
  });
}

export interface ProjectFilters {
  state: StateFilter;
  /** '' = todos; senao o id do tecnico. */
  technician: string;
  query: string;
  onlyOverdue: boolean;
}

export const DEFAULT_PROJECT_FILTERS: ProjectFilters = { state: 'abertos', technician: '', query: '', onlyOverdue: false };

export const activeProjectFilterCount = (f: ProjectFilters): number =>
  [f.state !== DEFAULT_PROJECT_FILTERS.state, f.technician !== '', f.query.trim() !== '', f.onlyOverdue].filter(Boolean).length;

export function filterProjectRows(rows: readonly ProjectTableRow[], f: ProjectFilters): ProjectTableRow[] {
  // a busca da lista do administrador procura nos campos do projeto; aqui tambem no que foi feito (nome das atividades)
  const q = normalize(f.query.trim());
  const base = filterRows(rows, f.state, '', f.technician);
  return base.filter((r) => (!f.onlyOverdue || r.overdue) && (q === '' || r.search.includes(q)));
}

export type ProjectSortKey = 'title' | 'technician' | 'kind' | 'state' | 'dueDate' | 'activities' | 'meters';
export interface ProjectSort {
  key: ProjectSortKey;
  dir: 'asc' | 'desc';
}

const firstDir = (key: ProjectSortKey): ProjectSort['dir'] => (key === 'title' || key === 'technician' || key === 'kind' || key === 'state' || key === 'dueDate' ? 'asc' : 'desc');

/** Clicar na coluna: a primeira vez ordena, de novo inverte, e uma terceira volta a ordem padrao (os que pedem atencao primeiro). */
export function nextProjectSort(cur: ProjectSort | null, key: ProjectSortKey): ProjectSort | null {
  if (!cur || cur.key !== key) return { key, dir: firstDir(key) };
  return cur.dir === firstDir(key) ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : null;
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/** `null` = ordem padrao (atrasados, em andamento, pendentes...). Empate desempata pelo mais novo e pelo id; prazo vazio vai sempre para o fim. */
export function sortProjectRows(rows: readonly ProjectTableRow[], s: ProjectSort | null): ProjectTableRow[] {
  if (!s) return sortRows(rows);
  const sign = s.dir === 'asc' ? 1 : -1;
  const value = (r: ProjectTableRow): string | number | null => {
    switch (s.key) {
      case 'title': return r.title;
      case 'technician': return r.technicianName;
      case 'kind': return KIND_LABEL[r.project.kind];
      case 'state': return STATE_ORDER[r.state];
      case 'dueDate': return r.project.dueDate ?? null;
      case 'activities': return r.activities;
      case 'meters': return r.meters;
    }
  };
  const cmp = (a: ProjectTableRow, b: ProjectTableRow): number => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : Number(x) - Number(y)) * sign;
  };
  return [...rows].sort((a, b) => cmp(a, b) || b.project.createdAt - a.project.createdAt || (a.id < b.id ? -1 : 1));
}

export interface ProjectTotals {
  projects: number;
  activities: number;
  elements: number;
  cables: number;
  meters: number;
}

export const projectTotalsOf = (rows: readonly ProjectTableRow[]): ProjectTotals =>
  rows.reduce((t, r) => ({ projects: t.projects + 1, activities: t.activities + r.activities, elements: t.elements + r.elements, cables: t.cables + r.cables, meters: t.meters + r.meters }), { projects: 0, activities: 0, elements: 0, cables: 0, meters: 0 });

/** O que a visao geral mostra: quantos projetos ha em cada situacao e quantos estao atrasados. */
export interface ProjectCounts {
  total: number;
  pendente: number;
  em_andamento: number;
  concluido: number;
  cancelado: number;
  overdue: number;
}

export function projectCounts(rows: readonly ProjectRow[]): ProjectCounts {
  const out: ProjectCounts = { total: rows.length, pendente: 0, em_andamento: 0, concluido: 0, cancelado: 0, overdue: 0 };
  for (const r of rows) {
    out[r.state]++;
    if (r.overdue) out.overdue++;
  }
  return out;
}

const CSV_HEADERS = ['Projeto', 'Técnico', 'Tipo', 'OS', 'Endereço', 'Prazo', 'Situação', 'Atrasado', 'Atividades', 'Elementos', 'Cabos', 'Metros de cabo'];

/** CSV do que esta na tabela (a mesma ordem), para abrir no Excel. */
export function projectsCsv(rows: readonly ProjectTableRow[]): string {
  return buildCsv(
    CSV_HEADERS,
    rows.map((r) => [
      r.title,
      r.technicianName,
      KIND_LABEL[r.project.kind],
      r.osNumber,
      r.project.address,
      r.project.dueDate ? formatDueDate(r.project.dueDate) : '',
      STATE_LABEL[r.state],
      r.overdue ? 'sim' : 'não',
      { n: r.activities, decimals: 0 },
      { n: r.elements, decimals: 0 },
      { n: r.cables, decimals: 0 },
      { n: r.meters, decimals: 2 },
    ]),
  );
}

/** `projetos-2026-10-07.csv` (dia local). */
export function projectsFileName(now: Date): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `projetos-${d}.csv`;
}
