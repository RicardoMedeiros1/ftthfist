import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import type { Activity } from '../../db/types';
import { ActivityRuleError, activityRepo } from './activityRepo';

let db: RotaFibraDB;
let repo: ReturnType<typeof activityRepo>;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  repo = activityRepo(db);
});

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ActivityRuleError);
  expect((err as ActivityRuleError).code).toBe(code);
};

describe('criar atividade', () => {
  it('nasce aberta, pendente de sincronização e com o técnico como createdBy', async () => {
    const a = await repo.create({ kind: 'implantacao', title: '  Rua das Flores  ', osNumber: ' 1234 ' }, ' João ');
    expect(a).toMatchObject({
      title: 'Rua das Flores',
      osNumber: '1234',
      technician: 'João',
      createdBy: 'João',
      status: 'aberta',
      syncStatus: 'pending',
      deleted: false,
    });
    expect(a.endedAt).toBeUndefined();
    expect(await repo.getOpen()).toMatchObject({ id: a.id });
  });

  it('OS vazia não grava o campo', async () => {
    const a = await repo.create({ kind: 'manutencao', title: 'X', osNumber: '   ' }, 'João');
    expect('osNumber' in a).toBe(false);
  });

  it('exige título e técnico', async () => {
    await rejectsWith(repo.create({ kind: 'implantacao', title: '   ' }, 'João'), 'TITLE_REQUIRED');
    await rejectsWith(repo.create({ kind: 'implantacao', title: 'X' }, '  '), 'TECHNICIAN_REQUIRED');
    expect(await db.activities.count()).toBe(0);
  });

  it('só permite uma atividade aberta por vez', async () => {
    await repo.create({ kind: 'implantacao', title: 'A' }, 'João');
    await rejectsWith(repo.create({ kind: 'manutencao', title: 'B' }, 'João'), 'ALREADY_OPEN');
    expect(await db.activities.count()).toBe(1);
  });

  it('dois pedidos simultâneos resultam em uma única atividade aberta', async () => {
    const results = await Promise.allSettled([
      repo.create({ kind: 'implantacao', title: 'A' }, 'João'),
      repo.create({ kind: 'implantacao', title: 'B' }, 'João'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.activities.count()).toBe(1);
  });
});

describe('concluir e reabrir', () => {
  it('concluir fecha, registra endedAt e libera para abrir outra', async () => {
    const a = await repo.create({ kind: 'implantacao', title: 'A' }, 'João');
    await repo.complete(a.id);
    const got = await db.activities.get(a.id);
    expect(got?.status).toBe('concluida');
    expect(got?.endedAt).toBeGreaterThanOrEqual(a.startedAt);
    expect(got?.syncStatus).toBe('pending');
    expect(await repo.getOpen()).toBeNull();
    await expect(repo.create({ kind: 'manutencao', title: 'B' }, 'João')).resolves.toBeTruthy();
  });

  it('reabrir limpa endedAt', async () => {
    const a = await repo.create({ kind: 'implantacao', title: 'A' }, 'João');
    await repo.complete(a.id);
    await repo.reopen(a.id);
    const got = await db.activities.get(a.id);
    expect(got?.status).toBe('aberta');
    expect('endedAt' in (got ?? {}) && got?.endedAt !== undefined).toBe(false);
  });

  it('não reabre se outra estiver aberta', async () => {
    const a = await repo.create({ kind: 'implantacao', title: 'A' }, 'João');
    await repo.complete(a.id);
    await repo.create({ kind: 'manutencao', title: 'B' }, 'João');
    await rejectsWith(repo.reopen(a.id), 'ALREADY_OPEN');
    expect((await db.activities.get(a.id))?.status).toBe('concluida');
  });

  it('id inexistente dá NOT_FOUND', async () => {
    await rejectsWith(repo.complete('nao-existe'), 'NOT_FOUND');
    await rejectsWith(repo.reopen('nao-existe'), 'NOT_FOUND');
  });
});

describe('listar', () => {
  it('abertas primeiro, depois as mais recentes; ignora excluídas logicamente', async () => {
    const make = (id: string, status: Activity['status'], startedAt: number, deleted = false): Activity => ({
      id,
      title: id,
      status,
      startedAt,
      createdAt: startedAt,
      updatedAt: startedAt,
      deleted,
      kind: 'implantacao',
      technician: 'J',
      createdBy: 'J',
      description: '',
      materials: [],
      syncStatus: 'pending',
    });
    await db.activities.bulkAdd([
      make('velha', 'concluida', 1000),
      make('nova', 'concluida', 3000),
      make('aberta', 'aberta', 2000),
      make('apagada', 'concluida', 4000, true),
    ]);
    expect((await repo.list()).map((a) => a.id)).toEqual(['aberta', 'nova', 'velha']);
  });

  it('atividade excluída logicamente não conta como aberta', async () => {
    const a = await repo.create({ kind: 'implantacao', title: 'A' }, 'João');
    await db.activities.update(a.id, { deleted: true });
    expect(await repo.getOpen()).toBeNull();
    await expect(repo.create({ kind: 'implantacao', title: 'B' }, 'João')).resolves.toBeTruthy();
  });
});
