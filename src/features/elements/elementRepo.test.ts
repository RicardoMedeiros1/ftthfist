import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { activityRepo } from '../activities/activityRepo';
import { ElementRuleError, elementRepo } from './elementRepo';

let db: RotaFibraDB;
let repo: ReturnType<typeof elementRepo>;
let acts: ReturnType<typeof activityRepo>;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  repo = elementRepo(db);
  acts = activityRepo(db);
});

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ElementRuleError);
  return (e as ElementRuleError).code;
};

const gps = { type: 'poste', lat: -23.55, lng: -46.63, accuracy: 8, positionSource: 'gps' } as const;

describe('criar elemento', () => {
  it('exige atividade aberta', async () => {
    expect(await code(repo.create(gps, 'João'))).toBe('NO_OPEN_ACTIVITY');
    expect(await db.elements.count()).toBe(0);
    const a = await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    await acts.complete(a.id);
    expect(await code(repo.create(gps, 'João'))).toBe('NO_OPEN_ACTIVITY');
  });

  it('grava na atividade aberta, com precisão do GPS, pendente de sincronização', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    const e = await repo.create(
      { ...gps, code: ' P-12 ', notes: ' perto da esquina ', attrs: { owner: 'proprio', ownerCode: ' 9 ', lixo: 1 } },
      'Maria',
    );
    expect(e).toMatchObject({
      type: 'poste',
      lat: -23.55,
      lng: -46.63,
      accuracy: 8,
      positionSource: 'gps',
      code: 'P-12',
      notes: 'perto da esquina',
      activityId: a.id,
      createdBy: 'Maria',
      deleted: false,
      syncStatus: 'pending',
      attrs: { owner: 'proprio', ownerCode: '9' },
    });
    expect(await db.elements.get(e.id)).toMatchObject({ id: e.id });
  });

  it('técnico em branco usa o técnico da atividade', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    expect((await repo.create(gps, '  ')).createdBy).toBe('João');
  });

  it('posição manual não guarda precisão, mesmo que venha informada', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    const e = await repo.create({ type: 'cto', lat: 1, lng: 2, accuracy: 3, positionSource: 'manual' }, 'João');
    expect('accuracy' in e).toBe(false);
    expect(e.positionSource).toBe('manual');
  });

  it('posição GPS sem precisão é recusada (a precisão é sempre guardada)', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    expect(await code(repo.create({ type: 'poste', lat: 1, lng: 2, positionSource: 'gps' }, 'J'))).toBe('INVALID_POSITION');
  });

  it('coordenadas fora do mundo ou inválidas são recusadas', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    for (const [lat, lng] of [[91, 0], [0, 181], [NaN, 0], [0, Infinity]] as const) {
      expect(await code(repo.create({ type: 'poste', lat, lng, accuracy: 5, positionSource: 'gps' }, 'J'))).toBe('INVALID_POSITION');
    }
    expect(await db.elements.count()).toBe(0);
  });

  it('tipo inválido é recusado', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    expect(await code(repo.create({ ...gps, type: 'torre' as never }, 'J'))).toBe('INVALID_TYPE');
  });
});

describe('listar', () => {
  it('traz elementos de todas as atividades e ignora os excluídos logicamente', async () => {
    const a1 = await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e1 = await repo.create(gps, 'J');
    await acts.complete(a1.id);
    await acts.create({ kind: 'manutencao', title: 'B' }, 'J');
    const e2 = await repo.create({ ...gps, type: 'cto' }, 'J');
    const e3 = await repo.create({ ...gps, type: 'ceo' }, 'J');
    await db.elements.update(e3.id, { deleted: true });

    const ids = (await repo.list()).map((e) => e.id).sort();
    expect(ids).toEqual([e1.id, e2.id].sort());
    expect(await repo.get(e3.id)).toBeUndefined();
    expect((await repo.get(e1.id))?.activityId).toBe(a1.id);
  });
});
