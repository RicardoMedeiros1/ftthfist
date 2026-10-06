import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActingUser } from '../../lib/ownership';
import { photoRepo } from '../elements/photoRepo';
import { CycleAbort, createSyncEngine, type Role } from './engine';
import { createPhotoFiles, needsDownload } from './photoFiles';
import { SyncHttpError, type RemoteApi } from './remote';
import { Device, fieldWork } from './testDevice';
import { TestServer } from './testServer';

const jpeg = (...bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
const bytesOf = async (b: Blob) => Array.from(new Uint8Array(await b.arrayBuffer()));

let server: TestServer;
const dev = (userId: string, role: Role = 'tecnico', remote?: RemoteApi) => new Device(remote ?? server.client(userId), userId, role).open();

beforeEach(() => {
  server = new TestServer();
  server.addUser('ana');
  server.addUser('bia');
});
afterEach(() => setActingUser(null));

/** Ana com o trabalho de campo e 2 fotos no poste P-1 (tudo ainda no aparelho). */
async function anaWithPhotos(ana: Device) {
  const work = await fieldWork(ana, 'Ana');
  const [a, b] = await ana.as(async () => [
    await photoRepo(ana.db).add(work.p1.id, { blob: jpeg(1, 2, 3) }, 'Ana'),
    await photoRepo(ana.db).add(work.p1.id, { blob: jpeg(4, 5) }, 'Ana'),
  ]);
  return { ...work, a: a!, b: b! };
}
const callsOf = (...fns: string[]) => server.calls.filter((c) => fns.includes(c.fn));

describe('enviar fotos', () => {
  it('o arquivo sobe primeiro, depois o registro (que aponta para o arquivo)', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    const r = await ana.sync();
    expect(r.pushed).toBe(1 + 2 + 1 + 2 + 3);
    const order = callsOf('upload', 'upsert').map((c) => (c.fn === 'upload' ? 'arquivo' : c.table));
    expect(order.indexOf('arquivo')).toBeGreaterThan(order.indexOf('cables')); // depois de atividade/elementos/cabos
    expect(order.lastIndexOf('arquivo')).toBeLessThan(order.indexOf('photos')); // todos os arquivos do lote antes do registro
    expect(server.files.has(`ana/${a.id}.jpg`)).toBe(true);
    expect(server.get('photos', a.id)).toMatchObject({ storage_path: `ana/${a.id}.jpg`, owner_id: 'ana', element_id: a.elementId, deleted: false });
  });

  it('o aparelho guarda o caminho, marca como enviada e continua com o arquivo', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.sync();
    const local = (await ana.db.photos.get(a.id))!;
    expect(local).toMatchObject({ syncStatus: 'synced', storagePath: `ana/${a.id}.jpg` });
    expect(await bytesOf(local.blob!)).toEqual([1, 2, 3]);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0 });
  });

  it('sem nada novo, não sobe arquivo nenhum de novo', async () => {
    const ana = await dev('ana');
    await anaWithPhotos(ana);
    await ana.sync();
    server.calls.length = 0;
    await ana.sync();
    expect(callsOf('upload', 'upsert')).toEqual([]);
  });

  it('as fotos entram na contagem de pendentes', async () => {
    const ana = await dev('ana');
    await anaWithPhotos(ana);
    expect((await ana.counts()).pending).toBe(1 + 2 + 1 + 2 + 3);
  });
});

