import type { SupabaseClient } from '@supabase/supabase-js';
import type { Role } from '../account/authApi';
import { classifyError } from '../sync/remote';

// A "porta" das ferramentas do administrador para o servidor. Tudo aqui exige internet e so funciona para um
// administrador ativo (quem garante e o servidor, por RLS: o app so esconde o que nao serviria).

export type AdminErrorKind = 'network' | 'auth' | 'denied' | 'last-admin' | 'other';

export class AdminError extends Error {
  constructor(
    readonly kind: AdminErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = 'AdminError';
  }
}

export interface Person {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
}

/** Uma linha de `admin_edits` (alteracao feita por quem nao e o dono) ou de `sync_conflicts`. */
export interface ChangeEntry {
  id: number;
  at: string;
  table: string;
  recordId: string;
  ownerId: string;
  /** Quem alterou (so no registro de alteracoes do administrador). */
  editedBy: string | null;
  /** Antes e depois (alteracoes) ou o que ficou e o que chegou atrasado (conflitos). */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface RemoteTrackPoint {
  id: string;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  segment: number;
}

export interface TrackCursor {
  ts: string;
  id: string;
}

export interface AdminApi {
  listPeople(): Promise<Person[]>;
  /** Aprova/desativa e/ou muda o papel. O servidor registra quem fez e protege o ultimo administrador. */
  setAccess(id: string, patch: { active?: boolean; role?: Role }): Promise<void>;
  /** Alteracoes feitas por quem nao e o dono, da mais nova para a mais antiga. `before` = id da ultima linha da pagina anterior. */
  listEdits(limit: number, before?: number): Promise<ChangeEntry[]>;
  /** Edicoes que chegaram atrasadas e foram recusadas (o servidor manteve a versao mais nova). */
  listConflicts(limit: number, before?: number): Promise<ChangeEntry[]>;
  /** Nomes (cadastro) por id. Quem nao for achado fica de fora. */
  names(ids: string[]): Promise<Map<string, string>>;
  /** Pontos da trilha de uma atividade, em ordem de horario; `after` continua de onde parou. */
  trackPage(activityId: string, limit: number, after?: TrackCursor): Promise<{ points: RemoteTrackPoint[]; last: TrackCursor | null }>;
}

type Failure = { code?: string; message?: string } | null;

function fail(error: NonNullable<Failure>, status: number | undefined): never {
  if (error.code === '23514') throw new AdminError('last-admin', error.message);
  if (error.code === '42501' || status === 403) throw new AdminError('denied', error.message);
  const kind = classifyError(status, error.code);
  throw new AdminError(kind === 'network' || kind === 'transient' ? 'network' : kind === 'auth' ? 'auth' : 'other', error.message);
}

type Row = Record<string, unknown>;

export function createSupabaseAdminApi(client: Pick<SupabaseClient, 'from' | 'rpc'>): AdminApi {
  const changes = async (table: 'admin_edits' | 'sync_conflicts', limit: number, before?: number): Promise<ChangeEntry[]> => {
    const cols = table === 'admin_edits' ? 'id,at,table_name,record_id,owner_id,edited_by,before,after' : 'id,at,table_name,record_id,owner_id,kept,incoming';
    let q = client.from(table).select(cols).order('id', { ascending: false }).limit(limit);
    if (before !== undefined) q = q.lt('id', before);
    const { data, error, status } = await q.retry(false);
    if (error) fail(error, status);
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      id: Number(r.id),
      at: String(r.at),
      table: String(r.table_name),
      recordId: String(r.record_id),
      ownerId: String(r.owner_id),
      editedBy: typeof r.edited_by === 'string' ? r.edited_by : null,
      // conflito: "kept" (o que o servidor manteve) e o antes; "incoming" (o que chegou atrasado) e o depois
      before: ((table === 'admin_edits' ? r.before : r.kept) ?? {}) as Row,
      after: ((table === 'admin_edits' ? r.after : r.incoming) ?? {}) as Row,
    }));
  };

  return {
    async listPeople() {
      const { data, error, status } = await client.rpc('admin_list_people').retry(false);
      if (error) fail(error, status);
      return ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        email: String(r.email ?? ''),
        fullName: String(r.full_name ?? ''),
        role: r.role as Role,
        active: r.active === true,
        createdAt: String(r.created_at),
        reviewedAt: typeof r.reviewed_at === 'string' ? r.reviewed_at : null,
        reviewedByName: typeof r.reviewed_by_name === 'string' ? r.reviewed_by_name : null,
      }));
    },
    async setAccess(id, patch) {
      const { data, error, status } = await client.from('profiles').update(patch).eq('id', id).select('id').retry(false);
      if (error) fail(error, status);
      if (!data || data.length === 0) throw new AdminError('denied', 'nenhuma linha alterada'); // RLS: nao e administrador
    },
    listEdits: (limit, before) => changes('admin_edits', limit, before),
    listConflicts: (limit, before) => changes('sync_conflicts', limit, before),
    async names(ids) {
      const out = new Map<string, string>();
      if (ids.length === 0) return out;
      const { data, error, status } = await client.from('profiles').select('id,full_name').in('id', [...new Set(ids)]).retry(false);
      if (error) fail(error, status);
      for (const r of (data ?? []) as Row[]) out.set(String(r.id), String(r.full_name ?? ''));
      return out;
    },
    async trackPage(activityId, limit, after) {
      let q = client
        .from('track_points')
        .select('id,lat,lng,accuracy_m,ts,segment')
        .eq('activity_id', activityId)
        .eq('deleted', false)
        .order('ts', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (after) q = q.or(`ts.gt.${after.ts},and(ts.eq.${after.ts},id.gt.${after.id})`);
      const { data, error, status } = await q.retry(false);
      if (error) fail(error, status);
      const rows = (data ?? []) as unknown as Row[];
      const last = rows.length > 0 ? { ts: String(rows[rows.length - 1]!.ts), id: String(rows[rows.length - 1]!.id) } : null;
      return {
        points: rows.map((r) => ({
          id: String(r.id),
          lat: Number(r.lat),
          lng: Number(r.lng),
          accuracy: Number(r.accuracy_m),
          timestamp: Date.parse(String(r.ts)),
          segment: Number(r.segment ?? 0),
        })),
        last,
      };
    },
  };
}
