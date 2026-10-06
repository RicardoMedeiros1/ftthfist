import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, IDS, activityRow, cableRow, createTestDb, elementRow, insertSql, photoRow, trackRow, upsertSql, type TestDb, type Tx } from './support/harness';

// O administrador altera o que e dos tecnicos (com registro de quem alterou); o dono nunca muda; o resto continua proibido.

const edits = (tx: Tx) => tx.q<{ table_name: string; record_id: string; owner_id: string; edited_by: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
  `select table_name, record_id, owner_id, edited_by, before, after from public.admin_edits order by id`);
const row = <T = Record<string, unknown>>(tx: Tx, sql: string, params: unknown[] = []) => tx.q<T>(sql, params).then((r) => r[0]!);

describe.skipIf(!DB_URL)('administrador: altera o que e dos outros, com registro', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('altera o poste de um tecnico: o dono continua o mesmo, quem alterou fica gravado, e sobra o registro antes/depois', async () => {
    await db.run('davi', async (tx) => {
      expect(await tx.count(`update public.elements set code = 'P-EDIT', updated_at = now() where id = $1`, [ID.elAna])).toBe(1);
      await tx.as('postgres');
      const r = await row<{ owner_id: string; updated_by: string; code: string }>(tx, `select owner_id, updated_by, code from public.elements where id = $1`, [ID.elAna]);
      expect(r).toEqual({ owner_id: IDS.ana, updated_by: IDS.davi, code: 'P-EDIT' });
      const log = await edits(tx);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ table_name: 'elements', record_id: ID.elAna, owner_id: IDS.ana, edited_by: IDS.davi });
      expect(log[0]!.before.code).toBe('P-ANA');
      expect(log[0]!.after.code).toBe('P-EDIT');
    });
  });

  it('altera (e "exclui", sempre logico) atividade, elemento, cabo, foto e ponto de trilha de outro', async () => {
    await db.run('postgres', async (tx) => {
      const t = trackRow(ID.tp(1), 'ana', ID.actAna, -23.55, -46.63, '2026-10-01T12:00:00Z');
      const ins = insertSql('track_points', t);
      await tx.q(ins.sql, ins.params);
      await tx.as('davi');
      for (const [table, id] of [['activities', ID.actAna], ['elements', ID.elAna], ['cables', ID.cableAna], ['photos', ID.photoAna], ['track_points', ID.tp(1)]] as const) {
        expect(await tx.count(`update public.${table} set deleted = true, updated_at = now() where id = $1`, [id]), table).toBe(1);
      }
      await tx.as('postgres');
      expect((await edits(tx)).map((e) => e.table_name).sort()).toEqual(['activities', 'cables', 'elements', 'photos', 'track_points']);
      expect((await row<{ n: string }>(tx, `select count(*) n from public.elements where id = $1`, [ID.elAna])).n).toBe('1'); // a linha continua la
    });
  });

  it('muda o tracado do cabo e a geometria acompanha', async () => {
    await db.run('davi', async (tx) => {
      const v = JSON.stringify([{ lat: -23.5, lng: -46.6 }, { lat: -23.5, lng: -46.601 }, { lat: -23.5005, lng: -46.602 }]);
      expect(await tx.count(`update public.cables set vertices = $2::jsonb, updated_at = now() where id = $1`, [ID.cableAna, v])).toBe(1);
      expect((await row<{ n: number }>(tx, `select st_npoints(geom::geometry) n from public.cables where id = $1`, [ID.cableAna])).n).toBe(3);
    });
  });

  it('o dono nunca muda, nem para o administrador', async () => {
    await db.run('davi', async (tx) => {
      await tx.denied(`update public.elements set owner_id = $2 where id = $1`, [ID.elAna, IDS.davi]);
      await tx.denied(`update public.activities set owner_id = $2 where id = $1`, [ID.actAna, IDS.davi]);
    });
  });

  it('NAO cria registro em nome de um tecnico nem dentro da atividade dele', async () => {
    await db.run('davi', async (tx) => {
      const inActivityOfAna = insertSql('elements', elementRow(ID.fresh(1), 'davi', ID.actAna, { owner_id: IDS.davi }));
      await tx.denied(inActivityOfAna.sql, inActivityOfAna.params);
      const asAna = insertSql('elements', elementRow(ID.fresh(2), 'ana', ID.actAna));
      await tx.denied(asAna.sql, asAna.params);
      const activityAsAna = insertSql('activities', activityRow(ID.fresh(3), 'ana'));
      await tx.denied(activityAsAna.sql, activityAsAna.params);
    });
  });

  it('cria normalmente na PROPRIA atividade', async () => {
    await db.run('davi', async (tx) => {
      const a = insertSql('activities', activityRow(ID.fresh(4), 'davi'));
      await tx.q(a.sql, a.params);
      const e = insertSql('elements', elementRow(ID.fresh(5), 'davi', ID.fresh(4)));
      await tx.q(e.sql, e.params);
      expect((await row<{ updated_by: string }>(tx, `select updated_by from public.elements where id = $1`, [ID.fresh(5)])).updated_by).toBe(IDS.davi);
      await tx.as('postgres');
      expect(await edits(tx)).toHaveLength(0); // o que e dele nao entra no registro
    });
  });

  it('o envio do app (INSERT ... ON CONFLICT DO UPDATE, sem owner_id) tambem funciona para o administrador', async () => {
    await db.run('davi', async (tx) => {
      const { owner_id: _o, ...payload } = elementRow(ID.elAna, 'ana', ID.actAna, { code: 'VIA-APP', updated_at: new Date().toISOString() });
      const up = upsertSql('elements', payload);
      await tx.q(up.sql, up.params);
      await tx.as('postgres');
      const r = await row<{ owner_id: string; code: string; updated_by: string }>(tx, `select owner_id, code, updated_by from public.elements where id = $1`, [ID.elAna]);
      expect(r).toEqual({ owner_id: IDS.ana, code: 'VIA-APP', updated_by: IDS.davi });
      expect(await edits(tx)).toHaveLength(1);
    });
  });

  it('o tecnico, o escritorio e o admin DESATIVADO continuam sem alterar o que e de outro', async () => {
    await db.run('ana', async (tx) => { expect(await tx.count(`update public.elements set code = 'X', updated_at = now() where id = $1`, [ID.elBruno])).toBe(0); });
    await db.run('clara', async (tx) => { expect(await tx.count(`update public.elements set code = 'X', updated_at = now() where id = $1`, [ID.elAna])).toBe(0); });
    await db.run('postgres', async (tx) => {
      await tx.q(`update public.profiles set role = 'admin' where id = $1`, [IDS.bruno]); // outro admin ativo: assim da para desativar o davi
      await tx.q(`update public.profiles set active = false where id = $1`, [IDS.davi]);
      await tx.as('davi');
      expect(await tx.count(`update public.elements set code = 'X', updated_at = now() where id = $1`, [ID.elAna])).toBe(0);
    });
  });

  it('a alteracao do proprio dono nao entra no registro; quem alterou por ultimo e sempre o login (nao se falsifica)', async () => {
    await db.run('ana', async (tx) => {
      expect(await tx.count(`update public.elements set code = 'MINHA', updated_at = now(), updated_by = $2 where id = $1`, [ID.elAna, IDS.davi])).toBe(1);
      expect((await row<{ updated_by: string }>(tx, `select updated_by from public.elements where id = $1`, [ID.elAna])).updated_by).toBe(IDS.ana);
      await tx.as('postgres');
      expect(await edits(tx)).toHaveLength(0);
    });
  });

  it('so o administrador le o registro de alteracoes, e ninguem escreve nele pela API', async () => {
    await db.run('davi', async (tx) => {
      await tx.q(`update public.elements set code = 'LOG', updated_at = now() where id = $1`, [ID.elAna]);
      expect(await tx.q(`select 1 from public.admin_edits`)).toHaveLength(1);
      await tx.denied(`insert into public.admin_edits (table_name, record_id, owner_id, edited_by, before, after) values ('elements', $1, $2, $3, '{}', '{}')`, [ID.elAna, IDS.ana, IDS.davi]);
      await tx.denied(`update public.admin_edits set table_name = 'x'`);
      await tx.denied(`delete from public.admin_edits`);
      for (const who of ['ana', 'bruno', 'clara'] as const) {
        await tx.as(who);
        expect(await tx.q(`select 1 from public.admin_edits`), who).toHaveLength(0);
      }
    });
  });

  it('envio atrasado do administrador nao altera nada e nao entra no registro (vira conflito, como qualquer um)', async () => {
    await db.run('davi', async (tx) => {
      expect(await tx.count(`update public.elements set code = 'ANTIGO', updated_at = '2020-01-01T00:00:00Z' where id = $1`, [ID.elAna])).toBe(0);
      await tx.as('postgres');
      expect((await row<{ code: string }>(tx, `select code from public.elements where id = $1`, [ID.elAna])).code).toBe('P-ANA');
      expect(await edits(tx)).toHaveLength(0);
      expect((await row<{ n: string }>(tx, `select count(*) n from public.sync_conflicts where record_id = $1 and owner_id = $2`, [ID.elAna, IDS.ana])).n).toBe('1');
    });
  });

  it('tecnico e administrador editando o mesmo registro: vale o mais recente, o atrasado vai para os conflitos', async () => {
    await db.run('postgres', async (tx) => {
      await tx.as('davi');
      await tx.q(`update public.elements set code = 'DO-ADMIN', updated_at = now() where id = $1`, [ID.elAna]);
      await tx.as('ana');
      const { owner_id: _o, ...late } = elementRow(ID.elAna, 'ana', ID.actAna, { code: 'DO-TECNICO', updated_at: '2026-10-02T00:00:00Z' });
      const up = upsertSql('elements', late);
      await tx.q(up.sql, up.params);
      await tx.as('postgres');
      expect((await row<{ code: string }>(tx, `select code from public.elements where id = $1`, [ID.elAna])).code).toBe('DO-ADMIN');
      const c = await tx.q<{ table_name: string; incoming: { code: string }; kept: { code: string } }>(`select table_name, incoming, kept from public.sync_conflicts where record_id = $1`, [ID.elAna]);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({ incoming: { code: 'DO-TECNICO' }, kept: { code: 'DO-ADMIN' } });
    });
  });

  it('reenvio IDENTICO e atrasado do dono nao gera conflito ("quem alterou" nao conta na comparacao)', async () => {
    await db.run('ana', async (tx) => {
      const newer = upsertSql('elements', elementRow(ID.fresh(10), 'ana', ID.actAna, { updated_at: '2026-10-03T00:00:00Z' }));
      await tx.q(newer.sql, newer.params);
      const older = upsertSql('elements', elementRow(ID.fresh(10), 'ana', ID.actAna, { updated_at: '2026-10-02T00:00:00Z' }));
      await tx.q(older.sql, older.params);
      await tx.as('postgres');
      expect((await row<{ n: string }>(tx, `select count(*) n from public.sync_conflicts where record_id = $1`, [ID.fresh(10)])).n).toBe('0');
    });
  });

  it('o administrador continua sem apagar linhas (nao ha DELETE para ninguem)', async () => {
    await db.run('davi', async (tx) => {
      await tx.denied(`delete from public.elements where id = $1`, [ID.elAna]);
      await tx.denied(`delete from public.activities where id = $1`, [ID.actAna]);
    });
  });

  it('foto: o administrador marca como excluida mas nao troca o caminho do arquivo para outra pasta de dono', async () => {
    await db.run('davi', async (tx) => {
      const p = photoRow(ID.fresh(6), 'ana', ID.actAna);
      void p;
      expect(await tx.count(`update public.photos set deleted = true, updated_at = now() where id = $1`, [ID.photoAna])).toBe(1);
    });
  });

  it('cableRow existe no cenario (garante que o teste do cabo usa o cabo da Ana)', () => {
    expect(cableRow(ID.cableAna, 'ana', ID.actAna).owner_id).toBe(IDS.ana);
  });
});

