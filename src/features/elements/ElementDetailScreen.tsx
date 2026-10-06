import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import NotMineNote from '../../components/NotMineNote';
import ScreenShell from '../../components/ScreenShell';
import { db } from '../../db/db';
import type { Photo } from '../../db/types';
import { formatDateTime } from '../../lib/format';
import { formatAccuracy } from '../../lib/geo';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { needsDownload } from '../sync/photoFiles';
import { photoFiles } from '../sync/syncRuntime';
import { useIsMine } from '../../lib/useOwnership';
import { KIND_LABEL } from '../activities/labels';
import { cableChoicesNear } from '../cables/cableChoices';
import { cableStore } from '../cables/cableRepo';
import { useTechnician } from '../settings/useTechnician';
import { attrsToFormStrings, describeAttrs } from './attrsView';
import { draftStore } from './draftStore';
import ElementFields, { emptyValues, type FieldValues } from './ElementFields';
import { ElementRuleError, elementStore } from './elementRepo';
import { elementSvg } from './elementSvg';
import { ELEMENT_META } from './meta';
import { CameraButton, PhotoGrid, PhotoViewer } from './PhotoParts';
import { photoStore } from './photoRepo';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

/** Detalhe do elemento (ao tocar no ícone no mapa): ver, editar, mover, excluir e gerenciar fotos. */
export default function ElementDetailScreen() {
  const id = useRouteId();
  // undefined = carregando · null = não existe (ou foi excluído)
  const el = useLiveQuery(async () => (id ? ((await elementStore.get(id)) ?? null) : null), [id]);
  const photos = useLiveQuery(() => (id ? photoStore.listFor(id) : Promise.resolve([] as Photo[])), [id]);
  const activity = useLiveQuery(
    async () => (el ? ((await db.activities.get(el.activityId)) ?? null) : null),
    [el?.activityId],
  );
  const mine = useIsMine(el);
  const technician = useTechnician();
  const cables = useLiveQuery(() => cableStore.list());

  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FieldValues>(emptyValues);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = useOnlineStatus();
  // Fotos de colegas: o registro chega pela sincronizacao e o arquivo baixa ao abrir o elemento (com internet)
  const [download, setDownload] = useState<'idle' | 'baixando' | 'sem-rede' | 'falhou'>('idle');
  const missing = (photos ?? []).filter(needsDownload).length;
  const elementId = el?.id;
  useEffect(() => {
    if (!elementId || !photoFiles || missing === 0 || !online) return;
    let cancelled = false;
    setDownload('baixando');
    void photoFiles.download(elementId).then((r) => {
      if (!cancelled) setDownload(r.offline ? 'sem-rede' : r.failed > 0 ? 'falhou' : 'idle');
    });
    return () => {
      cancelled = true;
    };
  }, [elementId, missing, online]);
  const items = useMemo(
    () =>
      (photos ?? []).map((p) => ({
        id: p.id,
        blob: p.blob,
        note: p.blob
          ? undefined
          : !p.storagePath
            ? 'Ainda não enviada'
            : !online || download === 'sem-rede'
              ? 'Sem internet'
              : download === 'falhou'
                ? 'Não foi possível baixar'
                : 'Baixando…',
      })),
    [photos, online, download],
  );

  const back = () => goBack('map');
  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof ElementRuleError ? err.message : fallback);

  if (el === undefined) return <ScreenShell title="Elemento" onBack={back}>{null}</ScreenShell>;
  if (el === null) {
    return (
      <ScreenShell title="Elemento" onBack={back}>
        <div className="alert" role="alert">Elemento não encontrado. Ele pode ter sido excluído.</div>
        <button className="btn btn-block" onClick={back}>Voltar ao mapa</button>
      </ScreenShell>
    );
  }

  const meta = ELEMENT_META[el.type];
  const viewing = items.find((p) => p.id === viewerId && p.blob);
  const position = `${el.lat.toFixed(6)}, ${el.lng.toFixed(6)}`;
  const how =
    el.positionSource === 'gps' && el.accuracy !== undefined
      ? `GPS ${formatAccuracy(el.accuracy)}`
      : 'posição marcada no mapa';

  function startEdit() {
    if (!el) return;
    setValues({ code: el.code, notes: el.notes, attrs: attrsToFormStrings(el.attrs) });
    setError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!el || busy) return;
    setBusy(true);
    setError(null);
    try {
      await elementStore.update(el.id, values);
      setEditing(false);
    } catch (err) {
      fail(err, 'Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  function startMove() {
    if (!el) return;
    draftStore.startMove(el);
    navigate('map');
  }

  async function doDelete() {
    if (!el) return;
    setConfirmDelete(false);
    try {
      await elementStore.remove(el.id);
      back();
    } catch (err) {
      fail(err, 'Não foi possível excluir. Tente de novo.');
    }
  }

  if (editing) {
    return (
      <ScreenShell title={`Editar ${meta.label}`} onBack={() => setEditing(false)}>
        <form
          className="screen-body"
          style={{ padding: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
        >
          <ElementFields
            type={el.type}
            values={values}
            onChange={setValues}
            cableChoices={
              el.type === 'reserva' && cables
                ? cableChoicesNear(el, cables, undefined, (el.attrs as { cableId?: string }).cableId)
                : []
            }
          />
          {error && <div className="alert" role="alert">{error}</div>}
          <div className="sticky-actions">
            <div className="placement-row">
              <button type="button" className="btn" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Salvar
              </button>
            </div>
          </div>
        </form>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell title={meta.label} onBack={back}>
      <div className="card element-summary">
        <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(el.type, { size: 48 }) }} />
        <div>
          <div className="card-title">{el.code || meta.label}</div>
          <div className="card-meta">{meta.label}</div>
        </div>
      </div>

      <div className="info-list">
        {activity && (
          <Row
            label="Atividade"
            value={`${activity.title} · ${KIND_LABEL[activity.kind]} · ${activity.status === 'aberta' ? 'aberta' : 'concluída'}`}
          />
        )}
        <Row label="Posição" value={`${position} (${how})`} />
        {describeAttrs(el).map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
        {el.notes && <Row label="Observações" value={el.notes} />}
        <Row label="Registrado" value={`${el.createdBy} · ${formatDateTime(el.createdAt)}`} />
      </div>

      <section className="field" aria-label="Fotos">
        <span className="label">Fotos ({items.length})</span>
        {mine && (
          <CameraButton
            onPhoto={async (blob, takenAt) => {
              await photoStore.add(el.id, { blob, takenAt }, technician ?? '');
            }}
          />
        )}
        <PhotoGrid items={items} onOpen={setViewerId} />
      </section>

      {error && <div className="alert" role="alert">{error}</div>}

      {mine ? (
        <div className="detail-actions">
          <button className="btn" onClick={startEdit}>Editar</button>
          <button className="btn" onClick={startMove}>Mover</button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Excluir</button>
        </div>
      ) : (
        <NotMineNote author={el.createdBy} what="elemento" />
      )}

      {viewing && (
        <PhotoViewer
          item={viewing}
          onClose={() => setViewerId(null)}
          onDelete={mine ? () => photoStore.remove(viewing.id) : undefined}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Excluir ${meta.label}${el.code ? ` ${el.code}` : ''}?`}
          message={
            items.length > 0
              ? `As ${items.length} foto(s) deste elemento também serão excluídas.`
              : 'O elemento será removido do mapa.'
          }
          confirmLabel="Excluir"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void doDelete()}
        />
      )}
    </ScreenShell>
  );
}
