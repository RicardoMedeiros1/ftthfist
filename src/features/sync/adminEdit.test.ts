import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { photoRepo } from '../elements/photoRepo';
import type { Role } from './engine';
import { Device, fieldWork } from './testDevice';
import { TestServer } from './testServer';

// O administrador altera o que e dos tecnicos: o dono nao muda, o tecnico recebe a alteracao, e o que nunca chegou
// ao servidor nunca e enviado em nome do administrador.

let server: TestServer;
let ana: Device; // tecnica
let davi: Device; // administrador
const dev = (userId: string, role: Role) => new Device(server.client(userId), userId, role).open();
const codeOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as { code?: string } | null)?.code;

beforeEach(async () => {
  server = new TestServer();
  server.addUser('ana');
  server.addUser('davi', 'admin');
  server.addUser('clara', 'escritorio');
  ana = await dev('ana', 'tecnico');
  davi = await dev('davi', 'admin');
});
afterEach(() => { setActingUser(null); setActingRole(null); });

/** A Ana trabalha e sobe; o administrador baixa. */
async function seeded() {
  const work = await fieldWork(ana, 'Ana');
  await ana.sync();
  await davi.sync();
  return work;
}

describe('o administrador altera o que e do tecnico', () => {
  it('edita o poste: o servidor guarda a alteracao, o dono continua o mesmo e fica o registro de quem mexeu', async () => {
    const { p1 } = await seeded();
    await davi.as(() => davi.els.update(p1.id, { code: 'P-DO-ADMIN' }));
    expect(await davi.counts()).toMatchObject({ pending: 1, blocked: 0 });
    const r = await davi.sync();
    expect(r.pushed).toBe(1);
    const row = server.get('elements', p1.id)!;
    expect(row).toMatchObject({ code: 'P-DO-ADMIN', owner_id: 'ana', updated_by: 'davi' });
    expect(server.adminEdits).toHaveLength(1);
    expect(server.adminEdits[0]).toMatchObject({ table: 'elements', id: p1.id, ownerId: 'ana', editedBy: 'davi' });
    expect(await davi.counts()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it('a tecnica recebe a alteracao (continua sendo a dona) e nao fica nada pendente', async () => {
    const { p1 } = await seeded();
    await davi.as(() => davi.els.update(p1.id, { code: 'P-DO-ADMIN' }));
    await davi.sync();
    await ana.sync();
    const got = (await ana.db.elements.get(p1.id))!;
    expect(got).toMatchObject({ code: 'P-DO-ADMIN', ownerId: 'ana', updatedBy: 'davi', syncStatus: 'synced' });
    expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
    // e ela continua podendo editar o que e dela
    await ana.as(() => ana.els.update(p1.id, { code: 'P-VOLTOU' }));
    await ana.sync();
    expect(server.get('elements', p1.id)).toMatchObject({ code: 'P-VOLTOU', updated_by: 'ana' });
  });

  it('mover o poste de um tecnico leva junto o cabo dele (o administrador envia as duas alteracoes)', async () => {
    const { p1, cable } = await seeded();
    await davi.as(() => davi.els.move(p1.id, { lat: -23.56, lng: -46.64, positionSource: 'manual' }));
    expect(await davi.counts()).toMatchObject({ pending: 2, blocked: 0 });
    await davi.sync();
    expect(server.get('elements', p1.id)).toMatchObject({ lat: -23.56, lng: -46.64, owner_id: 'ana' });
    const v = server.get('cables', cable.id)!.vertices as Array<{ lat: number; lng: number }>;
    expect(v[0]).toMatchObject({ lat: -23.56, lng: -46.64 });
    expect(server.adminEdits.map((e) => e.table).sort()).toEqual(['cables', 'elements']);
  });

  it('exclui (logico) o poste, o cabo e a atividade de um tecnico; o tecnico ve como excluidos', async () => {
    const { p1, cable, act } = await seeded();
    await davi.as(async () => {
      await davi.cables.remove(cable.id);
      await davi.els.remove(p1.id);
      await davi.acts.complete(act.id);
    });
    await davi.sync();
    expect(server.get('cables', cable.id)).toMatchObject({ deleted: true, owner_id: 'ana' });
    expect(server.get('elements', p1.id)).toMatchObject({ deleted: true });
    expect(server.get('activities', act.id)).toMatchObject({ status: 'concluida', owner_id: 'ana' });
    await ana.sync();
    expect((await ana.db.elements.get(p1.id))?.deleted).toBe(true);
    expect((await ana.db.activities.get(act.id))?.status).toBe('concluida');
  });

  it('foto do tecnico: o administrador pode excluir, mas nao acrescentar a um elemento dele', async () => {
    const { p1 } = await seeded();
    const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) }, 'Ana'));
    await ana.sync();
    await davi.sync();
    expect(await davi.as(() => photoRepo(davi.db).add(p1.id, { blob: new Blob([new Uint8Array([2])], { type: 'image/jpeg' }) }, 'Davi').then(() => null, (e: { code: string }) => e.code))).toBe('NOT_OWNER');
    await davi.as(() => photoRepo(davi.db).remove(photo.id));
    await davi.sync();
    expect(server.get('photos', photo.id)).toMatchObject({ deleted: true, owner_id: 'ana' });
  });
});

