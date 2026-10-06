import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { compressImage } from '../../lib/image';
import { useObjectUrls, type BlobItem } from './useObjectUrls';
import './photos.css';

/** Botão da câmera traseira. Cada toque abre a câmera; a foto é comprimida antes de ser entregue. */
export function CameraButton({ onPhoto }: { onPhoto: (blob: Blob, takenAt: number) => Promise<void> | void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite escolher/tirar o mesmo arquivo de novo
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        const takenAt = Date.now();
        await onPhoto(await compressImage(f), takenAt);
      }
    } catch {
      setError('Não foi possível ler a foto. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <button type="button" className="btn btn-block" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Processando foto…' : '📷 Tirar foto'}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={onChange} />
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function PhotoGrid({ items, onOpen }: { items: BlobItem[]; onOpen: (id: string) => void }) {
  const urls = useObjectUrls(items);
  if (items.length === 0) return <p className="hint">Nenhuma foto ainda.</p>;
  return (
    <div className="photo-grid">
      {items.map((p, i) =>
        p.blob ? (
          <button key={p.id} type="button" className="photo-thumb" aria-label={`Abrir foto ${i + 1}`} onClick={() => onOpen(p.id)}>
            {urls[p.id] && <img src={urls[p.id]} alt={`Foto ${i + 1}`} />}
          </button>
        ) : (
          <div key={p.id} className="photo-thumb photo-thumb-pending" role="img" aria-label={`Foto ${i + 1}: ${p.note ?? 'ainda não baixada'}`}>
            <span aria-hidden="true">📷</span>
            <small>{p.note ?? 'Ainda não baixada'}</small>
          </div>
        ),
      )}
    </div>
  );
}

/** Foto em tela cheia, com opção de excluir (com confirmação). */
export function PhotoViewer({
  item,
  onClose,
  onDelete,
}: {
  item: BlobItem;
  onClose: () => void;
  /** Sem isto, a foto abre só para ver (foto de outro técnico). */
  onDelete?: () => Promise<void> | void;
}) {
  const items = useMemo(() => [item], [item]);
  const urls = useObjectUrls(items);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Foto">
      <div className="photo-viewer-bar">
        <button className="btn btn-small" onClick={onClose}>
          Fechar
        </button>
        {onDelete && (
          <button className="btn btn-small btn-danger" onClick={() => setConfirming(true)}>
            Excluir foto
          </button>
        )}
      </div>
      {urls[item.id] && <img src={urls[item.id]} alt="Foto ampliada" />}
      {confirming && (
        <ConfirmDialog
          title="Excluir esta foto?"
          message="A foto será removida do elemento."
          confirmLabel="Excluir"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await onDelete?.();
            onClose();
          }}
        />
      )}
    </div>
  );
}
