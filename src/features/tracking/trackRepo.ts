import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { TrackPoint } from '../../db/types';

export interface NewTrackPoint {
  activityId: string;
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number;
  segment: number;
}

export function trackRepo(database: RotaFibraDB = db) {
  return {
    /** Pontos da atividade (sem os excluídos), por horário. */
    async listFor(activityId: string): Promise<TrackPoint[]> {
      const all = await database.trackPoints
        .where('activityId')
        .equals(activityId)
        .filter((p) => !p.deleted)
        .toArray();
      return all.sort((a, b) => a.timestamp - b.timestamp);
    },

    async add(p: NewTrackPoint, createdBy: string): Promise<TrackPoint> {
      const row: TrackPoint = {
        ...newBase(createdBy),
        activityId: p.activityId,
        lat: p.lat,
        lng: p.lng,
        accuracy: p.accuracy,
        timestamp: p.timestamp,
        ...(p.speed !== undefined ? { speed: p.speed } : {}),
        segment: p.segment,
      };
      await database.trackPoints.add(row);
      return row;
    },

    /** Número do próximo trecho: continua depois do último já gravado nesta atividade. */
    async nextSegment(activityId: string): Promise<number> {
      const pts = await this.listFor(activityId);
      return pts.length === 0 ? 0 : Math.max(...pts.map((p) => p.segment ?? 0)) + 1;
    },

    /** Exclusão lógica de toda a trilha da atividade. */
    async clear(activityId: string): Promise<number> {
      const now = Date.now();
      return database.trackPoints
        .where('activityId')
        .equals(activityId)
        .filter((p) => !p.deleted)
        .modify((p) => {
          Object.assign(p, touch<TrackPoint>({ deleted: true }, now));
        });
    },
  };
}

export const trackStore = trackRepo();
