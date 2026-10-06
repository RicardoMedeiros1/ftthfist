import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../db/db';
import { setActingUser } from '../lib/ownership';
import { activityRepo } from './activities/activityRepo';
import { cableChoicesNear } from './cables/cableChoices';
import { cableRepo } from './cables/cableRepo';
import { elementRepo } from './elements/elementRepo';
import { photoRepo } from './elements/photoRepo';

// Dois tecnicos no mesmo aparelho (ou dados de colegas vindos da sincronizacao): cada um altera so o que e seu.

let db: RotaFibraDB;
let acts: ReturnType<typeof activityRepo>;
let els: ReturnType<typeof elementRepo>;
let cables: ReturnType<typeof cableRepo>;

const pole = (lat: number, lng: number) => ({ type: 'poste', lat, lng, accuracy: 4, positionSource: 'gps' } as const);
const codeOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as { code?: string } | null)?.code;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  acts = activityRepo(db);
  els = elementRepo(db);
  cables = cableRepo(db);
});
afterEach(() => setActingUser(null));

/** A (ana) lança um cabo entre dois postes e conclui a atividade; depois a bia assume o aparelho. */
async function anaWorkThenBia() {
  setActingUser('ana');
  const act = await acts.create({ kind: 'implantacao', title: 'Rua da Ana' }, 'Ana');
  const p1 = await els.create(pole(-23.55, -46.63), 'Ana');
  const p2 = await els.create(pole(-23.5503, -46.6301), 'Ana');
  const cable = await cables.create(
    { cableType: 'AS-80', fiberCount: 12, vertices: [{ elementId: p1.id, lat: p1.lat, lng: p1.lng }, { elementId: p2.id, lat: p2.lat, lng: p2.lng }] },
    'Ana',
  );
  await acts.complete(act.id);
  setActingUser('bia');
  return { act, p1, p2, cable };
}

describe('registros nascem com o dono', () => {
  it('atividade, elemento e cabo carregam o ownerId de quem agia', async () => {
    const { act, p1, cable } = await anaWorkThenBia();
    expect([act.ownerId, p1.ownerId, cable.ownerId]).toEqual(['ana', 'ana', 'ana']);
  });
});

describe('só o dono altera', () => {
  it('elemento de outro: editar, mover e excluir são recusados e nada muda', async () => {
    const { p1 } = await anaWorkThenBia();
    expect(await codeOf(els.update(p1.id, { code: 'X' }))).toBe('NOT_OWNER');
    expect(await codeOf(els.move(p1.id, { lat: -23.6, lng: -46.7, positionSource: 'manual' }))).toBe('NOT_OWNER');
    expect(await codeOf(els.remove(p1.id))).toBe('NOT_OWNER');
    const after = await db.elements.get(p1.id);
    expect(after).toMatchObject({ lat: p1.lat, lng: p1.lng, code: p1.code, deleted: false });
  });

  it('cabo de outro: editar, mexer nos pontos e excluir são recusados', async () => {
    const { cable } = await anaWorkThenBia();
    expect(await codeOf(cables.update(cable.id, { notes: 'x' }))).toBe('NOT_OWNER');
    expect(await codeOf(cables.moveVertex(cable.id, 0, { lat: -23.6, lng: -46.7 }))).toBe('NOT_OWNER');
    expect(await codeOf(cables.removeVertex(cable.id, 0))).toBe('NOT_OWNER');
    expect(await codeOf(cables.remove(cable.id))).toBe('NOT_OWNER');
    expect((await db.cables.get(cable.id))?.deleted).toBe(false);
  });

  it('atividade de outro: concluir e reabrir são recusados', async () => {
    const { act } = await anaWorkThenBia();
    expect(await codeOf(acts.reopen(act.id))).toBe('NOT_OWNER');
    expect(await codeOf(acts.complete(act.id))).toBe('NOT_OWNER');
  });

  it('a mensagem é pronta para mostrar ao técnico', async () => {
    const { p1 } = await anaWorkThenBia();
    const e = await els.update(p1.id, { code: 'X' }).then(() => null, (x: Error) => x);
    expect(e?.message).toContain('outro técnico');
  });
});

