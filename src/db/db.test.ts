import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB, newBase, touch } from './db';
import type { Activity } from './types';

let db: RotaFibraDB;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
});

function activity(over: Partial<Activity> = {}): Activity {
  return {
    ...newBase('João'),
    kind: 'implantacao',
    title: 'Rua A',
    technician: 'João',
    startedAt: Date.now(),
    status: 'aberta',
    description: '',
    materials: [],
    ...over,
  };
}

describe('banco local', () => {
  it('novo registro nasce pendente, não excluído e com UUID', () => {
    const b = newBase('Maria');
    expect(b.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.deleted).toBe(false);
    expect(b.syncStatus).toBe('pending');
    expect(b.createdBy).toBe('Maria');
  });

  it('persiste e lê uma atividade', async () => {
    const a = activity();
    await db.activities.add(a);
    expect((await db.activities.get(a.id))?.title).toBe('Rua A');
  });

  it('touch devolve o registro a pendente e atualiza updatedAt', async () => {
    const a = activity({ syncStatus: 'synced', updatedAt: 1 });
    await db.activities.add(a);
    await db.activities.update(a.id, touch<Activity>({ title: 'Rua B' }, 99));
    const got = await db.activities.get(a.id);
    expect(got).toMatchObject({ title: 'Rua B', updatedAt: 99, syncStatus: 'pending' });
  });

  it('exclusão é lógica: o registro continua no banco', async () => {
    const a = activity();
    await db.activities.add(a);
    await db.activities.update(a.id, touch<Activity>({ deleted: true }));
    expect(await db.activities.count()).toBe(1);
    expect((await db.activities.get(a.id))?.deleted).toBe(true);
  });
});
