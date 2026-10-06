import type { RotaFibraDB } from '../../db/db';
import type { Activity, Cable, NetworkElement, Photo, TrackPoint } from '../../db/types';
import { trackDistanceMeters, groupSegments } from '../tracking/trackStats';

export type ExportScope = { kind: 'activity'; activityId: string } | { kind: 'network' };

export interface ExportData {
  /** Nome para o documento e o arquivo: título da atividade ou "Rede inteira". */
  title: string;
  scope: ExportScope;
  generatedAt: number;
  appVersion: string;
  activities: Map<string, Activity>;
  elements: NetworkElement[];
  cables: Cable[];
  /** Trilhas por atividade (só as que têm pontos). */
  tracks: { activity: Activity; points: TrackPoint[] }[];
  /** Fotos (não excluídas) dos elementos exportados, por elemento. */
  photosByElement: Map<string, Photo[]>;
}

/** Reúne o que será exportado, sem os registros excluídos logicamente. */
export async function collectExportData(
  database: RotaFibraDB,
  scope: ExportScope,
  opts: { appVersion?: string; now?: number } = {},
): Promise<ExportData> {
  const inScope = (activityId: string) => scope.kind === 'network' || activityId === scope.activityId;

  const allActivities = (await database.activities.toArray()).filter((a) => !a.deleted);
  const activities = new Map(allActivities.map((a) => [a.id, a]));
  if (scope.kind === 'activity' && !activities.has(scope.activityId)) {
    throw new Error('Atividade não encontrada.');
  }

  const elements = (await database.elements.toArray()).filter((e) => !e.deleted && inScope(e.activityId));
  const cables = (await database.cables.toArray()).filter((c) => !c.deleted && inScope(c.activityId));

  const allPoints = (await database.trackPoints.toArray()).filter((p) => !p.deleted && inScope(p.activityId));
  const byActivity = new Map<string, TrackPoint[]>();
  for (const p of allPoints) {
    const list = byActivity.get(p.activityId);
    if (list) list.push(p);
    else byActivity.set(p.activityId, [p]);
  }
  const tracks = [...byActivity.entries()]
    .flatMap(([id, points]) => {
      const activity = activities.get(id);
      return activity ? [{ activity, points: points.sort((a, b) => a.timestamp - b.timestamp) }] : [];
    })
    .sort((a, b) => a.activity.startedAt - b.activity.startedAt);

  const ids = new Set(elements.map((e) => e.id));
  const photosByElement = new Map<string, Photo[]>();
  for (const ph of (await database.photos.toArray()).filter((p) => !p.deleted && p.elementId && ids.has(p.elementId))) {
    const list = photosByElement.get(ph.elementId!);
    if (list) list.push(ph);
    else photosByElement.set(ph.elementId!, [ph]);
  }
  for (const list of photosByElement.values()) list.sort((a, b) => a.takenAt - b.takenAt);

  return {
    title: scope.kind === 'network' ? 'Rede inteira' : activities.get(scope.activityId)!.title,
    scope,
    generatedAt: opts.now ?? Date.now(),
    appVersion: opts.appVersion ?? 'dev',
    activities,
    elements,
    cables,
    tracks,
    photosByElement,
  };
}

export interface ExportSummary {
  elements: number;
  cables: number;
  trackKm: number;
  trackPoints: number;
  photos: number;
  photoBytes: number;
  cableMeters: number;
}

export function summarizeExport(d: ExportData): ExportSummary {
  let photos = 0;
  let photoBytes = 0;
  for (const list of d.photosByElement.values()) {
    for (const p of list) {
      photos++;
      photoBytes += p.blob.size;
    }
  }
  return {
    elements: d.elements.length,
    cables: d.cables.length,
    trackKm: d.tracks.reduce((s, t) => s + trackDistanceMeters(t.points), 0) / 1000,
    trackPoints: d.tracks.reduce((s, t) => s + t.points.length, 0),
    photos,
    photoBytes,
    cableMeters: d.cables.reduce((s, c) => s + c.totalMeters, 0),
  };
}

/** Duração de uma trilha: soma de cada trecho (do primeiro ao último ponto), sem os intervalos entre trechos. */
export function trackDurationMs(points: TrackPoint[]): number {
  return groupSegments(points).reduce((sum, seg) => sum + (seg.length > 1 ? seg[seg.length - 1]!.timestamp - seg[0]!.timestamp : 0), 0);
}

/** "rotafibra-rua-a-2026-10-06-0912.kmz": sem acentos, só letras/números/hífen. */
export function exportFileName(title: string, ext: string, d: Date): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'exportacao';
  const p = (n: number) => String(n).padStart(2, '0');
  return `rotafibra-${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
