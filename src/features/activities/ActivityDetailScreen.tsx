import { useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AdminBanner, EditedByNote } from '../../components/AdminNote';
import NotMineNote from '../../components/NotMineNote';
import { useAccount } from '../account/accountStore';
import { adminApi, remoteTrackStore } from '../admin/adminRuntime';
import { panelAccess } from '../panel/access';
import DeleteActivity from './DeleteActivity';
import ScreenShell from '../../components/ScreenShell';
import { db } from '../../db/db';
import type { Cable, NetworkElement, Photo } from '../../db/types';
import { formatDateTime, formatDuration } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { useCanEdit, useIsMine } from '../../lib/useOwnership';
import { cableLabel } from '../cables/cableChoices';
import { elementSvg } from '../elements/elementSvg';
import { ELEMENT_META } from '../elements/meta';
import { mapCommands } from '../map/mapCommands';
import { finishQuestionFor } from '../projects/finishQuestion';
import FinishProjectDialog from '../projects/FinishProjectDialog';
import ProjectLine from '../projects/ProjectLine';
import { ActivityRuleError, activities } from './activityRepo';
import { KIND_LABEL } from './labels';
import { formatMaterial, MAX_DESCRIPTION } from './materials';
import MaterialsEditor, { fromRows, toRows, type MaterialRow } from './MaterialsEditor';
import { activityBounds, summarizeActivity } from './summary';
import './activities.css';

const PAGE = 30;

