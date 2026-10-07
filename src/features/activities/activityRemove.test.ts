import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB, newBase } from '../../db/db';
import type { TrackPoint } from '../../db/types';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { cableRepo } from '../cables/cableRepo';
import { elementRepo } from '../elements/elementRepo';
import { photoRepo } from '../elements/photoRepo';
import { ActivityRuleError, activityRepo } from './activityRepo';

let db: RotaFibraDB;
let acts: ReturnType<typeof activityRepo>;
let els: ReturnType<typeof elementRepo>;
let cables: ReturnType<typeof cableRepo>;
let photos: ReturnType<typeof photoRepo>;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  acts = activityRepo(db);
  els = elementRepo(db);
  cables = cableRepo(db);
  photos = photoRepo(db);
});
afterEach(() => { setActingUser(null); setActingRole(null); });

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ActivityRuleError | null)?.code;
const pos = (n: number) => ({ lat: -23.55 - n * 0.0003, lng: -46.63, accuracy: 4, positionSource: 'gps' as const });

/** Uma atividade com 2 postes, 1 cabo, 2 fotos e 3 pontos de trilha. */
async function work(who: string, title = 'Rua A') {
  const act = await acts.create({ kind: 'implantacao', title }, who);
  const p1 = await els.create({ type: 'poste', ...pos(0) }, who);
  const p2 = await els.create({ type: 'poste', ...pos(1) }, who);
  const cable = await cables.create({ cableType: 'AS-80', fiberCount: 12, vertices: [{ elementId: p1.id, lat: p1.lat, lng: p1.lng }, { elementId: p2.id, lat: p2.lat, lng: p2.lng }] }, who);
  await photos.add(p1.id, { blob: new Blob(['a']) }, who);
  await photos.add(p1.id, { blob: new Blob(['b']) }, who);
  for (let i = 0; i < 3; i++) await db.trackPoints.add({ ...newBase(who), activityId: act.id, lat: -23.55, lng: -46.63, accuracy: 5, timestamp: Date.now() + i, segment: 0 } as TrackPoint);
  return { act, p1, p2, cable };
}

describe('excluir a atividade', () => {
  it('exclui a atividade e tudo o que e dela, com a mesma hora, pendente de envio, e diz quanto saiu', async () => {
    const { act, p1, cable } = await work('Carlos');
    await db.activities.update(act.id, { syncStatus: 'synced' });
    const r = await acts.remove(act.id);
    expect(r).toEqual({ elements: 2, cables: 1, photos: 2, trackPoints: 3 });
    const a = (await db.activities.get(act.id))!;
    const rows = [a, ...(await db.elements.toArray()), ...(await db.cables.toArray()), ...(await db.photos.toArray()), ...(await db.trackPoints.toArray())];
    expect(rows).toHaveLength(1 + 2 + 1 + 2 + 3);
    for (const x of rows) expect(x, x.id).toMatchObject({ deleted: true, syncStatus: 'pending', updatedAt: a.updatedAt });
    expect((await db.elements.get(p1.id))!.deleted).toBe(true);
    expect((await db.cables.get(cable.id))!.deleted).toBe(true);
    expect(await acts.list()).toEqual([]);
    expect(await acts.getOpen()).toBeNull();
  });

  it('nao mexe nas outras atividades', async () => {
    const a = await work('Carlos', 'Rua A');
    await acts.complete(a.act.id);
    const b = await work('Carlos', 'Rua B');
    await acts.remove(a.act.id);
    expect((await db.activities.get(b.act.id))!.deleted).toBe(false);
    expect((await db.elements.get(b.p1.id))!.deleted).toBe(false);
    expect((await db.cables.get(b.cable.id))!.deleted).toBe(false);
    expect(await db.photos.where('activityId').equals(b.act.id).filter((p) => !p.deleted).count()).toBe(2);
    expect(await db.trackPoints.where('activityId').equals(b.act.id).filter((p) => !p.deleted).count()).toBe(3);
  });

  it('o que ja estava excluido nao e carimbado de novo (a hora e o envio ficam como estavam)', async () => {
    const { act, p2 } = await work('Carlos');
    await els.remove(p2.id);
    const before = (await db.elements.get(p2.id))!;
    await db.elements.update(p2.id, { syncStatus: 'synced' });
    await new Promise((r) => setTimeout(r, 5));
    const r = await acts.remove(act.id);
    expect(r.elements).toBe(1); // so o poste que ainda estava vivo
    const after = (await db.elements.get(p2.id))!;
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.syncStatus).toBe('synced');
  });

  it('foto e ponto de trilha que ja estavam excluidos tambem nao sao carimbados de novo, e nao entram na conta', async () => {
    const { act, p1 } = await work('Carlos');
    const [gonePhoto] = await db.photos.where('elementId').equals(p1.id).toArray();
    await photos.remove(gonePhoto!.id);
    const gonePoint = (await db.trackPoints.where('activityId').equals(act.id).first())!;
    await db.trackPoints.update(gonePoint.id, { deleted: true, syncStatus: 'synced' });
    await db.photos.update(gonePhoto!.id, { syncStatus: 'synced' });
    const photoBefore = (await db.photos.get(gonePhoto!.id))!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const r = await acts.remove(act.id);
    expect(r).toMatchObject({ photos: 1, trackPoints: 2 });
    expect((await db.photos.get(gonePhoto!.id))).toMatchObject({ updatedAt: photoBefore, syncStatus: 'synced' });
    expect((await db.trackPoints.get(gonePoint.id))!.syncStatus).toBe('synced');
  });

  it('atividade aberta tambem pode ser excluida: deixa de haver atividade aberta', async () => {
    const { act } = await work('Carlos');
    expect(await acts.getOpen()).not.toBeNull();
    await acts.remove(act.id);
    expect(await acts.getOpen()).toBeNull();
    await expect(acts.create({ kind: 'implantacao', title: 'Nova' }, 'Carlos')).resolves.toMatchObject({ title: 'Nova' });
  });

  it('excluir de novo ou um id que nao existe: "nao encontrada"', async () => {
    const { act } = await work('Carlos');
    await acts.remove(act.id);
    expect(await code(acts.remove(act.id))).toBe('NOT_FOUND');
    expect(await code(acts.remove('nao-existe'))).toBe('NOT_FOUND');
  });
});

