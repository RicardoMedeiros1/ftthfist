import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, IDS, cableRow, createTestDb, elementRow, insertSql, photoRow, trackRow, type Row, type TestDb } from './support/harness';

const insert = (table: string, row: Row) => Object.values(insertSql(table, row)) as [string, unknown[]];

// distância "de livro" (haversine), para conferir o que o PostGIS calcula
function haversine(a: [number, number], b: [number, number]) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe.skipIf(!DB_URL)('geometria PostGIS calculada no servidor', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  it('elemento: geom vem de lat/lng, na ordem certa (x = longitude, y = latitude)', async () => {
    await db.run('ana', async (tx) => {
      const [g] = await tx.q<{ x: number; y: number; srid: number }>(
        `select st_x(geom::geometry) as x, st_y(geom::geometry) as y, st_srid(geom::geometry) as srid from public.elements where id = $1`, [ID.elAna]);
      expect(g).toEqual({ x: -46.63, y: -23.55, srid: 4326 });
    });
  });

  it('coordenadas fora do mundo e precisão negativa são recusadas', async () => {
    await db.run('ana', async (tx) => {
      await tx.fails('23514', ...insert('elements', elementRow(ID.fresh(40), 'ana', ID.actAna, { lat: 95 })));
      await tx.fails('23514', ...insert('elements', elementRow(ID.fresh(41), 'ana', ID.actAna, { lng: -190 })));
      await tx.fails('23514', ...insert('elements', elementRow(ID.fresh(42), 'ana', ID.actAna, { accuracy_m: -1, position_source: 'gps' })));
      await tx.fails('23514', ...insert('elements', elementRow(ID.fresh(43), 'ana', ID.actAna, { type: 'torre' })));
      await tx.fails('23514', ...insert('elements', elementRow(ID.fresh(44), 'ana', ID.actAna, { position_source: 'satelite' })));
    });
  });

  it('cabo: geom é a linha dos vértices, na ordem do traçado, e o comprimento bate com a conta de livro (< 0,7%)', async () => {
    const pts: [number, number][] = [[-23.55, -46.63], [-23.5508, -46.6311], [-23.552, -46.6322], [-23.5529, -46.6341]];
    await db.run('ana', async (tx) => {
      await tx.q(...insert('cables', cableRow(ID.fresh(50), 'ana', ID.actAna, { vertices: JSON.stringify(pts.map(([lat, lng]) => ({ lat, lng }))) })));
      const [r] = await tx.q<{ n: number; x0: number; y0: number; x3: number; y3: number; len: string }>(
        `select st_npoints(geom::geometry) n,
                st_x(st_startpoint(geom::geometry)) x0, st_y(st_startpoint(geom::geometry)) y0,
                st_x(st_endpoint(geom::geometry)) x3, st_y(st_endpoint(geom::geometry)) y3,
                st_length(geom) len
         from public.cables where id = $1`, [ID.fresh(50)]);
      expect(r).toMatchObject({ n: 4, x0: -46.63, y0: -23.55, x3: -46.6341, y3: -23.5529 });
      const book = pts.slice(1).reduce((s, p, i) => s + haversine(pts[i]!, p), 0);
      expect(Math.abs(Number(r!.len) - book) / book).toBeLessThan(0.007);
    });
  });

  it('cabo: alterar os vértices recalcula a geometria', async () => {
    await db.run('ana', async (tx) => {
      const three = JSON.stringify([{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.631 }, { lat: -23.552, lng: -46.632 }]);
      expect(await tx.count(`update public.cables set vertices = $2, updated_at = '2026-10-02T00:00:00Z' where id = $1`, [ID.cableAna, three])).toBe(1);
      expect((await tx.q<{ n: number }>(`select st_npoints(geom::geometry) n from public.cables where id = $1`, [ID.cableAna]))[0]!.n).toBe(3);
    });
  });

  it('cabo: menos de 2 pontos, ponto sem lat/lng, não numérico ou fora do mundo são recusados', async () => {
    await db.run('ana', async (tx) => {
      const bad = (v: unknown, code: string, n: number) => tx.fails(code, ...insert('cables', cableRow(ID.fresh(n), 'ana', ID.actAna, { vertices: JSON.stringify(v) })));
      await bad([{ lat: -23.55, lng: -46.63 }], '23514', 60);
      await bad([], '23514', 61);
      await bad({ lat: 1, lng: 2 }, '23514', 62);
      await bad([{ lat: -23.55, lng: -46.63 }, { lng: -46.631 }], '22023', 63);
      await bad([{ lat: -23.55, lng: -46.63 }, { lat: 'abc', lng: -46.631 }], '22023', 64);
      await bad([{ lat: -23.55, lng: -46.63 }, { lat: 95, lng: -46.631 }], '22023', 65);
      await bad([{ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: 181 }], '22023', 66);
      await tx.fails('23514', ...insert('cables', cableRow(ID.fresh(67), 'ana', ID.actAna, { fiber_count: 3 })));
      await tx.fails('23514', ...insert('cables', cableRow(ID.fresh(68), 'ana', ID.actAna, { total_m: -5 })));
    });
  });

  it('foto: geom só existe quando há lat e lng', async () => {
    await db.run('ana', async (tx) => {
      await tx.q(...insert('photos', photoRow(ID.fresh(70), 'ana', ID.actAna)));
      await tx.q(...insert('photos', photoRow(ID.fresh(71), 'ana', ID.actAna, { lat: -23.5, lng: -46.6 })));
      const r = await tx.q<{ id: string; has: boolean }>(`select id, geom is not null as has from public.photos where id in ($1, $2) order by id`, [ID.fresh(70), ID.fresh(71)]);
      expect(r.map((x) => x.has)).toEqual([false, true]);
    });
  });
});