/** Detalhe da atividade ("projeto"): resumo, totais, elementos, cabos, ver no mapa, exportar e (dono/administrador) editar. */
export default function ActivityDetailScreen() {
  const id = useRouteId();
  // undefined = carregando · null = nao existe
  const a = useLiveQuery(async () => (id ? ((await db.activities.get(id)) ?? null) : null), [id]);
  const elements = useLiveQuery(() => (id ? db.elements.where('activityId').equals(id).filter((e) => !e.deleted).toArray() : Promise.resolve([] as NetworkElement[])), [id]);
  const cables = useLiveQuery(() => (id ? db.cables.where('activityId').equals(id).filter((c) => !c.deleted).toArray() : Promise.resolve([] as Cable[])), [id]);
  const photos = useLiveQuery(() => (id ? db.photos.where('activityId').equals(id).filter((p) => !p.deleted).toArray() : Promise.resolve([] as Photo[])), [id]);
  const mine = useIsMine(a);
  const editable = useCanEdit(a);
  const canSeeTrack = useAccount((acc) => panelAccess(acc.status, acc.profile?.role) === 'liberado'); // escritorio e administrador

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [os, setOs] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAllEls, setShowAllEls] = useState(false);
  const [showAllCables, setShowAllCables] = useState(false);
  const [asking, setAsking] = useState<string | null>(null); // nome do projeto, quando a pergunta "o projeto terminou?" esta aberta

  const summary = useMemo(() => summarizeActivity(elements ?? [], cables ?? [], photos ?? []), [elements, cables, photos]);
  const bounds = useMemo(() => activityBounds(elements ?? [], cables ?? []), [elements, cables]);
  const sortedEls = useMemo(
    () => [...(elements ?? [])].sort((x, y) => x.createdAt - y.createdAt),
    [elements],
  );

  const back = () => goBack('atividades');
  if (a === undefined) return <ScreenShell title="Atividade" onBack={back}>{null}</ScreenShell>;
  if (a === null) {
    return (
      <ScreenShell title="Atividade" onBack={back}>
        <div className="alert" role="alert">Atividade não encontrada. Ela pode ter sido excluída.</div>
        <button className="btn btn-block" onClick={back}>Voltar</button>
      </ScreenShell>
    );
  }
  const open = a.status === 'aberta';

  function startEdit() {
    if (!a) return;
    setTitle(a.title);
    setOs(a.osNumber ?? '');
    setDescription(a.description);
    setRows(toRows(a.materials));
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!a || busy) return;
    setBusy(true);
    setError(null);
    try {
      await activities.update(a.id, { title, osNumber: os, description, materials: fromRows(rows) });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ActivityRuleError ? err.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ActivityRuleError ? err.message : 'Não foi possível concluir a ação.');
    }
  }

  function seeOnMap() {
    if (!bounds) return;
    navigate('map');
    if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) mapCommands.center(bounds[0], bounds[1], 19);
    else mapCommands.fitBounds(bounds);
  }

  if (editing) {
    return (
      <ScreenShell title="Editar atividade" onBack={() => setEditing(false)}>
        <form className="screen-body" style={{ padding: 0 }} onSubmit={(e) => void save(e)} noValidate>
          <div className="field">
            <label htmlFor="act-title">Título</label>
            <input id="act-title" type="text" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="act-os">Nº da OS (opcional)</label>
            <input id="act-os" type="text" value={os} maxLength={40} onChange={(e) => setOs(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="act-desc">Descrição</label>
            <textarea id="act-desc" rows={4} value={description} maxLength={MAX_DESCRIPTION} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <MaterialsEditor rows={rows} onChange={setRows} />
          {error && <div className="alert" role="alert">{error}</div>}
          <div className="sticky-actions">
            <div className="placement-row">
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>Salvar</button>
            </div>
          </div>
        </form>
      </ScreenShell>
    );
  }

  const shownEls = showAllEls ? sortedEls : sortedEls.slice(0, PAGE);
  const sortedCables = [...(cables ?? [])].sort((x, y) => x.createdAt - y.createdAt);
  const shownCables = showAllCables ? sortedCables : sortedCables.slice(0, PAGE);

  return (
    <ScreenShell title="Atividade" onBack={back}>
      <article className={`card ${open ? 'card-open' : ''}`}>
        <div className="row">
          <span className={`badge badge-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
          <span className={`badge badge-status-${a.status}`}>{open ? 'Aberta' : 'Concluída'}</span>
        </div>
        <div className="card-title">{a.title}</div>
        <div className="card-meta">
          {a.osNumber ? `OS ${a.osNumber} · ` : ''}
          {a.technician}
        </div>
        <div className="card-meta">
          Início {formatDateTime(a.startedAt)}
          {a.endedAt ? ` · Fim ${formatDateTime(a.endedAt)} · ${formatDuration(a.endedAt - a.startedAt)}` : ''}
        </div>
        {a.projectId && <ProjectLine projectId={a.projectId} />}
      </article>

      {a.description && (
        <section className="field" aria-label="Descrição">
          <span className="label">Descrição</span>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.description}</p>
        </section>
      )}
      {a.materials.length > 0 && (
        <section className="field" aria-label="Materiais">
          <span className="label">Materiais usados</span>
          <ul className="materials-list">
            {a.materials.map((m, i) => (
              <li key={i}>
                {m.item} · {formatMaterial(m)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="field" aria-label="Totais">
        <span className="label">Totais</span>
        <div className="totals">
          <div className="total-tile">
            <strong>{summary.elements}</strong>
            <span>
              {summary.elements === 1 ? 'elemento' : 'elementos'}
              {summary.byType.length > 0 && ` · ${summary.byType.map((t) => `${t.count} ${t.label}`).join(' · ')}`}
            </span>
          </div>
          <div className="total-tile">
            <strong>{summary.cables}</strong>
            <span>{summary.cables === 1 ? 'cabo' : 'cabos'}</span>
          </div>
          <div className="total-tile">
            <strong>{formatMeters(summary.totalMeters)}</strong>
            <span>de cabo (traçado {formatMeters(summary.lengthMeters)} + reservas {formatMeters(summary.reserveMeters)})</span>
          </div>
          <div className="total-tile">
            <strong>{summary.photos}</strong>
            <span>{summary.photos === 1 ? 'foto' : 'fotos'}</span>
          </div>
        </div>
      </section>

      {error && <div className="alert" role="alert">{error}</div>}

      <div className="detail-actions">
        <button className="btn" disabled={!bounds} onClick={seeOnMap}>Ver no mapa</button>
        <button className="btn" onClick={() => navigate('exportar', { id: a.id })}>Exportar</button>
        {canSeeTrack && !mine && adminApi && (
          <button
            className="btn"
            onClick={() => {
              void remoteTrackStore.show(a.id, `${a.title} · ${a.technician}`);
              navigate('map');
            }}
          >
            Ver trilha GPS
          </button>
        )}
      </div>

      <EditedByNote record={a} />
      {editable ? (
        <>
          {!mine && <AdminBanner author={a.technician} what="atividade" />}
          <div className="detail-actions">
            <button className="btn" onClick={startEdit}>Editar</button>
            {open ? (
              <button
                className="btn btn-primary"
                onClick={() =>
                  void run(async () => {
                    const q = await finishQuestionFor(a);
                    if (q) setAsking(q.title);
                    else await activities.complete(a.id);
                  })
                }
              >
                Concluir
              </button>
            ) : (
              <button className="btn" onClick={() => void run(() => activities.reopen(a.id))}>Reabrir</button>
            )}
          </div>
          {a.projectId && !open && (
            <section className="field" aria-label="Terminou o projeto">
              <span className="label">Com esta atividade o projeto terminou?</span>
              <div className="seg" role="group" aria-label="Terminou o projeto">
                <button type="button" aria-pressed={a.completesProject === true} onClick={() => void run(() => activities.setFinishesProject(a.id, true))}>Sim</button>
                <button type="button" aria-pressed={a.completesProject !== true} onClick={() => void run(() => activities.setFinishesProject(a.id, false))}>Não</button>
              </div>
            </section>
          )}
          <DeleteActivity activity={a} onDeleted={back} />
        </>
      ) : (
        <NotMineNote author={a.technician} what="atividade" />
      )}

      <section className="field" aria-label="Elementos">
        <span className="label">Elementos ({sortedEls.length})</span>
        {sortedEls.length === 0 ? (
          <p className="hint">Nenhum elemento nesta atividade.</p>
        ) : (
          <div className="row-list">
            {shownEls.map((e) => (
              <button key={e.id} className="btn row-btn" onClick={() => navigate('elemento', { id: e.id })}>
                <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(e.type, { size: 32 }) }} />
                <span>
                  {e.code || ELEMENT_META[e.type].label}
                  <small>{ELEMENT_META[e.type].label}</small>
                </span>
              </button>
            ))}
            {!showAllEls && sortedEls.length > PAGE && (
              <button className="btn btn-block" onClick={() => setShowAllEls(true)}>Mostrar todos ({sortedEls.length})</button>
            )}
          </div>
        )}
      </section>

      <section className="field" aria-label="Cabos">
        <span className="label">Cabos ({sortedCables.length})</span>
        {sortedCables.length === 0 ? (
          <p className="hint">Nenhum cabo nesta atividade.</p>
        ) : (
          <div className="row-list">
            {shownCables.map((c) => (
              <button key={c.id} className="btn row-btn" onClick={() => navigate('cabo', { id: c.id })}>
                <span>{cableLabel(c)}</span>
              </button>
            ))}
            {!showAllCables && sortedCables.length > PAGE && (
              <button className="btn btn-block" onClick={() => setShowAllCables(true)}>Mostrar todos ({sortedCables.length})</button>
            )}
          </div>
        )}
      </section>
      {asking !== null && (
        <FinishProjectDialog
          projectTitle={asking}
          onCancel={() => setAsking(null)}
          onChoose={(finishes) => {
            setAsking(null);
            void run(() => activities.complete(a.id, { finishesProject: finishes }));
          }}
        />
      )}
    </ScreenShell>
  );
}
