import type { RotaFibraDB } from '../../db/db';
import type { Photo } from '../../db/types';
import { SyncHttpError, type RemoteApi } from './remote';

// Arquivos das fotos dos colegas (ou minhas, de outro aparelho): o registro chega pela sincronizacao e o arquivo so
// e baixado quando alguem abre o elemento (economiza dados e espaco; no campo ninguem precisa de todas as fotos da rede).

export interface DownloadResult {
  downloaded: number;
  /** O arquivo nao existe (mais) no servidor ou o servidor recusou. */
  failed: number;
  /** Faltou conexao: o resto fica para a proxima vez. */
  offline: boolean;
}

/** Foto que tem arquivo no servidor mas ainda nao tem neste aparelho. */
export const needsDownload = (p: Photo) => !p.deleted && !p.blob && !!p.storagePath;

export function createPhotoFiles(deps: { db: RotaFibraDB; remote: RemoteApi }) {
  const inflight = new Map<string, Promise<DownloadResult>>();

  async function run(elementId: string): Promise<DownloadResult> {
    const result: DownloadResult = { downloaded: 0, failed: 0, offline: false };
    const wanted = await deps.db.photos.where('elementId').equals(elementId).filter(needsDownload).toArray();
    for (const p of wanted) {
      try {
        const blob = await deps.remote.downloadFile(p.storagePath!);
        // So grava se ainda faltar (o tecnico pode ter excluido a foto, ou outro ciclo ja trouxe). Nao mexe em updatedAt/syncStatus.
        await deps.db.transaction('rw', deps.db.photos, async () => {
          const cur = await deps.db.photos.get(p.id);
          if (cur && !cur.blob) await deps.db.photos.update(p.id, { blob });
        });
        result.downloaded++;
      } catch (e) {
        if (e instanceof SyncHttpError && (e.kind === 'permanent' || e.kind === 'dependency')) {
          result.failed++;
          continue;
        }
        result.offline = true; // rede, 5xx ou sessao: para aqui, tenta de novo ao abrir de novo
        break;
      }
    }
    return result;
  }

  return {
    /** Baixa as fotos que faltam deste elemento (uma de cada vez). Chamadas simultaneas dividem o mesmo trabalho. */
    download(elementId: string): Promise<DownloadResult> {
      const running = inflight.get(elementId);
      if (running) return running;
      const p = run(elementId).finally(() => inflight.delete(elementId));
      inflight.set(elementId, p);
      return p;
    },
  };
}

export type PhotoFiles = ReturnType<typeof createPhotoFiles>;
