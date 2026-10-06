import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteRow } from './mapping';
import { PHOTO_BUCKET } from './tables';

// A conversa com o servidor, atras de uma interface pequena (o motor e testado com um servidor falso).

/**
 * O que um erro significa para a fila:
 *  - network: sem conexao / servidor fora do ar -> tenta de novo depois, sem culpar nenhum registro
 *  - transient: 5xx, 429 -> idem
 *  - auth: sessao vencida/invalida -> parar e pedir para entrar de novo
 *  - dependency: depende de outro registro que ainda nao chegou (FK) -> o registro espera, nao e "com problema"
 *  - permanent: o servidor recusou este registro (RLS, dado invalido) -> o registro fica "bloqueado"
 */
export type SyncErrorKind = 'network' | 'transient' | 'auth' | 'dependency' | 'permanent';

export class SyncHttpError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly status = 0,
    readonly code = '',
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

export function classifyError(status: number | undefined, code: string | undefined): SyncErrorKind {
  if (!status) return 'network'; // fetch falhou: sem resposta HTTP
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return 'auth';
  if (status === 408 || status === 429 || status >= 500) return 'transient';
  if (code === '23503') return 'dependency';
  return 'permanent';
}

export interface PullQuery {
  /** Piso do cursor (ISO). Traz tudo com server_updated_at >= since. */
  since: string;
  /** Continuação da página anterior (keyset): o último (server_updated_at, id) recebido. */
  after?: { ts: string; id: string };
  limit: number;
}

export interface RemoteApi {
  /** Envia as linhas (upsert por id). Devolve os ids que o servidor GRAVOU: o reenvio igual ou atrasado não grava. */
  upsert(table: string, rows: RemoteRow[]): Promise<{ written: string[] }>;
  /** Linhas alteradas desde o cursor, em ordem de (server_updated_at, id). */
  pull(table: string, q: PullQuery): Promise<RemoteRow[]>;
  fetchByIds(table: string, ids: string[]): Promise<RemoteRow[]>;
  /** Envia o arquivo de uma foto ao bucket privado. Reenviar o mesmo caminho e inofensivo (sobrescreve). */
  uploadFile(path: string, blob: Blob): Promise<void>;
  /** Baixa o arquivo de uma foto. */
  downloadFile(path: string): Promise<Blob>;
}

interface PgError {
  code?: string;
  message?: string;
  details?: string;
}

function fail(error: PgError, status: number | undefined): never {
  const kind = classifyError(status, error.code);
  const text = [error.message, error.details].filter(Boolean).join(' — ') || 'erro desconhecido';
  throw new SyncHttpError(kind, text, status ?? 0, error.code ?? '');
}

interface StorageErr {
  message?: string;
  /** Resposta do servidor (400, 403, 404, 413...). Ausente = a conexao falhou antes de haver resposta. */
  status?: number;
}

function failStorage(error: StorageErr): never {
  const status = typeof error.status === 'number' ? error.status : undefined;
  const message = error.message || 'erro no armazenamento de fotos';
  let kind = classifyError(status, undefined);
  // o servico de arquivos responde 400/403 com texto de JWT quando o token venceu
  if (status && /jwt|token|exp claim/i.test(message)) kind = 'auth';
  throw new SyncHttpError(kind, message, status ?? 0, '');
}

/** Adaptador sobre o cliente do supabase-js. Sem repeticao automatica: quem decide quando tentar de novo é a fila. */
/** O que o adaptador usa do cliente: no app e o `SupabaseClient`; no service worker, `from` e `storage` montados a mao. */
export type RemoteClient = Pick<SupabaseClient, 'from' | 'storage'>;

export function createSupabaseRemote(client: RemoteClient): RemoteApi {
  return {
    async upsert(table, rows) {
      // merge-duplicates + return=representation: a resposta traz só as linhas realmente gravadas.
      const { data, error, status } = await client.from(table).upsert(rows, { onConflict: 'id' }).select('id').retry(false);
      if (error) fail(error, status);
      return { written: (data ?? []).map((r) => String((r as { id: unknown }).id)) };
    },
    async pull(table, q) {
      let query = client.from(table).select('*').order('server_updated_at', { ascending: true }).order('id', { ascending: true }).limit(q.limit);
      query = q.after
        ? query.or(`server_updated_at.gt.${q.after.ts},and(server_updated_at.eq.${q.after.ts},id.gt.${q.after.id})`)
        : query.gte('server_updated_at', q.since);
      const { data, error, status } = await query.retry(false);
      if (error) fail(error, status);
      return (data ?? []) as RemoteRow[];
    },
    async fetchByIds(table, ids) {
      const { data, error, status } = await client.from(table).select('*').in('id', ids).retry(false);
      if (error) fail(error, status);
      return (data ?? []) as RemoteRow[];
    },
    async uploadFile(path, blob) {
      const { error } = await client.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (error) failStorage(error as StorageErr);
    },
    async downloadFile(path) {
      const { data, error } = await client.storage.from(PHOTO_BUCKET).download(path);
      if (error) failStorage(error as StorageErr);
      return data!;
    },
  };
}
