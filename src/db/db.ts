import Dexie, { type EntityTable } from 'dexie';
import type {
  Activity,
  BaseRecord,
  Cable,
  NetworkElement,
  Photo,
  SettingEntry,
  TrackPoint,
} from './types';

export class RotaFibraDB extends Dexie {
  activities!: EntityTable<Activity, 'id'>;
  elements!: EntityTable<NetworkElement, 'id'>;
  cables!: EntityTable<Cable, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  trackPoints!: EntityTable<TrackPoint, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;

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
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const entry = await db.settings.get(key);
  return entry ? (entry.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