describe('falhas no envio de fotos', () => {
  it('a internet cai no meio dos arquivos: o que já subiu não sobe de novo', async () => {
    const ana = await dev('ana');
    const { a, b } = await anaWithPhotos(ana);
    let uploads = 0;
    server.beforeRespond = () => {
      // cai depois do 1º arquivo
      if (server.calls.at(-1)?.fn === 'upload' && ++uploads === 1) server.down = true;
    };
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    expect(server.files.size).toBe(1);
    const first = (await ana.db.photos.toArray()).find((p) => p.storagePath);
    expect(first && [a.id, b.id].includes(first.id)).toBe(true);
    expect(first!.syncStatus).toBe('pending'); // o registro ainda não subiu
    server.down = false;
    server.beforeRespond = null;
    server.calls.length = 0;
    await ana.sync();
    expect(callsOf('upload')).toHaveLength(1); // só o que faltava
    expect(server.files.size).toBe(2);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0 });
  });

  it('a resposta do REGISTRO se perdeu: tentar de novo não reenvia o arquivo nem duplica', async () => {
    const base = server.client('ana');
    let lose = true;
    const flaky: RemoteApi = {
      ...base,
      upsert: async (t, rows) => {
        const res = await base.upsert(t, rows);
        if (lose && t === 'photos') {
          lose = false;
          throw new SyncHttpError('network', 'Failed to fetch');
        }
        return res;
      },
    };
    const ana = await dev('ana', 'tecnico', flaky);
    await anaWithPhotos(ana);
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    expect(server.count('photos')).toBe(2); // gravou
    server.calls.length = 0;
    await ana.sync();
    expect(callsOf('upload')).toEqual([]);
    expect(server.count('photos')).toBe(2);
    expect(await ana.counts()).toEqual({ pending: 0, blocked: 0 });
    expect(server.conflicts).toEqual([]);
  });

  it('arquivo grande demais é recusado: só aquela foto fica bloqueada', async () => {
    const ana = await dev('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    const big = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: new Blob([new Uint8Array(3 * 1024 * 1024 + 1)], { type: 'image/jpeg' }) }, 'Ana'));
    const ok = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: jpeg(9) }, 'Ana'));
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect(server.get('photos', ok.id)).toBeDefined();
    expect(server.get('photos', big.id)).toBeUndefined();
    const list = await ana.engine.blockedList(ana.who);
    expect(list).toMatchObject([{ table: 'photos', id: big.id }]);
    expect(list[0]!.message).toMatch(/maximum allowed size/);
  });

  it('foto pendente sem arquivo no aparelho é recusada com mensagem clara', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.db.photos.update(a.id, { blob: undefined });
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect((await ana.engine.blockedList(ana.who))[0]!.message).toMatch(/arquivo da foto/);
  });

  it('sessão vencida no envio do arquivo: para com "auth" e nada é bloqueado', async () => {
    const ana = await dev('ana');
    await anaWithPhotos(ana);
    const base = server.client('ana');
    const expired: RemoteApi = { ...base, uploadFile: async () => { throw new SyncHttpError('auth', 'exp claim timestamp check failed', 400, ''); } };
    const engine = createSyncEngine({ db: ana.db, remote: expired, now: Date.now });
    const e = await engine.runCycle(ana.who).then(() => null, (x: unknown) => x);
    expect((e as CycleAbort).reason).toBe('auth');
    expect((await engine.counts(ana.who)).blocked).toBe(0);
  });

  it('foto cujo elemento ainda não está no servidor espera (sem ser recusada)', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.db.photos.update(a.id, { elementId: crypto.randomUUID(), updatedAt: Date.now() + 5, syncStatus: 'pending' });
    const r = await ana.sync();
    expect(r.waiting).toBe(1);
    expect((await ana.counts()).blocked).toBe(0);
  });
});

describe('excluir foto', () => {
  it('foto excluída antes de subir: só o registro (excluído), sem arquivo', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.as(() => photoRepo(ana.db).remove(a.id));
    await ana.sync();
    expect(server.files.has(`ana/${a.id}.jpg`)).toBe(false);
    expect(server.get('photos', a.id)).toMatchObject({ deleted: true, storage_path: null });
  });

  it('foto excluída depois de subir: registro excluído; o arquivo continua no servidor (não existe apagar)', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.sync();
    await ana.as(() => photoRepo(ana.db).remove(a.id));
    await ana.sync();
    expect(server.get('photos', a.id)).toMatchObject({ deleted: true });
    expect(server.files.has(`ana/${a.id}.jpg`)).toBe(true);
  });
});

