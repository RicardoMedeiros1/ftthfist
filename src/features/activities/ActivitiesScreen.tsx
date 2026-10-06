import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AdminBanner, EditedByNote } from '../../components/AdminNote';
import NotMineNote from '../../components/NotMineNote';
import ScreenShell from '../../components/ScreenShell';
import type { Activity } from '../../db/types';
import { formatDateTime, formatDuration } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
import { isMine } from '../../lib/ownership';
import { useCanEdit, useIsMine } from '../../lib/useOwnership';
import { ActivityRuleError, activities } from './activityRepo';
import { KIND_LABEL } from './labels';

function ActivityCard({
  a,
  canReopen,
  onAction,
}: {
  a: Activity;
  canReopen: boolean;
  onAction: (fn: () => Promise<void>) => void;
}) {
  const open = a.status === 'aberta';
  const mine = useIsMine(a);
  const editable = useCanEdit(a); // concluir/reabrir: o dono ou o administrador
  return (
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
      <EditedByNote record={a} />
      {!editable && <NotMineNote author={a.technician} what="atividade" />}
      {editable && !mine && <AdminBanner author={a.technician} what="atividade" />}
      <div className="card-actions">
        {!editable ? null : open ? (
          <button className="btn btn-primary btn-small" onClick={() => onAction(() => activities.complete(a.id))}>
            Concluir
          </button>
        ) : (
          <button
            className="btn btn-small"
            disabled={!canReopen}
            onClick={() => onAction(() => activities.reopen(a.id))}
          >
            Reabrir
          </button>
        )}
        <button className="btn btn-small" onClick={() => navigate('exportar', { id: a.id })}>
          Exportar
        </button>
      </div>
    </article>
  );
}

export default function ActivitiesScreen() {
  const list = useLiveQuery(() => activities.list());
  const [error, setError] = useState<string | null>(null);

  // so a MINHA atividade aberta impede de iniciar outra (a de um colega e dele)
  const hasOpen = list?.some((a) => a.status === 'aberta' && isMine(a)) ?? false;
  // reabrir: so se o DONO daquela atividade nao tiver outra aberta (o administrador reabre a de um tecnico)
  const ownersWithOpen = new Set((list ?? []).filter((a) => a.status === 'aberta').map((a) => a.ownerId ?? ''));

  function run(fn: () => Promise<void>) {
    setError(null);
    fn().catch((err: unknown) =>
      setError(err instanceof ActivityRuleError ? err.message : 'Não foi possível concluir a ação.'),
    );
  }

  return (
    <ScreenShell title="Atividades" onBack={() => goBack('map')}>
      <button className="btn btn-primary btn-block" disabled={list === undefined || hasOpen} onClick={() => navigate('nova-atividade')}>
        + Nova atividade
      </button>
      {hasOpen && <p className="hint">Só uma atividade pode ficar aberta. Conclua a atual para iniciar outra.</p>}
      {error && <div className="alert" role="alert">{error}</div>}

      {list === undefined ? null : list.length === 0 ? (
        <p className="hint">Nenhuma atividade ainda. Toque em “Nova atividade” para começar.</p>
      ) : (
        list.map((a) => <ActivityCard key={a.id} a={a} canReopen={!ownersWithOpen.has(a.ownerId ?? '')} onAction={run} />)
      )}
    </ScreenShell>
  );
}
