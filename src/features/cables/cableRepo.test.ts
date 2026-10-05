import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { pathLengthMeters, round2 } from '../../lib/geo';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { CableRuleError, cableRepo } from './cableRepo';

let db: RotaFibraDB;
let acts: ReturnType<typeof activityRepo>;
let els: ReturnType<typeof elementRepo>;
let cables: ReturnType<typeof cableRepo>;

beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  acts = activityRepo(db);
  els = elementRepo(db);
  cables = cableRepo(db);
});

const code = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(CableRuleError);
  return (e as CableRuleError).code;
};
const pole = (lat: number, lng: number) => ({ type: 'poste', lat, lng, accuracy: 4, positionSource: 'gps' } as const);
const P = [
  { lat: -23.55, lng: -46.63 },
  { lat: -23.5503, lng: -46.6301 },
  { lat: -23.5506, lng: -46.6303 },
  { lat: -23.5509, lng: -46.6306 },
  { lat: -23.5511, lng: -46.631 },
];

async function withPoles(n = 5) {
  const a = await acts.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
  const poles = [];
  for (const p of P.slice(0, n)) poles.push(await els.create(pole(p.lat, p.lng), 'Carlos'));
  return { a, poles };
}
const vOf = (e: { id: string; lat: number; lng: number }) => ({ elementId: e.id, lat: e.lat, lng: e.lng });

describe('criar cabo', () => {
  it('liga 5 postes: metragem do traçado, na atividade aberta, pendente de sincronização', async () => {
    const { a, poles } = await withPoles();
    const c = await cables.create({ cableType: 'AS-80', fiberCount: 12, vertices: poles.map(vOf), notes: ' rua principal ' }, 'Maria');
    expect(c).toMatchObject({
      cableType: 'AS-80', fiberCount: 12, activityId: a.id, notes: 'rua principal',
      createdBy: 'Maria', deleted: false, syncStatus: 'pending', reserveMeters: 0,
    });
    expect(c.vertices).toHaveLength(5);
    expect(c.vertices.every((v) => v.elementId)).toBe(true);
    const expected = round2(pathLengthMeters(P));
    expect(c.lengthMeters).toBe(expected);
    expect(c.totalMeters).toBe(expected);
    expect(expected).toBeGreaterThan(100);
  });

  it('exige atividade aberta, 2+ pontos, tipo e nº de fibras válidos', async () => {
    expect(await code(cables.create({ cableType: 'drop', fiberCount: 1, vertices: [P[0]!, P[1]!] }, 'J'))).toBe('NO_OPEN_ACTIVITY');
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    expect(await code(cables.create({ cableType: 'drop', fiberCount: 1, vertices: [P[0]!] }, 'J'))).toBe('TOO_FEW_VERTICES');
    expect(await code(cables.create({ cableType: '  ', fiberCount: 1, vertices: [P[0]!, P[1]!] }, 'J'))).toBe('INVALID_TYPE');
    expect(await code(cables.create({ cableType: 'drop', fiberCount: 10, vertices: [P[0]!, P[1]!] }, 'J'))).toBe('INVALID_FIBERS');
    expect(await code(cables.create({ cableType: 'drop', fiberCount: 1, vertices: [P[0]!, { lat: 99, lng: 0 }] }, 'J'))).toBe('INVALID_POSITION');
    expect(await db.cables.count()).toBe(0);
  });

  it('o vértice ligado a um elemento usa a posição do elemento; elemento inexistente vira ponto solto', async () => {
    const { poles } = await withPoles(2);
    const c = await cables.create(
      { cableType: 'drop', fiberCount: 2, vertices: [{ elementId: poles[0]!.id, lat: 1, lng: 1 }, { elementId: 'fantasma', lat: -23.6, lng: -46.7 }] },
      'J',
    );
    expect(c.vertices[0]).toEqual(vOf(poles[0]!));
    expect(c.vertices[1]).toEqual({ lat: -23.6, lng: -46.7 });
  });

  it('usa o id combinado (as reservas do lançamento já apontam para ele) e inclui as reservas no total', async () => {
    const { poles } = await withPoles(3);
    const cableId = crypto.randomUUID();
    await els.create({ type: 'reserva', lat: P[1]!.lat, lng: P[1]!.lng, positionSource: 'manual', attrs: { meters: '12,5', cableId } }, 'J');
    await els.create({ type: 'reserva', lat: P[2]!.lat, lng: P[2]!.lng, positionSource: 'manual', attrs: { meters: 5, cableId } }, 'J');
    const c = await cables.create({ id: cableId, cableType: 'AS-80', fiberCount: 24, vertices: poles.map(vOf) }, 'J');
    expect(c.id).toBe(cableId);
    expect(c.reserveMeters).toBe(17.5);
    expect(c.totalMeters).toBe(round2(c.lengthMeters + 17.5));
  });
});

