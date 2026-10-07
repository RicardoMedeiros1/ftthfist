import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB } from '../../db/db';
import type { Project } from '../../db/types';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { ActivityRuleError, activityRepo } from '../activities/activityRepo';
import { finishQuestionFor } from './finishQuestion';
import { shouldAskFinish } from './myProjects';
import type { LinkedActivity } from './types';

let db: RotaFibraDB;
let acts: ReturnType<typeof activityRepo>;
beforeEach(async () => {
  db = new RotaFibraDB(`finish-${crypto.randomUUID()}`);
  await db.open();
  acts = activityRepo(db);
  setActingUser('ana');
  setActingRole('tecnico');
});
afterEach(() => {
  setActingUser(null);
  setActingRole(null);
});

const P = (over: Partial<Project> = {}): Project => ({ id: 'p1', ownerId: 'adm', assignedTo: 'ana', title: 'Rua das Flores', kind: 'implantacao', description: '', address: '', status: 'aberto', deleted: false, createdAt: 1, updatedAt: 1, ...over });
const L = (over: Partial<LinkedActivity> = {}): LinkedActivity => ({ id: 'a1', title: 'T', technician: 'Ana', status: 'aberta', completesProject: false, deleted: false, ...over });
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as ActivityRuleError | null)?.code;

describe('shouldAskFinish', () => {
  it('pergunta enquanto o projeto esta para fazer', () => {
    expect(shouldAskFinish(P(), [L()])).toBe(true);
    expect(shouldAskFinish(P(), [L({ status: 'concluida' }), L({ id: 'a2' })])).toBe(true);
  });
  it('nao pergunta se o projeto nao existe aqui, foi excluido, esta cancelado ou concluido (a mao ou por outra atividade)', () => {
    expect(shouldAskFinish(undefined, [L()])).toBe(false);
    expect(shouldAskFinish(P({ deleted: true }), [L()])).toBe(false);
    expect(shouldAskFinish(P({ status: 'cancelado' }), [L()])).toBe(false);
    expect(shouldAskFinish(P({ status: 'concluido' }), [L()])).toBe(false);
    expect(shouldAskFinish(P(), [L({ id: 'a0', status: 'concluida', completesProject: true }), L()])).toBe(false);
  });
});

describe('finishQuestionFor (no banco do aparelho)', () => {
  it('atividade avulsa: nada a perguntar', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Avulsa' }, 'Ana');
    expect(await finishQuestionFor(a, db)).toBeNull();
  });
  it('atividade de projeto aberto: pergunta, com o nome do projeto', async () => {
    await db.projects.add(P());
    const a = await acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana');
    expect(await finishQuestionFor(a, db)).toEqual({ id: 'p1', title: 'Rua das Flores' });
  });
  it('projeto que nao chegou ao aparelho, cancelado ou excluido: nao pergunta', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana');
    expect(await finishQuestionFor(a, db)).toBeNull();
    await db.projects.add(P({ status: 'cancelado' }));
    expect(await finishQuestionFor(a, db)).toBeNull();
    await db.projects.put(P({ deleted: true }));
    expect(await finishQuestionFor(a, db)).toBeNull();
  });
  it('projeto ja concluido por outra atividade: nao pergunta de novo', async () => {
    await db.projects.add(P());
    const first = await acts.create({ kind: 'implantacao', title: 'Primeira', projectId: 'p1' }, 'Ana');
    await acts.complete(first.id, { finishesProject: true });
    const second = await acts.create({ kind: 'implantacao', title: 'Segunda', projectId: 'p1' }, 'Ana');
    expect(await finishQuestionFor(second, db)).toBeNull();
  });
  it('so conta as atividades do proprio projeto', async () => {
    await db.projects.bulkAdd([P(), P({ id: 'p2', title: 'Outro' })]);
    const a = await acts.create({ kind: 'implantacao', title: 'No p1', projectId: 'p1' }, 'Ana');
    await acts.complete(a.id, { finishesProject: true });
    const b = await acts.create({ kind: 'implantacao', title: 'No p2', projectId: 'p2' }, 'Ana');
    expect(await finishQuestionFor(b, db)).toEqual({ id: 'p2', title: 'Outro' });
  });
});