describe.skipIf(!DB_URL)('trilhas e totais do painel', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    // trecho 0: dois pontos a ~111 m; trecho 1: dois pontos longe dele (o "salto" entre trechos não pode contar);
    // trecho 2: um ponto só (não vira linha); e um ponto excluído
    const pts: [number, number, number, string, number][] = [
      [0, -23.5, -46.6, '2026-10-01T12:00:00Z', 0], [1, -23.501, -46.6, '2026-10-01T12:01:00Z', 0],
      [2, -23.6, -46.7, '2026-10-01T12:10:00Z', 1], [3, -23.601, -46.7, '2026-10-01T12:11:00Z', 1],
      [4, -23.7, -46.8, '2026-10-01T12:20:00Z', 2],
    ];
    for (const [i, lat, lng, ts, seg] of pts) {
      const { sql, params } = insertSql('track_points', trackRow(ID.tp(i), 'ana', ID.actAna, lat, lng, ts, seg));
      await db.admin(sql, params);
    }
    const dead = insertSql('track_points', { ...trackRow(ID.tp(9), 'ana', ID.actAna, -22, -45, '2026-10-01T12:30:00Z', 0), deleted: true });
    await db.admin(dead.sql, dead.params);
    expect(await db.admin(`select 1 from public.track_points`)).toHaveLength(6); // 5 + o excluído: se não estiver aqui, o teste abaixo não prova nada
  });
  afterAll(async () => { await db?.drop(); });

  it('activity_tracks: uma linha por trecho, sem ligar os trechos, com início, fim e distância', async () => {
    await db.run('clara', async (tx) => {
      const rows = await tx.q<{ owner_id: string; started_at: Date; ended_at: Date; length_m: string; parts: number; pts: number }>(
        `select owner_id, started_at, ended_at, length_m, st_numgeometries(geom::geometry) parts, st_npoints(geom::geometry) pts from public.activity_tracks where activity_id = $1`, [ID.actAna]);
      expect(rows).toHaveLength(1);
      const r = rows[0]!;
      expect(r.owner_id).toBe(IDS.ana);
      expect(r.parts).toBe(2); // o trecho de 1 ponto não vira linha
      expect(r.pts).toBe(4);
      expect(r.started_at.toISOString()).toBe('2026-10-01T12:00:00.000Z');
      expect(r.ended_at.toISOString()).toBe('2026-10-01T12:11:00.000Z');
      const book = haversine([-23.5, -46.6], [-23.501, -46.6]) + haversine([-23.6, -46.7], [-23.601, -46.7]);
      expect(Math.abs(Number(r.length_m) - book) / book).toBeLessThan(0.007); // sem o "salto" de ~15 km entre os trechos
    });
  });

  it('cable_totals: soma por técnico e período, ignora excluídos e fora do período; técnico também consulta', async () => {
    for (const [i, [owner, act, total, created, deleted]] of ([
      ['ana', ID.actAna, 100, '2026-10-02T10:00:00Z', false],
      ['ana', ID.actAna, 50, '2026-10-03T10:00:00Z', false],
      ['ana', ID.actAna, 999, '2026-10-04T10:00:00Z', true], // excluído
      ['ana', ID.actAna, 777, '2026-11-15T10:00:00Z', false], // fora do período
      ['bruno', ID.actBruno, 300, '2026-10-05T10:00:00Z', false],
    ] as const).entries()) {
      const row = cableRow(ID.fresh(80 + i), owner, act, { length_m: total - 10, reserve_m: 10, total_m: total, created_at: created, deleted });
      const { sql, params } = insertSql('cables', row);
      await db.admin(sql, params);
    }
    await db.run('bruno', async (tx) => {
      const t = await tx.q<{ technician: string; cables: string; length_m: string; reserve_m: string; total_m: string }>(
        `select technician, cables, length_m, reserve_m, total_m from public.cable_totals('2026-10-01', '2026-11-01')`);
      // o cabo do fixture (ana, criado em 01/10 12:00, total 160) também entra
      // ordenado do maior total para o menor
      expect(t.map((x) => [x.technician, Number(x.cables), Number(x.total_m)])).toEqual([
        ['Ana Técnica', 3, 310],
        ['Bruno Técnico', 1, 300],
      ]);
      expect(Number(t[0]!.reserve_m)).toBe(30);
    });
    await db.run('anon', async (tx) => { await tx.denied(`select * from public.cable_totals('2026-10-01', '2026-11-01')`); });
  });
});