describe('reservas ligadas ao cabo', () => {
  it('criar, editar, mover de cabo e excluir uma reserva refaz o total do cabo', async () => {
    const { poles } = await withPoles(3);
    const c1 = await cables.create({ cableType: 'AS-80', fiberCount: 12, vertices: poles.map(vOf) }, 'J');
    const c2 = await cables.create({ cableType: 'drop', fiberCount: 2, vertices: [vOf(poles[0]!), vOf(poles[1]!)] }, 'J');
    const r = await els.create({ type: 'reserva', lat: P[1]!.lat, lng: P[1]!.lng, positionSource: 'manual', attrs: { meters: 10, cableId: c1.id } }, 'J');
    expect((await cables.get(c1.id))?.reserveMeters).toBe(10);

    await els.update(r.id, { attrs: { meters: '25', cableId: c1.id } });
    expect((await cables.get(c1.id))?.reserveMeters).toBe(25);

    await els.update(r.id, { attrs: { meters: 25, cableId: c2.id } }); // passou para o outro cabo
    expect((await cables.get(c1.id))?.reserveMeters).toBe(0);
    expect((await cables.get(c2.id))?.reserveMeters).toBe(25);
    expect((await cables.get(c2.id))?.totalMeters).toBe(round2((await cables.get(c2.id))!.lengthMeters + 25));

    await els.remove(r.id);
    expect((await cables.get(c2.id))?.reserveMeters).toBe(0);
  });

  it('reserva de cabo excluído não conta e excluir o cabo solta as reservas (continuam no mapa, sem cabo)', async () => {
    const { poles } = await withPoles(2);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    const r = await els.create({ type: 'reserva', lat: P[0]!.lat, lng: P[0]!.lng, positionSource: 'manual', attrs: { meters: 8, cableId: c.id } }, 'J');
    await cables.remove(c.id);
    expect(await cables.get(c.id)).toBeUndefined();
    expect((await db.cables.get(c.id))?.deleted).toBe(true);
    const after = await els.get(r.id);
    expect(after?.deleted).toBe(false);
    expect(after?.attrs).toEqual({ meters: 8 });
    expect(after?.syncStatus).toBe('pending');
  });
});

