import { useMemo, useState } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { goBack, navigate } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useAccount } from '../account/accountStore';
import { adminApi } from '../admin/adminRuntime';
import { useAdminData } from '../admin/useAdminData';
import { Chips } from '../elements/fields';
import { assignable } from './assignable';
import ProjectCard from './ProjectCard';
import { buildRows, countByState, filterRows, sortRows, STATE_FILTERS, type StateFilter } from './projectState';
import './projects.css';

// Lembra o filtro ao voltar de um projeto (fica so na memoria: ao recarregar o app volta ao padrao).
const remembered = { filter: 'abertos' as StateFilter, query: '', technician: '' };

/** Projetos designados: o administrador acompanha todos, cria e abre um para editar. Exige internet. */
export default function ProjetosScreen() {
  const online = useOnlineStatus();
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const data = useAdminData(async () => {
    if (!adminApi) return null;
    const [projects, people] = await Promise.all([adminApi.listProjects(), adminApi.listPeople()]);
    const linked = await adminApi.linkedActivities(projects.filter((p) => !p.deleted).map((p) => p.id));
    return { projects, people, linked };
  }, []);
  const [filter, setFilter] = useState<StateFilter>(remembered.filter);
  const [query, setQuery] = useState(remembered.query);
  const [technician, setTechnician] = useState(remembered.technician);
  const back = () => goBack('config');
  const set = <T,>(setter: (v: T) => void, key: keyof typeof remembered, v: T) => {
    Object.assign(remembered, { [key]: v });
    setter(v);
  };

  const names = useMemo(() => new Map((data.data?.people ?? []).map((p) => [p.id, p.fullName || p.email])), [data.data]);
  const all = useMemo(() => (data.data ? buildRows(data.data.projects, data.data.linked, names, Date.now()) : []), [data.data, names]);
  const counts = countByState(all);
  const shown = useMemo(() => sortRows(filterRows(all, filter, query, technician)), [all, filter, query, technician]);
  const techs = useMemo(() => assignable(data.data?.people ?? []), [data.data]);

  if (!isAdmin || !adminApi) {
    return (
      <ScreenShell title="Projetos" onBack={back}>
        <div className="alert" role="alert">Esta tela é só para administradores.</div>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title="Projetos" onBack={back}>
      {!online && <div className="alert" role="alert">Sem internet. Para ver e criar projetos é preciso estar conectado.</div>}
      {data.error && <div className="alert" role="alert">{data.error}</div>}
      <button className="btn btn-primary btn-block" onClick={() => navigate('projeto-novo')} disabled={!online}>Novo projeto</button>
      <button className="btn btn-block" onClick={data.reload} disabled={data.loading}>{data.loading ? 'Carregando…' : 'Atualizar lista'}</button>
      {data.data && (
        <>
          <div className="project-filters">
            <Chips
              label="Mostrar"
              value={filter}
              options={STATE_FILTERS.map((f) => ({ value: f.value, label: `${f.label} (${counts[f.value]})` }))}
              onChange={(v) => v && set(setFilter, 'filter', v as StateFilter)}
            />
            <div className="field">
              <label htmlFor="proj-search">Buscar</label>
              <input id="proj-search" type="search" value={query} placeholder="Nome, OS, endereço, técnico…" onChange={(e) => set(setQuery, 'query', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="proj-tech">Técnico</label>
              <select id="proj-tech" value={technician} onChange={(e) => set(setTechnician, 'technician', e.target.value)}>
                <option value="">Todos</option>
                {techs.map((p) => (
                  <option key={p.id} value={p.id}>{p.fullName || p.email}</option>
                ))}
              </select>
            </div>
          </div>
          {all.length === 0 ? (
            <p className="hint">Nenhum projeto ainda. Toque em “Novo projeto” para criar o primeiro e entregar a um técnico.</p>
          ) : shown.length === 0 ? (
            <p className="hint">Nenhum projeto com esse filtro.</p>
          ) : (
            <ul className="project-list" aria-label="Projetos">
              {shown.map((r) => (
                <ProjectCard key={r.project.id} row={r} onOpen={() => navigate('projeto', { id: r.project.id })} />
              ))}
            </ul>
          )}
        </>
      )}
    </ScreenShell>
  );
}
