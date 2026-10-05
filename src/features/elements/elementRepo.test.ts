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

const blob = (txt = 'x') => new Blob([txt], { type: 'image/jpeg' });

describe('criar com fotos', () => {
  it('grava elemento e fotos juntos, com a posição e a atividade do elemento', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A' }, 'João');
    const e = await repo.create(gps, 'Maria', [{ blob: blob('1'), takenAt: 111 }, { blob: blob('2') }]);
    const photos = await db.photos.where('elementId').equals(e.id).toArray();
    expect(photos).toHaveLength(2);
    expect(photos.find((p) => p.takenAt === 111)).toBeTruthy();
    for (const p of photos) {
      expect(p).toMatchObject({
        activityId: a.id,
        lat: e.lat,
        lng: e.lng,
        createdBy: 'Maria',
        deleted: false,
        syncStatus: 'pending',
      });
      expect(p.blob).toBeInstanceOf(Blob);
    }
  });

  it('é tudo ou nada: se o elemento é recusado, nenhuma foto é gravada', async () => {
    expect(await code(repo.create(gps, 'J', [{ blob: blob() }]))).toBe('NO_OPEN_ACTIVITY');
    expect(await db.photos.count()).toBe(0);
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    expect(await code(repo.create({ ...gps, lat: 99 }, 'J', [{ blob: blob() }]))).toBe('INVALID_POSITION');
    expect(await db.photos.count()).toBe(0);
  });
});

describe('editar', () => {
  it('altera código, observações e atributos do tipo; o tipo e a atividade não mudam', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await repo.create({ ...gps, type: 'cto', attrs: { capacity: 8 } }, 'J');
    await db.elements.update(e.id, { syncStatus: 'synced', updatedAt: 1 });
    const u = await repo.update(e.id, { code: ' CTO-9 ', notes: ' poste 4 ', attrs: { capacity: '16', splitter: '1:16', lixo: 1 } });
    expect(u).toMatchObject({
      type: 'cto',
      activityId: a.id,
      code: 'CTO-9',
      notes: 'poste 4',
      attrs: { capacity: 16, splitter: '1:16' },
      syncStatus: 'pending',
    });
    expect(u.updatedAt).toBeGreaterThan(1);
  });

  it('só mexe no que foi enviado', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await repo.create({ ...gps, code: 'P-1', notes: 'n', attrs: { owner: 'proprio' } }, 'J');
    const u = await repo.update(e.id, { notes: 'novo' });
    expect(u).toMatchObject({ code: 'P-1', notes: 'novo', attrs: { owner: 'proprio' } });
  });

  it('elemento inexistente ou excluído dá NOT_FOUND', async () => {
    expect(await code(repo.update('nao-existe', { code: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('mover', () => {
  it('posição manual remove a precisão antiga', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await repo.create(gps, 'J');
    expect(e.accuracy).toBe(8);
    const m = await repo.move(e.id, { lat: -23.5501, lng: -46.6301, positionSource: 'manual' });
    expect(m).toMatchObject({ lat: -23.5501, lng: -46.6301, positionSource: 'manual', syncStatus: 'pending' });
    expect('accuracy' in m).toBe(false);
  });

  it('posição GPS exige precisão; coordenadas inválidas são recusadas e nada muda', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e = await repo.create(gps, 'J');
    expect(await code(repo.move(e.id, { lat: 1, lng: 2, positionSource: 'gps' }))).toBe('INVALID_POSITION');
    expect(await code(repo.move(e.id, { lat: 100, lng: 2, positionSource: 'manual' }))).toBe('INVALID_POSITION');
    expect(await db.elements.get(e.id)).toMatchObject({ lat: gps.lat, lng: gps.lng, accuracy: 8 });
  });

  it('elemento inexistente dá NOT_FOUND', async () => {
    expect(await code(repo.move('nao-existe', { lat: 1, lng: 2, positionSource: 'manual' }))).toBe('NOT_FOUND');
  });
});

describe('excluir', () => {
  it('exclusão lógica do elemento e das fotos dele; fotos de outros elementos ficam', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const e1 = await repo.create(gps, 'J', [{ blob: blob() }, { blob: blob() }]);
    const e2 = await repo.create({ ...gps, type: 'cto' }, 'J', [{ blob: blob() }]);
    await repo.remove(e1.id);

    expect(await db.elements.count()).toBe(2); // continua no banco (sincronização)
    expect(await repo.get(e1.id)).toBeUndefined();
    expect((await repo.list()).map((e) => e.id)).toEqual([e2.id]);
    const p1 = await db.photos.where('elementId').equals(e1.id).toArray();
    expect(p1).toHaveLength(2);
    expect(p1.every((p) => p.deleted && p.syncStatus === 'pending')).toBe(true);
    const p2 = await db.photos.where('elementId').equals(e2.id).toArray();
    expect(p2.every((p) => !p.deleted)).toBe(true);
    expect(await code(repo.remove(e1.id))).toBe('NOT_FOUND');
  });
});