describe('a atividade aberta é a minha, não a dos outros', () => {
  it('a atividade aberta de outro não me impede de iniciar a minha', async () => {
    setActingUser('ana');
    await acts.create({ kind: 'implantacao', title: 'Da Ana' }, 'Ana'); // fica aberta
    setActingUser('bia');
    expect(await acts.getOpen()).toBeNull();
    const mine = await acts.create({ kind: 'manutencao', title: 'Da Bia' }, 'Bia');
    expect(mine.ownerId).toBe('bia');
    expect((await acts.getOpen())?.id).toBe(mine.id);
  });

  it('marcar elemento usa a minha atividade aberta; sem ela, pede para iniciar uma', async () => {
    setActingUser('ana');
    await acts.create({ kind: 'implantacao', title: 'Da Ana' }, 'Ana');
    setActingUser('bia');
    expect(await codeOf(els.create(pole(-23.55, -46.63), 'Bia'))).toBe('NO_OPEN_ACTIVITY');
    const mine = await acts.create({ kind: 'manutencao', title: 'Da Bia' }, 'Bia');
    const el = await els.create(pole(-23.55, -46.63), 'Bia');
    expect(el.activityId).toBe(mine.id);
  });
});

describe('cabo usa a minha atividade aberta', () => {
  it('lançar cabo sem atividade minha aberta é recusado, mesmo com a de outro aberta', async () => {
    setActingUser('ana');
    await acts.create({ kind: 'implantacao', title: 'Da Ana' }, 'Ana'); // aberta
    setActingUser('bia');
    const verts = [{ lat: -23.55, lng: -46.63 }, { lat: -23.5503, lng: -46.6301 }];
    expect(await codeOf(cables.create({ cableType: 'drop', fiberCount: 1, vertices: verts }, 'Bia'))).toBe('NO_OPEN_ACTIVITY');
    const mine = await acts.create({ kind: 'implantacao', title: 'Da Bia' }, 'Bia');
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: verts }, 'Bia');
    expect(c.activityId).toBe(mine.id);
  });
});

