import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Photo } from '../../db/types';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { needsDownload } from '../sync/photoFiles';
import { photoFiles } from '../sync/syncRuntime';
import type { BlobItem } from './useObjectUrls';
import { photoStore } from './photoRepo';

/**
 * As fotos de um elemento, prontas para a galeria. Foto de colega chega pela sincronizacao como registro e o arquivo
 * baixa ao abrir o elemento (com internet); enquanto isso o quadrinho diz o que esta acontecendo.
 */
export function useElementPhotos(elementId: string | undefined): BlobItem[] {
  const photos = useLiveQuery(() => (elementId ? photoStore.listFor(elementId) : Promise.resolve([] as Photo[])), [elementId]);
  const online = useOnlineStatus();
  const [download, setDownload] = useState<'idle' | 'baixando' | 'sem-rede' | 'falhou'>('idle');
  const missing = (photos ?? []).filter(needsDownload).length;
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
  return useMemo(
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
}
