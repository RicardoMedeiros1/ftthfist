import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, IDS, cableRow, createTestDb, elementRow, upsertSql, type Row, type TestDb, type Tx } from './support/harness';

// O envio do app é um upsert por id (PostgREST: INSERT … ON CONFLICT DO UPDATE). Aqui se prova o que o
// critério de aceite pede: reenviar não duplica, o mais recente vence, e o atrasado vai para o log.

const T1 = '2026-10-01T12:00:00Z';
const T2 = '2026-10-01T13:00:00Z';
const T3 = '2026-10-01T14:00:00Z';

const up = (tx: Tx, table: string, row: Row) => {
  const { sql, params } = upsertSql(table, row);
  return tx.q(sql, params);
};
const el = (extra: Row = {}) => elementRow(ID.fresh(1), 'ana', ID.actAna, { code: 'P-NOVO', notes: 'versão A', ...extra });
const get = async (tx: Tx, id = ID.fresh(1)) =>
  (await tx.q<{ notes: string; updated_at: Date; server_updated_at: Date; deleted: boolean }>(`select notes, updated_at, server_updated_at, deleted from public.elements where id = $1`, [id]))[0]!;

describe.skipIf(!DB_URL)('sincronização: upsert idempotente e conflito', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('reenviar o mesmo registro (internet caiu antes da resposta) não duplica nem mexe no servidor', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el());
      const first = await get(tx);
      await up(tx, 'elements', el());
      await up(tx, 'elements', el());
      expect((await tx.q(`select 1 from public.elements where id = $1`, [ID.fresh(1)]))).toHaveLength(1);
      const again = await get(tx);
      expect(again.server_updated_at.getTime()).toBe(first.server_updated_at.getTime());
    });
  });

  it('o envio mais recente vence e avança o cursor do servidor', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: T1 }));
      const v1 = await get(tx);
      await up(tx, 'elements', el({ updated_at: T2, notes: 'versão B' }));
      const v2 = await get(tx);
      expect(v2.notes).toBe('versão B');
      expect(v2.server_updated_at.getTime()).toBeGreaterThan(v1.server_updated_at.getTime());
    });
  });

  it('o envio atrasado perde, o servidor mantém a versão mais nova e o conflito vai para o log do admin', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: T2, notes: 'versão nova' }));
      await up(tx, 'elements', el({ updated_at: T1, notes: 'versão velha, de outro aparelho' }));
      expect((await get(tx)).notes).toBe('versão nova');
      await tx.as('ana');
      expect(await tx.q(`select 1 from public.sync_conflicts`)).toHaveLength(0); // técnico não lê o log
      await tx.as('davi');
      const log = await tx.q<{ table_name: string; owner_id: string; incoming: { notes: string }; kept: { notes: string } }>(
        `select table_name, owner_id, incoming, kept from public.sync_conflicts where record_id = $1`, [ID.fresh(1)]);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ table_name: 'elements', owner_id: IDS.ana });
      expect(log[0]!.incoming.notes).toBe('versão velha, de outro aparelho');
      expect(log[0]!.kept.notes).toBe('versão nova');
    });
  });

  it('reenvio atrasado e IDÊNTICO ao do servidor não é conflito (nada a registrar)', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: T2 }));
      await up(tx, 'elements', el({ updated_at: T1 })); // mesmo conteúdo, relógio antigo
      await tx.as('davi');
      expect(await tx.q(`select 1 from public.sync_conflicts where record_id = $1`, [ID.fresh(1)])).toHaveLength(0);
    });
  });

  it('o mesmo técnico em dois aparelhos: a edição mais nova vence, qualquer que seja a ordem de chegada', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: T1 }));
      await up(tx, 'elements', el({ updated_at: T3, notes: 'aparelho B (mais novo)' }));
      await up(tx, 'elements', el({ updated_at: T2, notes: 'aparelho A (offline, chegou depois)' }));
      const r = await get(tx);
      expect(r.notes).toBe('aparelho B (mais novo)');
      expect(r.updated_at.toISOString()).toBe('2026-10-01T14:00:00.000Z');
    });
  });

  it('exclusão lógica é uma alteração como as outras: propaga e também respeita o mais recente', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: T1 }));
      await up(tx, 'elements', el({ updated_at: T2, deleted: true }));
      expect((await get(tx)).deleted).toBe(true);
      await up(tx, 'elements', el({ updated_at: T1, deleted: false })); // edição antiga não "desfaz" a exclusão
      expect((await get(tx)).deleted).toBe(true);
    });
  });

  it('relógio adiantado do celular não vence para sempre: o updated_at é limitado a "agora + 5 min"', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ updated_at: '2099-01-01T00:00:00Z' }));
      const [flags] = await tx.q<{ ok: boolean; in_range: boolean }>(
        `select updated_at <= clock_timestamp() + interval '5 minutes' as ok, updated_at > clock_timestamp() as in_range
         from public.elements where id = $1`, [ID.fresh(1)]);
      expect(flags!.ok).toBe(true);
      expect(flags!.in_range).toBe(true);
      // e uma edição honesta feita DEPOIS do erro de relógio passa a vencer assim que o tempo real alcançar o limite
      await up(tx, 'elements', el({ updated_at: T3, notes: 'edição com relógio certo' }));
      expect((await get(tx)).notes).toBe('versão A'); // ainda não: o servidor guarda "agora + 5 min"
    });
  });

  it('o aparelho não escolhe o server_updated_at: o servidor sempre grava o próprio relógio', async () => {
    await db.run('ana', async (tx) => {
      await up(tx, 'elements', el({ server_updated_at: '2000-01-01T00:00:00Z' }));
      expect((await get(tx)).server_updated_at.getFullYear()).toBeGreaterThanOrEqual(2026);
    });
  });

  it('cabo também: reenvio sem duplicar e geometria recalculada só quando a versão nova vence', async () => {
    await db.run('ana', async (tx) => {
      const cable = (extra: Row = {}) => cableRow(ID.fresh(30), 'ana', ID.actAna, extra);
      await up(tx, 'cables', cable({ updated_at: T2 }));
      await up(tx, 'cables', cable({ updated_at: T2 }));
      expect(await tx.q(`select 1 from public.cables where id = $1`, [ID.fresh(30)])).toHaveLength(1);
      const longer = JSON.stringify([{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.631 }, { lat: -23.552, lng: -46.632 }]);
      await up(tx, 'cables', cable({ updated_at: T1, vertices: longer })); // atrasado: ignorado
      const n = async () => (await tx.q<{ n: number }>(`select st_npoints(geom::geometry) as n from public.cables where id = $1`, [ID.fresh(30)]))[0]!.n;
      expect(await n()).toBe(2);
      await up(tx, 'cables', cable({ updated_at: T3, vertices: longer })); // mais novo: aplica
      expect(await n()).toBe(3);
    });
  });

  it('puxar desde a última sincronização: o cursor (server_updated_at, id) devolve só o que mudou', async () => {
    await db.run('bruno', async (tx) => {
      // O cursor é guardado COMO TEXTO: o servidor tem microssegundos e um Date do JavaScript os perderia
      // (a última linha lida voltaria na próxima rodada).
      const all = await tx.q<{ id: string; cur: string }>(`select id, server_updated_at::text as cur from public.elements order by server_updated_at, id`);
      expect(all).toHaveLength(2);
      const after = await tx.q<{ id: string }>(
        `select id from public.elements where (server_updated_at, id) > ($1::timestamptz, $2::uuid) order by server_updated_at, id`, [all[0]!.cur, all[0]!.id]);
      expect(after.map((r) => r.id)).toEqual([all[1]!.id]);
      const none = await tx.q(`select id from public.elements where (server_updated_at, id) > ($1::timestamptz, $2::uuid)`, [all[1]!.cur, all[1]!.id]);
      expect(none).toHaveLength(0);
    });
  });
});