describe('quem NAO pode', () => {
  it('tecnico e escritorio continuam sem alterar o que e de outro', async () => {
    const { p1 } = await seeded();
    const bia = await (async () => { server.addUser('bia'); return dev('bia', 'tecnico'); })();
    await bia.sync();
    expect(await codeOf(bia.as(() => bia.els.update(p1.id, { code: 'X' })))).toBe('NOT_OWNER');
    const clara = await dev('clara', 'escritorio');
    await clara.sync();
    expect(await codeOf(clara.as(() => clara.els.update(p1.id, { code: 'X' })))).toBe('NOT_OWNER');
  });

  it('administrador DESATIVADO (sem papel ativo) perde o poder de alterar na hora', async () => {
    const { p1 } = await seeded();
    await davi.as(async () => undefined);
    setActingRole(null); // o perfil foi desativado
    expect(await codeOf(davi.els.update(p1.id, { code: 'X' }))).toBe('NOT_OWNER');
  });

  it('o administrador NAO cria registro dentro da atividade de um tecnico: nao tem como pela interface (usa a atividade aberta dele)', async () => {
    await seeded();
    const err = await codeOf(davi.as(() => davi.els.create({ type: 'poste', lat: -23.5, lng: -46.6, accuracy: 4, positionSource: 'gps' }, 'Davi')));
    expect(err).toBe('NO_OPEN_ACTIVITY'); // a atividade aberta e a da Ana, nao a dele
  });
});

describe('a atividade aberta do administrador e a DELE', () => {
  it('a atividade aberta de um tecnico nao e a do administrador: ele inicia a propria e marca nela', async () => {
    await seeded(); // a atividade da Ana segue aberta
    expect(await davi.as(() => davi.acts.getOpen())).toBeNull();
    const mine = await davi.as(() => davi.acts.create({ kind: 'manutencao', title: 'Vistoria do admin' }, 'Davi'));
    expect(mine.ownerId).toBe('davi');
    const el = await davi.as(() => davi.els.create({ type: 'poste', lat: -23.5, lng: -46.6, accuracy: 4, positionSource: 'gps' }, 'Davi'));
    expect(el).toMatchObject({ ownerId: 'davi', activityId: mine.id });
    await davi.sync();
    expect(server.get('elements', el.id)).toMatchObject({ owner_id: 'davi', updated_by: 'davi' });
    expect(server.adminEdits).toEqual([]); // o que e dele nao entra no registro
  });
});

describe('envio do que e de outros (nunca em nome do administrador)', () => {
  it('registro de outro tecnico que NUNCA chegou ao servidor nao e enviado pelo administrador (aparelho compartilhado)', async () => {
    // a Ana trabalha offline no mesmo aparelho do administrador, sem nunca ter sincronizado
    const shared = await dev('davi', 'admin');
    const work = await fieldWork(ana, 'Ana');
    await shared.db.activities.bulkAdd(await ana.db.activities.toArray());
    await shared.db.elements.bulkAdd(await ana.db.elements.toArray());
    expect(work.p1.ownerId).toBe('ana');
    expect(await shared.counts()).toMatchObject({ pending: 0, blocked: 0 }); // nao conta
    const r = await shared.sync();
    expect(r.pushed).toBe(0);
    expect(server.count('activities')).toBe(0); // e nada foi criado em nome do administrador
    expect(server.calls.filter((c) => c.fn === 'upsert' && c.who === 'davi')).toEqual([]);
  });

  it('um tecnico (sem papel de administrador) nunca envia o que e de outro, mesmo vindo do servidor', async () => {
    const { p1 } = await seeded();
    server.addUser('bia');
    const bia = await dev('bia', 'tecnico');
    await bia.sync();
    await bia.db.elements.update(p1.id, { code: 'HACK', updatedAt: Date.now() + 1000, syncStatus: 'pending' });
    expect(await bia.counts()).toMatchObject({ pending: 0, blocked: 0 });
    expect((await bia.sync()).pushed).toBe(0);
    expect(server.get('elements', p1.id)?.code).not.toBe('HACK');
  });

  it('a edicao do administrador perde para uma alteracao MAIS RECENTE da tecnica: ele passa a ver a dela e e avisado', async () => {
    const { p1 } = await seeded();
    const t0 = (await davi.db.elements.get(p1.id))!.updatedAt;
    await davi.db.elements.update(p1.id, { code: 'DO-ADMIN', updatedAt: t0 + 1000, syncStatus: 'pending' });
    await ana.db.elements.update(p1.id, { code: 'DA-TECNICA', updatedAt: t0 + 2000, syncStatus: 'pending' });
    await ana.sync(); // a dela chega primeiro e e mais recente
    const r = await davi.sync();
    expect(r.lostEdits).toBe(1);
    expect(server.get('elements', p1.id)?.code).toBe('DA-TECNICA');
    expect((await davi.db.elements.get(p1.id))?.code).toBe('DA-TECNICA');
    expect(server.adminEdits).toHaveLength(0); // a do administrador nao chegou a ser gravada
  });

  it('a edicao do administrador, mais recente, vale sobre a da tecnica (que e avisada ao sincronizar)', async () => {
    const { p1 } = await seeded();
    const t0 = (await davi.db.elements.get(p1.id))!.updatedAt;
    await ana.db.elements.update(p1.id, { code: 'DA-TECNICA', updatedAt: t0 + 1000, syncStatus: 'pending' });
    await davi.db.elements.update(p1.id, { code: 'DO-ADMIN', updatedAt: t0 + 2000, syncStatus: 'pending' });
    await davi.sync();
    const r = await ana.sync();
    expect(r.lostEdits).toBe(1);
    expect((await ana.db.elements.get(p1.id))?.code).toBe('DO-ADMIN');
  });
});

