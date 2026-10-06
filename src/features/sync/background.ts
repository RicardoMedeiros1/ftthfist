import { SETTING_KEYS, type RotaFibraDB } from '../../db/db';
import { readAuthMirror, tokenUsable, type AuthMirror } from './authMirror';
import { CycleAbort, createSyncEngine, type Who } from './engine';
import { SyncHttpError, type RemoteApi } from './remote';

// Envio com o app FECHADO (service worker + Background Sync, so Chrome/Android; iPhone nao tem). Roda um ciclo so de
// ENVIO com o token que o app espelhou. Se o token ja venceu, nao tenta renovar (ver authMirror.ts): avisa por
// notificacao para o tecnico abrir o app. Aqui ficam as decisoes; o service worker so liga os eventos.

export const BG_SYNC_TAG = 'rotafibra-envio';
/** Trava (Web Locks) compartilhada com o app: nunca dois ciclos ao mesmo tempo. */
export const SYNC_LOCK = 'rotafibra-sync';
export const BUSY = Symbol('ocupado');

export type BackgroundOutcome = 'nada' | 'enviado' | 'ocupado' | 'avisou' | 'tentar-depois';

export interface Notice {
  title: string;
  body: string;
  /** Mesma etiqueta substitui o aviso anterior (nao empilha). */
  tag: string;
}

export interface BackgroundDeps {
  db: RotaFibraDB;
  now(): number;
  makeRemote(mirror: AuthMirror): RemoteApi;
  /** Roda `fn` se ninguem mais estiver sincronizando; senao devolve BUSY. */
  exclusive<T>(fn: () => Promise<T>): Promise<T | typeof BUSY>;
  notify(n: Notice): Promise<void>;
}

/** A trava (Web Locks) que impede o app e o service worker de sincronizarem ao mesmo tempo. Sem Web Locks, so roda. */
export async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | typeof BUSY> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request(SYNC_LOCK, { ifAvailable: true }, async (lock) => (lock ? fn() : BUSY));
}

const unusable: RemoteApi = (() => {
  const fail = async (): Promise<never> => {
    throw new SyncHttpError('auth', 'sem token valido', 401, '');
  };
  return { upsert: fail, pull: fail, fetchByIds: fail, uploadFile: fail, downloadFile: fail };
})();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const TAG_PENDING = 'rotafibra-pendentes';
const TAG_BLOCKED = 'rotafibra-recusados';

/** O pedaco do perfil guardado pelo app (accountProfile) que interessa aqui. */
interface StoredProfile {
  id: string;
  role: Who['role'];
  active: boolean;
}

/** Quem esta logado neste aparelho, se ja foi aprovado. Vem do que o app guardou (o service worker nao fala com o servidor para isso). */
async function whoFromStorage(db: RotaFibraDB): Promise<Who | null> {
  const account = (await db.settings.get(SETTING_KEYS.account))?.value as { userId: string } | null | undefined;
  const profile = (await db.settings.get(SETTING_KEYS.accountProfile))?.value as StoredProfile | null | undefined;
  if (!account || !profile || profile.id !== account.userId || !profile.active) return null;
  return { userId: account.userId, role: profile.role };
}

export async function runBackgroundSync(deps: BackgroundDeps): Promise<BackgroundOutcome> {
  const who = await whoFromStorage(deps.db);
  if (!who) return 'nada';

  const mirror = await readAuthMirror(deps.db);
  const usable = tokenUsable(mirror, deps.now()) && mirror.userId === who.userId;
  const engine = createSyncEngine({ db: deps.db, remote: usable ? deps.makeRemote(mirror!) : unusable, now: deps.now });

  const { pending } = await engine.counts(who);
  if (pending === 0) return 'nada';

  const askToOpen = async () => {
    await deps.notify({
      title: 'RotaFibra',
      body: `${plural(pending, 'registro aguardando envio', 'registros aguardando envio')}. Abra o app para enviar.`,
      tag: TAG_PENDING,
    });
    return 'avisou' as const;
  };
  if (!usable) return askToOpen(); // token vencido: so o app consegue renovar a sessao

  try {
    const done = await deps.exclusive(() => engine.runCycle(who, undefined, { pull: false }));
    if (done === BUSY) return 'ocupado';
  } catch (e) {
    if (e instanceof CycleAbort && (e.reason === 'auth' || e.reason === 'too-many-blocked')) return askToOpen();
    if (e instanceof CycleAbort) return 'tentar-depois'; // sem conexao ou servidor com problema: o navegador repete depois
    throw e;
  }

  const after = await engine.counts(who);
  if (after.blocked > 0) {
    await deps.notify({
      title: 'RotaFibra',
      body: `${plural(after.blocked, 'registro foi recusado', 'registros foram recusados')} pelo servidor. Abra o app e veja em Sincronização.`,
      tag: TAG_BLOCKED,
    });
    return 'avisou';
  }
  return 'enviado';
}
