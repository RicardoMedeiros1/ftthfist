import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, IDS, activityRow, createTestDb, insertSql, upsertSql, type Person, type TestDb, type Tx } from './support/harness';

// Projetos designados: so o administrador cria e altera; o tecnico le o que e dele; a atividade pode nascer ligada ao projeto.

const PROJ = '00000000-0000-4000-8000-00000000a001';
const project = (extra: Record<string, unknown> = {}) => ({
  id: PROJ, assigned_to: IDS.ana, kind: 'implantacao', title: 'Rua das Flores', ...extra,
});
const create = (tx: Tx, extra: Record<string, unknown> = {}) => {
  const { sql, params } = insertSql('projects', project(extra));
  return tx.q(sql, params);
};
const failsCreate = (tx: Tx, code: string, extra: Record<string, unknown>) => {
  const { sql, params } = insertSql('projects', project(extra));
  return tx.fails(code, sql, params);
};
const seen = async (db: TestDb, who: Person) => db.run(who, (tx) => tx.q<{ id: string }>(`select id from public.projects order by id`).then((r) => r.map((x) => x.id)));

describe.skipIf(!DB_URL)('projetos designados', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('o administrador cria e o servidor preenche o dono, a data e quem gravou', async () => {
    await db.run('davi', async (tx) => {
      await create(tx, { os_number: 'OS-9', lat: -23.55, lng: -46.63, due_date: '2026-10-20' });
      const [r] = await tx.q<{ owner_id: string; updated_by: string; status: string; deleted: boolean; server_updated_at: Date }>(`select * from public.projects where id = $1`, [PROJ]);
      expect(r).toMatchObject({ owner_id: IDS.davi, updated_by: IDS.davi, status: 'aberto', deleted: false });
      expect(r!.server_updated_at).toBeInstanceOf(Date);
    });
  });

  it('quem le: administrador e escritorio veem todos; o tecnico so o que e dele; conta desativada e anonimo, nada', async () => {
    await db.admin(`delete from public.projects`);
    await db.admin(`insert into public.projects (id, owner_id, assigned_to, kind, title) values ($1, $2, $3, 'implantacao', 'da Ana'), ($4, $2, $5, 'manutencao', 'do Bruno')`,
      [PROJ, IDS.davi, IDS.ana, '00000000-0000-4000-8000-00000000a002', IDS.bruno]);
    expect(await seen(db, 'davi')).toHaveLength(2);
    expect(await seen(db, 'clara')).toHaveLength(2);
    expect(await seen(db, 'ana')).toEqual([PROJ]);
    expect(await seen(db, 'bruno')).toEqual(['00000000-0000-4000-8000-00000000a002']);
    expect(await seen(db, 'eva')).toEqual([]);
    await db.run('anon', (tx) => tx.denied(`select * from public.projects`));
  });

  it('tecnico e escritorio nao criam nem alteram projeto (nem o proprio, nem trocando o tecnico)', async () => {
    await db.admin(`delete from public.projects`);
    await db.admin(`insert into public.projects (id, owner_id, assigned_to, kind, title) values ($1, $2, $3, 'implantacao', 'da Ana')`, [PROJ, IDS.davi, IDS.ana]);
    for (const who of ['ana', 'clara', 'eva'] as const) {
      await db.run(who, async (tx) => {
        const { sql, params } = insertSql('projects', { ...project({ id: ID.fresh(1) }), owner_id: IDS[who] });
        await tx.denied(sql, params);
      });
    }
    for (const who of ['ana', 'bruno', 'clara'] as const) {
      await db.run(who, async (tx) => {
        // sem permissao nao ha erro, so nenhuma linha (a politica esconde): conferimos que nada mudou
        expect(await tx.count(`update public.projects set title = 'invadido' where id = $1`, [PROJ])).toBe(0);
        expect(await tx.count(`update public.projects set assigned_to = $2, status = 'concluido' where id = $1`, [PROJ, IDS[who]])).toBe(0);
      });
    }
    await db.run('davi', async (tx) => expect((await tx.q<{ title: string; status: string }>(`select title, status from public.projects`))[0]).toEqual({ title: 'da Ana', status: 'aberto' }));
  });

  it('o administrador nao cria projeto em nome de outro, e ninguem apaga linha', async () => {
    await db.run('davi', async (tx) => {
      const { sql, params } = insertSql('projects', { ...project({ id: ID.fresh(2) }), owner_id: IDS.bruno });
      await tx.denied(sql, params);
      await tx.denied(`delete from public.projects where id = $1`, [PROJ]);
    });
  });

  it('so se designa a tecnico (ou administrador) ativo', async () => {
    await db.run('davi', async (tx) => {
      await failsCreate(tx, '23514', { id: ID.fresh(3), assigned_to: IDS.clara });
      await failsCreate(tx, '23514', { id: ID.fresh(4), assigned_to: IDS.eva });
      await create(tx, { id: ID.fresh(5), assigned_to: IDS.davi }); // o proprio administrador tambem pode fazer campo
      expect((await tx.q(`select id from public.projects where id = $1`, [ID.fresh(5)])).length).toBe(1);
      await tx.fails('23514', `update public.projects set assigned_to = $2 where id = $1`, [PROJ, IDS.clara]);
      expect(await tx.count(`update public.projects set assigned_to = $2 where id = $1`, [PROJ, IDS.bruno])).toBe(1); // reatribuir
    });
  });

  it('o dono do projeto nunca muda', async () => {
    await db.run('davi', (tx) => tx.denied(`update public.projects set owner_id = $2 where id = $1`, [PROJ, IDS.bruno]));
  });

  it('cancelar, concluir e excluir (logico) sao alteracoes; o relogio do servidor avanca', async () => {
    await db.run('davi', async (tx) => {
      const stamp = async () => (await tx.q<{ t: Date }>(`select server_updated_at t from public.projects where id = $1`, [PROJ]))[0]!.t.getTime();
      const t0 = await stamp();
      expect(await tx.count(`update public.projects set status = 'cancelado' where id = $1`, [PROJ])).toBe(1);
      const t1 = await stamp();
      expect(t1).toBeGreaterThan(t0);
      expect(await tx.count(`update public.projects set deleted = true where id = $1`, [PROJ])).toBe(1);
      expect(await stamp()).toBeGreaterThan(t1);
      await tx.fails('23514', `update public.projects set status = 'sumiu' where id = $1`, [PROJ]);
    });
  });

  it('o excluido continua visivel ao tecnico (para a exclusao chegar ao celular)', async () => {
    await db.admin(`update public.projects set deleted = true where id = $1`, [PROJ]);
    await db.run('ana', async (tx) => expect(await tx.q(`select id, deleted from public.projects`)).toEqual([{ id: PROJ, deleted: true }]));
    await db.admin(`update public.projects set deleted = false where id = $1`, [PROJ]);
  });

  it('dados invalidos: titulo vazio, so uma coordenada, coordenada fora do mundo', async () => {
    await db.run('davi', async (tx) => {
      for (const extra of [{ title: '   ' }, { lat: -23.5 }, { lng: -46.6 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { kind: 'outro' }]) {
        await failsCreate(tx, '23514', { id: ID.fresh(6), ...extra });
      }
    });
  });

  describe('atividade ligada ao projeto', () => {
    it('o tecnico cria a atividade ja ligada ao projeto (e marcando que o concluiu) e o envio repetido nao duplica', async () => {
      await db.run('ana', async (tx) => {
        const row = activityRow(ID.fresh(10), 'ana', { project_id: PROJ, completes_project: true });
        const { sql, params } = upsertSql('activities', row);
        await tx.q(sql, params);
        await tx.q(sql, params);
        expect(await tx.q(`select project_id, completes_project from public.activities where id = $1`, [ID.fresh(10)])).toEqual([{ project_id: PROJ, completes_project: true }]);
      });
    });

    it('concluir o projeto exige o projeto; projeto que nao existe e recusado pela chave', async () => {
      await db.run('ana', async (tx) => {
        const a = insertSql('activities', activityRow(ID.fresh(11), 'ana', { completes_project: true }));
        await tx.fails('23514', a.sql, a.params);
        const b = insertSql('activities', activityRow(ID.fresh(12), 'ana', { project_id: ID.fresh(99) }));
        await tx.fails('23503', b.sql, b.params);
      });
    });

    it('o trabalho de campo nunca e recusado porque o projeto foi cancelado, excluido ou reatribuido enquanto o celular estava sem internet', async () => {
      await db.admin(`update public.projects set status = 'cancelado', deleted = true, assigned_to = $2 where id = $1`, [PROJ, IDS.bruno]);
      await db.run('ana', async (tx) => {
        const { sql, params } = upsertSql('activities', activityRow(ID.fresh(13), 'ana', { project_id: PROJ }));
        await tx.q(sql, params);
        expect((await tx.q<{ project_id: string }>(`select project_id from public.activities where id = $1`, [ID.fresh(13)]))[0]!.project_id).toBe(PROJ);
      });
      await db.admin(`update public.projects set status = 'aberto', deleted = false, assigned_to = $2 where id = $1`, [PROJ, IDS.ana]);
    });

    it('o tecnico nao altera o projeto nem por dentro da atividade; so a atividade dele guarda o vinculo', async () => {
      await db.run('ana', async (tx) => {
        expect(await tx.count(`update public.projects set status = 'concluido' where id = $1`, [PROJ])).toBe(0);
        expect(await tx.count(`update public.activities set project_id = $2 where id = $1`, [ID.actBruno, PROJ])).toBe(0); // atividade de outro
      });
    });
  });
});
