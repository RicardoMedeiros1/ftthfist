import 'fake-indexeddb/auto';
import { PostgrestClient } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setActingUser } from '../../src/lib/ownership';
import { CycleAbort, type Role, type Tuning } from '../../src/features/sync/engine';
import { createSupabaseRemote, type RemoteApi } from '../../src/features/sync/remote';
import { SyncHttpError } from '../../src/features/sync/remote';
import { Device, fieldWork, pole } from '../../src/features/sync/testDevice';
import { createPhotoFiles } from '../../src/features/sync/photoFiles';
import { photoRepo } from '../../src/features/elements/photoRepo';
import { SETTING_KEYS } from '../../src/db/db';
import type { TrackPoint } from '../../src/db/types';
import { newBase } from '../../src/db/db';
import { IDS, createTestDb, type Person, type TestDb } from './support/harness';
import { POSTGREST_BIN, mint, startPostgrest } from './support/postgrest';

// O motor de sincronizacao do app (o mesmo codigo do celular) contra o que o Supabase tem de verdade:
// Postgres 16 + PostGIS com as migrations, RLS e triggers, atras de um PostgREST real e do cliente supabase-js/postgrest-js.
// Roda so com TEST_DATABASE_URL e POSTGREST_BIN (caminho do binario do PostgREST) definidos; veja supabase/README.md.

const enabled = Boolean(process.env.TEST_DATABASE_URL && POSTGREST_BIN);

