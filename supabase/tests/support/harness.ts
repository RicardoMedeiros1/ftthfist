import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';

// Banco isolado por arquivo de teste: cria um banco novo, aplica o stub do Supabase e as migrations de verdade,
// e cria usuários e dados de exemplo. Quem consulta é "personificado" como o PostgREST faz:
// papel do Postgres (anon/authenticated) + JWT em request.jwt.claims.

export const DB_URL = process.env.TEST_DATABASE_URL;

const here = (p: string) => new URL(p, import.meta.url);
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const IDS = {
  ana: uuid(1), // técnica
  bruno: uuid(2), // técnico
  clara: uuid(3), // escritório
  davi: uuid(4), // admin
  eva: uuid(5), // técnica desativada
} as const;
export type Person = keyof typeof IDS;
export type Who = Person | 'anon' | 'postgres';

export const ID = {
  actAna: uuid(101),
  actBruno: uuid(102),
  elAna: uuid(201),
  elBruno: uuid(202),
  cableAna: uuid(301),
  photoAna: uuid(401),
  tp: (n: number) => uuid(500 + n),
  fresh: (n: number) => uuid(9000 + n),
};

const T0 = '2026-10-01T12:00:00Z';
const base = (owner: Person, name: string) => ({ owner_id: IDS[owner], created_by: name, created_at: T0, updated_at: T0 });

export type Row = Record<string, unknown>;

/** insert genérico (jsonb: passar já como string JSON). */
export function insertSql(table: string, row: Row) {
  const cols = Object.keys(row);
  return {
    sql: `insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    params: cols.map((c) => row[c]),
  };
}

/** O que o PostgREST faz com `Prefer: resolution=merge-duplicates`: INSERT … ON CONFLICT (id) DO UPDATE. */
export function upsertSql(table: string, row: Row) {
  const { sql, params } = insertSql(table, row);
  const sets = Object.keys(row).filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`);
  return { sql: `${sql} on conflict (id) do update set ${sets.join(', ')}`, params };
}

export const activityRow = (id: string, owner: Person, extra: Row = {}): Row => ({
  id, ...base(owner, owner), kind: 'implantacao', title: `Atividade de ${owner}`, technician: owner,
  started_at: T0, status: 'aberta', ...extra,
});
export const elementRow = (id: string, owner: Person, activityId: string, extra: Row = {}): Row => ({
  id, ...base(owner, owner), activity_id: activityId, type: 'poste', lat: -23.55, lng: -46.63, position_source: 'manual', code: 'P-1', ...extra,
});
export const cableRow = (id: string, owner: Person, activityId: string, extra: Row = {}): Row => ({
  id, ...base(owner, owner), activity_id: activityId, cable_type: 'AS-80', fiber_count: 12,
  vertices: JSON.stringify([{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.631 }]), length_m: 150, reserve_m: 10, total_m: 160, ...extra,
});
export const photoRow = (id: string, owner: Person, activityId: string, extra: Row = {}): Row => ({
  id, ...base(owner, owner), activity_id: activityId, taken_at: T0, ...extra,
});
export const trackRow = (id: string, owner: Person, activityId: string, lat: number, lng: number, ts: string, segment = 0): Row => ({
  id, ...base(owner, owner), activity_id: activityId, lat, lng, accuracy_m: 8, ts, segment,
});

export interface Tx {
  /** consulta; devolve as linhas */
  q<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** consulta; devolve o nº de linhas afetadas */
  count(sql: string, params?: unknown[]): Promise<number>;
  /** troca quem está consultando (como mandar outro JWT) */
  as(who: Who): Promise<void>;
  /** espera que o banco RECUSE (permissão ou RLS, código 42501) e continua usando a transação */
  denied(sql: string, params?: unknown[]): Promise<void>;
  /** espera erro com este código do Postgres (ex.: 23514 check, 22023 parâmetro inválido) */
  fails(code: string, sql: string, params?: unknown[]): Promise<void>;
}

async function impersonate(c: pg.PoolClient, who: Who) {
  await c.query('reset role');
  if (who === 'postgres') {
    await c.query(`select set_config('request.jwt.claims', '', true)`);
  } else if (who === 'anon') {
    await c.query(`select set_config('role', 'anon', true), set_config('request.jwt.claims', '', true)`);
  } else {
    const claims = JSON.stringify({ sub: IDS[who], role: 'authenticated' });
    await c.query(`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)`, [claims]);
  }
}

