import { db, type RotaFibraDB } from '../../db/db';
import type { Activity } from '../../db/types';
import { linkedByProject, shouldAskFinish } from './myProjects';

/**
 * Concluir a atividade de um projeto pergunta "o projeto terminou?". Devolve o projeto a perguntar (so o nome, para o texto) ou
 * null quando nao ha o que perguntar (atividade avulsa, projeto que nao esta aqui, ja concluido, cancelado ou excluido).
 */
export async function finishQuestionFor(a: Pick<Activity, 'projectId'>, database: RotaFibraDB = db): Promise<{ id: string; title: string } | null> {
  const projectId = a.projectId;
  if (!projectId) return null;
  const project = await database.projects.get(projectId);
  const withProject = await database.activities.filter((x) => x.projectId === projectId).toArray();
  return project && shouldAskFinish(project, linkedByProject(withProject).get(projectId) ?? []) ? { id: project.id, title: project.title } : null;
}