describe('fotos dos colegas', () => {
  async function biaWithPhotos() {
    const ana = await dev('ana');
    const work = await anaWithPhotos(ana);
    await ana.sync();
    const bia = await dev('bia');
    await bia.sync();
    return { ana, bia, ...work, files: createPhotoFiles({ db: bia.db, remote: server.client('bia') }) };
  }

  it('chega só o registro: sem arquivo, com o caminho, e nada é baixado sozinho', async () => {
    const { bia, a, p1 } = await biaWithPhotos();
    const got = (await bia.db.photos.get(a.id))!;
    expect(got).toMatchObject({ ownerId: 'ana', syncStatus: 'synced', storagePath: `ana/${a.id}.jpg`, elementId: p1.id });
    expect(got.blob).toBeUndefined();
    expect(needsDownload(got)).toBe(true);
    expect(callsOf('download')).toEqual([]);
    expect((await bia.counts()).pending).toBe(0);
  });

  it('abrir o elemento baixa os arquivos que faltam; sem alterar o estado de sincronização', async () => {
    const { bia, a, b, p1, files } = await biaWithPhotos();
    const r = await files.download(p1.id);
    expect(r).toEqual({ downloaded: 2, failed: 0, offline: false });
    const A = (await bia.db.photos.get(a.id))!;
    expect(await bytesOf(A.blob!)).toEqual([1, 2, 3]);
    expect(await bytesOf((await bia.db.photos.get(b.id))!.blob!)).toEqual([4, 5]);
    expect(A).toMatchObject({ syncStatus: 'synced', updatedAt: (await bia.db.photos.get(a.id))!.updatedAt });
    server.calls.length = 0;
    expect(await files.download(p1.id)).toEqual({ downloaded: 0, failed: 0, offline: false });
    expect(callsOf('download')).toEqual([]); // não baixa de novo
  });

  it('sem internet: não baixa, avisa, e baixa quando voltar', async () => {
    const { bia, a, p1, files } = await biaWithPhotos();
    server.down = true;
    expect(await files.download(p1.id)).toMatchObject({ downloaded: 0, offline: true });
    expect((await bia.db.photos.get(a.id))!.blob).toBeUndefined();
    server.down = false;
    expect(await files.download(p1.id)).toMatchObject({ downloaded: 2, offline: false });
  });

  it('arquivo que não existe no servidor: conta como falha, sem derrubar as outras', async () => {
    const { a, b, p1, files } = await biaWithPhotos();
    server.files.delete(`ana/${a.id}.jpg`);
    expect(await files.download(p1.id)).toEqual({ downloaded: 1, failed: 1, offline: false });
    expect(b.id).toBeTruthy();
  });

  it('duas aberturas ao mesmo tempo dividem o mesmo download', async () => {
    const { p1, files } = await biaWithPhotos();
    server.calls.length = 0;
    await Promise.all([files.download(p1.id), files.download(p1.id)]);
    expect(callsOf('download')).toHaveLength(2); // 2 fotos, uma vez cada
  });

  it('a atualização do registro (ex.: foto excluída pelo dono) não apaga o arquivo já baixado', async () => {
    const { ana, bia, a, p1, files } = await biaWithPhotos();
    await files.download(p1.id);
    await ana.as(() => photoRepo(ana.db).remove(a.id));
    await ana.sync();
    await bia.sync();
    const got = (await bia.db.photos.get(a.id))!;
    expect(got.deleted).toBe(true);
    expect(got.blob).toBeDefined();
  });

  it('a Bia não consegue excluir a foto da Ana (nem pelo app, nem pelo servidor)', async () => {
    const { bia, a } = await biaWithPhotos();
    const err = await bia.as(() => photoRepo(bia.db).remove(a.id)).then(() => null, (e: { code: string }) => e);
    expect(err?.code).toBe('NOT_OWNER');
  });

  it('o outro aparelho da própria Ana também recebe as fotos dela', async () => {
    const { p1, ana } = await biaWithPhotos();
    const ana2 = await dev('ana');
    await ana2.sync();
    const files = createPhotoFiles({ db: ana2.db, remote: server.client('ana') });
    expect(await files.download(p1.id)).toMatchObject({ downloaded: 2 });
    expect((await ana2.counts()).pending).toBe(0);
    expect(ana.userId).toBe('ana');
  });

  it('foto excluída pelo dono antes de eu abrir: não baixa o arquivo', async () => {
    const { ana, bia, a, p1, files } = await biaWithPhotos();
    await ana.as(() => photoRepo(ana.db).remove(a.id));
    await ana.sync();
    await bia.sync();
    server.calls.length = 0;
    const r = await files.download(p1.id);
    expect(r.downloaded).toBe(1); // só a foto que não foi excluída
    expect(callsOf('download')).toHaveLength(1);
  });

  it('cai a conexão: para na primeira (não fica tentando as outras)', async () => {
    const { p1, files } = await biaWithPhotos();
    server.down = true;
    server.calls.length = 0;
    await files.download(p1.id);
    expect(callsOf('download')).toHaveLength(1);
  });

  it('se o arquivo chegou por outro caminho enquanto baixava, o que já está lá não é sobrescrito', async () => {
    const { bia, a, p1 } = await biaWithPhotos();
    const base = server.client('bia');
    const racing = createPhotoFiles({
      db: bia.db,
      remote: {
        ...base,
        downloadFile: async (path) => {
          const got = await base.downloadFile(path);
          if (path.includes(a.id)) await bia.db.photos.update(a.id, { blob: jpeg(7) }); // chegou de outro lugar no meio
          return got;
        },
      },
    });
    await racing.download(p1.id);
    expect(await bytesOf((await bia.db.photos.get(a.id))!.blob!)).toEqual([7]);
  });

  it('foto sem arquivo no servidor ainda (registro excluído antes de subir) não pede download', async () => {
    const ana = await dev('ana');
    const { a } = await anaWithPhotos(ana);
    await ana.as(() => photoRepo(ana.db).remove(a.id));
    await ana.sync();
    const bia = await dev('bia');
    await bia.sync();
    const got = (await bia.db.photos.get(a.id))!;
    expect(got.storagePath).toBeUndefined();
    expect(needsDownload(got)).toBe(false);
  });
});
