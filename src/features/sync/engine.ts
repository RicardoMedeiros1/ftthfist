import { SETTING_KEYS, type RotaFibraDB } from '../../db/db';
import type { Activity, BaseRecord, Cable, NetworkElement, Photo, TrackPoint } from '../../db/types';
import { fromRemote, MappingError, toRemote, type RemoteRow } from './mapping';
import { SyncHttpError, type RemoteApi } from './remote';
import { PULL_ORDER, PUSH_ORDER, REMOTE_TABLE, photoPath, type SyncTable } from './tables';

// O motor de sincronizacao: sobe o que esta "pending" e baixa o que mudou no servidor.
// Principios: (1) nada aqui bloqueia o trabalho de campo: tudo roda em segundo plano e falha em silencio;
// (2) reenviar nunca duplica (upsert por id); (3) um registro recusado nao trava os demais (fica "bloqueado");
// (4) so o dono altera: o que e de outro tecnico so e baixado, nunca enviado.

export const PUSH_BATCH = 100;
export const TRACK_BATCH = 500;
/** Fotos: cada uma e um arquivo de centenas de KB, entao lotes pequenos (o progresso aparece e uma queda perde pouco). */
export const PHOTO_BATCH = 10;
export const PULL_PAGE = 500;
/** O servidor pode confirmar uma transacao longa depois de outra mais nova: o "puxar" volta um pouco no cursor. */
export const PULL_OVERLAP_MS = 5 * 60_000;
/** Depois de tantos registros recusados no mesmo ciclo, para (provavel problema de conta/permissao, nao dos dados). */
const MAX_BLOCKED_PER_CYCLE = 5;

export type Role = 'tecnico' | 'escritorio' | 'admin';

export interface SyncDeps {
  db: RotaFibraDB;
  remote: RemoteApi;
  now(): number;
}

export interface Who {
  userId: string;
  role: Role;
}

export interface BlockedInfo {
  table: SyncTable;
  id: string;
  updatedAt: number;
  message: string;
}

export interface Progress {
  phase: 'enviando' | 'baixando';
  done: number;
}

export interface CycleReport {
  pushed: number;
  pulled: number;
  /** Alteracoes minhas que perderam para uma versao mais nova (por exemplo, feita em outro aparelho). */
  lostEdits: number;
  /** Registros recusados pelo servidor neste ciclo. */
  newlyBlocked: number;
  /** Ainda esperando (dependem de outro registro que nao chegou ao servidor). */
  waiting: number;
}

export class CycleAbort extends Error {
  constructor(
    readonly reason: 'network' | 'auth' | 'server' | 'too-many-blocked',
    message: string,
  ) {
    super(message);
    this.name = 'CycleAbort';
  }
}

type Row = Activity | NetworkElement | Cable | Photo | TrackPoint;
type BlockedMap = Record<string, { updatedAt: number; message: string }>;
type Cursors = Partial<Record<SyncTable, string>>;

const key = (t: SyncTable, id: string) => `${t}:${id}`;

export interface Tuning {
  pushBatch: number;
  trackBatch: number;
  photoBatch: number;
  pullPage: number;
}