describe.skipIf(!enabled)('motor de sincronização contra Postgres + PostgREST de verdade', () => {
  let db: TestDb;
  let stop: () => void;
  let rest: string;

  beforeAll(async () => {
    db = await createTestDb();
    ({ rest, stop } = await startPostgrest(db));
  }, 30_000);

  afterAll(async () => {
    stop?.();
    await db?.drop();
  });

  // cada teste parte de um servidor vazio (os papéis e os usuários continuam)
  beforeEach(async () => {
    await db.admin('truncate public.track_points, public.photos, public.cables, public.elements, public.activities, public.sync_conflicts, public.admin_edits');
  });
  afterEach(() => setActingUser(null));

  const remoteFor = (person: Person): RemoteApi =>
    createSupabaseRemote(new PostgrestClient(rest, { headers: { Authorization: `Bearer ${mint(IDS[person])}`, apikey: 'teste' } }) as unknown as SupabaseClient);

  const device = (person: Person, role: Role = 'tecnico', tuning: Partial<Tuning> = {}, remote: RemoteApi = remoteFor(person)) =>
    new Device(remote, IDS[person], role, tuning).open();

  const count = async (table: string) => Number((await db.admin<{ n: string }>(`select count(*) n from public.${table}`))[0]!.n);

  it('Ana sobe o trabalho de campo: tudo chega com o dono certo, a geometria e as medidas', async () => {
    const ana = await device('ana');
    const { cable, p1 } = await fieldWork(ana, 'Ana');
    const r = await ana.sync();
    expect(r.pushed).toBe(7);
    expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
    expect([await count('activities'), await count('elements'), await count('cables'), await count('track_points')]).toEqual([1, 2, 1, 3]);
    const owners = await db.admin<{ owner_id: string }>(`select owner_id from public.elements union all select owner_id from public.cables`);
    expect(owners.every((o) => o.owner_id === IDS.ana)).toBe(true);
    // geometria calculada no servidor a partir do que o app mandou
    const [c] = await db.admin<{ meters: number; length_m: string; n: number }>(
      `select st_length(geom)::float8 as meters, length_m::text, st_npoints(geom::geometry) n from public.cables where id = $1`, [cable.id]);
    expect(c!.n).toBe(2);
    expect(Math.abs(c!.meters - cable.lengthMeters)).toBeLessThan(cable.lengthMeters * 0.01 + 0.1);
    const [e] = await db.admin<{ lat: number; lng: number; ok: boolean }>(
      `select lat, lng, st_distance(geom, st_setsrid(st_makepoint($2, $3), 4326)::geography) < 0.5 as ok from public.elements where id = $1`, [p1.id, p1.lng, p1.lat]);
    expect(e!.ok).toBe(true);
  });

  it('reenviar sem nada novo não faz nenhuma chamada de envio', async () => {
    const ana = await device('ana');
    await fieldWork(ana, 'Ana');
    await ana.sync();
    let upserts = 0;
    const base = remoteFor('ana');
    const counting = await device('ana', 'tecnico', {}, { ...base, upsert: async (t, rows) => { upserts++; return base.upsert(t, rows); } });
    await counting.sync(); // aparelho novo da Ana: baixa, não tem nada pendente
    expect(upserts).toBe(0);
  });

  it('a resposta se perdeu depois de o servidor gravar: tentar de novo não duplica, não gera conflito e o aparelho se acerta', async () => {
    const base = remoteFor('ana');
    let lose = true;
    const flaky: RemoteApi = {
      ...base,
      upsert: async (t, rows) => {
        const res = await base.upsert(t, rows);
        if (lose && t === 'activities') {
          lose = false;
          throw new SyncHttpError('network', 'Failed to fetch');
        }
        return res;
      },
    };
    const ana = await device('ana', 'tecnico', {}, flaky);
    await fieldWork(ana, 'Ana');
    await expect(ana.sync()).rejects.toBeInstanceOf(CycleAbort);
    expect(await count('activities')).toBe(1); // gravou, mas o aparelho não soube
    expect((await ana.counts()).pending).toBe(7);
    await ana.sync();
    expect([await count('activities'), await count('elements'), await count('cables'), await count('track_points')]).toEqual([1, 2, 1, 3]);
    expect(await count('sync_conflicts')).toBe(0);
    expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
  });

  it('edição atrasada do outro aparelho perde, vai para o log de conflitos e o aparelho passa a mostrar a que valeu', async () => {
    const ana = await device('ana');
    const ana2 = await device('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    await ana2.sync();
    const t0 = (await ana.db.elements.get(p1.id))!.updatedAt;
    await ana.db.elements.update(p1.id, { code: 'ANTIGA', updatedAt: t0 + 1000, syncStatus: 'pending' });
    await ana2.db.elements.update(p1.id, { code: 'NOVA', updatedAt: t0 + 2000, syncStatus: 'pending' });
    await ana2.sync();
    const r = await ana.sync();
    expect(r.lostEdits).toBe(1);
    expect((await db.admin<{ code: string }>(`select code from public.elements where id = $1`, [p1.id]))[0]!.code).toBe('NOVA');
    const conflicts = await db.admin<{ table_name: string; incoming: { code: string }; kept: { code: string } }>(`select table_name, incoming, kept from public.sync_conflicts`);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ table_name: 'elements', incoming: { code: 'ANTIGA' }, kept: { code: 'NOVA' } });
    expect((await ana.db.elements.get(p1.id))?.code).toBe('NOVA');
    expect((await ana.counts()).pending).toBe(0);
  });

  it('Bruno baixa o que Ana fez (em páginas, com o filtro de continuação real) e a trilha não vai junto', async () => {
    const ana = await device('ana');
    await fieldWork(ana, 'Ana');
    await ana.as(async () => {
      for (let i = 2; i < 9; i++) await ana.els.create(pole(i), 'Ana');
    });
    await ana.sync();
    const bruno = await device('bruno', 'tecnico', { pullPage: 3 });
    const r = await bruno.sync();
    expect(await bruno.db.elements.count()).toBe(9);
    expect(r.pulled).toBe(1 + 9 + 1);
    expect(await bruno.db.trackPoints.count()).toBe(0);
    expect((await bruno.db.elements.toArray()).every((e) => e.ownerId === IDS.ana && e.syncStatus === 'synced')).toBe(true);
    // segundo ciclo: nada novo e nada duplicado
    await bruno.sync();
    expect(await bruno.db.elements.count()).toBe(9);
  });

  it('o que muda depois chega no ciclo seguinte (cursor com microssegundos)', async () => {
    const ana = await device('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    const bruno = await device('bruno');
    await bruno.sync();
    const cur = (await bruno.db.settings.get(SETTING_KEYS.syncCursor))!.value as Record<string, string>;
    expect(cur.elements).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+\+00:00$/);
    await ana.as(() => ana.els.update(p1.id, { code: 'P-NOVO' }));
    await ana.sync();
    await bruno.sync();
    expect((await bruno.db.elements.get(p1.id))?.code).toBe('P-NOVO');
    expect(await bruno.db.elements.count()).toBe(2);
  });

  it('exclusão lógica sobe e desce: a linha continua no servidor e some das listas do outro técnico', async () => {
    const ana = await device('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    const bruno = await device('bruno');
    await bruno.sync();
    await ana.as(() => ana.els.remove(p1.id));
    await ana.sync();
    expect((await db.admin<{ deleted: boolean }>(`select deleted from public.elements where id = $1`, [p1.id]))[0]!.deleted).toBe(true);
    await bruno.sync();
    expect((await bruno.db.elements.get(p1.id))?.deleted).toBe(true);
  });

  it('Bruno tentando sobrescrever o poste da Ana: o servidor recusa (RLS) e o registro fica bloqueado', async () => {
    const ana = await device('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    const bruno = await device('bruno');
    await bruno.sync();
    // defeito/ataque: força a edição direto no banco local e a marca como pendente sem dono
    await bruno.db.elements.update(p1.id, { code: 'HACK', updatedAt: Date.now() + 1000, syncStatus: 'pending', ownerId: undefined });
    const r = await bruno.sync();
    expect(r.newlyBlocked).toBe(1);
    expect((await db.admin<{ code: string }>(`select code from public.elements where id = $1`, [p1.id]))[0]!.code).not.toBe('HACK');
    expect((await bruno.counts()).blocked).toBe(1);
    expect((await bruno.engine.blockedList(bruno.who))[0]!.message).toMatch(/row-level security/i);
  });

  it('registro com dado impossível (coordenada 999) é recusado pelo banco e não trava os outros', async () => {
    const ana = await device('ana');
    await fieldWork(ana, 'Ana');
    const bad = await ana.as(() => ana.els.create(pole(5), 'Ana'));
    await ana.sync(); // sobe o que está certo
    await ana.db.elements.update(bad.id, { lat: 999, updatedAt: Date.now() + 5, syncStatus: 'pending' });
    const good = await ana.as(() => ana.els.create(pole(6), 'Ana'));
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect(await count('elements')).toBe(2 + 1 + 1); // 2 do campo + o "bad" (versão antiga válida) + o novo bom
    expect((await db.admin(`select 1 from public.elements where id = $1`, [good.id]))).toHaveLength(1);
    expect((await ana.engine.blockedList(ana.who))[0]).toMatchObject({ table: 'elements', id: bad.id });
  });

  it('cabo com menos de 2 pontos é recusado pelo banco', async () => {
    const ana = await device('ana');
    const { cable } = await fieldWork(ana, 'Ana');
    await ana.db.cables.update(cable.id, { vertices: [cable.vertices[0]!] });
    const r = await ana.sync();
    expect(r.newlyBlocked).toBe(1);
    expect(await count('cables')).toBe(0);
    expect(await count('elements')).toBe(2); // o resto subiu
  });

  it('registro cuja atividade não está no servidor não derruba o ciclo: fica recusado, sem travar os outros', async () => {
    const ana = await device('ana');
    await fieldWork(ana, 'Ana');
    await ana.sync();
    const orphan = await ana.as(() => ana.els.create(pole(8), 'Ana'));
    await ana.db.elements.update(orphan.id, { activityId: crypto.randomUUID(), updatedAt: Date.now() + 1, syncStatus: 'pending' });
    const r = await ana.sync();
    expect(r.newlyBlocked + r.waiting).toBe(1);
    expect((await db.admin(`select 1 from public.elements where id = $1`, [orphan.id]))).toHaveLength(0);
  });

  it('usuário desativado: o servidor recusa e nada trava', async () => {
    const eva = await device('eva');
    await fieldWork(eva, 'Eva');
    const r = await eva.sync();
    expect(r.newlyBlocked).toBe(1); // a atividade; o resto espera por ela
    expect(await count('activities')).toBe(0);
    expect(await eva.counts()).toMatchObject({ pending: 6, blocked: 1 });
  });

  it('relógio do aparelho 3 h adiantado: o servidor limita a +5 min e o aparelho não entra em loop', async () => {
    const ana = await device('ana');
    const { p1 } = await fieldWork(ana, 'Ana');
    await ana.sync();
    await ana.db.elements.update(p1.id, { code: 'RELOGIO', updatedAt: Date.now() + 3 * 3600_000, syncStatus: 'pending' });
    await ana.sync();
    const [row] = await db.admin<{ ok: boolean; code: string }>(`select updated_at <= now() + interval '6 minutes' as ok, code from public.elements where id = $1`, [p1.id]);
    expect(row).toEqual({ ok: true, code: 'RELOGIO' });
    expect((await ana.counts()).pending).toBe(0);
  });

  it('trilha grande sobe em lotes de 500', async () => {
    const ana = await device('ana');
    const { act } = await fieldWork(ana, 'Ana');
    const many: TrackPoint[] = Array.from({ length: 1200 }, (_, i) => ({
      ...newBase('Ana'), activityId: act.id, lat: -23.55 - i * 0.00001, lng: -46.63, accuracy: 6, timestamp: Date.now() + i, segment: 0,
    }));
    await ana.db.trackPoints.bulkAdd(many);
    const r = await ana.sync();
    expect(r.pushed).toBe(1 + 2 + 1 + 3 + 1200);
    expect(await count('track_points')).toBe(1203);
  }, 60_000); // o fake-indexeddb regrava lentamente registros que já existem; no navegador de verdade isso é rápido

  // O serviço de arquivos (Storage) do Supabase não roda aqui: o arquivo vai para um bucket falso em memória, e as políticas
  // do bucket são conferidas em storage.test.ts. O que se prova aqui é o REGISTRO da foto no banco de verdade.
  describe('fotos', () => {
    const bucket = new Map<string, Blob>();
    beforeEach(() => bucket.clear());
    const withBucket = (person: Person): RemoteApi => ({
      ...remoteFor(person),
      uploadFile: async (path, blob) => void bucket.set(path, blob),
      downloadFile: async (path) => {
        const f = bucket.get(path);
        if (!f) throw new SyncHttpError('permanent', 'Object not found', 404, '');
        return f;
      },
    });
    const jpeg = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'image/jpeg' });

    it('o registro da foto chega com dono, geometria e o caminho do arquivo no formato que a política do bucket exige', async () => {
      const ana = await device('ana', 'tecnico', {}, withBucket('ana'));
      const { p1 } = await fieldWork(ana, 'Ana');
      const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: jpeg(1, 2, 3), takenAt: Date.now() - 5000 }, 'Ana'));
      const r = await ana.sync();
      expect(r.newlyBlocked).toBe(0);
      const [row] = await db.admin<{ owner_id: string; storage_path: string; geo_ok: boolean; element_id: string; deleted: boolean }>(
        `select owner_id, storage_path, element_id, deleted, geom is not null and st_distance(geom, st_setsrid(st_makepoint($2, $3), 4326)::geography) < 0.5 as geo_ok
           from public.photos where id = $1`, [photo.id, p1.lng, p1.lat]);
      expect(row).toMatchObject({ owner_id: IDS.ana, element_id: p1.id, deleted: false, geo_ok: true });
      expect(row!.storage_path).toBe(`${IDS.ana}/${photo.id}.jpg`);
      // o mesmo formato que a politica fotos_insert confere (<uuid>/<uuid>.jpg)
      const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
      expect(new RegExp(`^${uuid}/${uuid}\\.jpg$`).test(row!.storage_path)).toBe(true);
      expect(bucket.has(row!.storage_path)).toBe(true);
    });

    it('a Bia recebe o registro (sem o arquivo), baixa ao abrir e o dono é a Ana', async () => {
      const ana = await device('ana', 'tecnico', {}, withBucket('ana'));
      const { p1 } = await fieldWork(ana, 'Ana');
      const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: jpeg(7, 8) }, 'Ana'));
      await ana.sync();
      const bruno = await device('bruno', 'tecnico', {}, withBucket('bruno'));
      await bruno.sync();
      const got = (await bruno.db.photos.get(photo.id))!;
      expect(got).toMatchObject({ ownerId: IDS.ana, syncStatus: 'synced', elementId: p1.id });
      expect(got.blob).toBeUndefined();
      const files = createPhotoFiles({ db: bruno.db, remote: withBucket('bruno') });
      expect(await files.download(p1.id)).toMatchObject({ downloaded: 1, offline: false });
      expect(Array.from(new Uint8Array(await (await bruno.db.photos.get(photo.id))!.blob!.arrayBuffer()))).toEqual([7, 8]);
      expect((await bruno.counts()).pending).toBe(0);
    });

    it('foto cujo elemento não existe no servidor: o banco responde 409 (chave estrangeira) e a foto ESPERA, sem ser recusada', async () => {
      const ana = await device('ana', 'tecnico', {}, withBucket('ana'));
      const { p1 } = await fieldWork(ana, 'Ana');
      const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: jpeg(1) }, 'Ana'));
      await ana.db.photos.update(photo.id, { elementId: crypto.randomUUID() });
      const r = await ana.sync();
      expect(r.waiting).toBe(1);
      expect(r.newlyBlocked).toBe(0);
      expect((await ana.counts()).blocked).toBe(0);
      expect(await count('photos')).toBe(0);
    });

    it('foto excluída sobe como excluída; a linha continua no servidor', async () => {
      const ana = await device('ana', 'tecnico', {}, withBucket('ana'));
      const { p1 } = await fieldWork(ana, 'Ana');
      const photo = await ana.as(() => photoRepo(ana.db).add(p1.id, { blob: jpeg(1) }, 'Ana'));
      await ana.sync();
      await ana.as(() => photoRepo(ana.db).remove(photo.id));
      await ana.sync();
      expect((await db.admin<{ deleted: boolean }>(`select deleted from public.photos where id = $1`, [photo.id]))[0]!.deleted).toBe(true);
      expect(bucket.has(`${IDS.ana}/${photo.id}.jpg`)).toBe(true);
    });
  });

  describe('administrador', () => {
    const adminRows = () => db.admin<{ table_name: string; record_id: string; owner_id: string; edited_by: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
      `select table_name, record_id, owner_id, edited_by, before, after from public.admin_edits order by id`);

    it('o administrador baixa, edita o poste da Ana e envia: o servidor grava, o dono continua a Ana e fica o registro antes/depois', async () => {
      const ana = await device('ana');
      const { p1 } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      await davi.as(() => davi.els.update(p1.id, { code: 'P-DO-ADMIN' }));
      const r = await davi.sync();
      expect(r.pushed).toBe(1);
      expect(r.newlyBlocked).toBe(0);
      const [row] = await db.admin<{ code: string; owner_id: string; updated_by: string }>(`select code, owner_id, updated_by from public.elements where id = $1`, [p1.id]);
      expect(row).toEqual({ code: 'P-DO-ADMIN', owner_id: IDS.ana, updated_by: IDS.davi });
      const log = await adminRows();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ table_name: 'elements', record_id: p1.id, owner_id: IDS.ana, edited_by: IDS.davi });
      expect(log[0]!.before.code).toBe(p1.code); // era o codigo original
      expect(log[0]!.after.code).toBe('P-DO-ADMIN');
    });

    it('a Ana recebe a alteracao do administrador e continua dona; nada fica pendente', async () => {
      const ana = await device('ana');
      const { p1 } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      await davi.as(() => davi.els.update(p1.id, { code: 'P-NOVO' }));
      await davi.sync();
      await ana.sync();
      const got = (await ana.db.elements.get(p1.id))!;
      expect(got).toMatchObject({ code: 'P-NOVO', ownerId: IDS.ana, updatedBy: IDS.davi, syncStatus: 'synced' });
      expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
    });

    it('mover o poste de um tecnico leva o cabo dele; a geometria do cabo acompanha no servidor', async () => {
      const ana = await device('ana');
      const { p1, cable } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      await davi.as(() => davi.els.move(p1.id, { lat: -23.56, lng: -46.64, positionSource: 'manual' }));
      const r = await davi.sync();
      expect(r.pushed).toBe(2);
      const [c] = await db.admin<{ first_lat: number; owner_id: string }>(
        `select st_y(st_startpoint(geom::geometry)) as first_lat, owner_id from public.cables where id = $1`, [cable.id]);
      expect(c!.owner_id).toBe(IDS.ana);
      expect(Math.abs(c!.first_lat - -23.56)).toBeLessThan(1e-6);
      expect((await adminRows()).map((x) => x.table_name).sort()).toEqual(['cables', 'elements']);
    });

    it('exclusao logica do administrador chega a tecnica como excluida', async () => {
      const ana = await device('ana');
      const { p1 } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      await davi.as(() => davi.els.remove(p1.id));
      await davi.sync();
      expect((await db.admin<{ deleted: boolean }>(`select deleted from public.elements where id = $1`, [p1.id]))[0]!.deleted).toBe(true);
      await ana.sync();
      expect((await ana.db.elements.get(p1.id))?.deleted).toBe(true);
    });

    it('registro NOVO do administrador em atividade de um tecnico e recusado pelo banco (gatilho), sem criar nada', async () => {
      const ana = await device('ana');
      const { act } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      // forca (defeito): elemento novo do administrador apontando para a atividade da Ana
      const own = await davi.as(() => davi.acts.create({ kind: 'manutencao', title: 'Do admin' }, 'Davi'));
      const el = await davi.as(() => davi.els.create(pole(3), 'Davi'));
      await davi.db.elements.update(el.id, { activityId: act.id, updatedAt: Date.now() + 5, syncStatus: 'pending' });
      const r = await davi.sync();
      expect(r.newlyBlocked).toBe(1);
      expect((await db.admin(`select 1 from public.elements where id = $1`, [el.id]))).toHaveLength(0);
      expect(own.ownerId).toBe(IDS.davi);
      expect((await davi.engine.blockedList(davi.who))[0]!.message).toMatch(/atividade propria|row-level security/i);
    });

    it('registro de outro tecnico que nunca chegou ao servidor NAO e enviado pelo administrador', async () => {
      const ana = await device('ana');
      await fieldWork(ana, 'Ana'); // pendente no aparelho da Ana, nunca sincronizado
      const davi = await device('davi', 'admin');
      await davi.db.activities.bulkAdd(await ana.db.activities.toArray());
      await davi.db.elements.bulkAdd(await ana.db.elements.toArray());
      const r = await davi.sync();
      expect(r.pushed).toBe(0);
      expect(await count('activities')).toBe(0);
    });

    it('edicao do administrador mais antiga que a da tecnica: perde, vira conflito, e o administrador passa a ver a da tecnica', async () => {
      const ana = await device('ana');
      const { p1 } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      const t0 = (await ana.db.elements.get(p1.id))!.updatedAt;
      await davi.db.elements.update(p1.id, { code: 'DO-ADMIN', updatedAt: t0 + 1000, syncStatus: 'pending' });
      await ana.db.elements.update(p1.id, { code: 'DA-TECNICA', updatedAt: t0 + 2000, syncStatus: 'pending' });
      await ana.sync();
      const r = await davi.sync();
      expect(r.lostEdits).toBe(1);
      expect((await davi.db.elements.get(p1.id))?.code).toBe('DA-TECNICA');
      expect(await adminRows()).toHaveLength(0);
      expect(await count('sync_conflicts')).toBe(1);
    });

    it('o administrador exclui a atividade da Ana: tudo fica excluido no servidor, o dono continua a Ana, fica o registro e a Ana recebe sem aviso de substituicao', async () => {
      const ana = await device('ana');
      const { act, p1, p2, cable } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const davi = await device('davi', 'admin');
      await davi.sync();
      const removal = await davi.as(() => davi.acts.remove(act.id));
      expect(removal).toMatchObject({ elements: 2, cables: 1 });
      const r = await davi.sync();
      expect(r).toMatchObject({ pushed: 4, newlyBlocked: 0, lostEdits: 0 });
      const rows = await db.admin<{ t: string; deleted: boolean; owner_id: string; updated_by: string }>(
        `select 'a' t, deleted, owner_id, updated_by from public.activities where id = $1
         union all select 'e', deleted, owner_id, updated_by from public.elements where id in ($2, $3)
         union all select 'c', deleted, owner_id, updated_by from public.cables where id = $4`, [act.id, p1.id, p2.id, cable.id]);
      expect(rows).toHaveLength(4);
      for (const x of rows) expect(x).toMatchObject({ deleted: true, owner_id: IDS.ana, updated_by: IDS.davi });
      // a trilha gravada continua no servidor (o administrador nunca baixa a trilha dos outros), mas a atividade ja nao existe
      expect((await db.admin<{ n: string }>(`select count(*) n from public.track_points where activity_id = $1 and not deleted`, [act.id]))[0]!.n).toBe('3');
      expect((await adminRows()).filter((l) => l.after.deleted === true)).toHaveLength(4);
      const back = await ana.sync();
      expect(back.lostEdits).toBe(0);
      expect(await ana.as(() => ana.acts.list())).toEqual([]);
      expect(await ana.counts()).toMatchObject({ pending: 0, blocked: 0 });
    });

    it('escritorio e tecnico nao conseguem alterar o que e de outro pelo servidor', async () => {
      const ana = await device('ana');
      const { p1 } = await fieldWork(ana, 'Ana');
      await ana.sync();
      const bruno = await device('bruno');
      await bruno.sync();
      await bruno.db.elements.update(p1.id, { code: 'HACK', updatedAt: Date.now() + 1000, syncStatus: 'pending', ownerId: undefined });
      const r = await bruno.sync();
      expect(r.newlyBlocked).toBe(1);
      expect((await db.admin<{ code: string }>(`select code from public.elements where id = $1`, [p1.id]))[0]!.code).not.toBe('HACK');
      expect(await adminRows()).toHaveLength(0);
    });
  });

  it('escritório baixa a rede toda e não envia nada', async () => {
    const ana = await device('ana');
    await fieldWork(ana, 'Ana');
    await ana.sync();
    const clara = await device('clara', 'escritorio');
    const r = await clara.sync();
    expect(r.pulled).toBe(1 + 2 + 1);
    expect(r.pushed).toBe(0);
  });
});
