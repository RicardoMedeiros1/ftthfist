import { useState } from 'react';
import { elementSvg } from '../elements/elementSvg';
import { describeAttrs } from '../elements/attrsView';
import { ELEMENT_META } from '../elements/meta';
import { PhotoGrid, PhotoViewer } from '../elements/PhotoParts';
import { useElementPhotos } from '../elements/useElementPhotos';
import { FiberLine } from '../cables/Legend';
import type { Activity, Cable, NetworkElement } from '../../db/types';
import { formatDateTime } from '../../lib/format';
import { formatAccuracy, formatMeters } from '../../lib/geo';
import { navigate } from '../../lib/route';
import ActivityInfo from './ActivityInfo';
import type { MapData } from './mapFilters';
import type { Selection } from './panelMapStore';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

const activityLine = (a: Activity | undefined) => (a ? `${a.title} · ${a.technician}${a.osNumber ? ` · OS ${a.osNumber}` : ''}` : 'Atividade ainda não sincronizada');

function ElementCard({ el, activity }: { el: NetworkElement; activity?: Activity }) {
  const meta = ELEMENT_META[el.type];
  const photos = useElementPhotos(el.id);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const viewing = photos.find((p) => p.id === viewerId && p.blob);
  const how = el.positionSource === 'gps' && el.accuracy !== undefined ? `GPS ${formatAccuracy(el.accuracy)}` : 'posição marcada no mapa';
  return (
    <>
      <div className="card element-summary">
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(el.type, { size: 48 }) }} />
        <div>
          <div className="card-title">{el.code || meta.label}</div>
          <div className="card-meta">{meta.label}</div>
        </div>
      </div>
      <div className="info-list">
        <Row label="Atividade" value={activityLine(activity)} />
        <Row label="Posição" value={`${el.lat.toFixed(6)}, ${el.lng.toFixed(6)} (${how})`} />
        {describeAttrs(el).map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
        {el.notes && <Row label="Observações" value={el.notes} />}
        <Row label="Registrado" value={`${el.createdBy} · ${formatDateTime(el.createdAt)}`} />
      </div>
      <section className="field" aria-label="Fotos">
        <span className="label">Fotos ({photos.length})</span>
        <PhotoGrid items={photos} onOpen={setViewerId} />
      </section>
      {viewing && <PhotoViewer item={viewing} onClose={() => setViewerId(null)} />}
      <button className="btn btn-block" onClick={() => navigate('elemento', { id: el.id })}>Abrir ficha completa</button>
    </>
  );
}

function CableCard({ cable, activity }: { cable: Cable; activity?: Activity }) {
  return (
    <>
      <div className="card element-summary">
        <FiberLine fiberCount={cable.fiberCount} width={56} />
        <div>
          <div className="card-title">{cable.cableType} · {cable.fiberCount} fibras</div>
          <div className="card-meta">{cable.vertices.length} pontos</div>
        </div>
      </div>
      <div className="info-list">
        <Row label="Atividade" value={activityLine(activity)} />
        <Row label="Traçado" value={formatMeters(cable.lengthMeters)} />
        <Row label="Reservas" value={formatMeters(cable.reserveMeters)} />
        <Row label="Total" value={formatMeters(cable.totalMeters)} />
        {cable.notes && <Row label="Observações" value={cable.notes} />}
        <Row label="Registrado" value={`${cable.createdBy} · ${formatDateTime(cable.createdAt)}`} />
      </div>
      <button className="btn btn-block" onClick={() => navigate('cabo', { id: cable.id })}>Abrir ficha completa</button>
    </>
  );
}

/** Ficha so de leitura do que foi tocado no mapa (ou escolhido na busca). */
export default function MapDetail({ selection, data, onClose, onFocus }: { selection: Selection; data: MapData; onClose: () => void; onFocus: () => void }) {
  const byId = new Map(data.activities.map((a) => [a.id, a]));
  const el = selection.kind === 'elemento' ? data.elements.find((e) => e.id === selection.id && !e.deleted) : undefined;
  const cable = selection.kind === 'cabo' ? data.cables.find((c) => c.id === selection.id && !c.deleted) : undefined;
  const activity = selection.kind === 'atividade' ? data.activities.find((a) => a.id === selection.id && !a.deleted) : undefined;
  const found = el ?? cable ?? activity;
  return (
    <aside className="panel-detail" aria-label="Ficha do item">
      <div className="panel-detail-bar">
        <button className="btn btn-small" onClick={onFocus} disabled={!found}>Mostrar no mapa</button>
        <button className="btn btn-small" onClick={onClose} aria-label="Fechar ficha">Fechar</button>
      </div>
      {!found && <div className="alert" role="alert">Este item não existe mais (foi excluído ou ainda não chegou).</div>}
      {el && <ElementCard key={el.id} el={el} activity={byId.get(el.activityId)} />}
      {cable && <CableCard key={cable.id} cable={cable} activity={byId.get(cable.activityId)} />}
      {activity && <ActivityInfo key={activity.id} activity={activity} elements={data.elements} cables={data.cables} onDeleted={onClose} />}
    </aside>
  );
}
