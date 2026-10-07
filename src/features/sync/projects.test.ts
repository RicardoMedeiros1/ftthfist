import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActingRole, setActingUser } from '../../lib/ownership';
import type { Role } from './engine';
import { CycleAbort } from './engine';
import { SyncHttpError } from './remote';
import { Device, fieldWork } from './testDevice';
import { TestServer } from './testServer';

// Os projetos designados descem para o aparelho (so leitura): cada tecnico recebe so os dele, e o que sai da mao dele some.

let server: TestServer;
const dev = (userId: string, role: Role = 'tecnico', tuning = {}) => new Device(server.client(userId), userId, role, tuning);
let ana: Device;
let bia: Device;
let davi: Device;
let clara: Device;
beforeEach(async () => {
  server = new TestServer();
  server.addUser('ana');
  server.addUser('bia');
  server.addUser('davi', 'admin');
  server.addUser('clara', 'escritorio');
  [ana, bia, davi, clara] = await Promise.all([dev('ana').open(), dev('bia').open(), dev('davi', 'admin').open(), dev('clara', 'escritorio').open()]);
});
afterEach(() => {
  setActingUser(null);
  setActingRole(null);
});

const save = (id: string, assignedTo: string, extra: Record<string, unknown> = {}) => server.saveProject({ id, assigned_to: assignedTo, title: `Projeto ${id}`, ...extra });
const ids = async (d: Device) => (await d.db.projects.toArray()).map((p) => p.id).sort();

describe('quem recebe o quê', () => {
  it('o tecnico recebe so os projetos designados a ele; administrador e escritorio recebem todos', async () => {
    save('p1', 'ana');
    save('p2', 'bia');
    save('p3', 'ana');
    for (const d of [ana, bia, davi, clara]) await d.sync();
    expect(await ids(ana)).toEqual(['p1', 'p3']);
    expect(await ids(bia)).toEqual(['p2']);
    expect(await ids(davi)).toEqual(['p1', 'p2', 'p3']);
    expect(await ids(clara)).toEqual(['p1', 'p2', 'p3']);
  });

  it('chega traduzido para o modelo do app (camelCase, ponto, prazo, OS)', async () => {
    save('p1', 'ana', { kind: 'manutencao', os_number: 'OS-7', description: 'trocar', address: 'Rua X', lat: -23.5, lng: -46.6, due_date: '2026-10-20', owner_id: 'davi' });
    await ana.sync();
    expect(await ana.db.projects.get('p1')).toMatchObject({
      id: 'p1', ownerId: 'davi', assignedTo: 'ana', title: 'Projeto p1', kind: 'manutencao', osNumber: 'OS-7', description: 'trocar', address: 'Rua X', lat: -23.5, lng: -46.6, dueDate: '2026-10-20', status: 'aberto', deleted: false,
    });
  });

  it('a copia local nunca e enviada: o ciclo nao tem nada pendente por causa dos projetos', async () => {
    save('p1', 'ana');
    const r = await ana.sync();
    expect(r.pushed).toBe(0);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0, tracks: 0 });
    expect(server.calls.filter((c) => c.fn === 'upsert')).toEqual([]);
  });

  it('o escritorio recebe e, sem poder escrever, nao tenta enviar nada', async () => {
    save('p1', 'ana');
    expect((await clara.sync()).pushed).toBe(0);
    expect(await ids(clara)).toEqual(['p1']);
  });
});

