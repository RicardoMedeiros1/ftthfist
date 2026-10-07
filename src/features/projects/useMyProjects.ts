import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import { db } from '../../db/db';
import { actingRole, actingUserId, subscribeActingUser } from '../../lib/ownership';
import { isTodo, myProjectRows } from './myProjects';
import type { ProjectRow } from './projectState';

const snapshot = () => `${actingUserId() ?? ''}|${actingRole() ?? ''}`;

/**
 * Os projetos de quem esta com o app aberto. So quem faz campo (tecnico, ou administrador que tambem trabalha na rua)
 * tem projetos; o escritorio nao. `undefined` enquanto carrega. Reavalia sozinho quando chega projeto novo ou muda quem entrou.
 */
export function useMyProjects(): { rows: ProjectRow[] | undefined; todo: ProjectRow[] | undefined } {
  const acting = useSyncExternalStore(subscribeActingUser, snapshot, snapshot);
  const rows = useLiveQuery(async () => {
    const [userId, role] = acting.split('|');
    if (!userId || (role !== 'tecnico' && role !== 'admin')) return [];
    const [projects, withProject] = await Promise.all([db.projects.where('assignedTo').equals(userId).toArray(), db.activities.filter((a) => !!a.projectId).toArray()]);
    return myProjectRows(projects, withProject, userId, Date.now());
  }, [acting]);
  return { rows, todo: rows?.filter(isTodo) };
}
