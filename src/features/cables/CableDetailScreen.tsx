import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import { AdminBanner, EditedByNote } from '../../components/AdminNote';
import NotMineNote from '../../components/NotMineNote';
import ScreenShell from '../../components/ScreenShell';
import { db } from '../../db/db';
import type { NetworkElement } from '../../db/types';
import { formatDateTime } from '../../lib/format';
import { distanceMeters, formatMeters } from '../../lib/geo';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { adminDeleteText } from '../../lib/ownership';
import { useCanEdit, useIsMine } from '../../lib/useOwnership';
import { KIND_LABEL } from '../activities/labels';
import { draftStore } from '../elements/draftStore';
import { elementStore } from '../elements/elementRepo';
import { ELEMENT_META } from '../elements/meta';
import { Chips } from '../elements/fields';
import { CableRuleError, cableStore } from './cableRepo';
import { ColorStandardChips } from './colorStandard';
import CableConnections from './CableConnections';
import FiberList from './FiberList';
import { DEFAULT_COLOR_STANDARD, STANDARD_LABEL, tubeCount, type ColorStandard } from './fibers';
import { useCableTypes } from './cableTypes';
import { FiberLine, LegendList } from './Legend';
import { FIBER_COUNTS } from './style';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

/** Detalhe do cabo (ao tocar na linha no mapa): metragem, pontos, reservas, edição e exclusão. */
export default function CableDetailScreen() {
  const id = useRouteId();
  const cable = useLiveQuery(async () => (id ? ((await cableStore.get(id)) ?? null) : null), [id]); // undefined = carregando
  const activity = useLiveQuery(async () => (cable ? ((await db.activities.get(cable.activityId)) ?? null) : null), [cable?.activityId]);
  const reserves = useLiveQuery(
    (): Promise<NetworkElement[]> =>
      id
        ? db.elements
            .where('type')
            .equals('reserva')
            .filter((e) => !e.deleted && (e.attrs as { cableId?: string }).cableId === id)
            .toArray()
        : Promise.resolve([] as NetworkElement[]),
    [id],
  );
  const vertexElements = useLiveQuery(async () => {
    const ids = (cable?.vertices ?? []).flatMap((v) => (v.elementId ? [v.elementId] : []));
    const found = await Promise.all(ids.map((x) => elementStore.get(x)));
    return new Map(found.flatMap((e) => (e ? [[e.id, e] as const] : [])));
  }, [cable]);
  const types = useCableTypes();
  const mine = useIsMine(cable);
  const editable = useCanEdit(cable); // o dono ou o administrador

  const [editing, setEditing] = useState(false);
  const [cableType, setCableType] = useState('');
  const [fiberCount, setFiberCount] = useState(12);
  const [standard, setStandard] = useState<ColorStandard>(DEFAULT_COLOR_STANDARD);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const back = () => goBack('map');
  const fail = (e: unknown, fallback: string) => setError(e instanceof CableRuleError ? e.message : fallback);

  if (cable === undefined) return <ScreenShell title="Cabo" onBack={back}>{null}</ScreenShell>;
  if (cable === null) {
    return (
      <ScreenShell title="Cabo" onBack={back}>
        <div className="alert" role="alert">Cabo não encontrado. Ele pode ter sido excluído.</div>
        <button className="btn btn-block" onClick={back}>Voltar ao mapa</button>
      </ScreenShell>
    );
  }

  function startEdit() {
    if (!cable) return;
    setCableType(cable.cableType);
    setFiberCount(cable.fiberCount);
    setStandard(cable.colorStandard ?? DEFAULT_COLOR_STANDARD);
    setNotes(cable.notes);
    setError(null);
    setEditing(true);
  }

  async function saveEdit() {
    if (!cable || busy) return;
    setBusy(true);
    setError(null);
    try {
      await cableStore.update(cable.id, { cableType, fiberCount, colorStandard: standard, notes });
      setEditing(false);
    } catch (e) {
      fail(e, 'Não foi possível salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!cable) return;
    setConfirmDelete(false);
    try {
      await cableStore.remove(cable.id);
      back();
    } catch (e) {
      fail(e, 'Não foi possível excluir. Tente de novo.');
    }
  }

  function editPath() {
    if (!cable) return;
    draftStore.startCableEdit(cable.id);
    navigate('map');
  }

  if (editing) {
    // O tipo atual continua escolhível mesmo que tenha sido removido da lista das Configurações.
    const options = [...new Set([...(types ?? []), cable.cableType])];
    return (
      <ScreenShell title="Editar cabo" onBack={() => setEditing(false)}>
        <form
          className="screen-body"
          style={{ padding: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
        >
          <Chips label="Tipo do cabo" value={cableType} options={options.map((t) => ({ value: t, label: t }))} onChange={(v) => v && setCableType(v)} />
          <div className="field">
            <span className="label" id="edit-fibers">Nº de fibras</span>
            <div className="chips fibers" role="group" aria-labelledby="edit-fibers">
              {FIBER_COUNTS.map((n) => (
                <button type="button" key={n} aria-pressed={fiberCount === n} onClick={() => setFiberCount(n)}>
                  <span>{n}</span>
                  <FiberLine fiberCount={n} width={40} />
                </button>
              ))}
            </div>
          </div>
          <ColorStandardChips value={standard} onChange={setStandard} />
          <div className="field">
            <label htmlFor="cable-notes">Observações</label>
            <textarea id="cable-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
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

  const vs = cable.vertices;
  return (
    <ScreenShell title="Cabo" onBack={back}>
      <div className="card element-summary">
        <FiberLine fiberCount={cable.fiberCount} width={56} />
        <div>
          <div className="card-title">{cable.cableType} · {cable.fiberCount} fibras</div>
          <div className="card-meta">{vs.length} pontos</div>
        </div>
      </div>

      <div className="info-list">
        <Row label="Traçado" value={formatMeters(cable.lengthMeters)} />
        <Row label="Reservas" value={formatMeters(cable.reserveMeters)} />
        <Row label="Total" value={formatMeters(cable.totalMeters)} />
        {activity && <Row label="Atividade" value={`${activity.title} · ${KIND_LABEL[activity.kind]} · ${activity.status === 'aberta' ? 'aberta' : 'concluída'}`} />}
        {cable.notes && <Row label="Observações" value={cable.notes} />}
        <Row label="Registrado" value={`${cable.createdBy} · ${formatDateTime(cable.createdAt)}`} />
      </div>

      <section className="field" aria-label="Fibras do cabo">
        <span className="label">
          Fibras ({cable.fiberCount}) · cores {STANDARD_LABEL[cable.colorStandard ?? DEFAULT_COLOR_STANDARD]}
          {tubeCount(cable.fiberCount) > 0 ? ` · ${tubeCount(cable.fiberCount)} tubos` : ''}
        </span>
        <FiberList fiberCount={cable.fiberCount} standard={cable.colorStandard ?? DEFAULT_COLOR_STANDARD} />
      </section>

      <CableConnections cableId={cable.id} />

      <section className="field" aria-label="Pontos do traçado">
        <span className="label">Pontos do traçado</span>
        <ol className="vertex-list">
          {vs.map((v, i) => {
            const el = v.elementId ? vertexElements?.get(v.elementId) : undefined;
            const next = vs[i + 1];
            return (
              <li key={i}>
                <span>
                  {i + 1}. {el ? `${ELEMENT_META[el.type].label}${el.code ? ' ' + el.code : ''}` : v.elementId ? 'Elemento' : 'Ponto solto'}
                </span>
                {next && <small>↓ {formatMeters(distanceMeters(v, next))}</small>}
              </li>
            );
          })}
        </ol>
      </section>

      {reserves && reserves.length > 0 && (
        <section className="field" aria-label="Reservas">
          <span className="label">Reservas ({reserves.length})</span>
          {reserves.map((r) => (
            <button key={r.id} className="btn" onClick={() => navigate('elemento', { id: r.id })}>
              Reserva {r.code} · {formatMeters((r.attrs as { meters?: number }).meters ?? 0)}
            </button>
          ))}
        </section>
      )}

      {error && <div className="alert" role="alert">{error}</div>}

      <EditedByNote record={cable} />
      {editable ? (
        <>
          {!mine && <AdminBanner author={cable.createdBy} what="cabo" />}
          <div className="detail-actions">
            <button className="btn" onClick={startEdit}>Editar</button>
            <button className="btn" onClick={editPath}>Traçado</button>
            <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Excluir</button>
          </div>
        </>
      ) : (
        <NotMineNote author={cable.createdBy} what="cabo" />
      )}

      <section className="field" aria-label="Legenda">
        <span className="label">Legenda</span>
        <LegendList />
      </section>

      {confirmDelete && (
        <ConfirmDialog
          title={`Excluir cabo ${cable.cableType} · ${cable.fiberCount} fibras?`}
          message={
            (!mine ? `${adminDeleteText('cabo', cable.createdBy)} ` : '') +
            (reserves && reserves.length > 0
              ? `As ${reserves.length} reserva(s) continuam no mapa, sem cabo. Os postes não são excluídos.`
              : 'O cabo será removido do mapa. Os postes não são excluídos.')
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
