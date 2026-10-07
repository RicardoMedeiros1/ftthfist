import { normalize } from '../activities/filters';
import { KIND_LABEL } from '../activities/labels';
import type { LinkedActivity, Project, ProjectState } from './types';

// Regras de apresentacao dos projetos (puras, testadas sem tela). O mesmo codigo serve ao administrador, ao tecnico e ao painel.

export const STATE_LABEL: Record<ProjectState, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

/**
 * Cancelado ou concluido a mao (administrador) vale sempre. Senao: concluido se uma atividade ligada, nao excluida e
 * concluida, diz que terminou o projeto; em andamento se ha atividade ligada nao excluida; pendente se nao ha nenhuma.
 */
export function projectState(project: Pick<Project, 'status'>, linked: readonly LinkedActivity[]): ProjectState {
  if (project.status === 'cancelado') return 'cancelado';
  if (project.status === 'concluido') return 'concluido';
  const live = linked.filter((a) => !a.deleted);
  if (live.some((a) => a.completesProject && a.status === 'concluida')) return 'concluido';
  return live.length > 0 ? 'em_andamento' : 'pendente';
}

/** Dia local `AAAA-MM-DD` (o prazo e um dia do calendario, sem hora). */
export function dayString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Atrasado: tem prazo, o prazo ja passou (o proprio dia ainda nao conta) e o projeto ainda nao terminou nem foi cancelado. */
export function isOverdue(project: Pick<Project, 'dueDate'>, state: ProjectState, now: number): boolean {
  if (!project.dueDate || state === 'concluido' || state === 'cancelado') return false;
  return project.dueDate < dayString(now);
}

/** `2026-10-20` -> `20/10/2026`. */
export function formatDueDate(dueDate: string): string {
  const [y, m, d] = dueDate.split('-');
  return y && m && d ? `${d}/${m}/${y}` : dueDate;
}

export interface ProjectRow {
  project: Project;
  state: ProjectState;
  technicianName: string;
  linked: LinkedActivity[];
  overdue: boolean;
}

export type StateFilter = 'todos' | 'abertos' | ProjectState;

export const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'abertos', label: 'Para fazer' },
  { value: 'pendente', label: 'Pendentes' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'concluido', label: 'Concluídos' },
  { value: 'cancelado', label: 'Cancelados' },
  { value: 'todos', label: 'Todos' },
];


/** Monta as linhas da lista (excluidos ficam de fora). */
export function buildRows(projects: readonly Project[], linkedBy: ReadonlyMap<string, LinkedActivity[]>, names: ReadonlyMap<string, string>, now: number): ProjectRow[] {
  return projects
    .filter((p) => !p.deleted)
    .map((project) => {
      const linked = linkedBy.get(project.id) ?? [];
      const state = projectState(project, linked);
      return { project, state, linked, technicianName: names.get(project.assignedTo) ?? 'Técnico não encontrado', overdue: isOverdue(project, state, now) };
    });
}

/** "Para fazer" = pendente + em andamento. A busca olha titulo, OS, endereco, descricao, tipo e nome do tecnico, sem acento. */
export function filterRows(rows: readonly ProjectRow[], filter: StateFilter, query: string, technicianId = ''): ProjectRow[] {
  const q = normalize(query.trim());
  return rows.filter((r) => {
    if (filter === 'abertos' ? r.state !== 'pendente' && r.state !== 'em_andamento' : filter !== 'todos' && r.state !== filter) return false;
    if (technicianId && r.project.assignedTo !== technicianId) return false;
    if (!q) return true;
    const p = r.project;
    return normalize([p.title, p.osNumber ?? '', p.address, p.description, KIND_LABEL[p.kind], r.technicianName].join(' ')).includes(q);
  });
}

const ORDER: Record<ProjectState, number> = { em_andamento: 0, pendente: 1, concluido: 2, cancelado: 3 };

/** Os que pedem atencao primeiro: atrasados, depois por prazo mais proximo (sem prazo por ultimo), depois os mais novos. */
export function sortRows(rows: readonly ProjectRow[]): ProjectRow[] {
  return [...rows].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.state !== b.state) return ORDER[a.state] - ORDER[b.state];
    const da = a.project.dueDate;
    const db = b.project.dueDate;
    if (da !== db) return da === undefined ? 1 : db === undefined ? -1 : da < db ? -1 : 1;
    return b.project.createdAt - a.project.createdAt;
  });
}

/** Quantos projetos ha em cada situacao (a lista mostra o numero ao lado do filtro). */
export function countByState(rows: readonly ProjectRow[]): Record<StateFilter, number> {
  const out: Record<StateFilter, number> = { todos: rows.length, abertos: 0, pendente: 0, em_andamento: 0, concluido: 0, cancelado: 0 };
  for (const r of rows) {
    out[r.state]++;
    if (r.state === 'pendente' || r.state === 'em_andamento') out.abertos++;
  }
  return out;
}