describe('mudancas depois', () => {
  it('alteracao, cancelamento e exclusao chegam pelo mesmo caminho (versao mais nova vence)', async () => {
    save('p1', 'ana', { title: 'Antes' });
    await ana.sync();
    save('p1', 'ana', { title: 'Depois', status: 'cancelado' });
    await ana.sync();
    expect(await ana.db.projects.get('p1')).toMatchObject({ title: 'Depois', status: 'cancelado', deleted: false });
    save('p1', 'ana', { deleted: true });
    await ana.sync();
    expect(await ana.db.projects.get('p1')).toMatchObject({ deleted: true });
  });

  it('uma versao mais antiga nunca sobrepoe a mais nova (pagina repetida pela sobreposicao do cursor)', async () => {
    save('p1', 'ana', { title: 'Nova' });
    await ana.sync();
    const stale = { ...server.get('projects', 'p1')!, title: 'Velha', updated_at: new Date(Date.now() - 60_000).toISOString() };
    server.rows.projects!.set('p1', stale);
    await ana.sync();
    expect((await ana.db.projects.get('p1'))!.title).toBe('Nova');
  });

  it('muitos projetos em varias paginas chegam todos, sem repetir nem pular', async () => {
    const small = await dev('ana', 'tecnico', { pullPage: 2 }).open();
    for (let i = 0; i < 7; i++) save(`p${i}`, 'ana');
    await small.sync();
    expect(await ids(small)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });

  it('o cursor guarda onde parou: o proximo ciclo so traz o que mudou', async () => {
    save('p1', 'ana');
    await ana.sync();
    server.calls.length = 0;
    save('p2', 'ana');
    const r = await ana.sync();
    expect(r.pulled).toBeGreaterThanOrEqual(1);
    expect(await ids(ana)).toEqual(['p1', 'p2']);
    const projectPulls = server.calls.filter((c) => c.fn === 'pull' && c.table === 'projects');
    expect(projectPulls).toHaveLength(1);
    expect(Date.parse(projectPulls[0]!.query!.since)).toBeGreaterThan(Date.now() - 24 * 3600_000); // nao recomeca do zero
  });
});

describe('projeto passado a outro tecnico', () => {
  it('some do aparelho de quem tinha (o servidor so mostra o que e seu) e aparece no do novo', async () => {
    save('p1', 'ana');
    await ana.sync();
    await bia.sync();
    expect(await ids(ana)).toEqual(['p1']);
    expect(await ids(bia)).toEqual([]);
    save('p1', 'bia');
    await ana.sync();
    await bia.sync();
    expect(await ids(ana)).toEqual([]);
    expect(await ids(bia)).toEqual(['p1']);
  });

  it('so confere os abertos; o historico (concluido, cancelado, excluido) nao gera consulta', async () => {
    save('p1', 'ana', { status: 'cancelado' });
    save('p2', 'ana', { deleted: true });
    save('p3', 'ana', { status: 'concluido' });
    await ana.sync();
    server.calls.length = 0;
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds')).toEqual([]);
  });

  it('com projetos abertos, uma consulta por ciclo (e nenhuma sem eles)', async () => {
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds')).toEqual([]);
    save('p1', 'ana');
    save('p2', 'ana');
    await ana.sync();
    server.calls.length = 0;
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds').map((c) => `${c.table}:${c.n}`)).toEqual(['projects:2']);
  });

  it('muitos abertos: consulta em lotes de 50 e tira so os que sairam', async () => {
    for (let i = 0; i < 120; i++) save(`p${String(i).padStart(3, '0')}`, 'ana');
    await ana.sync();
    expect(await ana.db.projects.count()).toBe(120);
    for (let i = 0; i < 120; i += 2) save(`p${String(i).padStart(3, '0')}`, 'bia'); // os pares vao para a Bia
    server.calls.length = 0;
    await ana.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds').map((c) => c.n)).toEqual([50, 50, 20]);
    const left = await ids(ana);
    expect(left).toHaveLength(60);
    expect(left.every((id) => Number(id.slice(1)) % 2 === 1)).toBe(true);
  });

  it('administrador e escritorio leem todos: nada sai do aparelho deles, so atualiza', async () => {
    save('p1', 'ana');
    await davi.sync();
    save('p1', 'bia');
    server.calls.length = 0;
    await davi.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds')).toEqual([]);
    expect((await davi.db.projects.get('p1'))!.assignedTo).toBe('bia');
  });

  it('administrador que tambem faz campo: ve o projeto dele, mesmo lendo todos', async () => {
    save('p1', 'davi');
    save('p2', 'ana');
    await davi.sync();
    expect((await davi.db.projects.toArray()).filter((p) => p.assignedTo === 'davi').map((p) => p.id)).toEqual(['p1']);
    server.calls.length = 0;
    await davi.sync();
    expect(server.calls.filter((c) => c.fn === 'fetchByIds')).toEqual([]); // le todos: nao precisa conferir o que e dele
  });
});

describe('quando a rede ou o servidor falham', () => {
  it('sem rede o ciclo falha como sempre e o que ja estava no aparelho continua la', async () => {
    save('p1', 'ana');
    await ana.sync();
    server.down = true;
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    server.down = false;
    expect(await ids(ana)).toEqual(['p1']);
  });

  it('a conferencia de reatribuicao tambem respeita a rede: cair no meio nao apaga nada', async () => {
    let drop = false;
    const base = server.client('ana');
    const flaky = { ...base, fetchByIds: (t: string, i: string[]) => (drop ? Promise.reject(new SyncHttpError('network', 'Failed to fetch')) : base.fetchByIds(t, i)) };
    const d = await new Device(flaky, 'ana').open();
    save('p1', 'ana');
    await d.sync();
    drop = true;
    await expect(d.sync()).rejects.toMatchObject({ reason: 'network' });
    expect(await ids(d)).toEqual(['p1']); // a conferencia nao conseguiu perguntar: nao conclui que o projeto saiu
  });

  it('a conferencia recusada de forma permanente (ex.: sem permissao) nao derruba o ciclo nem apaga projeto', async () => {
    let refuse = false;
    const base = server.client('ana');
    const remote = { ...base, fetchByIds: (t: string, i: string[]) => (refuse ? Promise.reject(new SyncHttpError('permanent', 'permission denied', 403, '42501')) : base.fetchByIds(t, i)) };
    const d = await new Device(remote, 'ana').open();
    save('p1', 'ana');
    await d.sync();
    refuse = true;
    await expect(d.sync()).resolves.toBeDefined();
    expect(await ids(d)).toEqual(['p1']);
  });

  it('servidor sem a migration dos projetos: o resto sincroniza normalmente, sem erro e sem tentar de novo a cada ciclo cheio', async () => {
    server.missingTables.add('projects');
    const w = await fieldWork(ana);
    const r = await ana.sync();
    expect(r.pushed).toBe(7);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0, tracks: 0 });
    expect(server.get('activities', w.act.id)).toBeDefined();
    expect(await ids(ana)).toEqual([]);
    // quando o servidor passa a ter a tabela, os projetos chegam
    server.missingTables.delete('projects');
    save('p1', 'ana');
    await ana.sync();
    expect(await ids(ana)).toEqual(['p1']);
  });

  it('erro de sessao ou do servidor ao baixar projetos continua abortando o ciclo (so o "nao existe" e perdoado)', async () => {
    const base = server.client('ana');
    const expired = { ...base, pull: (t: string, q: Parameters<typeof base.pull>[1]) => (t === 'projects' ? Promise.reject(new SyncHttpError('auth', 'JWT expired', 401, 'PGRST301')) : base.pull(t, q)) };
    const d = await new Device(expired, 'ana').open();
    await expect(d.sync()).rejects.toMatchObject({ reason: 'auth' });
  });
});