describe('concluir a atividade de um projeto', () => {
  it('"sim": a atividade conclui e marca que terminou o projeto (pendente de envio)', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana');
    await db.activities.update(a.id, { syncStatus: 'synced' });
    await acts.complete(a.id, { finishesProject: true });
    expect(await db.activities.get(a.id)).toMatchObject({ status: 'concluida', completesProject: true, syncStatus: 'pending' });
    expect((await db.activities.get(a.id))!.endedAt).toBeGreaterThan(0);
  });
  it('"nao" ou sem dizer nada: conclui sem marcar', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A', projectId: 'p1' }, 'Ana');
    await acts.complete(a.id, { finishesProject: false });
    expect(await db.activities.get(a.id)).toMatchObject({ status: 'concluida' });
    expect(await db.activities.get(a.id)).not.toHaveProperty('completesProject');
    const b = await acts.create({ kind: 'implantacao', title: 'B', projectId: 'p1' }, 'Ana');
    await acts.complete(b.id);
    expect(await db.activities.get(b.id)).not.toHaveProperty('completesProject');
  });
  it('atividade avulsa nunca "termina projeto", mesmo que peçam', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'Avulsa' }, 'Ana');
    await acts.complete(a.id, { finishesProject: true });
    expect(await db.activities.get(a.id)).not.toHaveProperty('completesProject');
  });
  it('concluir de novo uma ja concluida nao muda nada (nem o "sim")', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A', projectId: 'p1' }, 'Ana');
    await acts.complete(a.id);
    const before = await db.activities.get(a.id);
    await acts.complete(a.id, { finishesProject: true });
    expect(await db.activities.get(a.id)).toEqual(before);
  });
});

describe('setFinishesProject (desfazer ou refazer o "terminou o projeto")', () => {
  it('liga e desliga, e cada mudanca fica pendente de envio', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A', projectId: 'p1' }, 'Ana');
    await acts.complete(a.id);
    await db.activities.update(a.id, { syncStatus: 'synced' });
    await acts.setFinishesProject(a.id, true);
    expect(await db.activities.get(a.id)).toMatchObject({ completesProject: true, syncStatus: 'pending' });
    await db.activities.update(a.id, { syncStatus: 'synced' });
    await acts.setFinishesProject(a.id, false);
    const got = await db.activities.get(a.id);
    expect(got).toMatchObject({ syncStatus: 'pending' });
    expect(got).not.toHaveProperty('completesProject');
  });
  it('repetir o mesmo valor nao mexe em nada (nao gera envio a toa)', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A', projectId: 'p1' }, 'Ana');
    await db.activities.update(a.id, { syncStatus: 'synced' });
    await acts.setFinishesProject(a.id, false);
    expect((await db.activities.get(a.id))!.syncStatus).toBe('synced');
  });
  it('so para atividade de projeto, que existe, e de quem pode alterar', async () => {
    const free = await acts.create({ kind: 'implantacao', title: 'Avulsa' }, 'Ana');
    expect(await code(acts.setFinishesProject(free.id, true))).toBe('NO_PROJECT');
    expect(await code(acts.setFinishesProject('nao-existe', true))).toBe('NOT_FOUND');
    await acts.complete(free.id);
    setActingUser('outro');
    const mine = await acts.create({ kind: 'implantacao', title: 'Dele', projectId: 'p1' }, 'Outro');
    setActingUser('ana');
    expect(await code(acts.setFinishesProject(mine.id, true))).toBe('NOT_OWNER');
  });
  it('o administrador pode mudar o de um tecnico (reabrir o projeto)', async () => {
    const a = await acts.create({ kind: 'implantacao', title: 'A', projectId: 'p1' }, 'Ana');
    await acts.complete(a.id, { finishesProject: true });
    setActingUser('davi');
    setActingRole('admin');
    await acts.setFinishesProject(a.id, false);
    expect(await db.activities.get(a.id)).not.toHaveProperty('completesProject');
  });
});
