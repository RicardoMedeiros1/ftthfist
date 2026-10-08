import Dexie, { type EntityTable } from 'dexie';
import type {
  Activity,
  BaseRecord,
  Cable,
  NetworkElement,
  Photo,
  Project,
  ReferenceFeature,
  ReferenceLayer,
  SettingEntry,
  TrackPoint,
} from './types';
import { actingUserId } from '../lib/ownership';

export class RotaFibraDB extends Dexie {
  activities!: EntityTable<Activity, 'id'>;
  elements!: EntityTable<NetworkElement, 'id'>;
  cables!: EntityTable<Cable, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  trackPoints!: EntityTable<TrackPoint, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;
  referenceLayers!: EntityTable<ReferenceLayer, 'id'>;
  referenceFeatures!: EntityTable<ReferenceFeature, 'id'>;
  projects!: EntityTable<Project, 'id'>;

  constructor(name = 'rotafibra') {
    super(name);
    // IndexedDB não indexa booleanos: `deleted` é filtrado em código.
    // Cabos e trilhas só são usados a partir da Fase 1B, mas as tabelas já existem
    // para não exigir migração depois.
    this.version(1).stores({
      activities: 'id, status, kind, updatedAt, syncStatus',
      elements: 'id, activityId, type, updatedAt, syncStatus',
      cables: 'id, activityId, updatedAt, syncStatus',
      photos: 'id, elementId, activityId, updatedAt, syncStatus',
      trackPoints: 'id, activityId, timestamp, syncStatus',
      settings: 'key',
    });
    // v2: camadas de referência importadas (KML/KMZ). Só tabelas novas: o que já está gravado não muda.
    this.version(2).stores({
      referenceLayers: 'id, updatedAt',
      referenceFeatures: 'id, layerId',
    });
    // v3: projetos designados (copia do servidor, so leitura). Tabela nova: o que ja esta gravado nao muda.
    this.version(3).stores({
      projects: 'id, assignedTo, updatedAt',
    });
  }
}

export const db = new RotaFibraDB();

/** Campos comuns para um registro novo. */
export function newBase(createdBy: string, now = Date.now()): BaseRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    createdBy,
    deleted: false,
    syncStatus: 'pending',
    ...(actingUserId() ? { ownerId: actingUserId()! } : {}),
  };
}

/** Marca o registro como alterado localmente (entra na fila de sincronização da Fase 2). */
export function touch<T extends BaseRecord>(patch: Partial<T>, now = Date.now()): Partial<T> {
  return { ...patch, updatedAt: now, syncStatus: 'pending' };
}

// ---- Configurações ----

export const SETTING_KEYS = {
  technician: 'technician',
  mapView: 'mapView',
  baseLayer: 'baseLayer',
  lastBackupAt: 'lastBackupAt',
  backupDismissedAt: 'backupDismissedAt',
  cableTypes: 'cableTypes',
  cableDraft: 'cableDraft',
  lastCable: 'lastCable',
  // último tipo e fibras usados num ramal (o "Derivar" já abre com eles marcados)
  lastBranch: 'lastBranch',
  trackState: 'trackState',
  // conta (Fase 2): quem esta logado neste aparelho e o ultimo perfil conhecido (para funcionar sem internet)
  account: 'account',
  accountProfile: 'accountProfile',
  // este aparelho ja teve uma conta (define se a tela de acesso abre em "Pedir acesso" ou em "Entrar")
  accountSeen: 'accountSeen',
  // erros de acesso seguidos e ate quando o aparelho esta travado (attemptLimiter)
  authAttempts: 'authAttempts',
  // primeira conta que usou o aparelho: dona dos registros feitos antes de existir login
  deviceOwner: 'deviceOwner',
  // sincronizacao (Fase 2): ate onde ja baixamos de cada tabela, registros que o servidor recusou, ultimo resultado
  syncCursor: 'syncCursor',
  syncBlocked: 'syncBlocked',
  syncLast: 'syncLast',
  // copia do token de ACESSO (nunca o de renovacao) e do endereco do servidor, para o service worker enviar com o app fechado
  authMirror: 'authMirror',
  // padrao de cores das fibras usado nos cabos novos ('abnt' ou 'tia598')
  colorStandard: 'colorStandard',
  // camada "Projetado" (desenho dos projetos) ligada ou desligada no mapa do tecnico
  plannedVisible: 'plannedVisible',
  // nomes das pessoas (id -> nome do cadastro), guardados quando ha internet para o painel mostrar o tecnico de um projeto sem rede
  profileNames: 'profileNames',
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const entry = await db.settings.get(key);
  return entry ? (entry.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
