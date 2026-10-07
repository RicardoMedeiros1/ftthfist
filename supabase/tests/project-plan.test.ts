import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, IDS, createTestDb, type Person, type TestDb } from './support/harness';

// O desenho do projeto (coluna plan): so o administrador grava, o tecnico responsavel le, e o banco recusa desenho malformado.

const PROJ = '00000000-0000-4000-8000-00000000e001';
const good = {
  lines: [{ id: 'l1', points: [[-23.55, -46.63], [-23.551, -46.631], [-23.552, -46.632]] }],
  points: [{ id: 'p1', type: 'poste', lat: -23.55, lng: -46.63, code: 'P-1' }, { id: 'p2', type: 'cto', lat: -23.551, lng: -46.631 }],
};
const line = (n: number, c: [number, number] = [0, 0]) => ({ id: 'l', points: Array.from({ length: n }, () => c) });

describe.skipIf(!DB_URL)('desenho do projeto', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.admin(`insert into public.projects (id, owner_id, assigned_to, kind, title) values ($1, $2, $3, 'implantacao', 'Rua das Flores')`, [PROJ, IDS.davi, IDS.ana]);
  });
  afterAll(async () => { await db?.drop(); });

  const set = (who: Person, plan: unknown) => db.run(who, (tx) => tx.count(`update public.projects set plan = $2::jsonb where id = $1`, [PROJ, plan === null ? null : JSON.stringify(plan)]));
  const rejects = (plan: unknown) => db.run('davi', (tx) => tx.fails('23514', `update public.projects set plan = $2::jsonb where id = $1`, [PROJ, JSON.stringify(plan)]));

  it('o administrador grava, e o tecnico responsavel, o escritorio e o administrador leem igual', async () => {
    expect(await set('davi', good)).toBe(1);
    await db.admin(`update public.projects set plan = $2::jsonb where id = $1`, [PROJ, JSON.stringify(good)]);
    for (const who of ['ana', 'clara', 'davi'] as const) {
      const [r] = await db.run(who, (tx) => tx.q<{ plan: unknown }>(`select plan from public.projects where id = $1`, [PROJ]));
      expect(r!.plan, who).toEqual(good);
    }
    expect(await db.run('bruno', (tx) => tx.q(`select plan from public.projects where id = $1`, [PROJ]))).toEqual([]); // projeto de outro: nem o desenho
  });

  it('tecnico e escritorio nao gravam o desenho (a politica esconde a linha: nada muda)', async () => {
    await db.admin(`update public.projects set plan = null where id = $1`, [PROJ]);
    expect(await set('ana', good)).toBe(0);
    expect(await set('clara', good)).toBe(0);
    expect(await set('bruno', good)).toBe(0);
    expect((await db.admin<{ plan: unknown }>(`select plan from public.projects where id = $1`, [PROJ]))[0]!.plan).toBeNull();
  });

  it('sem desenho (nulo) vale, e apagar o desenho e gravar nulo', async () => {
    expect(await set('davi', null)).toBe(1);
    expect(await set('davi', good)).toBe(1);
    expect(await set('davi', null)).toBe(1);
  });

  it('desenho vazio mas bem formado e aceito (o app trata como sem desenho)', async () => {
    expect(await set('davi', { lines: [], points: [] })).toBe(1);
  });

  it('formato errado: nao e objeto, falta lista, lista que nao e lista', async () => {
    for (const bad of [[], 'x', 5, true, {}, { lines: [] }, { points: [] }, { lines: {}, points: [] }, { lines: [], points: 'a' }, { lines: null, points: [] }]) await rejects(bad);
  });

  it('traçado: menos de 2 pontos, ponto que nao e [lat, lng], fora do mundo, nao numerico', async () => {
    for (const l of [
      { id: 'a', points: [] }, { id: 'a', points: [[0, 0]] }, 'x', { id: 'a' }, { id: 'a', points: 'x' },
      { id: 'a', points: [[0, 0], [1]] }, { id: 'a', points: [[0, 0], [1, 2, 3]] }, { id: 'a', points: [[0, 0], 'x'] },
      { id: 'a', points: [[0, 0], [91, 0]] }, { id: 'a', points: [[0, 0], [-91, 0]] }, { id: 'a', points: [[0, 0], [0, 181]] }, { id: 'a', points: [[0, 0], [0, -181]] },
      { id: 'a', points: [[0, 0], ['1', 2]] }, { id: 'a', points: [[0, 0], [null, 2]] },
    ]) await rejects({ lines: [l], points: [] });
  });

  it('os extremos do mundo valem', async () => {
    expect(await set('davi', { lines: [{ id: 'a', points: [[-90, -180], [90, 180]] }], points: [{ id: 'p', type: 'outro', lat: 90, lng: -180 }] })).toBe(1);
  });

  it('numero grande demais para caber no banco tambem e recusado, sem erro estranho', async () => {
    await db.run('davi', (tx) => tx.fails('23514', `update public.projects set plan = '{"lines":[{"id":"a","points":[[0,0],[1e999,0]]}],"points":[]}'::jsonb where id = $1`, [PROJ]));
  });

  it('ponto: tipo invalido (inclusive ocorrencia), sem tipo, coordenada ruim, codigo que nao e texto ou e grande', async () => {
    const pt = (over: Record<string, unknown>) => ({ lines: [], points: [{ id: 'p', type: 'poste', lat: 1, lng: 2, ...over }] });
    for (const bad of [{ type: 'ocorrencia' }, { type: 'nada' }, { type: null }, { type: undefined }, { lat: 91 }, { lng: 181 }, { lat: '1' }, { lat: undefined }, { lng: null }, { code: 5 }, { code: null }, { code: 'x'.repeat(61) }]) await rejects(pt(bad));
    await rejects({ lines: [], points: ['x'] });
    for (const type of ['poste', 'cto', 'ceo', 'reserva', 'outro']) expect(await set('davi', pt({ type })), type).toBe(1);
    expect(await set('davi', pt({ code: 'x'.repeat(60) }))).toBe(1);
    expect(await set('davi', pt({ code: '' }))).toBe(1);
  });

  it('limites de quantidade: 200 traçados, 2000 pontos, 5000 pontos por traçado, 20000 no total', async () => {
    const lines = (n: number) => Array.from({ length: n }, () => line(2));
    const points = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, type: 'poste', lat: 1, lng: 2 }));
    expect(await set('davi', { lines: lines(200), points: [] })).toBe(1);
    await rejects({ lines: lines(201), points: [] });
    expect(await set('davi', { lines: [], points: points(2000) })).toBe(1);
    await rejects({ lines: [], points: points(2001) });
    expect(await set('davi', { lines: [line(5000)], points: [] })).toBe(1);
    await rejects({ lines: [line(5001)], points: [] });
    await rejects({ lines: [line(5000), line(5000), line(5000), line(5000), line(5000)], points: [] }); // 25000 no total
    expect(await set('davi', { lines: [line(5000), line(5000), line(5000), line(5000)], points: [] })).toBe(1); // exatamente 20000
    await rejects({ lines: [line(5000), line(5000), line(5000), line(4999), line(2)], points: [] }); // 20001
  });

  it('tamanho: acima de 400 mil caracteres e recusado, mesmo dentro dos limites de quantidade', async () => {
    const fat = (i: number) => ({ id: `l${i}`, points: Array.from({ length: 4000 }, (_, k) => [-23.123456789012 - k / 1e6, -46.123456789012]) });
    await rejects({ lines: [fat(0), fat(1), fat(2)], points: [] }); // 12000 pontos, ~450 mil caracteres
  });

  it('editar o resto do projeto nunca mexe no desenho; reatribuir tambem nao', async () => {
    await db.admin(`update public.projects set plan = $2::jsonb where id = $1`, [PROJ, JSON.stringify(good)]);
    await db.run('davi', async (tx) => {
      expect(await tx.count(`update public.projects set title = 'Outro nome', status = 'cancelado' where id = $1`, [PROJ])).toBe(1);
      expect(await tx.count(`update public.projects set assigned_to = $2 where id = $1`, [PROJ, IDS.bruno])).toBe(1);
      expect((await tx.q<{ plan: unknown }>(`select plan from public.projects where id = $1`, [PROJ]))[0]!.plan).toEqual(good);
    });
  });

  it('o administrador cria um projeto ja com desenho; o desenho invalido recusa a criacao inteira', async () => {
    const id = '00000000-0000-4000-8000-00000000e002';
    await db.run('davi', async (tx) => {
      await tx.q(`insert into public.projects (id, assigned_to, kind, title, plan) values ($1, $2, 'implantacao', 'Com desenho', $3::jsonb)`, [id, IDS.ana, JSON.stringify(good)]);
      expect((await tx.q(`select id from public.projects where id = $1`, [id])).length).toBe(1);
      await tx.fails('23514', `insert into public.projects (id, assigned_to, kind, title, plan) values ($1, $2, 'implantacao', 'Ruim', '{"lines":[{"points":[[0,0]]}],"points":[]}'::jsonb)`, ['00000000-0000-4000-8000-00000000e003', IDS.ana]);
    });
  });
});