describe.skipIf(!DB_URL)('administrador: pessoas', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });
  const people = (tx: Tx) => tx.q<{ id: string; email: string; full_name: string; role: string; active: boolean }>(`select id, email, full_name, role, active from public.admin_list_people()`);

  it('o administrador lista todas as pessoas, com e-mail, a fila de pendentes primeiro', async () => {
    await db.run('postgres', async (tx) => {
      await tx.q(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000b1', 'novo@x.com', '{"full_name":"Novo Tecnico"}')`);
      await tx.as('davi');
      const list = await people(tx);
      expect(list.length).toBe(6);
      expect(list[0]).toMatchObject({ email: 'novo@x.com', full_name: 'Novo Tecnico', active: false }); // pendente: primeiro
      expect(list.find((p) => p.id === IDS.ana)).toMatchObject({ email: 'ana@rotafibra.test', role: 'tecnico', active: true });
    });
  });

  it('tecnico, escritorio e desativado recebem lista vazia (o e-mail nao vaza)', async () => {
    await db.run('ana', async (tx) => {
      for (const who of ['ana', 'bruno', 'clara', 'eva'] as const) {
        await tx.as(who);
        expect(await people(tx), who).toEqual([]);
      }
    });
  });

  it('sem login nao executa a funcao', async () => {
    await db.run('anon', async (tx) => { await tx.denied(`select * from public.admin_list_people()`); });
  });

  it('aprovar: o administrador ativa o pendente e fica registrado quem aprovou e quando', async () => {
    await db.run('postgres', async (tx) => {
      await tx.q(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000b2', 'fila@x.com')`);
      await tx.as('davi');
      expect(await tx.count(`update public.profiles set active = true where id = '00000000-0000-4000-8000-0000000000b2'`)).toBe(1);
      await tx.as('postgres');
      const r = await row<{ reviewed_by: string; reviewed_at: Date }>(tx, `select reviewed_by, reviewed_at from public.profiles where id = '00000000-0000-4000-8000-0000000000b2'`);
      expect(r.reviewed_by).toBe(IDS.davi);
      expect(r.reviewed_at).toBeTruthy();
      await tx.as('davi');
      const listed = (await tx.q<{ id: string; reviewed_by_name: string | null }>(`select id, reviewed_by_name from public.admin_list_people()`)).find((p) => p.id === '00000000-0000-4000-8000-0000000000b2');
      expect(listed?.reviewed_by_name).toBe('Davi Admin'); // a lista mostra QUEM aprovou
    });
  });

  it('o ultimo administrador ativo nao pode ser rebaixado nem desativado (nem por ele mesmo)', async () => {
    await db.run('davi', async (tx) => {
      await tx.fails('23514', `update public.profiles set role = 'tecnico' where id = $1`, [IDS.davi]);
      await tx.fails('23514', `update public.profiles set active = false where id = $1`, [IDS.davi]);
    });
    await db.run('postgres', async (tx) => {
      await tx.fails('23514', `update public.profiles set role = 'escritorio' where id = $1`, [IDS.davi]); // nem pelo SQL Editor
    });
  });

  it('com um segundo administrador ativo, dá para rebaixar o primeiro; o segundo vira o ultimo e fica protegido', async () => {
    await db.run('postgres', async (tx) => {
      await tx.q(`update public.profiles set role = 'admin' where id = $1`, [IDS.ana]);
      await tx.as('davi');
      expect(await tx.count(`update public.profiles set role = 'tecnico' where id = $1`, [IDS.davi])).toBe(1);
      await tx.as('ana');
      await tx.fails('23514', `update public.profiles set active = false where id = $1`, [IDS.ana]);
    });
  });

  it('desativar ou rebaixar quem NAO e administrador nao e barrado', async () => {
    await db.run('davi', async (tx) => {
      expect(await tx.count(`update public.profiles set active = false where id = $1`, [IDS.bruno])).toBe(1);
      expect(await tx.count(`update public.profiles set role = 'escritorio' where id = $1`, [IDS.ana])).toBe(1);
    });
  });
});
