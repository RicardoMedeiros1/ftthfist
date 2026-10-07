import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Activity, Cable, NetworkElement } from '../../db/types';
import { db } from '../../db/db';
import { formatDateTime, formatDuration } from '../../lib/format';
import { formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import { useAccount } from '../account/accountStore';
import { adminApi, remoteTrackStore } from '../admin/adminRuntime';
import { useIsMine } from '../../lib/useOwnership';
import DeleteActivity from '../activities/DeleteActivity';
import { KIND_LABEL } from '../activities/labels';
import { formatMaterial } from '../activities/materials';
import { summarizeActivity } from '../activities/summary';
import { cableLabel } from '../cables/cableChoices';
import { elementSvg } from '../elements/elementSvg';
import { ELEMENT_META } from '../elements/meta';
import { panelAccess } from './access';

const PAGE = 10;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

/** Ficha de uma atividade (so leitura): quem, quando, materiais, totais e o que ha nela. Usada no mapa e na tabela do painel. */
export default function ActivityInfo({ activity, elements, cables, onShowOnMap, onDeleted }: { activity: Activity; elements: NetworkElement[]; cables: Cable[]; onShowOnMap?: () => void; onDeleted?: () => void }) {
  const photos = useLiveQuery(() => db.photos.where('activityId').equals(activity.id).filter((p) => !p.deleted).count(), [activity.id]);
  const mine = useIsMine(activity);
  const canSeeTrack = useAccount((a) => panelAccess(a.status, a.profile?.role) === 'liberado');
  const [allEls, setAllEls] = useState(false);
  const [allCables, setAllCables] = useState(false);
  const els = elements.filter((e) => e.activityId === activity.id && !e.deleted).sort((a, b) => a.createdAt - b.createdAt);
  const cbs = cables.filter((c) => c.activityId === activity.id && !c.deleted).sort((a, b) => a.createdAt - b.createdAt);
  const s = summarizeActivity(els, cbs, []);
  const open = activity.status === 'aberta';
  return (
    <>
      <article className={`card ${open ? 'card-open' : ''}`}>
        <div className="row">
          <span className={`badge badge-${activity.kind}`}>{KIND_LABEL[activity.kind]}</span>
          <span className={`badge badge-status-${activity.status}`}>{open ? 'Aberta' : 'Concluída'}</span>
        </div>
        <div className="card-title">{activity.title}</div>
        <div className="card-meta">
          {activity.osNumber ? `OS ${activity.osNumber} · ` : ''}
          {activity.technician}
        </div>
        <div className="card-meta">
          Início {formatDateTime(activity.startedAt)}
          {activity.endedAt ? ` · Fim ${formatDateTime(activity.endedAt)} · ${formatDuration(activity.endedAt - activity.startedAt)}` : ''}
        </div>
      </article>

      {activity.description && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{activity.description}</p>}
      {activity.materials.length > 0 && (
        <section className="field" aria-label="Materiais">
          <span className="label">Materiais usados</span>
          <ul className="materials-list">
            {activity.materials.map((m, i) => (
              <li key={i}>
                {m.item} · {formatMaterial(m)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="info-list" aria-label="Totais">
        <Row label="Elementos" value={s.byType.length > 0 ? `${s.elements} · ${s.byType.map((t) => `${t.count} ${t.label}`).join(' · ')}` : String(s.elements)} />
        <Row label="Cabos" value={`${s.cables} · ${formatMeters(s.totalMeters)} (traçado ${formatMeters(s.lengthMeters)} + reservas ${formatMeters(s.reserveMeters)})`} />
        <Row label="Fotos" value={photos === undefined ? '…' : String(photos)} />
      </div>

      <div className="detail-actions">
        {onShowOnMap && <button className="btn" onClick={onShowOnMap} disabled={els.length === 0 && cbs.length === 0}>Ver no mapa</button>}
        <button className="btn" onClick={() => navigate('atividade', { id: activity.id })}>Abrir atividade</button>
        <button className="btn" onClick={() => navigate('exportar', { id: activity.id })}>Exportar</button>
        {canSeeTrack && !mine && adminApi && (
          <button
            className="btn"
            onClick={() => {
              void remoteTrackStore.show(activity.id, `${activity.title} · ${activity.technician}`);
              navigate('painel', { id: 'mapa' });
            }}
          >
            Ver trilha GPS
          </button>
        )}
      </div>
      <DeleteActivity activity={activity} onDeleted={onDeleted} />

      <section className="field" aria-label="Elementos">
        <span className="label">Elementos ({els.length})</span>
        <div className="row-list">
          {(allEls ? els : els.slice(0, PAGE)).map((e) => (
            <button key={e.id} className="btn row-btn" onClick={() => navigate('elemento', { id: e.id })}>
              <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(e.type, { size: 32 }) }} />
              <span>
                {e.code || ELEMENT_META[e.type].label}
                <small>{ELEMENT_META[e.type].label}</small>
              </span>
            </button>
          ))}
          {!allEls && els.length > PAGE && <button className="btn btn-block" onClick={() => setAllEls(true)}>Mostrar todos ({els.length})</button>}
        </div>
      </section>

      <section className="field" aria-label="Cabos">
        <span className="label">Cabos ({cbs.length})</span>
        <div className="row-list">
          {(allCables ? cbs : cbs.slice(0, PAGE)).map((c) => (
            <button key={c.id} className="btn row-btn" onClick={() => navigate('cabo', { id: c.id })}>
              <span>{cableLabel(c)}</span>
            </button>
          ))}
          {!allCables && cbs.length > PAGE && <button className="btn btn-block" onClick={() => setAllCables(true)}>Mostrar todos ({cbs.length})</button>}
        </div>
      </section>
    </>
  );
}