describe('reabrir atividade: uma aberta por tecnico', () => {
  it('o administrador reabre a atividade de um tecnico mesmo tendo uma aberta dele; mas nao se o TECNICO ja tem outra', async () => {
    const { act } = await seeded();
    await ana.as(() => ana.acts.complete(act.id));
    await ana.sync();
    await davi.sync();
    await davi.as(() => davi.acts.create({ kind: 'manutencao', title: 'Do admin' }, 'Davi')); // o admin tem uma aberta
    await davi.as(() => davi.acts.reopen(act.id)); // reabrir a da Ana: permitido
    expect((await davi.db.activities.get(act.id))?.status).toBe('aberta');
    // a Ana ja tem a atividade aberta; abrir uma segunda de novo para ela e barrado
    await davi.as(() => davi.acts.complete(act.id));
    await davi.sync();
    await ana.sync();
    const second = await ana.as(() => ana.acts.create({ kind: 'manutencao', title: 'Segunda da Ana' }, 'Ana'));
    await ana.sync();
    await davi.sync();
    expect((await davi.db.activities.get(second.id))?.status).toBe('aberta');
    const err = await davi.as(() => davi.acts.reopen(act.id).then(() => null, (e: { code: string }) => e.code));
    expect(err).toBe('ALREADY_OPEN');
  });
});

describe('o administrador exclui a atividade de um tecnico', () => {
  it('a atividade e tudo o que e dela ficam excluidos no servidor (o dono nao muda) e o administrador nao ve "alteracoes substituidas"', async () => {
    const { act, p1, p2, cable } = await seeded();
    const removal = await davi.as(() => davi.acts.remove(act.id));
    expect(removal).toMatchObject({ elements: 2, cables: 1, photos: 0, trackPoints: 0 }); // a trilha da Ana nunca foi baixada para o administrador
    const r = await davi.sync();
    expect(r.pushed).toBe(4);
    expect(r.lostEdits).toBe(0);
    for (const [table, id] of [['activities', act.id], ['elements', p1.id], ['elements', p2.id], ['cables', cable.id]] as const) {
      expect(server.get(table, id), `${table} ${id}`).toMatchObject({ deleted: true, owner_id: 'ana', updated_by: 'davi' });
    }
    expect(server.adminEdits.filter((e) => e.after.deleted === true)).toHaveLength(4); // fica registrado quem excluiu cada um
    expect(await davi.counts()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it('a tecnica recebe: some da lista dela, nada fica pendente e a atividade aberta deixa de existir', async () => {
    const { act, p1 } = await seeded();
    await davi.as(() => davi.acts.remove(act.id));
    await davi.sync();
    const r = await ana.sync();
    expect(r.lostEdits).toBe(0);
    expect(await ana.as(() => ana.acts.list())).toEqual([]);
    expect(await ana.as(() => ana.acts.getOpen())).toBeNull();
    expect((await ana.db.elements.get(p1.id))).toMatchObject({ deleted: true, ownerId: 'ana', syncStatus: 'synced' });
    expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it('o dono excluindo a propria atividade tambem sobe a trilha como excluida', async () => {
    const { act, track } = await seeded();
    const removal = await ana.as(() => ana.acts.remove(act.id));
    expect(removal.trackPoints).toBe(3);
    await ana.sync();
    for (const t of track) expect(server.get('track_points', t.id), t.id).toMatchObject({ deleted: true });
    expect(server.get('activities', act.id)).toMatchObject({ deleted: true });
  });

  it('o escritorio nao exclui (so leitura): o app recusa antes de gravar qualquer coisa', async () => {
    const clara = await dev('clara', 'escritorio');
    const { act } = await seeded();
    await clara.sync();
    const err = await clara.as(() => clara.acts.remove(act.id).then(() => null, (e: { code: string }) => e.code));
    expect(err).toBe('NOT_OWNER');
    expect(await clara.counts()).toMatchObject({ pending: 0 });
  });
});
