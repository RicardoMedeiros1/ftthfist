import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { SETTING_KEYS, setSetting } from '../../db/db';
import { formatDateTime } from '../../lib/format';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { useAccount } from '../account/accountStore';
import { ActivityRuleError, activities } from '../activities/activityRepo';
import { KIND_LABEL } from '../activities/labels';
import { mapCommands } from '../map/mapCommands';
import { useTechnician } from '../settings/useTechnician';
import { canStart, directionsUrl, isTodo, startInput, technicianNameFor } from './myProjects';
import { planBounds, planSummary } from './plan';
import { setPlannedVisible } from './plannedLayer';
import { formatDueDate, STATE_LABEL } from './projectState';
import { useMyProjects } from './useMyProjects';
import './projects.css';

/** Um projeto meu: instrucoes, local, atividades ja feitas e o botao de iniciar. Funciona sem internet. */
export default function MeuProjetoScreen() {
  const id = useRouteId();
  const { rows } = useMyProjects();
  const saved = useTechnician();
  const profileName = useAccount((a) => a.profile?.fullName);
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando; null = nenhuma aberta
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => goBack('meus-projetos');
  useEffect(() => setError(null), [id]);

  if (rows === undefined || saved === undefined || open === undefined) return <ScreenShell title="Projeto" onBack={back}>{null}</ScreenShell>;
  const row = rows.find((r) => r.project.id === id);
  if (!row) {
    return (
      <ScreenShell title="Projeto" onBack={back}>
        <div className="alert" role="alert">Projeto não encontrado. Ele pode ter sido passado para outra pessoa ou excluído.</div>
        <button className="btn btn-block" onClick={back}>Voltar</button>
      </ScreenShell>
    );
  }

  const { project: p, state } = row;
  const savedName: string = saved;
  const known = technicianNameFor(savedName, profileName);
  const name = known || typed.trim();
  const mine = row.linked.filter((a) => !a.deleted);
  const openHere = open && open.projectId === p.id ? open : null;
  const url = directionsUrl(p);
  const startable = canStart(row);

  function seeOnMap() {
    if (p.lat === undefined || p.lng === undefined) return;
    navigate('map');
    mapCommands.center(p.lat, p.lng, 18);
  }

  function seePlan() {
    const bounds = p.plan ? planBounds(p.plan) : null;
    if (!bounds) return;
    void setPlannedVisible(true); // com a camada desligada o desenho nao apareceria
    navigate('map');
    mapCommands.fitBounds(bounds);
  }

  async function start() {
    if (busy) return;
    if (!name) {
      setError('Informe o seu nome para iniciar.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // O nome so e pedido se nao houver um nas Configuracoes nem no cadastro; fica salvo para as proximas
      if (!savedName.trim()) await setSetting(SETTING_KEYS.technician, name);
      await activities.create(startInput(p), name);
      navigate('map', { replace: true });
    } catch (e) {
      setError(e instanceof ActivityRuleError ? e.message : 'Não foi possível iniciar. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="Projeto" onBack={back}>
      <article className="card">
        <div className="project-head">
          <span className="card-title">{p.title}</span>
          <span className="project-badges">
            <span className={`badge badge-state-${state}`}>{STATE_LABEL[state]}</span>
            {row.overdue && <span className="badge badge-overdue">Atrasado</span>}
          </span>
        </div>
        <dl className="project-facts">
          <dt>Tipo</dt>
          <dd>{KIND_LABEL[p.kind]}</dd>
          {p.osNumber && (
            <>
              <dt>OS</dt>
              <dd>{p.osNumber}</dd>
            </>
          )}
          <dt>Prazo</dt>
          <dd>{p.dueDate ? formatDueDate(p.dueDate) : 'Sem prazo'}</dd>
          {p.address && (
            <>
              <dt>Local</dt>
              <dd>{p.address}</dd>
            </>
          )}
        </dl>
      </article>

      {state === 'cancelado' && <div className="alert" role="status">O administrador cancelou este projeto. Não é preciso fazer.</div>}
      {state === 'concluido' && <div className="ok-note" role="status">Este projeto está concluído.</div>}

      {p.description && (
        <section className="field" aria-label="Instruções">
          <span className="label">Instruções</span>
          <p className="project-instructions">{p.description}</p>
        </section>
      )}

      {url && (
        <section className="field" aria-label="Local no mapa">
          <span className="label">Ponto no mapa</span>
          <div className="project-map-actions">
            <button className="btn" onClick={seeOnMap}>Ver no mapa</button>
            <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Como chegar</a>
          </div>
        </section>
      )}

      {p.plan && planBounds(p.plan) && (
        <section className="field" aria-label="Desenho do projeto">
          <span className="label">Desenho do projeto</span>
          <p className="project-instructions">{planSummary(p.plan)}</p>
          <p className="hint">O desenho aparece no mapa tracejado, só como guia. Os postes e o cabo de verdade você marca no campo, como sempre.</p>
          {isTodo(row) && <button className="btn" onClick={seePlan}>Ver desenho no mapa</button>}
        </section>
      )}

      <section className="field" aria-label="Atividades do projeto">
        <span className="label">Atividades deste projeto ({mine.length})</span>
        {mine.length === 0 ? (
          <p className="hint">Você ainda não começou.</p>
        ) : (
          <ul className="project-linked">
            {mine.map((a) => (
              <li key={a.id}>
                <button className="btn" onClick={() => navigate('atividade', { id: a.id })}>
                  {a.title}{a.startedAt ? ` · ${formatDateTime(a.startedAt)}` : ''} · {a.status === 'concluida' ? 'concluída' : 'aberta'}{a.completesProject ? ' · terminou o projeto' : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <div className="alert" role="alert">{error}</div>}

      {startable && openHere && (
        <>
          <div className="ok-note" role="status">A atividade deste projeto está aberta ("{openHere.title}"). Continue no mapa.</div>
          <button className="btn btn-primary btn-block" onClick={() => navigate('map', { replace: true })}>Voltar para o mapa</button>
        </>
      )}
      {startable && !openHere && open && (
        <div className="alert" role="status">Você já tem uma atividade aberta ("{open.title}"). Conclua antes de iniciar este projeto.</div>
      )}
      {startable && !open && (
        <>
          {!known && (
            <div className="field">
              <label htmlFor="proj-me">Seu nome</label>
              <input id="proj-me" type="text" value={typed} placeholder="Como aparece nas atividades" onChange={(e) => setTyped(e.target.value)} />
            </div>
          )}
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void start()}>
            {mine.length === 0 ? 'Iniciar este projeto' : 'Iniciar outra atividade neste projeto'}
          </button>
        </>
      )}
    </ScreenShell>
  );
}