describe('quem pode excluir', () => {
  it('o dono pode; outro tecnico nao (e nada e alterado)', async () => {
    setActingUser('u-ana');
    setActingRole('tecnico');
    const { act, p1 } = await work('Ana');
    setActingUser('u-bruno');
    expect(await code(acts.remove(act.id))).toBe('NOT_OWNER');
    expect((await db.activities.get(act.id))!.deleted).toBe(false);
    expect((await db.elements.get(p1.id))!.deleted).toBe(false);
    setActingUser('u-ana');
    await expect(acts.remove(act.id)).resolves.toMatchObject({ elements: 2 });
  });

  it('o escritorio nao pode (so leitura)', async () => {
    setActingUser('u-ana');
    setActingRole('tecnico');
    const { act } = await work('Ana');
    setActingUser('u-clara');
    setActingRole('escritorio');
    expect(await code(acts.remove(act.id))).toBe('NOT_OWNER');
  });

  it('o administrador exclui a atividade de um tecnico, com os elementos e cabos dela', async () => {
    setActingUser('u-ana');
    setActingRole('tecnico');
    const { act, cable } = await work('Ana');
    setActingUser('u-davi');
    setActingRole('admin');
    const r = await acts.remove(act.id);
    expect(r).toMatchObject({ elements: 2, cables: 1, photos: 2 });
    expect((await db.cables.get(cable.id))).toMatchObject({ deleted: true, ownerId: 'u-ana', syncStatus: 'pending' }); // o dono nao muda
  });
});

describe('o que ficou em outras atividades', () => {
  it('cabo de outra atividade que passava por um poste excluido fica com o ponto solto, no mesmo lugar', async () => {
    const a = await work('Carlos', 'Rua A');
    await acts.complete(a.act.id);
    await acts.create({ kind: 'implantacao', title: 'Rua B' }, 'Carlos');
    const p3 = await els.create({ type: 'poste', ...pos(5) }, 'Carlos');
    const through = await cables.create({ cableType: 'drop', fiberCount: 2, vertices: [{ elementId: a.p2.id, lat: a.p2.lat, lng: a.p2.lng }, { elementId: p3.id, lat: p3.lat, lng: p3.lng }] }, 'Carlos');
    await acts.remove(a.act.id);
    const c = (await db.cables.get(through.id))!;
    expect(c.deleted).toBe(false);
    expect(c.vertices[0]).toEqual({ lat: a.p2.lat, lng: a.p2.lng }); // sem elementId, no mesmo lugar
    expect(c.vertices[1]).toMatchObject({ elementId: p3.id });
    expect(c.syncStatus).toBe('pending');
  });

  it('reserva de outra atividade que era de um cabo excluido fica sem cabo', async () => {
    const a = await work('Carlos', 'Rua A');
    await acts.complete(a.act.id);
    await acts.create({ kind: 'implantacao', title: 'Rua B' }, 'Carlos');
    const res = await els.create({ type: 'reserva', ...pos(0), attrs: { meters: 10, cableId: a.cable.id } }, 'Carlos');
    await acts.remove(a.act.id);
    const r = (await db.elements.get(res.id))!;
    expect(r.deleted).toBe(false);
    expect((r.attrs as { cableId?: string }).cableId).toBeUndefined();
    expect((r.attrs as { meters?: number }).meters).toBe(10);
  });

  it('reserva excluida junto com a atividade sai do total do cabo de outra atividade', async () => {
    const a = await work('Carlos', 'Rua A'); // atividade A fica aberta so para criar o cabo e a reserva
    await acts.complete(a.act.id);
    const b = await acts.create({ kind: 'implantacao', title: 'Rua B' }, 'Carlos');
    const p = await els.create({ type: 'poste', ...pos(8) }, 'Carlos');
    const q = await els.create({ type: 'poste', ...pos(9) }, 'Carlos');
    const cb = await cables.create({ cableType: 'AS-80', fiberCount: 12, vertices: [{ elementId: p.id, lat: p.lat, lng: p.lng }, { elementId: q.id, lat: q.lat, lng: q.lng }] }, 'Carlos');
    await acts.complete(b.id);
    await acts.reopen(a.act.id);
    await els.create({ type: 'reserva', ...pos(8), attrs: { meters: 20, cableId: cb.id } }, 'Carlos'); // reserva na atividade A, no cabo da B
    expect((await db.cables.get(cb.id))!.reserveMeters).toBe(20);
    await acts.remove(a.act.id);
    const c = (await db.cables.get(cb.id))!;
    expect(c).toMatchObject({ deleted: false, reserveMeters: 0 });
    expect(c.totalMeters).toBe(c.lengthMeters);
  });
});
