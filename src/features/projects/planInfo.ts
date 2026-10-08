import type { PlanLine, PlanPointType, Project, ProjectPlan } from '../../db/types';
import { formatMeters } from '../../lib/geo';
import { ELEMENT_META } from '../elements/meta';
import { isEmptyPlan, lineMeters } from './plan';
import type { ProjectRow } from './projectState';
import { isTodo } from './myProjects';

// O que se mostra do desenho do projeto para quem executa (tecnico) e para quem acompanha (escritorio): textos e a escolha de
// quais desenhos aparecem no mapa. Puro e testado; as telas so desenham.

/** Um desenho que aparece no mapa: de qual projeto e o que tem. */
export interface PlannedProject {
  id: string;
  title: string;
  plan: ProjectPlan;
}

/** Os desenhos dos projetos que ainda faltam fazer (concluido e cancelado ficam fora do mapa), na ordem recebida. */
export function plannedProjects(rows: readonly Pick<ProjectRow, 'project' | 'state'>[]): PlannedProject[] {
  return rows
    .filter((r) => isTodo(r) && !r.project.deleted && !isEmptyPlan(r.project.plan))
    .map((r) => ({ id: r.project.id, title: r.project.title, plan: r.project.plan! }));
}

export const plannedFromProject = (p: Pick<Project, 'id' | 'title' | 'plan'>): PlannedProject | null =>
  isEmptyPlan(p.plan) ? null : { id: p.id, title: p.title, plan: p.plan! };

/** "Poste projetado", "CTO projetado", "Reserva projetada"... ("outro" vira "Ponto projetado"). */
export const pointTitle = (type: PlanPointType): string => {
  if (type === 'outro') return 'Ponto projetado';
  return `${ELEMENT_META[type].label} projetad${type === 'reserva' ? 'a' : 'o'}`; // "a reserva", "o poste"
};

/** "Código: P-014" ou null quando o ponto nao tem codigo. */
export const codeText = (code: string | undefined): string | null => (code ? `Código: ${code}` : null);

/** "120 m · 4 pontos". */
export function lineText(line: PlanLine): string {
  return `${formatMeters(lineMeters(line))} · ${line.points.length} pontos`;
}
