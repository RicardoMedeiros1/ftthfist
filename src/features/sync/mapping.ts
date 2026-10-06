import type { Activity, BaseRecord, Cable, NetworkElement, TrackPoint } from '../../db/types';
import type { SyncTable } from './tables';

// Tradução entre o registro local (camelCase, tempo em ms) e a linha do servidor (snake_case, ISO 8601).
// O app NUNCA envia: owner_id (o servidor decide), geom (calculada la), server_updated_at (relogio do servidor).

export type RemoteRow = Record<string, unknown>;

export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MappingError';
  }
}

const iso = (ms: number, what: string): string => {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) throw new MappingError(`data inválida em "${what}"`);
  return d.toISOString();
};
const parseMs = (v: unknown, what: string): number => {
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new MappingError(`data inválida em "${what}"`);
  return t;
};

function common(r: BaseRecord): RemoteRow {
  return {
    id: r.id,
    created_by: r.createdBy,
    created_at: iso(r.createdAt, 'createdAt'),
    updated_at: iso(r.updatedAt, 'updatedAt'),
    deleted: r.deleted,
  };
}

function fromCommon(row: RemoteRow): BaseRecord {
  return {
    id: String(row.id),
    createdAt: parseMs(row.created_at, 'created_at'),
    updatedAt: parseMs(row.updated_at, 'updated_at'),
    createdBy: String(row.created_by ?? ''),
    deleted: row.deleted === true,
    syncStatus: 'synced',
    ...(row.owner_id ? { ownerId: String(row.owner_id) } : {}),
  };
}

type Local = Activity | NetworkElement | Cable | TrackPoint;

export function toRemote(table: SyncTable, r: Local): RemoteRow {
  switch (table) {
    case 'activities': {
      const a = r as Activity;
      return {
        ...common(a),
        kind: a.kind,
        title: a.title,
        os_number: a.osNumber ?? null,
        technician: a.technician,
        started_at: iso(a.startedAt, 'startedAt'),
        ended_at: a.endedAt === undefined ? null : iso(a.endedAt, 'endedAt'),
        status: a.status,
        description: a.description,
        materials: a.materials,
      };
    }
    case 'elements': {
      const e = r as NetworkElement;
      return {
        ...common(e),
        activity_id: e.activityId,
        type: e.type,
        lat: e.lat,
        lng: e.lng,
        accuracy_m: e.accuracy ?? null,
        position_source: e.positionSource,
        code: e.code,
        notes: e.notes,
        attrs: e.attrs,
      };
    }
    case 'cables': {
      const c = r as Cable;
      return {
        ...common(c),
        activity_id: c.activityId,
        cable_type: c.cableType,
        fiber_count: c.fiberCount,
        vertices: c.vertices,
        length_m: c.lengthMeters,
        reserve_m: c.reserveMeters,
        total_m: c.totalMeters,
        notes: c.notes,
      };
    }
    case 'trackPoints': {
      const t = r as TrackPoint;
      return {
        ...common(t),
        activity_id: t.activityId,
        lat: t.lat,
        lng: t.lng,
        accuracy_m: t.accuracy,
        ts: iso(t.timestamp, 'timestamp'),
        speed: t.speed ?? null,
        segment: t.segment ?? 0,
      };
    }
  }
}

/** Linha do servidor -> registro local (já "synced"). A trilha não é baixada, então não há tradução dela. */
export function fromRemote(table: 'activities', row: RemoteRow): Activity;
export function fromRemote(table: 'elements', row: RemoteRow): NetworkElement;
export function fromRemote(table: 'cables', row: RemoteRow): Cable;
export function fromRemote(table: 'activities' | 'elements' | 'cables', row: RemoteRow): Activity | NetworkElement | Cable;
export function fromRemote(table: 'activities' | 'elements' | 'cables', row: RemoteRow): Activity | NetworkElement | Cable {
  const base = fromCommon(row);
  switch (table) {
    case 'activities':
      return {
        ...base,
        kind: row.kind as Activity['kind'],
        title: String(row.title ?? ''),
        ...(row.os_number != null ? { osNumber: String(row.os_number) } : {}),
        technician: String(row.technician ?? ''),
        startedAt: parseMs(row.started_at, 'started_at'),
        ...(row.ended_at != null ? { endedAt: parseMs(row.ended_at, 'ended_at') } : {}),
        status: row.status as Activity['status'],
        description: String(row.description ?? ''),
        materials: Array.isArray(row.materials) ? (row.materials as Activity['materials']) : [],
      };
    case 'elements':
      return {
        ...base,
        activityId: String(row.activity_id),
        type: row.type as NetworkElement['type'],
        lat: Number(row.lat),
        lng: Number(row.lng),
        ...(row.accuracy_m != null ? { accuracy: Number(row.accuracy_m) } : {}),
        positionSource: row.position_source as NetworkElement['positionSource'],
        code: String(row.code ?? ''),
        notes: String(row.notes ?? ''),
        attrs: (row.attrs && typeof row.attrs === 'object' ? row.attrs : {}) as NetworkElement['attrs'],
      };
    case 'cables':
      return {
        ...base,
        activityId: String(row.activity_id),
        cableType: String(row.cable_type ?? ''),
        fiberCount: Number(row.fiber_count) as Cable['fiberCount'],
        vertices: Array.isArray(row.vertices) ? (row.vertices as Cable['vertices']) : [],
        lengthMeters: Number(row.length_m),
        reserveMeters: Number(row.reserve_m),
        totalMeters: Number(row.total_m),
        notes: String(row.notes ?? ''),
      };
  }
}
