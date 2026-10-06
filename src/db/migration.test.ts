import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { RotaFibraDB } from './db';

// O esquema da v1, congelado aqui: é o que os aparelhos que já usam o app têm gravado.
function openV1(name: string) {
  const old = new Dexie(name);
  old.version(1).stores({
    activities: 'id, status, kind, updatedAt, syncStatus',
    elements: 'id, activityId, type, updatedAt, syncStatus',
    cables: 'id, activityId, updatedAt, syncStatus',
    photos: 'id, elementId, activityId, updatedAt, syncStatus',
    trackPoints: 'id, activityId, timestamp, syncStatus',
    settings: 'key',
  });
  return old;
}

const base = (id: string) => ({ id, createdAt: 1, updatedAt: 1, createdBy: 'Carlos', deleted: false, syncStatus: 'pending' });

describe('migração do banco local (v1 → v2)', () => {
  it('mantém tudo o que já estava gravado e abre as tabelas novas vazias', async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const old = openV1(name);
    const rows = {
      activities: { ...base('a1'), kind: 'implantacao', title: 'Rua A', technician: 'Carlos', startedAt: 1, status: 'aberta', description: '', materials: [] },
      elements: { ...base('e1'), type: 'poste', lat: -23.5, lng: -46.6, accuracy: 8, positionSource: 'gps', code: 'P-1', notes: '', activityId: 'a1', attrs: { owner: 'proprio' } },
      cables: { ...base('c1'), cableType: 'AS-80', fiberCount: 12, vertices: [{ lat: 1, lng: 2 }], lengthMeters: 10, reserveMeters: 0, totalMeters: 10, activityId: 'a1', notes: '' },
      photos: { ...base('p1'), blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), takenAt: 5, elementId: 'e1', activityId: 'a1' },
      trackPoints: { ...base('t1'), activityId: 'a1', lat: 1, lng: 2, accuracy: 9, timestamp: 7, segment: 1 },
      settings: { key: 'technician', value: 'Carlos' },
    } as const;
    for (const [table, row] of Object.entries(rows)) await old.table(table).add(row);
    old.close();

    const db = new RotaFibraDB(name);
    await db.open();
    expect(db.verno).toBe(2);
    for (const table of ['activities', 'elements', 'cables', 'trackPoints', 'settings'] as const) {
      const [got] = await db[table].toArray();
      expect(got).toEqual((rows as Record<string, unknown>)[table]);
    }
    const [photo] = await db.photos.toArray();
    expect(photo).toMatchObject({ id: 'p1', takenAt: 5, elementId: 'e1' });
    expect(Array.from(new Uint8Array(await photo!.blob!.arrayBuffer()))).toEqual([1, 2, 3]);

    // índices antigos continuam funcionando
    expect(await db.activities.where('status').equals('aberta').count()).toBe(1);
    expect(await db.elements.where('activityId').equals('a1').count()).toBe(1);

    // tabelas novas: vazias e utilizáveis
    expect(await db.referenceLayers.count()).toBe(0);
    expect(await db.referenceFeatures.count()).toBe(0);
    await db.referenceFeatures.add({ id: 'L:0', layerId: 'L', n: 0, name: 'x', description: '', props: [], geom: { kind: 'point', coord: [1, 2] } });
    expect(await db.referenceFeatures.where('layerId').equals('L').count()).toBe(1);
    db.close();
  });

  it('abrir de novo (já na v2) não altera nada', async () => {
    const name = `mig-${crypto.randomUUID()}`;
    const first = new RotaFibraDB(name);
    await first.open();
    await first.settings.put({ key: 'technician', value: 'Ana' });
    first.close();
    const again = new RotaFibraDB(name);
    await again.open();
    expect(await again.settings.get('technician')).toEqual({ key: 'technician', value: 'Ana' });
    again.close();
  });

  it('banco novo (sem nada antes) já nasce na v2', async () => {
    const db = new RotaFibraDB(`mig-${crypto.randomUUID()}`);
    await db.open();
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['activities', 'cables', 'elements', 'photos', 'referenceFeatures', 'referenceLayers', 'settings', 'trackPoints'],
    );
    db.close();
  });
});
