import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { ActivityRuleError, activityRepo } from './activityRepo';

let db: RotaFibraDB;
let acts: ReturnType<typeof activityRepo>;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
  acts = activityRepo(db);
});
afterEach(() => { setActingUser(null); setActingRole(null); });

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ActivityRuleError | null)?.code;

describe('editar a atividade', () => {
  it('altera título, OS, descrição e materiais; limpa o texto; marca como pendente', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Rua A', osNumber: '10' }, 'Carlos');
    await db.activities.update(a.id, { syncStatus: 'synced' });
    const u = await acts.update(a.id, {
      title: '  Rua   B  ', osNumber: ' 2002 ', description: '  trocar o cabo  ',
      materials: [{ item: ' Abraçadeira ', quantity: 20, unit: 'un' }, { item: '', quantity: 1, unit: '' }],
    });
    expect(u).toMatchObject({ title: 'Rua B', osNumber: '2002', description: 'trocar o cabo', syncStatus: 'pending' });
    expect(u.materials).toEqual([{ item: 'Abraçadeira', quantity: 20, unit: 'un' }]);
    expect(u.updatedAt).toBeGreaterThanOrEqual(a.updatedAt);
  });

  it('o que não vem no pedido não muda; tipo, técnico e datas nunca mudam por aqui', async () => {
    const a = await acts.create({ kind: 'manutencao', title: 'Rua A' }, 'Carlos');
    const u = await acts.update(a.id, { description: 'x', ...({ kind: 'implantacao', technician: 'Outro', startedAt: 5 } as object) });
    expect(u).toMatchObject({ title: 'Rua A', kind: 'manutencao', technician: 'Carlos', startedAt: a.startedAt, description: 'x' });
  });

  it('OS vazia remove o número', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Rua A', osNumber: '77' }, 'Carlos');
    const u = await acts.update(a.id, { osNumber: '   ' });
    expect(u.osNumber).toBeUndefined();
    expect('osNumber' in (await db.activities.get(a.id))!).toBe(false);
  });

  it('título vazio é recusado e nada é gravado', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
    expect(await code(acts.update(a.id, { title: '   ', description: 'não grava' }))).toBe('TITLE_REQUIRED');
    expect((await db.activities.get(a.id))!.description).toBe('');
  });

  it('limita o tamanho do título e da descrição', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
    const u = await acts.update(a.id, { title: 'T'.repeat(400), description: 'd'.repeat(5000) });
    expect(u.title).toHaveLength(120);
    expect(u.description).toHaveLength(2000);
  });

  it('atividade inexistente ou excluída', async () => {
    expect(await code(acts.update('nao-existe', { title: 'x' }))).toBe('NOT_FOUND');
    const a = await acts.create({ kind: 'implantacao', title: 'Rua A' }, 'Carlos');
    await db.activities.update(a.id, { deleted: true });
    expect(await code(acts.update(a.id, { title: 'x' }))).toBe('NOT_FOUND');
  });
});

describe('quem pode editar a atividade', () => {
  async function ofAna() {
    setActingUser('ana');
    const a = await acts.create({ kind: 'implantacao', title: 'Da Ana' }, 'Ana');
    await acts.complete(a.id);
    return a;
  }

  it('outro técnico e o escritório não editam; o dono e o administrador sim', async () => {
    const a = await ofAna();
    setActingUser('bia');
    setActingRole('tecnico');
    expect(await code(acts.update(a.id, { title: 'X' }))).toBe('NOT_OWNER');
    setActingRole('escritorio');
    expect(await code(acts.update(a.id, { title: 'X' }))).toBe('NOT_OWNER');
    setActingUser('davi');
    setActingRole('admin');
    expect((await acts.update(a.id, { title: 'Do admin' })).ownerId).toBe('ana'); // o dono nao muda
    setActingUser('ana');
    setActingRole('tecnico');
    expect((await acts.update(a.id, { title: 'Da Ana de novo' })).title).toBe('Da Ana de novo');
  });

  it('administrador desativado (sem papel) não edita a atividade de outro', async () => {
    const a = await ofAna();
    setActingUser('davi');
    setActingRole(null);
    expect(await code(acts.update(a.id, { title: 'X' }))).toBe('NOT_OWNER');
  });
});
