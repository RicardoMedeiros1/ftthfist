import { cableStyle } from '../cables/style';
import { ELEMENT_META } from '../elements/meta';
import { groupSegments, trackDistanceMeters } from '../tracking/trackStats';
import type { ExportData } from './exportData';

export const GEOJSON_MIME = 'application/geo+json';

type Position = [number, number];
interface Feature {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

const lonLat = (p: { lat: number; lng: number }): Position => [p.lng, p.lat];
const iso = (ms: number) => new Date(ms).toISOString();

/** FeatureCollection com elementos (Point), cabos (LineString) e trilhas (MultiLineString). */
export function buildGeoJson(d: ExportData): string {
  const features: Feature[] = [];

  for (const e of d.elements) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: lonLat(e) },
      properties: {
        kind: 'element',
        id: e.id,
        type: e.type,
        typeLabel: ELEMENT_META[e.type].label,
        code: e.code,
        notes: e.notes,
        attrs: e.attrs,
        accuracyMeters: e.accuracy ?? null,
        positionSource: e.positionSource,
        activityId: e.activityId,
        activity: d.activities.get(e.activityId)?.title ?? null,
        createdBy: e.createdBy,
        createdAt: iso(e.createdAt),
        photos: d.photosByElement.get(e.id)?.length ?? 0,
      },
    });
  }

  for (const c of d.cables) {
    const style = cableStyle(c.fiberCount);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c.vertices.map(lonLat) },
      properties: {
        kind: 'cable',
        id: c.id,
        cableType: c.cableType,
        fiberCount: c.fiberCount,
        lengthMeters: c.lengthMeters,
        reserveMeters: c.reserveMeters,
        totalMeters: c.totalMeters,
        notes: c.notes,
        activityId: c.activityId,
        activity: d.activities.get(c.activityId)?.title ?? null,
        createdBy: c.createdBy,
        createdAt: iso(c.createdAt),
        stroke: style.color,
      },
    });
  }

  for (const t of d.tracks) {
    const segs = groupSegments(t.points).filter((s) => s.length >= 2);
    if (segs.length === 0) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'MultiLineString', coordinates: segs.map((s) => s.map(lonLat)) },
      properties: {
        kind: 'track',
        activityId: t.activity.id,
        activity: t.activity.title,
        distanceMeters: Math.round(trackDistanceMeters(t.points) * 100) / 100,
        points: t.points.length,
        segments: segs.length,
      },
    });
  }

  return JSON.stringify({ type: 'FeatureCollection', features });
}
