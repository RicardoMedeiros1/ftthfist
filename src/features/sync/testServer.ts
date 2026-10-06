import type { RemoteRow } from './mapping';
import { SyncHttpError, type PullQuery, type RemoteApi } from './remote';

// Servidor falso, em memoria, para testar o motor. Reproduz as regras que importam do Supabase real
// (supabase/migrations): dono definido pelo servidor, atividade-pai do mesmo dono, conflito por updated_at,
// relogio adiantado limitado a +5 min, reenvio igual nao grava, RLS por papel, trilha so do dono.
// As mesmas regras sao conferidas contra o Postgres de verdade em supabase/tests (e no teste de integracao).

export type Role = 'tecnico' | 'escritorio' | 'admin';

const TABLES = ['activities', 'elements', 'cables', 'photos', 'track_points'] as const;
const CHILD = new Set(['elements', 'cables', 'photos', 'track_points']);
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const FIBERS = new Set([1, 2, 4, 6, 12, 24, 36, 48, 72, 144]);
const ELEMENT_TYPES = new Set(['poste', 'cto', 'ceo', 'reserva', 'ocorrencia', 'outro']);

export interface Call {
  fn: 'upsert' | 'pull' | 'fetchByIds' | 'upload' | 'download';
  table: string;
  who: string;
  n: number;
  query?: PullQuery;
}

export class TestServer {
  rows: Record<string, Map<string, RemoteRow>> = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
  conflicts: Array<{ table: string; id: string; incoming: RemoteRow; kept: RemoteRow }> = [];
  /** Bucket de fotos: caminho -> arquivo. */
  files = new Map<string, Blob>();
  calls: Call[] = [];
  profiles = new Map<string, { role: Role; active: boolean }>();
  /** Relogio do servidor (ms). Avanca sozinho a cada gravacao (monotonico). */
  clock = Date.now();
  private tick = 0;
  /** Sem rede: toda chamada falha como falha de conexao. */
  down = false;
  /** Erro a simular na proxima chamada (uma vez). */
  failNext: SyncHttpError | null = null;
  /** O servidor GRAVA, mas a resposta nao chega (cai a conexao): o caso que mais gera duplicata em sistemas ingenuos. */
  loseResponseOnce = false;
  /** Gancho chamado depois de gravar e antes de responder (para simular edicao concorrente no aparelho). */
  beforeRespond: (() => Promise<void> | void) | null = null;

  addUser(id: string, role: Role = 'tecnico', active = true) {
    this.profiles.set(id, { role, active });
  }

  private stamp(): string {
    this.clock += 1;
    this.tick += 1;
    return `${new Date(this.clock).toISOString().slice(0, -1)}${String(this.tick % 1000).padStart(3, '0')}+00:00`;
  }

  count(table: string) {
    return this.rows[table]!.size;
  }
  get(table: string, id: string) {
    return this.rows[table]!.get(id);
  }

  private guard(fn: Call['fn'], table: string, who: string, n: number, query?: PullQuery) {
    this.calls.push({ fn, table, who, n, query });
    if (this.down) throw new SyncHttpError('network', 'Failed to fetch');
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }

  client(userId: string): RemoteApi {
    const profile = () => this.profiles.get(userId);
    const readable = (table: string, r: RemoteRow) => (table === 'track_points' ? r.owner_id === userId || profile()?.role !== 'tecnico' : true);
    const denied = () => new SyncHttpError('permanent', 'new row violates row-level security policy', 403, '42501');
    return {
      upsert: async (table, rows) => {
        this.guard('upsert', table, userId, rows.length);
        const p = profile();
        if (!p || !p.active || p.role === 'escritorio') throw denied();
        const t = this.rows[table]!;
        // validacao do lote inteiro antes de gravar (um erro derruba tudo, como um unico INSERT)
        for (const r of rows) {
          const old = t.get(String(r.id));
          if (old && old.owner_id !== userId) throw denied();
          if (CHILD.has(table)) {
            const act = this.rows.activities!.get(String(r.activity_id));
            if (!act) throw new SyncHttpError('dependency', 'violates foreign key constraint', 409, '23503');
            if (act.owner_id !== userId) throw denied();
          }
          if (table === 'elements' && !ELEMENT_TYPES.has(String(r.type))) throw new SyncHttpError('permanent', 'check constraint', 400, '23514');
          if (table === 'cables') {
            if (!FIBERS.has(Number(r.fiber_count))) throw new SyncHttpError('permanent', 'check constraint', 400, '23514');
            if (!Array.isArray(r.vertices) || r.vertices.length < 2) throw new SyncHttpError('permanent', 'o cabo precisa de pelo menos 2 pontos', 400, '23514');
          }
          if (table === 'photos' && r.element_id != null && !this.rows.elements!.has(String(r.element_id))) {
            throw new SyncHttpError('dependency', 'violates foreign key constraint', 409, '23503');
          }
          if ((table === 'elements' || table === 'track_points') && (Math.abs(Number(r.lat)) > 90 || Math.abs(Number(r.lng)) > 180)) {
            throw new SyncHttpError('permanent', 'check constraint', 400, '23514');
          }
        }
        const written: string[] = [];
        for (const r of rows) {
          const id = String(r.id);
          const old = t.get(id);
          const clamp = this.clock + 5 * 60_000;
          const updated = Math.min(Date.parse(String(r.updated_at)), clamp);
          const next: RemoteRow = { ...r, updated_at: new Date(updated).toISOString(), owner_id: old ? old.owner_id : userId };
          delete next.geom;
          if (old) {
            const oldUpdated = Date.parse(String(old.updated_at));
            if (updated <= oldUpdated) {
              const strip = (x: RemoteRow) => JSON.stringify({ ...x, updated_at: 0, server_updated_at: 0 });
              if (updated < oldUpdated && strip(next) !== strip(old)) this.conflicts.push({ table, id, incoming: next, kept: old });
              continue; // reenvio igual ou atrasado: nao grava
            }
          }
          next.server_updated_at = this.stamp();
          t.set(id, next);
          written.push(id);
        }
        await this.beforeRespond?.();
        if (this.loseResponseOnce) {
          this.loseResponseOnce = false;
          throw new SyncHttpError('network', 'Failed to fetch');
        }
        return { written };
      },
      pull: async (table, q) => {
        this.guard('pull', table, userId, 0, q);
        const p = profile();
        if (!p || !p.active) return [];
        const sorted = [...this.rows[table]!.values()]
          .filter((r) => readable(table, r))
          .sort((a, b) => String(a.server_updated_at).localeCompare(String(b.server_updated_at)) || String(a.id).localeCompare(String(b.id)));
        const after = q.after;
        const out = sorted.filter((r) => {
          const ts = String(r.server_updated_at);
          if (after) return ts > after.ts || (ts === after.ts && String(r.id) > after.id);
          return Date.parse(ts) >= Date.parse(q.since);
        });
        return out.slice(0, q.limit).map((r) => ({ ...r }));
      },
      uploadFile: async (path, blob) => {
        this.guard('upload', 'fotos', userId, 1);
        const p = profile();
        if (!p || !p.active || p.role === 'escritorio') throw new SyncHttpError('permanent', 'new row violates row-level security policy', 403, '');
        if (!path.startsWith(`${userId}/`) || !path.endsWith('.jpg')) throw new SyncHttpError('permanent', 'new row violates row-level security policy', 403, '');
        if (blob.type !== 'image/jpeg') throw new SyncHttpError('permanent', 'mime type not supported', 415, '');
        if (blob.size > MAX_PHOTO_BYTES) throw new SyncHttpError('permanent', 'The object exceeded the maximum allowed size', 413, '');
        this.files.set(path, blob);
        await this.beforeRespond?.();
        if (this.loseResponseOnce) {
          this.loseResponseOnce = false;
          throw new SyncHttpError('network', 'Failed to fetch');
        }
      },
      downloadFile: async (path) => {
        this.guard('download', 'fotos', userId, 1);
        const p = profile();
        if (!p || !p.active) throw new SyncHttpError('permanent', 'new row violates row-level security policy', 403, '');
        const f = this.files.get(path);
        if (!f) throw new SyncHttpError('permanent', 'Object not found', 404, '');
        return f;
      },
      fetchByIds: async (table, ids) => {
        this.guard('fetchByIds', table, userId, ids.length);
        return ids.flatMap((id) => {
          const r = this.rows[table]!.get(id);
          return r && readable(table, r) ? [{ ...r }] : [];
        });
      },
    };
  }
}
