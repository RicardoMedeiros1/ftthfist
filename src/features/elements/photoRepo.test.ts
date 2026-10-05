import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from './elementRepo';
import { PhotoRuleError, photoRepo } from './photoRepo';

let db: RotaFibraDB;
let photos: ReturnType<typeof photoRepo>;
let elements: ReturnType<typeof elementRepo>;
let acts: ReturnType<typeof activityRepo>;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  photos = photoRepo(db);
  elements = elementRepo(db);
  acts = activityRepo(db);
});

const jpeg = (t = 'x') => new Blob([t], { type: 'image/jpeg' });
const gps = { type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps' } as const;

describe('fotos', () => {
  it('adiciona a um elemento existente, herdando atividade e posição', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await elements.create(gps, 'J');
    const p = await photos.add(e.id, { blob: jpeg() }, ' Maria ');
    expect(p).toMatchObject({ elementId: e.id, activityId: a.id, lat: e.lat, lng: e.lng, createdBy: 'Maria', syncStatus: 'pending', deleted: false });
    expect((await db.photos.get(p.id))?.blob).toBeInstanceOf(Blob);
  });

  it('não adiciona a elemento inexistente nem excluído', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await elements.create(gps, 'J');
    await elements.remove(e.id);
    for (const id of ['nao-existe', e.id]) {
      const err = await photos.add(id, { blob: jpeg() }, 'J').then(() => null, (x: unknown) => x);
      expect(err).toBeInstanceOf(PhotoRuleError);
    }
    expect(await db.photos.count()).toBe(0);
  });

  it('lista da mais antiga para a mais nova, sem as excluídas', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await elements.create(gps, 'J');
    const b = await photos.add(e.id, { blob: jpeg('b'), takenAt: 200 }, 'J');
    const a = await photos.add(e.id, { blob: jpeg('a'), takenAt: 100 }, 'J');
    const c = await photos.add(e.id, { blob: jpeg('c'), takenAt: 300 }, 'J');
    expect((await photos.listFor(e.id)).map((p) => p.id)).toEqual([a.id, b.id, c.id]);
    await photos.remove(b.id);
    expect((await photos.listFor(e.id)).map((p) => p.id)).toEqual([a.id, c.id]);
    expect(await db.photos.count()).toBe(3); // exclusão lógica
    expect((await db.photos.get(b.id))?.syncStatus).toBe('pending');
  });

  it('remover foto inexistente ou já removida dá erro', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await elements.create(gps, 'J');
    const p = await photos.add(e.id, { blob: jpeg() }, 'J');
    await photos.remove(p.id);
    for (const id of [p.id, 'nao-existe']) {
      const err = await photos.remove(id).then(() => null, (x: unknown) => x);
      expect(err).toBeInstanceOf(PhotoRuleError);
    }
  });
});
