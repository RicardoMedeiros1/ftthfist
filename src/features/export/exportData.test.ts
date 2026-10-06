import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import type { Cable, TrackPoint } from '../../db/types';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { collectExportData, exportFileName, summarizeExport, trackDurationMs } from './exportData';

let db: RotaFibraDB;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
});

const jpeg = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });
const base = (extra: object) => ({ id: crypto.randomUUID(), createdAt: 5, updatedAt: 5, createdBy: 'Carlos', deleted: false, syncStatus: 'pending', ...extra });
const cable = (activityId: string, extra: Partial<Cable> = {}): Cable =>
  base({
    cableType: 'AS-80', fiberCount: 12, vertices: [{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.63 }],
    lengthMeters: 111, reserveMeters: 10, totalMeters: 121, activityId, notes: '', ...extra,
  }) as Cable;
const tp = (activityId: string, timestamp: number, extra: Partial<TrackPoint> = {}): TrackPoint =>
  base({ activityId, lat: -23.55 - timestamp / 1e6, lng: -46.63, accuracy: 8, timestamp, ...extra }) as TrackPoint;

async function seed() {
  const acts = activityRepo(db);
  const els = elementRepo(db);
  const a1 = await acts.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
  const p1 = await els.create({ type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps', code: 'P-1' }, 'Carlos', [
    { blob: jpeg(1, 2, 3), takenAt: 20 },
    { blob: jpeg(4, 5), takenAt: 10 },
  ]);
  await acts.complete(a1.id);
  const a2 = await acts.create({ kind: 'manutencao', title: 'Rua B' }, 'Carlos');
  const p2 = await els.create({ type: 'cto', lat: -23.56, lng: -46.64, positionSource: 'manual', code: 'C-1' }, 'Carlos');
  await db.cables.bulkAdd([cable(a1.id), cable(a2.id)]);
  await db.trackPoints.bulkAdd([tp(a1.id, 3000), tp(a1.id, 1000), tp(a2.id, 2000)]);
  return { a1, a2, p1, p2 };
}

describe('collectExportData', () => {
  it('rede inteira: tudo que não foi excluído, com trilhas ordenadas e fotos por elemento', async () => {
    const { a1, p1 } = await seed();
    const d = await collectExportData(db, { kind: 'network' }, { now: 99, appVersion: 'abc' });
    expect(d.title).toBe('Rede inteira');
    expect(d.generatedAt).toBe(99);
    expect(d.elements).toHaveLength(2);
    expect(d.cables).toHaveLength(2);
    expect(d.tracks).toHaveLength(2);
    expect(d.tracks.find((t) => t.activity.id === a1.id)!.points.map((p) => p.timestamp)).toEqual([1000, 3000]);
    expect(d.photosByElement.get(p1.id)!.map((p) => p.takenAt)).toEqual([10, 20]);
  });

  it('uma atividade: só o que pertence a ela', async () => {
    const { a1 } = await seed();
    const d = await collectExportData(db, { kind: 'activity', activityId: a1.id });
    expect(d.title).toBe('Rua A');
    expect(d.elements.map((e) => e.code)).toEqual(['P-1']);
    expect(d.cables).toHaveLength(1);
    expect(d.tracks.map((t) => t.activity.id)).toEqual([a1.id]);
  });

  it('ignora registros excluídos (elemento, cabo, ponto da trilha, foto)', async () => {
    const { a1, p1 } = await seed();
    const [ph] = await db.photos.toArray();
    await db.photos.update(ph!.id, { deleted: true });
    const [c] = await db.cables.toArray();
    await db.cables.update(c!.id, { deleted: true });
    const [t] = await db.trackPoints.toArray();
    await db.trackPoints.update(t!.id, { deleted: true });
    await db.elements.update(p1.id, { deleted: true });
    const d = await collectExportData(db, { kind: 'network' });
    expect(d.elements.map((e) => e.code)).toEqual(['C-1']);
    expect(d.cables).toHaveLength(1);
    expect(d.photosByElement.size).toBe(0);
    expect(d.tracks.reduce((s, x) => s + x.points.length, 0)).toBe(2);
    expect(a1.id).toBeTruthy();
  });

  it('atividade excluída não pode ser exportada e some da rede inteira', async () => {
    const { a1 } = await seed();
    await db.activities.update(a1.id, { deleted: true });
    await expect(collectExportData(db, { kind: 'activity', activityId: a1.id })).rejects.toThrow(/não encontrada/i);
    const d = await collectExportData(db, { kind: 'network' });
    expect(d.tracks.map((t) => t.activity.id)).not.toContain(a1.id);
  });

  it('banco vazio gera uma coleta vazia', async () => {
    const d = await collectExportData(db, { kind: 'network' });
    expect(summarizeExport(d)).toMatchObject({ elements: 0, cables: 0, photos: 0, trackPoints: 0, cableMeters: 0 });
  });
});

describe('summarizeExport', () => {
  it('conta fotos, bytes, metros de cabo e km da trilha', async () => {
    await seed();
    const s = summarizeExport(await collectExportData(db, { kind: 'network' }));
    expect(s).toMatchObject({ elements: 2, cables: 2, photos: 2, photoBytes: 5, cableMeters: 242, trackPoints: 3 });
    expect(s.trackKm).toBeGreaterThan(0);
  });
});

describe('trackDurationMs', () => {
  it('soma cada trecho e ignora o intervalo entre trechos', () => {
    const p = (timestamp: number, segment: number) => tp('a', timestamp, { segment });
    expect(trackDurationMs([p(0, 0), p(10_000, 0), p(100_000, 1), p(130_000, 1)])).toBe(40_000);
    expect(trackDurationMs([])).toBe(0);
  });
});

describe('exportFileName', () => {
  it('sem acentos, só minúsculas e hífen, com data e hora', () => {
    expect(exportFileName('Poste caído — Rua São João!', 'kmz', new Date(2026, 9, 6, 9, 5))).toBe(
      'rotafibra-poste-caido-rua-sao-joao-2026-10-06-0905.kmz',
    );
  });
  it('título vazio ou só símbolos cai num nome padrão', () => {
    expect(exportFileName('???', 'geojson', new Date(2026, 0, 2, 13, 45))).toBe('rotafibra-exportacao-2026-01-02-1345.geojson');
  });
  it('título enorme é cortado', () => {
    expect(exportFileName('a'.repeat(200), 'kmz', new Date(2026, 0, 1)).length).toBeLessThan(80);
  });
});
