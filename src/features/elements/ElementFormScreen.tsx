import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import { formatAccuracy } from '../../lib/geo';
import { goBack, navigate } from '../../lib/route';
import { cableChoicesNear } from '../cables/cableChoices';
import { cableStore } from '../cables/cableRepo';
import { useTechnician } from '../settings/useTechnician';
import { draftStore, useDraft } from './draftStore';
import ElementFields, { emptyValues, type FieldValues } from './ElementFields';
import { ElementRuleError, elementStore } from './elementRepo';
import { elementSvg } from './elementSvg';
import { ELEMENT_META } from './meta';
import { CameraButton, PhotoGrid, PhotoViewer } from './PhotoParts';

interface DraftPhoto {
  id: string;
  blob: Blob;
  takenAt: number;
}

export default function ElementFormScreen() {
  const type = useDraft((s) => s.type);
  const position = useDraft((s) => s.position);
  const technician = useTechnician();
  const [values, setValues] = useState<FieldValues>(emptyValues);
  // As fotos ficam na memória até salvar; o elemento e as fotos são gravados juntos.
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const items = useMemo(() => photos.map((p) => ({ id: p.id, blob: p.blob })), [photos]);
  // Reserva "sobre um vértice" de um cabo: sugere esse cabo (o técnico pode trocar ou tirar).
  const cables = useLiveQuery(() => cableStore.list());
  const cableChoices = useMemo(
    () => (type === 'reserva' && position && cables ? cableChoicesNear(position, cables) : []),
    [type, position, cables],
  );
  const suggested = useRef(false);
  useEffect(() => {
    if (suggested.current || cableChoices.length === 0) return;
    suggested.current = true;
    setValues((v) => ({ ...v, attrs: { ...v.attrs, cableId: cableChoices[0]!.id } }));
  }, [cableChoices]);

  const missing = !type || !position;
  // Recarregar a página nesta tela perde o rascunho: volta para o mapa.
  useEffect(() => {
    if (missing) navigate('map', { replace: true });
  }, [missing]);
  if (missing) return null;

  const meta = ELEMENT_META[type];
  const where =
    position.source === 'gps' && position.accuracy !== undefined
      ? `GPS ${formatAccuracy(position.accuracy)}`
      : 'Posição marcada no mapa';
  const viewing = photos.find((p) => p.id === viewerId);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !type || !position) return;
    setBusy(true);
    setError(null);
    try {
      await elementStore.create(
        {
          type,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          positionSource: position.source,
          ...values,
        },
        technician ?? '',
        photos.map((p) => ({ blob: p.blob, takenAt: p.takenAt })),
      );
      draftStore.saved(`Salvo: ${meta.label}${values.code.trim() ? ` ${values.code.trim()}` : ''}`);
      navigate('map', { replace: true });
    } catch (err) {
      setError(err instanceof ElementRuleError ? err.message : 'Não foi possível salvar. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="Dados do elemento" onBack={() => goBack('map')}>
      <form onSubmit={onSubmit} className="screen-body" style={{ padding: 0 }}>
        <div className="card element-summary">
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(type, { size: 44 }) }} />
          <div>
            <div className="card-title">{meta.label}</div>
            <div className="card-meta">{where}</div>
          </div>
        </div>

        <ElementFields type={type} values={values} onChange={setValues} cableChoices={cableChoices} feed={{ position: { lat: position.lat, lng: position.lng } }} />

        <div className="field">
          <span className="label">Fotos</span>
          <CameraButton
            onPhoto={(blob, takenAt) => setPhotos((ps) => [...ps, { id: crypto.randomUUID(), blob, takenAt }])}
          />
          <PhotoGrid items={items} onOpen={setViewerId} />
        </div>

        {error && <div className="alert" role="alert">{error}</div>}

        <div className="sticky-actions">
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Salvar {meta.label}
          </button>
        </div>
      </form>

      {viewing && (
        <PhotoViewer
          item={{ id: viewing.id, blob: viewing.blob }}
          onClose={() => setViewerId(null)}
          onDelete={() => setPhotos((ps) => ps.filter((p) => p.id !== viewing.id))}
        />
      )}
    </ScreenShell>
  );
}