describe('cascatas não tocam nos cabos dos outros', () => {
  it('a bia muda os metros da própria reserva: o total do cabo da Ana (ligado a ela) não é recalculado', async () => {
    const { cable } = await anaWorkThenBia();
    await acts.create({ kind: 'manutencao', title: 'Da Bia' }, 'Bia');
    const reserve = await els.create(
      { type: 'reserva', lat: -23.55, lng: -46.63, accuracy: 3, positionSource: 'gps', attrs: { meters: 10, cableId: cable.id } },
      'Bia',
    );
    const before = (await db.cables.get(cable.id))!;
    await els.update(reserve.id, { attrs: { meters: 40, cableId: cable.id } });
    const after = (await db.cables.get(cable.id))!;
    expect(after.reserveMeters).toBe(before.reserveMeters);
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it('a bia move o próprio poste: o cabo da Ana que passa por ali não é alterado', async () => {
    const { cable } = await anaWorkThenBia();
    const mine = await acts.create({ kind: 'manutencao', title: 'Da Bia' }, 'Bia');
    expect(mine.ownerId).toBe('bia');
    // poste da Bia, cabo da Ana ligado a ele (como acontece se a Ana ligar o cabo dela a um poste da Bia)
    const biaPole = await els.create(pole(-23.56, -46.64), 'Bia');
    const before = (await db.cables.get(cable.id))!;
    await db.cables.update(cable.id, { vertices: [{ elementId: biaPole.id, lat: biaPole.lat, lng: biaPole.lng }, before.vertices[1]!] });
    const anaVersion = (await db.cables.get(cable.id))!;

    await els.move(biaPole.id, { lat: -23.57, lng: -46.65, positionSource: 'manual' });
    expect((await db.cables.get(cable.id))?.vertices).toEqual(anaVersion.vertices);
    await els.remove(biaPole.id);
    expect((await db.cables.get(cable.id))?.vertices).toEqual(anaVersion.vertices);
  });

  it('a Ana segue acompanhando o próprio poste (cascata normal para o dono)', async () => {
    const { p1 } = await anaWorkThenBia();
    setActingUser('ana');
    // a atividade da Ana foi concluída; reabrir para poder mover é desnecessário: mover não exige atividade aberta
    await els.move(p1.id, { lat: -23.551, lng: -46.631, positionSource: 'manual' });
    const c = (await db.cables.toArray())[0]!;
    expect(c.vertices[0]).toMatchObject({ lat: -23.551, lng: -46.631 });
    expect(c.lengthMeters).toBeGreaterThan(0);
  });

  it('mover o vértice do meu cabo preso a um poste de outro é recusado (não desloco o poste alheio)', async () => {
    const { p1 } = await anaWorkThenBia();
    await acts.create({ kind: 'implantacao', title: 'Da Bia' }, 'Bia');
    const mine = await cables.create(
      { cableType: 'drop', fiberCount: 1, vertices: [{ elementId: p1.id, lat: p1.lat, lng: p1.lng }, { lat: -23.552, lng: -46.632 }] },
      'Bia',
    );
    expect(await codeOf(cables.moveVertex(mine.id, 0, { lat: -23.6, lng: -46.7 }))).toBe('NOT_OWNER');
    expect((await db.elements.get(p1.id))?.lat).toBe(p1.lat);
  });

  it('excluir meu cabo não desliga reservas de outro técnico', async () => {
    await anaWorkThenBia();
    await acts.create({ kind: 'implantacao', title: 'Da Bia' }, 'Bia');
    const mine = await cables.create(
      { cableType: 'drop', fiberCount: 1, vertices: [{ lat: -23.55, lng: -46.63 }, { lat: -23.5503, lng: -46.6301 }] },
      'Bia',
    );
    const anaReserve = await els.create({ type: 'reserva', lat: -23.55, lng: -46.63, accuracy: 3, positionSource: 'gps', attrs: { meters: 20, cableId: mine.id } }, 'Bia');
    await db.elements.update(anaReserve.id, { ownerId: 'ana' }); // reserva de outro apontando para o meu cabo
    await cables.remove(mine.id);
    expect(((await db.elements.get(anaReserve.id))?.attrs as { cableId?: string }).cableId).toBe(mine.id);
  });
});

describe('reserva só liga a cabo meu', () => {
  it('cableChoicesNear ignora cabos de outros', async () => {
    const { cable } = await anaWorkThenBia();
    const near = { lat: cable.vertices[0]!.lat, lng: cable.vertices[0]!.lng };
    expect(cableChoicesNear(near, [cable])).toEqual([]);
    setActingUser('ana');
    expect(cableChoicesNear(near, [cable]).map((c) => c.id)).toEqual([cable.id]);
  });
});

describe('fotos', () => {
  const jpeg = () => new Blob(['x'], { type: 'image/jpeg' });

  it('não adiciono foto a elemento de outro, nem excluo foto de outro', async () => {
    const { p1 } = await anaWorkThenBia();
    const photos = photoRepo(db);
    expect(await codeOf(photos.add(p1.id, { blob: jpeg() }, 'Bia'))).toBe('NOT_OWNER');
    setActingUser('ana');
    const photo = await photos.add(p1.id, { blob: jpeg() }, 'Ana');
    expect(photo.ownerId).toBe('ana');
    setActingUser('bia');
    expect(await codeOf(photos.remove(photo.id))).toBe('NOT_OWNER');
    expect((await db.photos.get(photo.id))?.deleted).toBe(false);
  });
});
