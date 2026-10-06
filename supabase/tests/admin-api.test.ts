import { PostgrestClient } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AdminError, createSupabaseAdminApi, type AdminApi } from '../../src/features/admin/adminApi';
import { loadTrack } from '../../src/features/admin/remoteTrack';
import { ID, IDS, activityRow, createTestDb, insertSql, trackRow, type Person, type TestDb } from './support/harness';
import { POSTGREST_BIN, mint, startPostgrest } from './support/postgrest';

// As ferramentas do administrador (Pessoas, Alteracoes, Conflitos, trilha) contra Postgres + PostgREST de verdade,
// usando o MESMO codigo do app. Roda so com TEST_DATABASE_URL e POSTGREST_BIN definidos.

const enabled = Boolean(process.env.TEST_DATABASE_URL && POSTGREST_BIN);

describe.skipIf(!enabled)('ferramentas do administrador contra o servidor de verdade', () => {
  let db: TestDb;
  let stop: () => void;
  let rest: string;

  const clientFor = (url: string, token: string) => new PostgrestClient(url, { headers: { Authorization: `Bearer ${token}`, apikey: 'teste' } }) as unknown as SupabaseClient;
  const apiAs = (person: Person): AdminApi => createSupabaseAdminApi(clientFor(rest, mint(IDS[person])));
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { sql, params } = insertSql(table, row);
    await db.admin(sql, params);
  };

  beforeAll(async () => {
    db = await createTestDb();
    ({ rest, stop } = await startPostgrest(db));
  }, 30_000);
  afterAll(async () => {
    stop?.();
    await db?.drop();
  });
  beforeEach(async () => {
    await db.admin('truncate public.track_points, public.photos, public.cables, public.elements, public.activities, public.sync_conflicts, public.admin_edits');
    await db.admin(`delete from auth.users where email like '%@fila.test'`);
  });

  describe('pessoas', () => {
    it('lista com e-mail e papel, e os pedidos pendentes vêm primeiro', async () => {
      await db.admin(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000c1', 'novo@fila.test', '{"full_name":"Novo Pedido"}')`);
      const list = await apiAs('davi').listPeople();
      expect(list[0]).toMatchObject({ email: 'novo@fila.test', fullName: 'Novo Pedido', active: false, reviewedAt: null });
      expect(list.find((p) => p.id === IDS.ana)).toMatchObject({ email: 'ana@rotafibra.test', role: 'tecnico', active: true });
    });

    it('técnico não vê ninguém (a lista vem vazia, sem erro)', async () => {
      expect(await apiAs('ana').listPeople()).toEqual([]);
    });

    it('aprovar: a pessoa passa a ter acesso e a lista mostra quem aprovou', async () => {
      await db.admin(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c2', 'fila@fila.test')`);
      const api = apiAs('davi');
      await api.setAccess('00000000-0000-4000-8000-0000000000c2', { active: true, role: 'escritorio' });
      const p = (await api.listPeople()).find((x) => x.email === 'fila@fila.test');
      expect(p).toMatchObject({ active: true, role: 'escritorio', reviewedByName: 'Davi Admin' });
      expect(p?.reviewedAt).toBeTruthy();
    });

    it('quem não é administrador não consegue mudar acesso nenhum: erro "denied"', async () => {
      await expect(apiAs('ana').setAccess(IDS.bruno, { active: false })).rejects.toMatchObject({ kind: 'denied' });
      await expect(apiAs('clara').setAccess(IDS.ana, { role: 'admin' })).rejects.toMatchObject({ kind: 'denied' }); // ninguém se promove nem promove
    });

    it('o último administrador ativo é protegido: erro "last-admin"', async () => {
      await expect(apiAs('davi').setAccess(IDS.davi, { active: false })).rejects.toMatchObject({ kind: 'last-admin' });
      await expect(apiAs('davi').setAccess(IDS.davi, { role: 'tecnico' })).rejects.toMatchObject({ kind: 'last-admin' });
    });

    it('sem servidor no ar: erro "network"', async () => {
      const dead = createSupabaseAdminApi(clientFor('http://127.0.0.1:9', mint(IDS.davi)));
      await expect(dead.listPeople()).rejects.toBeInstanceOf(AdminError);
      await expect(dead.listPeople()).rejects.toMatchObject({ kind: 'network' });
    });

    it('sessão vencida/inválida: erro "auth"', async () => {
      const bad = createSupabaseAdminApi(clientFor(rest, 'isto.nao.e-um-token'));
      await expect(bad.listPeople()).rejects.toMatchObject({ kind: 'auth' });
    });
  });

  describe('alterações e conflitos', () => {
    const edit = (n: number) =>
      insert('admin_edits', { table_name: 'elements', record_id: ID.elAna, owner_id: IDS.ana, edited_by: IDS.davi, before: JSON.stringify({ code: `A${n}` }), after: JSON.stringify({ code: `B${n}` }) });

    it('lista da mais nova para a mais antiga, em páginas, sem repetir nem pular', async () => {
      for (let i = 1; i <= 5; i++) await edit(i);
      const api = apiAs('davi');
      const p1 = await api.listEdits(2);
      const p2 = await api.listEdits(2, p1.at(-1)!.id);
      const p3 = await api.listEdits(2, p2.at(-1)!.id);
      expect([...p1, ...p2, ...p3].map((e) => e.after.code)).toEqual(['B5', 'B4', 'B3', 'B2', 'B1']);
      expect(p3.length).toBe(1);
      expect(p1[0]).toMatchObject({ table: 'elements', recordId: ID.elAna, ownerId: IDS.ana, editedBy: IDS.davi, before: { code: 'A5' } });
    });

    it('só o administrador lê (técnico e escritório recebem lista vazia)', async () => {
      await edit(1);
      expect(await apiAs('ana').listEdits(10)).toEqual([]);
      expect(await apiAs('clara').listEdits(10)).toEqual([]);
      expect(await apiAs('davi').listEdits(10)).toHaveLength(1);
    });

    it('conflitos: "ficou" vira before e "chegou" vira after, sem editedBy', async () => {
      await insert('sync_conflicts', { table_name: 'elements', record_id: ID.elAna, owner_id: IDS.ana, kept: JSON.stringify({ code: 'NOVO' }), incoming: JSON.stringify({ code: 'ATRASADO' }) });
      const [c] = await apiAs('davi').listConflicts(10);
      expect(c).toMatchObject({ table: 'elements', ownerId: IDS.ana, editedBy: null, before: { code: 'NOVO' }, after: { code: 'ATRASADO' } });
      expect(await apiAs('ana').listConflicts(10)).toEqual([]);
    });

    it('nomes do cadastro por id (e quem não existe fica de fora)', async () => {
      const names = await apiAs('davi').names([IDS.ana, IDS.davi, IDS.ana, '00000000-0000-4000-8000-00000000dead']);
      expect(names.get(IDS.ana)).toBe('Ana Técnica');
      expect(names.get(IDS.davi)).toBe('Davi Admin');
      expect(names.size).toBe(2);
      expect((await apiAs('davi').names([])).size).toBe(0);
    });
  });

  describe('trilha de um técnico', () => {
    const seed = async (n: number, deleted: number[] = []) => {
      await insert('activities', activityRow(ID.actAna, 'ana'));
      for (let i = 0; i < n; i++) {
        await insert('track_points', trackRow(ID.tp(i), 'ana', ID.actAna, -23.55 + i * 0.0001, -46.63, `2026-10-01T12:${String(i % 60).padStart(2, '0')}:00Z`, i < n / 2 ? 0 : 1));
      }
      for (const i of deleted) await db.admin(`update public.track_points set deleted = true, updated_at = now() where id = $1`, [ID.tp(i)]);
    };

    it('baixa em páginas, em ordem de horário, sem repetir nem pular, e traz o trecho', async () => {
      await seed(7);
      const got = await loadTrack(apiAs('davi'), ID.actAna, { pageSize: 3 });
      expect(got.truncated).toBe(false);
      expect(got.points.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6].map(ID.tp));
      expect(got.points.map((p) => p.segment)).toEqual([0, 0, 0, 0, 1, 1, 1]);
      expect(got.points[0]).toMatchObject({ lat: -23.55, lng: -46.63, accuracy: 8, timestamp: Date.parse('2026-10-01T12:00:00Z') });
    });

    it('pontos do mesmo instante também não se perdem entre páginas (desempate por id)', async () => {
      await insert('activities', activityRow(ID.actAna, 'ana'));
      for (let i = 0; i < 5; i++) await insert('track_points', trackRow(ID.tp(i), 'ana', ID.actAna, -23.55, -46.63, '2026-10-01T12:00:00Z'));
      const got = await loadTrack(apiAs('davi'), ID.actAna, { pageSize: 2 });
      expect(got.points.map((p) => p.id)).toEqual([0, 1, 2, 3, 4].map(ID.tp));
    });

    it('não traz pontos excluídos e para no limite, avisando que cortou', async () => {
      await seed(6, [2]);
      expect((await loadTrack(apiAs('davi'), ID.actAna, { pageSize: 10 })).points).toHaveLength(5);
      const cut = await loadTrack(apiAs('davi'), ID.actAna, { pageSize: 2, maxPoints: 4 });
      expect(cut).toMatchObject({ truncated: true });
      expect(cut.points).toHaveLength(4);
    });

    it('o escritório e o próprio dono leem; outro técnico não vê nada', async () => {
      await seed(3);
      expect((await loadTrack(apiAs('clara'), ID.actAna, {})).points).toHaveLength(3);
      expect((await loadTrack(apiAs('ana'), ID.actAna, {})).points).toHaveLength(3);
      expect((await loadTrack(apiAs('bruno'), ID.actAna, {})).points).toHaveLength(0);
    });

    it('atividade sem trilha devolve vazio', async () => {
      await insert('activities', activityRow(ID.actAna, 'ana'));
      expect(await loadTrack(apiAs('davi'), ID.actAna, {})).toEqual({ points: [], truncated: false });
    });
  });
});
