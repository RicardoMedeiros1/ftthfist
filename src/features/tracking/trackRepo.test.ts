import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { trackRepo } from './trackRepo';

let db: RotaFibraDB;
let repo: ReturnType<typeof trackRepo>;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  repo = trackRepo(db);
});

const p = (activityId: string, timestamp: number, segment = 0, extra = {}) => ({ activityId, lat: -23.5, lng: -46.6, accuracy: 8, timestamp, segment, ...extra });

describe('trackRepo', () => {
  it('grava com os campos do projeto, pendente de sincronização', async () => {
    const row = await repo.add(p('a1', 100, 2, { speed: 1.4 }), 'Carlos');
    expect(row).toMatchObject({ activityId: 'a1', accuracy: 8, timestamp: 100, speed: 1.4, segment: 2, createdBy: 'Carlos', deleted: false, syncStatus: 'pending' });
    expect(await db.trackPoints.get(row.id)).toBeTruthy();
  });
  it('sem velocidade informada o campo não é gravado', async () => {
    expect('speed' in (await repo.add(p('a1', 1), 'C'))).toBe(false);
  });
  it('lista só a atividade pedida, por horário', async () => {
    await repo.add(p('a1', 30), 'C');
    await repo.add(p('a2', 10), 'C');
    await repo.add(p('a1', 20), 'C');
    expect((await repo.listFor('a1')).map((x) => x.timestamp)).toEqual([20, 30]);
  });
  it('o próximo trecho continua depois do último da atividade', async () => {
    expect(await repo.nextSegment('a1')).toBe(0);
    await repo.add(p('a1', 1, 0), 'C');
    await repo.add(p('a1', 2, 3), 'C');
    expect(await repo.nextSegment('a1')).toBe(4);
    expect(await repo.nextSegment('outra')).toBe(0);
  });
  it('apagar a trilha é lógico, só da atividade, e deixa o registro para a sincronização', async () => {
    await repo.add(p('a1', 1), 'C');
    await repo.add(p('a1', 2), 'C');
    await repo.add(p('a2', 3), 'C');
    expect(await repo.clear('a1')).toBe(2);
    expect(await repo.listFor('a1')).toEqual([]);
    expect(await repo.listFor('a2')).toHaveLength(1);
    expect(await db.trackPoints.count()).toBe(3);
    expect((await db.trackPoints.toArray()).filter((x) => x.deleted).every((x) => x.syncStatus === 'pending')).toBe(true);
    expect(await repo.clear('a1')).toBe(0);
  });
});
