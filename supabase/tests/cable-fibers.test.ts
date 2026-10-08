import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, ID, createTestDb, type Person, type TestDb } from './support/harness';

// Padrao de cores das fibras e ligacoes entre cabos (colunas color_standard e links de cables).
// (O servidor so aceita alteracao com `updated_at` mais novo: por isso todo update carrega `updated_at = now()`.)

const E1 = '00000000-0000-4000-8000-0000000000e1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const link = (elementId = E1, cableId = C2) => ({ elementId, cableId });

describe.skipIf(!DB_URL)('cabos: padrao de cores e ligacoes', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db?.drop(); });

  const setStd = (who: Person, v: string | null) => db.run(who, (tx) => tx.count(`update public.cables set color_standard = $2, updated_at = now() where id = $1`, [ID.cableAna, v]));
  const setLinks = (who: Person, v: unknown) => db.run(who, (tx) => tx.count(`update public.cables set links = $2::jsonb, updated_at = now() where id = $1`, [ID.cableAna, JSON.stringify(v)]));
  const rejectLinks = (v: unknown) => db.run('ana', (tx) => tx.fails('23514', `update public.cables set links = $2::jsonb, updated_at = now() where id = $1`, [ID.cableAna, JSON.stringify(v)]));

  it('cabo novo nasce sem padrao gravado (ABNT) e sem ligacoes', async () => {
    const [c] = await db.admin<{ color_standard: string | null; links: unknown }>(`select color_standard, links from public.cables where id = $1`, [ID.cableAna]);
    expect(c).toEqual({ color_standard: null, links: [] });
  });

  it('o padrao de cores aceita abnt, tia598 e nulo; qualquer outro valor e recusado', async () => {
    expect(await setStd('ana', 'tia598')).toBe(1);
    expect(await setStd('ana', 'abnt')).toBe(1);
    expect(await setStd('ana', null)).toBe(1);
    for (const bad of ['ABNT', 'iec', '', 'tia-598']) await db.run('ana', (tx) => tx.fails('23514', `update public.cables set color_standard = $2, updated_at = now() where id = $1`, [ID.cableAna, bad]));
  });

  it('o dono e o administrador gravam as ligacoes; outro tecnico e o escritorio nao (a politica esconde a linha)', async () => {
    expect(await setLinks('ana', [link()])).toBe(1);
    expect(await setLinks('davi', [link(), link(E1, '00000000-0000-4000-8000-0000000000c3')])).toBe(1);
    expect(await setLinks('bruno', [])).toBe(0);
    expect(await setLinks('clara', [])).toBe(0);
    // (cada `run` e desfeito no fim: o que vale para o proximo teste e gravado por fora)
    await db.admin(`update public.cables set links = $2::jsonb, updated_at = now() where id = $1`, [ID.cableAna, JSON.stringify([link(), link(E1, '00000000-0000-4000-8000-0000000000c3')])]);
    expect(await setLinks('bruno', [])).toBe(0);
    const [c] = await db.admin<{ links: unknown[] }>(`select links from public.cables where id = $1`, [ID.cableAna]);
    expect(c!.links).toHaveLength(2);
  });

  it('todos leem as ligacoes (tecnico de outro, escritorio e administrador)', async () => {
    for (const who of ['ana', 'bruno', 'clara', 'davi'] as const) {
      const [c] = await db.run(who, (tx) => tx.q<{ links: unknown[] }>(`select links from public.cables where id = $1`, [ID.cableAna]));
      expect(c!.links, who).toHaveLength(2);
    }
  });

  it('lista vazia vale (e como se apaga ligacao)', async () => {
    expect(await setLinks('ana', [])).toBe(1);
  });

  it('formato errado e recusado: nao e lista, item que nao e objeto, falta campo, campo que nao e texto, id que nao e uuid', async () => {
    for (const bad of [{}, 'x', 5, null, ['x'], [1], [[]], [{}], [{ elementId: E1 }], [{ cableId: C2 }], [{ elementId: 1, cableId: C2 }], [{ elementId: E1, cableId: null }],
      [link('nao-e-uuid')], [link(E1, 'nao-e-uuid')], [link(E1.slice(1))], [link(`${E1}0`)]]) {
      await rejectLinks(bad);
    }
  });

  it('uuid em maiusculas vale', async () => {
    expect(await setLinks('ana', [link(E1.toUpperCase())])).toBe(1);
  });

  it('o limite e de 200 ligacoes por cabo', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => link(E1, `00000000-0000-4000-8000-${String(100000 + i).padStart(12, '0')}`));
    expect(await setLinks('ana', many(200))).toBe(1);
    await rejectLinks(many(201));
  });

  it('as ligacoes sao so referencias: apontar para cabo ou elemento que nao existe (ainda) e aceito', async () => {
    expect(await setLinks('ana', [link('00000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-00000000fffe')])).toBe(1);
  });
});
