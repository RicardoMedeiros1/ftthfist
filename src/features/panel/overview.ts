import type { Activity, Cable, NetworkElement, Photo } from '../../db/types';
import { summarizeActivity, type ActivitySummary } from '../activities/summary';

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
    ...summarizeActivity(data.elements, data.cables, data.photos),
    technicians: people.size,
    activities: acts.length,
    openActivities: acts.filter((a) => a.status === 'aberta').length,
  };
}
