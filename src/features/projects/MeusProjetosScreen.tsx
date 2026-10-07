import { useState } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { goBack, navigate } from '../../lib/route';
import { useAccount } from '../account/accountStore';
import ProjectCard from './ProjectCard';
import { isTodo } from './myProjects';
import { useMyProjects } from './useMyProjects';
import './projects.css';

/** Meus projetos: o que o administrador designou para mim. Funciona sem internet (a copia vem na sincronizacao). */
export default function MeusProjetosScreen() {
  const { rows } = useMyProjects();
  const role = useAccount((a) => (a.status === 'ativo' ? a.profile?.role : undefined));
  const [showDone, setShowDone] = useState(false);
  const back = () => goBack('map');
  const todo = rows?.filter(isTodo) ?? [];
  const history = rows?.filter((r) => !isTodo(r)) ?? [];

  if (role === 'escritorio') {
    return (
      <ScreenShell title="Meus projetos" onBack={back}>
        <div className="alert" role="alert">Esta tela é para quem faz o trabalho de campo. O escritório acompanha os projetos pelo painel.</div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Meus projetos" onBack={back}>
      {rows === undefined ? null : (
        <>
          <section className="project-section" aria-label="Para fazer">
            <span className="label">Para fazer ({todo.length})</span>
            {todo.length === 0 ? (
              <p className="hint">Nenhum projeto para você agora. Quando o administrador designar um, ele aparece aqui, mesmo sem internet depois de sincronizar.</p>
            ) : (
              <ul className="project-list">
                {todo.map((r) => (
                  <ProjectCard key={r.project.id} row={r} showTechnician={false} onOpen={() => navigate('meu-projeto', { id: r.project.id })} />
                ))}
              </ul>
            )}
          </section>
          {history.length > 0 && (
            <section className="project-section" aria-label="Encerrados">
              <button className="btn btn-block" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                {showDone ? 'Esconder' : 'Mostrar'} encerrados ({history.length})
              </button>
              {showDone && (
                <ul className="project-list">
                  {history.map((r) => (
                    <ProjectCard key={r.project.id} row={r} showTechnician={false} onOpen={() => navigate('meu-projeto', { id: r.project.id })} />
                  ))}
                </ul>
              )}
            </section>
          )}
          <button className="btn btn-block" onClick={() => navigate('nova-atividade')}>Fazer atividade avulsa</button>
        </>
      )}
    </ScreenShell>
  );
}