export interface TestDb {
  name: string;
  /** URL de conexao deste banco de teste (o PostgREST dos testes de integracao usa esta). */
  url: string;
  /** roda `fn` numa transação personificada como `who`; tudo é desfeito no fim (rollback) */
  run<T>(who: Who, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** SQL como superusuário, gravado de verdade (para montar cenários) */
  admin<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  drop(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  if (!DB_URL) throw new Error('TEST_DATABASE_URL não definida');
  const adminClient = new pg.Client({ connectionString: DB_URL });
  await adminClient.connect();
  const name = `rf_test_${randomBytes(4).toString('hex')}`;
  const url = new URL(DB_URL);
  url.pathname = `/${name}`;

  // Os papéis (anon, authenticated…) são do cluster inteiro: o preparo roda um arquivo de teste por vez.
  await adminClient.query('select pg_advisory_lock(7777)');
  try {
    await adminClient.query(`create database ${name}`);
    const setup = new pg.Client({ connectionString: url.toString() });
    await setup.connect();
    await setup.query(readFileSync(here('./supabase-stub.sql'), 'utf8').replace(':"dbname"', `"${name}"`));
    const migrations = readdirSync(here('../../migrations/')).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migrations) await setup.query(readFileSync(here(`../../migrations/${f}`), 'utf8'));
    await setup.end();
  } finally {
    await adminClient.query('select pg_advisory_unlock(7777)');
  }

  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  // ao apagar o banco de teste (drop ... with force) o Postgres derruba conexoes ociosas: isso nao e erro do teste
  pool.on('error', () => undefined);
  const admin = async <T = Row>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

  // ---------- cenário ----------
  const people: [Person, string, string, boolean][] = [
    ['ana', 'Ana Técnica', 'tecnico', true],
    ['bruno', 'Bruno Técnico', 'tecnico', true],
    ['clara', 'Clara Escritório', 'escritorio', true],
    ['davi', 'Davi Admin', 'admin', true],
    ['eva', 'Eva Desativada', 'tecnico', false],
  ];
  for (const [p, full, role, active] of people) {
    await admin(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [IDS[p], `${p}@rotafibra.test`, JSON.stringify({ full_name: full })]);
    await admin(`update public.profiles set role = $2, active = $3 where id = $1`, [IDS[p], role, active]);
  }
  const put = async (table: string, row: Row) => {
    const { sql, params } = insertSql(table, row);
    await pool.query(sql, params);
  };
  await put('activities', activityRow(ID.actAna, 'ana'));
  await put('activities', activityRow(ID.actBruno, 'bruno'));
  await put('elements', elementRow(ID.elAna, 'ana', ID.actAna, { code: 'P-ANA' }));
  await put('elements', elementRow(ID.elBruno, 'bruno', ID.actBruno, { code: 'P-BRUNO', lat: -23.56, lng: -46.64 }));
  await put('cables', cableRow(ID.cableAna, 'ana', ID.actAna));
  await put('photos', photoRow(ID.photoAna, 'ana', ID.actAna, { element_id: ID.elAna, lat: -23.55, lng: -46.63 }));

  return {
    name,
    url: url.toString(),
    admin,
    async run(who, fn) {
      const c = await pool.connect();
      let n = 0;
      try {
        await c.query('begin');
        await impersonate(c, who);
        const guarded = async (sql: string, params: unknown[] | undefined, expect: (e: { code?: string; message: string } | null) => void) => {
          const sp = `sp${n++}`;
          await c.query(`savepoint ${sp}`);
          let err: { code?: string; message: string } | null = null;
          try {
            await c.query(sql, params);
          } catch (e) {
            err = e as { code?: string; message: string };
          }
          await c.query(`rollback to savepoint ${sp}`);
          expect(err);
        };
        const tx: Tx = {
          q: async <T,>(sql: string, params?: unknown[]) => (await c.query(sql, params)).rows as T[],
          count: async (sql, params) => (await c.query(sql, params)).rowCount ?? 0,
          as: (w) => impersonate(c, w),
          denied: (sql, params) =>
            guarded(sql, params, (e) => {
              if (!e) throw new Error(`esperava que o banco recusasse, mas funcionou: ${sql.slice(0, 80)}`);
              if (e.code !== '42501') throw new Error(`esperava recusa (42501), veio ${e.code}: ${e.message}`);
            }),
          fails: (code, sql, params) =>
            guarded(sql, params, (e) => {
              if (!e) throw new Error(`esperava erro ${code}, mas funcionou: ${sql.slice(0, 80)}`);
              if (e.code !== code) throw new Error(`esperava erro ${code}, veio ${e.code}: ${e.message}`);
            }),
        };
        return await fn(tx);
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    },
    async drop() {
      await pool.end();
      await adminClient.query(`drop database if exists ${name} with (force)`);
      await adminClient.end();
    },
  };
}
