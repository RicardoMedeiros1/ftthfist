import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import type { Activity } from '../../db/types';
import { formatDateTime, formatDuration } from '../../lib/format';
import { goBack, navigate } from '../../lib/route';
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
      <div className="card-actions">
        {open ? (
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
      </div>
    </article>
  );
}

export default function ActivitiesScreen() {
  const list = useLiveQuery(() => activities.list());
  const [error, setError] = useState<string | null>(null);

  const hasOpen = list?.some((a) => a.status === 'aberta') ?? false;

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
        list.map((a) => <ActivityCard key={a.id} a={a} canReopen={!hasOpen} onAction={run} />)
      )}
    </ScreenShell>
  );
}
