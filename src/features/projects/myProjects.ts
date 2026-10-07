import type { Activity, Project } from '../../db/types';
import { buildRows, sortRows, type ProjectRow } from './projectState';
import type { LinkedActivity, ProjectInput } from './types';

// Os projetos de quem esta com o app aberto (tecnico, ou administrador que tambem faz campo). Puro: a tela so desenha.

/** Atividades ligadas a projetos, por projeto, na ordem em que comecaram (as excluidas ficam: quem decide e `projectState`). */
export function linkedByProject(activities: readonly Activity[]): Map<string, LinkedActivity[]> {
  const out = new Map<string, LinkedActivity[]>();
  const withProject = activities.filter((a) => a.projectId).sort((a, b) => a.startedAt - b.startedAt);
  for (const a of withProject) {
    const entry: LinkedActivity = {
      id: a.id,
      title: a.title,
      technician: a.technician,
      status: a.status,
      completesProject: a.completesProject === true,
      deleted: a.deleted,
      startedAt: a.startedAt,
    };
    const list = out.get(a.projectId!);
    if (list) list.push(entry);
    else out.set(a.projectId!, [entry]);
  }
  return out;
}

/** Os projetos designados a `userId` (sem os excluidos), ja com situacao e atraso, os que pedem atencao primeiro. */
export function myProjectRows(projects: readonly Project[], activities: readonly Activity[], userId: string | null, now: number): ProjectRow[] {
  // sem ninguem identificado (userId nulo ou vazio) nenhum projeto casa: `assignedTo` nunca e nulo nem vazio
  const mine = projects.filter((p) => p.assignedTo === userId);
  return sortRows(buildRows(mine, linkedByProject(activities), new Map(), now));
}

/** O que ainda falta fazer: pendente ou em andamento. Concluido e cancelado ficam no historico. */
export const isTodo = (r: Pick<ProjectRow, 'state'>): boolean => r.state === 'pendente' || r.state === 'em_andamento';

/** "Você tem 1 projeto para fazer" / "Você tem 3 projetos para fazer". */
export function noticeText(todo: number): string {
  return `Você tem ${todo} ${todo === 1 ? 'projeto' : 'projetos'} para fazer`;
}

/** O que preenche a atividade quando o tecnico inicia o projeto. */
export function startInput(p: Pick<Project, 'id' | 'title' | 'kind' | 'osNumber'>): { kind: ProjectInput['kind']; title: string; osNumber?: string; projectId: string } {
  return { kind: p.kind, title: p.title, ...(p.osNumber ? { osNumber: p.osNumber } : {}), projectId: p.id };
}

/** Ainda da para iniciar uma atividade neste projeto? So enquanto esta pendente ou em andamento. */
export const canStart = (r: Pick<ProjectRow, 'state' | 'project'>): boolean => !r.project.deleted && isTodo(r);

/** Link para abrir a rota ate o ponto no app de mapas do celular (nao depende do app: e so um endereco). */
export function directionsUrl(p: Pick<Project, 'lat' | 'lng'>): string | null {
  if (p.lat === undefined || p.lng === undefined) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

/** Nome que vai na atividade: o das Configuracoes, senao o do cadastro da conta; vazio = precisa perguntar. */
export function technicianNameFor(saved: string | undefined, profileName: string | undefined): string {
  return saved?.trim() || profileName?.trim() || '';
}