describe('atividade ligada ao projeto', () => {
  it('sobe com project_id e completes_project; a avulsa sobe como sempre, sem essas colunas', async () => {
    save('p1', 'ana');
    await ana.sync();
    const linked = await ana.as(() => ana.acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana'));
    await ana.sync();
    expect(server.get('activities', linked.id)).toMatchObject({ project_id: 'p1', completes_project: false });
    await ana.as(() => ana.acts.complete(linked.id));
    const free = await ana.as(() => ana.acts.create({ kind: 'manutencao', title: 'Avulsa' }, 'Ana'));
    await ana.sync();
    const row = server.get('activities', free.id)!;
    expect('project_id' in row || 'completes_project' in row).toBe(false);
  });

  it('o projeto tem que existir no servidor: sem ele a atividade espera (nao e recusada nem some)', async () => {
    const a = await ana.as(() => ana.acts.create({ kind: 'implantacao', title: 'Orfa', projectId: 'nao-existe' }, 'Ana'));
    const r = await ana.sync();
    expect(r.waiting).toBeGreaterThanOrEqual(1);
    expect(await ana.counts()).toMatchObject({ pending: 1, blocked: 0 });
    expect(server.get('activities', a.id)).toBeUndefined();
    save('nao-existe', 'ana');
    await ana.sync();
    expect(server.get('activities', a.id)).toMatchObject({ project_id: 'nao-existe' });
    expect((await ana.counts()).pending).toBe(0);
  });

  it('trabalho feito sem internet sobe mesmo se o projeto foi cancelado, excluido ou passado a outro enquanto isso', async () => {
    save('p1', 'ana');
    await ana.sync();
    const a = await ana.as(() => ana.acts.create({ kind: 'implantacao', title: 'No campo', projectId: 'p1' }, 'Ana'));
    save('p1', 'bia', { status: 'cancelado', deleted: true });
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(0);
    expect(server.get('activities', a.id)).toMatchObject({ project_id: 'p1' });
    expect((await ana.counts()).pending).toBe(0);
  });

  it('as atividades ligadas chegam aos outros aparelhos com projectId e completesProject (o escritorio e o administrador veem o andamento)', async () => {
    save('p1', 'ana');
    await ana.sync();
    const a = await ana.as(() => ana.acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana'));
    await ana.db.activities.update(a.id, { completesProject: true, status: 'concluida', updatedAt: Date.now() + 1, syncStatus: 'pending' });
    await ana.sync();
    await davi.sync();
    expect(await davi.db.activities.get(a.id)).toMatchObject({ projectId: 'p1', completesProject: true, status: 'concluida' });
    await clara.sync();
    expect(await clara.db.activities.get(a.id)).toMatchObject({ projectId: 'p1' });
  });

  it('uma atividade sem completesProject chega sem o campo (nada de false disfarcado)', async () => {
    save('p1', 'ana');
    await ana.sync();
    const a = await ana.as(() => ana.acts.create({ kind: 'implantacao', title: 'Do projeto', projectId: 'p1' }, 'Ana'));
    await ana.sync();
    await davi.sync();
    const got = (await davi.db.activities.get(a.id))!;
    expect(got.projectId).toBe('p1');
    expect('completesProject' in got).toBe(false);
  });
});

describe('desenho do projeto', () => {
  const plan = { lines: [{ id: 'l1', points: [[-23.55, -46.63], [-23.551, -46.631]] }], points: [{ id: 'p1', type: 'cto', lat: -23.55, lng: -46.63, code: 'CTO-1' }] };
  it('chega ao tecnico junto com o projeto, e ao administrador e ao escritorio', async () => {
    save('p1', 'ana', { plan });
    for (const d of [ana, davi, clara]) await d.sync();
    for (const d of [ana, davi, clara]) expect((await d.db.projects.get('p1'))!.plan, d.userId).toEqual(plan);
  });
  it('mudar o desenho chega como qualquer outra mudanca, e apagar tambem', async () => {
    save('p1', 'ana', { plan });
    await ana.sync();
    const plan2 = { lines: [], points: [{ id: 'p2', type: 'poste', lat: 1, lng: 2 }] };
    save('p1', 'ana', { plan: plan2 });
    await ana.sync();
    expect((await ana.db.projects.get('p1'))!.plan).toEqual(plan2);
    save('p1', 'ana', { plan: null });
    await ana.sync();
    expect('plan' in (await ana.db.projects.get('p1'))!).toBe(false);
  });
  it('projeto sem desenho nao ganha o campo', async () => {
    save('p1', 'ana');
    await ana.sync();
    expect('plan' in (await ana.db.projects.get('p1'))!).toBe(false);
  });
  it('desenho corrompido no servidor nao derruba o projeto: ele chega sem o que nao presta', async () => {
    save('p1', 'ana', { plan: { lines: [{ id: 'a', points: [[0, 0]] }], points: [{ id: 'ok', type: 'poste', lat: 1, lng: 2 }, { id: 'ruim', type: 'zzz', lat: 1, lng: 2 }] } });
    await ana.sync();
    expect((await ana.db.projects.get('p1'))!.plan).toEqual({ lines: [], points: [{ id: 'ok', type: 'poste', lat: 1, lng: 2 }] });
  });
});

