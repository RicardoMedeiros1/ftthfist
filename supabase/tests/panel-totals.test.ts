import { PostgrestClient } from '@supabase/postgrest-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compareWithServer, createSupabaseTotalsApi, periodBounds, type TotalsApi } from '../../src/features/panel/serverTotals';
import { DEFAULT_TOTALS_FILTERS, computeTotals, type TotalsData } from '../../src/features/panel/totals';
import { dayEnd } from '../../src/features/panel/mapFilters';
import type { Activity, Cable } from '../../src/db/types';
import { ID, IDS, activityRow, cableRow, createTestDb, insertSql, type Person, type TestDb } from './support/harness';
import { POSTGREST_BIN, mint, startPostgrest } from './support/postgrest';

// Os totais do painel (calculados no navegador) contra a funcao cable_totals do servidor de verdade: quando os dados sao
// os mesmos, os dois TEM que bater. Roda so com TEST_DATABASE_URL e POSTGREST_BIN definidos.

const enabled = Boolean(process.env.TEST_DATABASE_URL && POSTGREST_BIN);

describe.skipIf(!enabled)('totais do painel x cable_totals do servidor', () => {
  let db: TestDb;
  let stop: () => void;
  let rest: string;
  const apiAs = (p: Person): TotalsApi => createSupabaseTotalsApi(new PostgrestClient(rest, { headers: { Authorization: `Bearer ${mint(IDS[p])}`, apikey: 'teste' } }) as unknown as SupabaseClient);
  const insert = async (table: string, row: Record<string, unknown>) => {
    const { sql, params } = insertSql(table, row);
    await db.admin(sql, params);
  };

  const OCT = { ...DEFAULT_TOTALS_FILTERS, from: '2026-10-01', to: '2026-10-31' };
  // o que cada celular tem (mesmos numeros que foram para o servidor)
  const cableAna = (id: string, len: number, res: number, at: string): Cable =>
    ({ id, ownerId: IDS.ana, createdBy: 'Ana Técnica', createdAt: Date.parse(at), updatedAt: 1, deleted: false, syncStatus: 'synced', cableType: 'AS-80', fiberCount: 12, vertices: [], lengthMeters: len, reserveMeters: res, totalMeters: len + res, activityId: ID.actAna, notes: '' }) as Cable;
  const cableBruno = (id: string, len: number, res: number, at: string): Cable => ({ ...cableAna(id, len, res, at), ownerId: IDS.bruno, createdBy: 'Bruno Técnico', activityId: ID.actBruno });
  const localActs = [
    { id: ID.actAna, ownerId: IDS.ana, technician: 'Ana Técnica', kind: 'implantacao', startedAt: Date.parse('2026-10-01T12:00:00Z'), deleted: false } as Activity,
    { id: ID.actBruno, ownerId: IDS.bruno, technician: 'Bruno Técnico', kind: 'implantacao', startedAt: Date.parse('2026-10-01T12:00:00Z'), deleted: false } as Activity,
  ];
  const mirror = (cables: Cable[]): TotalsData => ({ activities: localActs, elements: [], cables });

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
    await insert('activities', activityRow(ID.actAna, 'ana'));
    await insert('activities', activityRow(ID.actBruno, 'bruno'));
  });

  const seed = async (c: Cable, deleted = false) => {
    const row = cableRow(c.id, c.ownerId === IDS.ana ? 'ana' : 'bruno', c.activityId, { created_at: new Date(c.createdAt).toISOString(), length_m: c.lengthMeters, reserve_m: c.reserveMeters, total_m: c.totalMeters });
    await insert('cables', row);
    if (deleted) await db.admin(`update public.cables set deleted = true, updated_at = now() where id = $1`, [c.id]);
  };
  const server = async (as: Person = 'clara', f = OCT) => {
    const b = periodBounds(f);
    return apiAs(as).cableTotals(b.from, b.to);
  };

  it('os mesmos dados dao os mesmos totais (por tecnico, com nome, tracado, reservas e total)', async () => {
    const cables = [cableAna(ID.fresh(1), 100.25, 10, '2026-10-05T10:00:00Z'), cableAna(ID.fresh(2), 50, 0, '2026-10-20T10:00:00Z'), cableBruno(ID.fresh(3), 200, 20, '2026-10-10T10:00:00Z')];
    for (const c of cables) await seed(c);
    const remote = await server();
    expect(remote.map((r) => [r.label, r.cables, r.lengthMeters, r.reserveMeters, r.totalMeters])).toEqual([['Bruno Técnico', 1, 200, 20, 220], ['Ana Técnica', 2, 150.25, 10, 160.25]]);
    const here = computeTotals(mirror(cables), OCT);
    expect(compareWithServer(here, remote)).toEqual({ equal: true, diffs: [] });
  });

  it('cabo excluido nao conta, nem aqui nem la', async () => {
    const live = cableAna(ID.fresh(1), 100, 0, '2026-10-05T10:00:00Z');
    const gone = { ...cableAna(ID.fresh(2), 999, 0, '2026-10-06T10:00:00Z'), deleted: true };
    await seed(live);
    await seed(gone, true);
    const remote = await server();
    expect(remote).toHaveLength(1);
    expect(remote[0]).toMatchObject({ cables: 1, totalMeters: 100 });
    expect(compareWithServer(computeTotals(mirror([live, gone]), OCT), remote).equal).toBe(true);
  });

  it('o limite do periodo e o mesmo: o ultimo instante do ultimo dia entra, a meia-noite seguinte nao', async () => {
    const last = new Date(dayEnd('2026-10-31')!).toISOString();
    const next = new Date(dayEnd('2026-10-31')! + 1).toISOString();
    const inside = cableAna(ID.fresh(1), 10, 0, last);
    const outside = cableAna(ID.fresh(2), 20, 0, next);
    await seed(inside);
    await seed(outside);
    const remote = await server();
    expect(remote.map((r) => r.totalMeters)).toEqual([10]);
    expect(compareWithServer(computeTotals(mirror([inside, outside]), OCT), remote).equal).toBe(true);
  });

  it('periodo aberto (sem datas) pega tudo', async () => {
    const cables = [cableAna(ID.fresh(1), 10, 0, '2024-01-15T10:00:00Z'), cableAna(ID.fresh(2), 20, 5, '2026-10-05T10:00:00Z')];
    for (const c of cables) await seed(c);
    const remote = await server('clara', DEFAULT_TOTALS_FILTERS);
    expect(remote[0]).toMatchObject({ cables: 2, totalMeters: 35 });
    expect(compareWithServer(computeTotals(mirror(cables), DEFAULT_TOTALS_FILTERS), remote).equal).toBe(true);
  });

  it('o navegador que ainda nao recebeu tudo e flagrado: falta um cabo aqui', async () => {
    const a = cableAna(ID.fresh(1), 100, 0, '2026-10-05T10:00:00Z');
    const b = cableAna(ID.fresh(2), 50, 0, '2026-10-06T10:00:00Z');
    await seed(a);
    await seed(b);
    const diff = compareWithServer(computeTotals(mirror([a]), OCT), await server());
    expect(diff.equal).toBe(false);
    expect(diff.diffs).toEqual([{ owner: IDS.ana, label: 'Ana Técnica', status: 'diferente', here: { cables: 1, totalMeters: 100 }, server: { cables: 2, totalMeters: 150 } }]);
  });

  it('um tecnico inteiro que nao chegou aqui aparece como "so no servidor"', async () => {
    const a = cableAna(ID.fresh(1), 100, 0, '2026-10-05T10:00:00Z');
    const b = cableBruno(ID.fresh(2), 70, 0, '2026-10-06T10:00:00Z');
    await seed(a);
    await seed(b);
    const diff = compareWithServer(computeTotals(mirror([a]), OCT), await server());
    expect(diff.diffs.map((d) => [d.label, d.status])).toEqual([['Bruno Técnico', 'so-servidor']]);
  });

  it('escritorio e administrador veem a rede inteira; sem permissao a lista vem vazia, sem erro', async () => {
    await seed(cableAna(ID.fresh(1), 100, 0, '2026-10-05T10:00:00Z'));
    await seed(cableBruno(ID.fresh(2), 70, 0, '2026-10-06T10:00:00Z'));
    expect(await server('clara')).toHaveLength(2);
    expect(await server('davi')).toHaveLength(2);
    expect(await server('eva')).toEqual([]); // tecnica desativada: a RLS nao deixa ler nada
  });

  it('sem login valido: erro de autenticacao', async () => {
    const bad = createSupabaseTotalsApi(new PostgrestClient(rest, { headers: { Authorization: 'Bearer isto.nao.vale', apikey: 'teste' } }) as unknown as SupabaseClient);
    await expect(bad.cableTotals(...(Object.values(periodBounds(OCT)) as [string, string]))).rejects.toMatchObject({ kind: 'auth' });
  });
});
