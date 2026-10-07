import type { Activity, Cable, NetworkElement, Photo, Project } from '../../db/types';
import { summarizeActivity, type ActivitySummary } from '../activities/summary';
import { linkedByProject } from '../projects/myProjects';
import { buildRows } from '../projects/projectState';
import { liveItems } from './mapFilters';
import { projectCounts, type ProjectCounts } from './projectTable';

export interface Overview extends ActivitySummary {
  technicians: number;
  activities: number;
  openActivities: number;
}

/** Totais da rede inteira que este aparelho conhece (tudo o que foi sincronizado), sem os registros excluidos. */
export function overview(data: { activities: Activity[]; elements: NetworkElement[]; cables: Cable[]; photos: Photo[] }): Overview {
  const acts = data.activities.filter((a) => !a.deleted);
  // quem registrou: o dono (conta) e, nos registros antigos sem dono, o nome do tecnico
  const people = new Set(acts.map((a) => a.ownerId ?? `nome:${a.technician}`));
  return {
    ...summarizeActivity(liveItems(data.elements, data.activities), liveItems(data.cables, data.activities), liveItems(data.photos, data.activities)),
    technicians: people.size,
    activities: acts.length,
    openActivities: acts.filter((a) => a.status === 'aberta').length,
  };
}

/** Quantos projetos ha em cada situacao (sem os excluidos) e quantos estao atrasados: o que a visao geral mostra. */
export function projectsOverview(projects: readonly Project[], activities: readonly Activity[], now: number): ProjectCounts {
  return projectCounts(buildRows(projects, linkedByProject(activities), new Map(), now));
}
