import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { navigate } from '../../lib/route';
import { actingRole, actingUserId } from '../../lib/ownership';
import { useAccount } from '../account/accountStore';

/**
 * Na atividade: de qual projeto ela veio. O administrador abre o projeto para editar; o tecnico abre o dele
 * (se o projeto saiu das maos dele, so mostra o nome, que ele nao tem mais).
 */
export default function ProjectLine({ projectId }: { projectId: string }) {
  const project = useLiveQuery(async () => (await db.projects.get(projectId)) ?? null, [projectId]);
  const role = useAccount((a) => (a.status === 'ativo' ? a.profile?.role : undefined));
  if (project === undefined) return null;
  const isAdmin = role === 'admin' || actingRole() === 'admin';
  const mine = project !== null && project.assignedTo === actingUserId();
  const target = isAdmin ? ('projeto' as const) : mine ? ('meu-projeto' as const) : null;
  return (
    <div className="card-meta project-line">
      Projeto: <strong>{project ? project.title : 'não está mais com você'}</strong>
      {project && target && (
        <>
          {' '}
          <button className="btn btn-small" onClick={() => navigate(target, { id: projectId })}>
            Abrir projeto
          </button>
        </>
      )}
    </div>
  );
}