export function createSyncEngine(deps: SyncDeps, tuning: Partial<Tuning> = {}) {
  const { db, remote } = deps;
  const pushBatch = tuning.pushBatch ?? PUSH_BATCH;
  const trackBatch = tuning.trackBatch ?? TRACK_BATCH;
  const photoBatch = tuning.photoBatch ?? PHOTO_BATCH;
  const pullPage = tuning.pullPage ?? PULL_PAGE;
  const table = (t: SyncTable) => db[t] as unknown as import('dexie').Table<Row, string>;
  const getSetting = async <T>(k: string, fallback: T): Promise<T> => ((await db.settings.get(k))?.value as T | undefined) ?? fallback;
  const setSetting = (k: string, value: unknown) => db.settings.put({ key: k, value });

  /** Pode ser enviado por quem esta logado? So o que e dele (ou ainda sem dono), e so se o papel permite escrever. */
  const mine = (r: BaseRecord, who: Who) => !r.ownerId || r.ownerId === who.userId;
  const canWrite = (who: Who) => who.role === 'tecnico' || who.role === 'admin';

  // Sem `async`: o liveQuery do Dexie so rastreia as tabelas lidas se a cadeia de promessas for a do proprio Dexie
  // (um `await` de funcao async nativa faz ele perder o rastro e a contagem de pendentes nunca atualizava).
  const blockedMap = (): Promise<BlockedMap> => db.settings.get(SETTING_KEYS.syncBlocked).then((e) => (e?.value as BlockedMap | undefined) ?? {});
  const isBlocked = (map: BlockedMap, t: SyncTable, r: BaseRecord) => map[key(t, r.id)]?.updatedAt === r.updatedAt;

  // ---------- contagens (para o indicador "N pendentes") ----------

  async function counts(who: Who): Promise<{ pending: number; blocked: number }> {
    if (!canWrite(who)) return { pending: 0, blocked: 0 };
    const map = await blockedMap();
    let pending = 0;
    let blocked = 0;
    for (const t of PUSH_ORDER) {
      await table(t)
        .where('syncStatus')
        .equals('pending')
        .each((r) => {
          if (!mine(r, who)) return;
          if (isBlocked(map, t, r)) blocked++;
          else pending++;
        });
    }
    return { pending, blocked };
  }

  async function blockedList(who: Who): Promise<BlockedInfo[]> {
    const map = await blockedMap();
    const out: BlockedInfo[] = [];
    for (const t of PUSH_ORDER) {
      await table(t)
        .where('syncStatus')
        .equals('pending')
        .each((r) => {
          const b = map[key(t, r.id)];
          if (b && b.updatedAt === r.updatedAt && mine(r, who)) out.push({ table: t, id: r.id, updatedAt: r.updatedAt, message: b.message });
        });
    }
    return out;
  }

  /** "Tentar de novo": esquece os bloqueios (o servidor pode ter mudado, ex.: acesso aprovado). */
  async function clearBlocked(): Promise<void> {
    await setSetting(SETTING_KEYS.syncBlocked, {});
  }

  // ---------- enviar ----------

  async function markSynced(t: SyncTable, rows: Row[], who: Who) {
    if (!rows.length) return;
    await db.transaction('rw', table(t), async () => {
      const current = await table(t).bulkGet(rows.map((r) => r.id));
      const done: Row[] = [];
      rows.forEach((r, i) => {
        const cur = current[i];
        // Se o registro mudou enquanto o envio estava no ar, a versao nova continua pendente.
        if (cur && cur.syncStatus === 'pending' && cur.updatedAt === r.updatedAt) {
          done.push({ ...cur, syncStatus: 'synced', ownerId: cur.ownerId ?? who.userId });
        }
      });
      if (done.length) await table(t).bulkPut(done);
    });
    // O que foi enviado nao esta mais "recusado": tira da lista (senao ela so cresceria).
    const map = await blockedMap();
    const gone = rows.map((r) => key(t, r.id)).filter((k) => k in map);
    if (gone.length) {
      for (const k of gone) delete map[k];
      await setSetting(SETTING_KEYS.syncBlocked, map);
    }
  }

  async function block(t: SyncTable, r: Row, message: string, report: CycleReport) {
    const map = await blockedMap();
    map[key(t, r.id)] = { updatedAt: r.updatedAt, message };
    await setSetting(SETTING_KEYS.syncBlocked, map);
    report.newlyBlocked++;
    if (report.newlyBlocked >= MAX_BLOCKED_PER_CYCLE) {
      throw new CycleAbort('too-many-blocked', 'O servidor recusou vários registros seguidos.');
    }
  }

  /** O servidor ignorou o envio (igual ou mais antigo que o dele). Se a versao dele e mais nova, ela passa a valer aqui. */
  async function resolveDropped(t: SyncTable, rows: Row[], who: Who, report: CycleReport) {
    if (t === 'trackPoints') return markSynced(t, rows, who); // ponto de trilha nao muda: reenvio igual
    const remoteRows = await remote.fetchByIds(REMOTE_TABLE[t], rows.map((r) => r.id));
    const byId = new Map(remoteRows.map((r) => [String(r.id), r]));
    const toMark: Row[] = [];
    for (const r of rows) {
      const s = byId.get(r.id);
      if (!s) continue; // sumiu do servidor?! fica pendente e tenta no proximo ciclo
      const sUpdated = Date.parse(String(s.updated_at));
      if (sUpdated > r.updatedAt) {
        const applied = await applyRemote(t, [s], who, { onlyIfLocalUpdatedAt: r.updatedAt });
        if (applied) report.lostEdits++;
      } else {
        toMark.push(r);
      }
    }
    await markSynced(t, toMark, who);
  }

  /** Sobe o arquivo de cada foto do lote. Devolve as que estao prontas para ter o registro enviado. */
  async function uploadPhotos(rows: Photo[], who: Who, report: CycleReport): Promise<Photo[]> {
    const ready: Photo[] = [];
    for (const p of rows) {
      if (p.deleted || p.storagePath) {
        ready.push(p); // excluida (so o registro) ou arquivo ja enviado numa tentativa anterior
        continue;
      }
      if (!p.blob) {
        await block('photos', p, 'arquivo da foto não encontrado neste aparelho', report);
        continue;
      }
      const path = photoPath(p.ownerId ?? who.userId, p.id);
      try {
        await remote.uploadFile(path, p.blob);
      } catch (e) {
        if (!(e instanceof SyncHttpError)) throw e;
        if (e.kind === 'permanent' || e.kind === 'dependency') {
          await block('photos', p, e.message, report); // ex.: arquivo grande demais, formato recusado
          continue;
        }
        throw new CycleAbort(e.kind === 'auth' ? 'auth' : e.kind === 'network' ? 'network' : 'server', e.message);
      }
      // Lembra que o arquivo ja esta la (sem mexer em updatedAt): se o registro falhar, a nova tentativa nao reenvia o arquivo.
      await db.photos.update(p.id, { storagePath: path });
      ready.push({ ...p, storagePath: path });
    }
    return ready;
  }

  async function pushRows(t: SyncTable, rows: Row[], who: Who, report: CycleReport): Promise<void> {
    if (!rows.length) return;
    // 1) traduzir; um registro com dado impossivel de traduzir e recusado sozinho, sem derrubar o lote
    const ok: Row[] = [];
    const payload: RemoteRow[] = [];
    for (const r of rows) {
      try {
        payload.push(toRemote(t, r));
        ok.push(r);
      } catch (e) {
        await block(t, r, e instanceof MappingError ? e.message : 'registro inválido', report);
      }
    }
    if (!ok.length) return;

    // 2) enviar
    let written: string[];
    try {
      ({ written } = await remote.upsert(REMOTE_TABLE[t], payload));
    } catch (e) {
      if (!(e instanceof SyncHttpError)) throw e;
      if (e.kind === 'permanent' || e.kind === 'dependency') {
        // O servidor recusa o lote inteiro por causa de UM registro: divide para achar qual.
        if (ok.length > 1) {
          const mid = Math.ceil(ok.length / 2);
          await pushRows(t, ok.slice(0, mid), who, report);
          await pushRows(t, ok.slice(mid), who, report);
          return;
        }
        if (e.kind === 'dependency') report.waiting++; // espera o registro de que depende; segue pendente
        else await block(t, ok[0]!, e.message, report);
        return;
      }
      throw new CycleAbort(e.kind === 'auth' ? 'auth' : e.kind === 'network' ? 'network' : 'server', e.message);
    }

    // 3) conferir o que foi gravado
    const writtenSet = new Set(written);
    await markSynced(t, ok.filter((r) => writtenSet.has(r.id)), who);
    report.pushed += ok.filter((r) => writtenSet.has(r.id)).length;
    const dropped = ok.filter((r) => !writtenSet.has(r.id));
    if (dropped.length) {
      try {
        await resolveDropped(t, dropped, who, report);
      } catch (e) {
        if (e instanceof SyncHttpError) throw new CycleAbort(e.kind === 'auth' ? 'auth' : e.kind === 'network' ? 'network' : 'server', e.message);
        throw e;
      }
      report.pushed += dropped.length;
    }
  }

  async function push(who: Who, report: CycleReport, progress?: (p: Progress) => void): Promise<void> {
    if (!canWrite(who)) return;
    const blocked = await blockedMap();
    const waitingActivities = new Set<string>(); // atividades que ainda nao subiram: os registros dela esperam
    for (const t of PUSH_ORDER) {
      const size = t === 'trackPoints' ? trackBatch : t === 'photos' ? photoBatch : pushBatch;
      const seen = new Set<string>();
      for (;;) {
        const batch = await table(t)
          .where('syncStatus')
          .equals('pending')
          .filter((r) => {
            if (seen.has(r.id) || !mine(r, who) || isBlocked(blocked, t, r)) return false;
            return t === 'activities' || !waitingActivities.has((r as NetworkElement).activityId);
          })
          .limit(size)
          .toArray();
        if (!batch.length) break;
        batch.forEach((r) => seen.add(r.id));
        // Foto: o ARQUIVO sobe primeiro; so depois o registro (que aponta para ele). Assim nunca existe registro sem arquivo.
        await pushRows(t, t === 'photos' ? await uploadPhotos(batch as Photo[], who, report) : batch, who, report);
        progress?.({ phase: 'enviando', done: report.pushed });
      }
      if (t === 'activities') {
        // quem continua pendente depois do envio (recusada ou esperando) segura os registros dela
        const stillPending = await db.activities.where('syncStatus').equals('pending').filter((a) => mine(a, who)).toArray();
        stillPending.forEach((a) => waitingActivities.add(a.id));
      }
    }
  }

  // ---------- baixar ----------

  /**
   * Grava no aparelho as linhas vindas do servidor. Regra: a versao com updatedAt mais recente vence.
   * Devolve quantas foram gravadas por cima de uma alteracao minha ainda nao enviada (alteracao perdida).
   */
  async function applyRemote(
    t: SyncTable,
    rows: RemoteRow[],
    who: Who,
    opts: { onlyIfLocalUpdatedAt?: number } = {},
  ): Promise<number> {
    if (t === 'trackPoints') return 0;
    let lost = 0;
    const incoming: Row[] = rows.map((row) => fromRemote(t, row));
    await db.transaction('rw', table(t), async () => {
      const current = await table(t).bulkGet(incoming.map((r) => r.id));
      const toPut: Row[] = [];
      incoming.forEach((inc, i) => {
        const cur = current[i];
        if (cur) {
          if (opts.onlyIfLocalUpdatedAt !== undefined && cur.updatedAt !== opts.onlyIfLocalUpdatedAt) return;
          if (inc.updatedAt <= cur.updatedAt) return; // o local e igual ou mais novo
          if (cur.syncStatus === 'pending' && mine(cur, who)) lost++; // minha alteracao perde para uma mais recente
          // o registro do servidor nao traz o arquivo: se ja o baixamos, continua aqui
          if (t === 'photos' && (cur as Photo).blob) (inc as Photo).blob = (cur as Photo).blob;
        }
        toPut.push(inc);
      });
      if (toPut.length) await table(t).bulkPut(toPut);
    });
    return lost;
  }

  async function pull(who: Who, report: CycleReport, progress?: (p: Progress) => void): Promise<void> {
    const cursors = await getSetting<Cursors>(SETTING_KEYS.syncCursor, {});
    for (const t of PULL_ORDER) {
      const cursor = cursors[t];
      const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : '1970-01-01T00:00:00Z';
      let after: { ts: string; id: string } | undefined;
      let newest = cursor;
      for (;;) {
        let rows: RemoteRow[];
        try {
          rows = await remote.pull(REMOTE_TABLE[t], { since, after, limit: pullPage });
        } catch (e) {
          if (e instanceof SyncHttpError) throw new CycleAbort(e.kind === 'auth' ? 'auth' : e.kind === 'network' ? 'network' : 'server', e.message);
          throw e;
        }
        if (!rows.length) break;
        report.lostEdits += await applyRemote(t, rows, who);
        report.pulled += rows.length;
        const last = rows[rows.length - 1]!;
        after = { ts: String(last.server_updated_at), id: String(last.id) };
        newest = after.ts;
        progress?.({ phase: 'baixando', done: report.pulled });
        if (rows.length < pullPage) break;
      }
      // Guarda o cursor a cada tabela concluida: uma queda no meio nao refaz o que ja foi baixado.
      if (newest && newest !== cursor) {
        cursors[t] = newest;
        await setSetting(SETTING_KEYS.syncCursor, { ...(await getSetting<Cursors>(SETTING_KEYS.syncCursor, {})), ...cursors });
      }
    }
  }

  /**
   * Um ciclo completo: envia o que e meu e baixa o que mudou. Lanca CycleAbort se nao deu para terminar.
   * `pull: false` = so enviar (e o que o service worker faz com o app fechado).
   */
  async function runCycle(who: Who, progress?: (p: Progress) => void, opts: { pull?: boolean } = {}): Promise<CycleReport> {
    const report: CycleReport = { pushed: 0, pulled: 0, lostEdits: 0, newlyBlocked: 0, waiting: 0 };
    await push(who, report, progress);
    if (opts.pull !== false) await pull(who, report, progress);
    return report;
  }

  return { counts, blockedList, clearBlocked, runCycle };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