describe('editar', () => {
  it('altera tipo, fibras e observações; valida', async () => {
    const { poles } = await withPoles(2);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    await db.cables.update(c.id, { syncStatus: 'synced', updatedAt: 1 });
    const u = await cables.update(c.id, { cableType: ' AS-120 ', fiberCount: 48, notes: ' n ' });
    expect(u).toMatchObject({ cableType: 'AS-120', fiberCount: 48, notes: 'n', syncStatus: 'pending' });
    expect(u.updatedAt).toBeGreaterThan(1);
    expect(await code(cables.update(c.id, { fiberCount: 7 }))).toBe('INVALID_FIBERS');
    expect(await code(cables.update('nao-existe', { notes: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('editar o traçado', () => {
  it('mover um ponto solto muda só o cabo e a metragem', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: [P[0]!, P[1]!, P[2]!] }, 'J');
    const m = await cables.moveVertex(c.id, 1, { lat: -23.5508, lng: -46.6302 });
    expect(m.vertices[1]).toEqual({ lat: -23.5508, lng: -46.6302 });
    expect(m.lengthMeters).toBe(round2(pathLengthMeters([P[0]!, { lat: -23.5508, lng: -46.6302 }, P[2]!])));
    expect(m.lengthMeters).not.toBe(c.lengthMeters);
  });

  it('mover um ponto que é um poste move o POSTE e todos os cabos que passam por ele', async () => {
    const { poles } = await withPoles(4);
    const c1 = await cables.create({ cableType: 'AS-80', fiberCount: 12, vertices: [vOf(poles[0]!), vOf(poles[1]!), vOf(poles[2]!)] }, 'J');
    const c2 = await cables.create({ cableType: 'drop', fiberCount: 2, vertices: [vOf(poles[1]!), vOf(poles[3]!)] }, 'J');
    const to = { lat: -23.5504, lng: -46.6299 };
    await cables.moveVertex(c1.id, 1, to);

    const el = await els.get(poles[1]!.id);
    expect(el).toMatchObject({ ...to, positionSource: 'manual', syncStatus: 'pending' });
    expect('accuracy' in el!).toBe(false);
    expect((await cables.get(c1.id))?.vertices[1]).toEqual({ elementId: poles[1]!.id, ...to });
    const o = await cables.get(c2.id);
    expect(o?.vertices[0]).toEqual({ elementId: poles[1]!.id, ...to });
    expect(o?.lengthMeters).toBe(round2(pathLengthMeters(o!.vertices)));
  });

  it('mover o elemento pelo detalhe (4b) também leva os cabos', async () => {
    const { poles } = await withPoles(2);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    await els.move(poles[0]!.id, { lat: -23.549, lng: -46.629, positionSource: 'manual' });
    const after = await cables.get(c.id);
    expect(after?.vertices[0]).toEqual({ elementId: poles[0]!.id, lat: -23.549, lng: -46.629 });
    expect(after?.lengthMeters).toBe(round2(pathLengthMeters(after!.vertices)));
    // posição de GPS: também acompanha
    await els.move(poles[0]!.id, { lat: -23.5495, lng: -46.6295, accuracy: 3, positionSource: 'gps' });
    expect((await cables.get(c.id))?.vertices[0]).toEqual({ elementId: poles[0]!.id, lat: -23.5495, lng: -46.6295 });
  });

  it('excluir o poste solta o vértice no mesmo lugar (o cabo não muda de forma)', async () => {
    const { poles } = await withPoles(3);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    await els.remove(poles[1]!.id);
    const after = await cables.get(c.id);
    expect(after?.vertices[1]).toEqual({ lat: poles[1]!.lat, lng: poles[1]!.lng });
    expect(after?.vertices[0]?.elementId).toBe(poles[0]!.id);
    expect(after?.lengthMeters).toBe(c.lengthMeters);
  });

  it('inserir um ponto no meio de um trecho', async () => {
    await acts.create({ kind: 'implantacao', title: 'A' }, 'J');
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: [P[0]!, P[2]!] }, 'J');
    const m = { lat: -23.5502, lng: -46.6304 };
    const u = await cables.insertVertex(c.id, 0, m);
    expect(u.vertices).toEqual([P[0], m, P[2]]);
    expect(u.lengthMeters).toBeGreaterThan(c.lengthMeters); // desvio aumenta a metragem
    expect(u.vertices).toHaveLength(3);
    expect(await code(cables.insertVertex(c.id, 2, m))).toBe('NOT_FOUND'); // não há trecho depois do último ponto
    expect(await code(cables.insertVertex(c.id, -1, m))).toBe('NOT_FOUND');
  });

  it('inserir um elemento existente usa a posição dele', async () => {
    const { poles } = await withPoles(3);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: [vOf(poles[0]!), vOf(poles[2]!)] }, 'J');
    const u = await cables.insertVertex(c.id, 0, { elementId: poles[1]!.id, lat: 0, lng: 0 });
    expect(u.vertices[1]).toEqual(vOf(poles[1]!));
  });

  it('remover um ponto: mantém o elemento no mapa e nunca deixa o cabo com menos de 2 pontos', async () => {
    const { poles } = await withPoles(3);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    const u = await cables.removeVertex(c.id, 1);
    expect(u.vertices).toHaveLength(2);
    expect((await els.get(poles[1]!.id))?.deleted).toBe(false);
    expect(await code(cables.removeVertex(c.id, 0))).toBe('MIN_VERTICES');
    expect(await code(cables.removeVertex(c.id, 9))).toBe('NOT_FOUND');
  });

  it('excluir o cabo é lógico e some da lista', async () => {
    const { poles } = await withPoles(2);
    const c = await cables.create({ cableType: 'drop', fiberCount: 1, vertices: poles.map(vOf) }, 'J');
    await cables.remove(c.id);
    expect(await cables.list()).toEqual([]);
    expect(await db.cables.count()).toBe(1);
    expect(await code(cables.remove(c.id))).toBe('NOT_FOUND');
    expect(await code(cables.moveVertex(c.id, 0, { lat: 1, lng: 1 }))).toBe('NOT_FOUND');
  });
});
