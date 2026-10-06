import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_URL, ID, IDS, activityRow, cableRow, createTestDb, elementRow, insertSql, photoRow, trackRow, upsertSql, type Row, type TestDb,
} from './support/harness';

// Permissões e RLS. Cada teste personifica um usuário (como o JWT do PostgREST) e tenta de verdade
// ler/escrever; no fim a transação é desfeita.

describe.skipIf(!DB_URL)('perfis e papéis', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('usuário novo ganha perfil de técnico, com o nome do cadastro (ou o começo do e-mail)', async () => {
    await db.run('postgres', async (tx) => {
      await tx.q(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000a1', 'joana@x.com', '{"full_name":"Joana Silva"}')`);
      await tx.q(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a2', 'sem.nome@x.com')`);
      const p = await tx.q<{ id: string; full_name: string; role: string; active: boolean }>(
        `select id, full_name, role, active from public.profiles where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2') order by id`);
      expect(p).toEqual([
        { id: '00000000-0000-4000-8000-0000000000a1', full_name: 'Joana Silva', role: 'tecnico', active: true },
        { id: '00000000-0000-4000-8000-0000000000a2', full_name: 'sem.nome', role: 'tecnico', active: true },
      ]);
    });
  });

  it('ninguém se promove sozinho: o técnico não consegue mudar o próprio papel', async () => {
    await db.run('ana', async (tx) => {
      expect(await tx.count(`update public.profiles set role = 'admin' where id = $1`, [IDS.ana])).toBe(0);
      await tx.as('postgres');
      expect((await tx.q<{ role: string }>(`select role from public.profiles where id = $1`, [IDS.ana]))[0]!.role).toBe('tecnico');
    });
  });

  it('escritório também não altera perfis', async () => {
    await db.run('clara', async (tx) => {
      expect(await tx.count(`update public.profiles set active = false where id = $1`, [IDS.ana])).toBe(0);
    });
  });

  it('o admin altera papéis e desativa contas', async () => {
    await db.run('davi', async (tx) => {
      expect(await tx.count(`update public.profiles set role = 'escritorio' where id = $1`, [IDS.bruno])).toBe(1);
      expect(await tx.count(`update public.profiles set active = false where id = $1`, [IDS.bruno])).toBe(1);
    });
  });

  it('conta desativada vira ex-usuário: não lê perfis nem dados da rede', async () => {
    await db.run('eva', async (tx) => {
      expect(await tx.q(`select 1 from public.profiles`)).toHaveLength(0);
      expect(await tx.q(`select 1 from public.elements`)).toHaveLength(0);
      expect(await tx.q(`select 1 from public.activities`)).toHaveLength(0);
    });
  });

  it('desativar o dono durante o expediente corta o acesso na hora', async () => {
    await db.run('postgres', async (tx) => {
      await tx.q(`update public.profiles set active = false where id = $1`, [IDS.ana]);
      await tx.as('ana');
      expect(await tx.q(`select 1 from public.elements`)).toHaveLength(0);
      await tx.denied(...(Object.values(insertSql('elements', elementRow(ID.fresh(1), 'ana', ID.actAna))) as [string, unknown[]]));
    });
  });

  it('técnico e escritório leem nomes e papéis (para os filtros do painel); não inserem nem apagam perfis', async () => {
    for (const who of ['ana', 'clara'] as const) {
      await db.run(who, async (tx) => {
        expect(await tx.q(`select 1 from public.profiles`)).toHaveLength(5);
        await tx.denied(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'x')`);
        await tx.denied(`delete from public.profiles where id = $1`, [IDS.bruno]);
      });
    }
  });

  it('anônimo não toca em nada (sem privilégio nas tabelas)', async () => {
    await db.run('anon', async (tx) => {
      for (const t of ['profiles', 'activities', 'elements', 'cables', 'photos', 'track_points', 'sync_conflicts']) {
        await tx.denied(`select 1 from public.${t}`);
      }
      await tx.denied(...(Object.values(insertSql('elements', elementRow(ID.fresh(2), 'ana', ID.actAna))) as [string, unknown[]]));
    });
  });
});

describe.skipIf(!DB_URL)('estrutura: o que nunca pode ser esquecido', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('toda tabela do schema public tem RLS ligada', async () => {
    const off = await db.admin<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(off).toEqual([]);
  });

  it('usuário logado não tem DELETE nem TRUNCATE em nenhuma tabela; anônimo não tem nada', async () => {
    const bad = await db.admin<{ grantee: string; table_name: string; privilege_type: string }>(
      `select grantee, table_name, privilege_type from information_schema.role_table_grants
       where table_schema = 'public'
         and ((grantee = 'authenticated' and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
           or grantee = 'anon')`);
    expect(bad).toEqual([]);
  });

  it('só funções de trigger sensíveis ficam sem EXECUTE para usuário comum', async () => {
    const open = await db.admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('sync_guard', 'cables_set_geom', 'handle_new_user')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    expect(open).toEqual([]);
  });
});

// As mesmas regras valem para todas as tabelas de dados.
const TABLES: { table: string; mine: (id: string, owner: 'ana' | 'bruno', act: string) => Row; existing: string; change: Row }[] = [
  { table: 'activities', mine: (id, o) => activityRow(id, o), existing: ID.actAna, change: { title: 'trocado' } },
  { table: 'elements', mine: (id, o, a) => elementRow(id, o, a), existing: ID.elAna, change: { code: 'trocado' } },
  { table: 'cables', mine: (id, o, a) => cableRow(id, o, a), existing: ID.cableAna, change: { notes: 'trocado' } },
  { table: 'photos', mine: (id, o, a) => photoRow(id, o, a), existing: ID.photoAna, change: { storage_path: 'x' } },
];

describe.skipIf(!DB_URL).each(TABLES)('$table: quem lê, quem escreve', ({ table, mine, existing, change }) => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  const ins = (row: Row) => Object.values(insertSql(table, row)) as [string, unknown[]];

  it('técnico, escritório e admin leem o registro de outro técnico', async () => {
    for (const who of ['bruno', 'clara', 'davi'] as const) {
      await db.run(who, async (tx) => {
        expect(await tx.q(`select id from public.${table} where id = $1`, [existing])).toHaveLength(1);
      });
    }
  });

  it('o dono cria (o dono é gravado pelo servidor, mesmo sem owner_id no envio) e edita o que é dele', async () => {
    await db.run('ana', async (tx) => {
      const row = mine(ID.fresh(10), 'ana', ID.actAna);
      delete row.owner_id;
      await tx.q(...ins(row));
      expect((await tx.q<{ owner_id: string }>(`select owner_id from public.${table} where id = $1`, [ID.fresh(10)]))[0]!.owner_id).toBe(IDS.ana);
      const sets = Object.keys(change).map((k, i) => `${k} = $${i + 2}`).join(', ');
      expect(await tx.count(`update public.${table} set ${sets}, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [existing, ...Object.values(change)])).toBe(1);
    });
  });

  it('não dá para criar em nome de outro (owner_id alheio)', async () => {
    await db.run('ana', async (tx) => {
      await tx.denied(...ins(mine(ID.fresh(11), 'bruno', ID.actAna)));
    });
  });

  it('outro técnico não edita: o UPDATE não alcança a linha', async () => {
    await db.run('bruno', async (tx) => {
      const sets = Object.keys(change).map((k, i) => `${k} = $${i + 2}`).join(', ');
      expect(await tx.count(`update public.${table} set ${sets}, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [existing, ...Object.values(change)])).toBe(0);
      await tx.as('postgres');
      const key = Object.keys(change)[0]!;
      expect((await tx.q(`select ${key} as v from public.${table} where id = $1`, [existing]))[0]!.v).not.toBe(Object.values(change)[0]);
    });
  });

  it('nem reaproveitando o id do registro alheio num upsert (o ataque que a interface não mostra)', async () => {
    await db.run('bruno', async (tx) => {
      const hijack = mine(existing, 'bruno', ID.actBruno);
      await tx.denied(...(Object.values(upsertSql(table, hijack)) as [string, unknown[]]));
    });
  });

  it('o dono não pode passar o registro para outra pessoa', async () => {
    await db.run('ana', async (tx) => {
      await tx.denied(`update public.${table} set owner_id = $2, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [existing, IDS.bruno]);
    });
  });

  it('escritório lê tudo mas não cria nem edita dados de campo', async () => {
    await db.run('clara', async (tx) => {
      await tx.denied(...ins(mine(ID.fresh(12), 'ana', ID.actAna)));
      expect(await tx.count(`update public.${table} set updated_at = '2026-10-02T00:00:00Z' where id = $1`, [existing])).toBe(0);
    });
  });

  it('ninguém apaga linha: nem o dono, nem o admin (a exclusão é lógica)', async () => {
    for (const who of ['ana', 'davi'] as const) {
      await db.run(who, async (tx) => {
        await tx.denied(`delete from public.${table} where id = $1`, [existing]);
        await tx.denied(`truncate public.${table}`);
      });
    }
  });

  it('conta desativada não escreve', async () => {
    await db.run('eva', async (tx) => {
      await tx.denied(...ins(mine(ID.fresh(13), 'ana', ID.actAna)));
    });
  });
});

describe.skipIf(!DB_URL)('o dono é imutável (segunda camada: trigger, vale até com privilégio total)', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('nem o servidor com acesso irrestrito troca owner_id por engano', async () => {
    await db.run('postgres', async (tx) => {
      await tx.denied(`update public.elements set owner_id = $2, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [ID.elAna, IDS.bruno]);
    });
  });
});

describe.skipIf(!DB_URL)('registros filhos só se ligam a atividade do próprio dono', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('ana não pendura elemento, cabo, foto nem ponto de trilha na atividade do Bruno', async () => {
    await db.run('ana', async (tx) => {
      await tx.denied(...(Object.values(insertSql('elements', elementRow(ID.fresh(20), 'ana', ID.actBruno))) as [string, unknown[]]));
      await tx.denied(...(Object.values(insertSql('cables', cableRow(ID.fresh(21), 'ana', ID.actBruno))) as [string, unknown[]]));
      await tx.denied(...(Object.values(insertSql('photos', photoRow(ID.fresh(22), 'ana', ID.actBruno))) as [string, unknown[]]));
      await tx.denied(...(Object.values(insertSql('track_points', trackRow(ID.fresh(23), 'ana', ID.actBruno, -23.5, -46.6, '2026-10-01T12:00:00Z'))) as [string, unknown[]]));
    });
  });

  it('nem mudando a atividade de um registro que já é dela', async () => {
    await db.run('ana', async (tx) => {
      await tx.denied(`update public.elements set activity_id = $2, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [ID.elAna, ID.actBruno]);
    });
  });
});

describe.skipIf(!DB_URL)('trilha GPS: privacidade', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    for (const [i, [lat, lng]] of [[-23.5, -46.6], [-23.501, -46.6]].entries()) {
      const { sql, params } = insertSql('track_points', trackRow(ID.tp(i), 'ana', ID.actAna, lat!, lng!, `2026-10-01T12:0${i}:00Z`));
      await db.admin(sql, params);
    }
  });
  afterAll(async () => { await db?.drop(); });

  it('só o dono, o escritório e o admin leem a trilha; outro técnico não vê nada', async () => {
    const seen: Record<string, number> = {};
    for (const who of ['ana', 'bruno', 'clara', 'davi'] as const) {
      await db.run(who, async (tx) => { seen[who] = (await tx.q(`select 1 from public.track_points`)).length; });
    }
    expect(seen).toEqual({ ana: 2, bruno: 0, clara: 2, davi: 2 });
  });

  it('a visão activity_tracks segue a mesma regra (security_invoker)', async () => {
    const seen: Record<string, number> = {};
    for (const who of ['ana', 'bruno', 'clara'] as const) {
      await db.run(who, async (tx) => { seen[who] = (await tx.q(`select 1 from public.activity_tracks`)).length; });
    }
    expect(seen).toEqual({ ana: 1, bruno: 0, clara: 1 });
  });
});

describe.skipIf(!DB_URL)('conflitos: só o admin lê o log', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.admin(`insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept) values ('elements', $1, $2, '{}', '{}')`, [ID.elAna, IDS.ana]);
  });
  afterAll(async () => { await db?.drop(); });

  it('admin vê; técnico e escritório não', async () => {
    const seen: Record<string, number> = {};
    for (const who of ['ana', 'clara', 'davi'] as const) {
      await db.run(who, async (tx) => { seen[who] = (await tx.q(`select 1 from public.sync_conflicts`)).length; });
    }
    expect(seen).toEqual({ ana: 0, clara: 0, davi: 1 });
  });

  it('ninguém escreve no log pela API (só o trigger do servidor)', async () => {
    await db.run('davi', async (tx) => {
      await tx.denied(`insert into public.sync_conflicts (table_name, record_id, owner_id, incoming, kept) values ('x', gen_random_uuid(), gen_random_uuid(), '{}', '{}')`);
    });
  });
});
