import { describe, expect, it } from 'vitest';
import { TotalsApiError, compareWithServer, createSupabaseTotalsApi, periodBounds, totalsErrorText, type ServerTotalsRow } from './serverTotals';
import type { TotalsRow } from './totals';

const local = (owner: string, cables: number, length: number, reserve: number, label = owner): TotalsRow => ({ owner, label, activities: 1, cables, lengthMeters: length, reserveMeters: reserve, totalMeters: length + reserve, elements: 0, byType: { poste: 0, cto: 0, ceo: 0, reserva: 0, ocorrencia: 0, outro: 0 } });
const server = (owner: string, cables: number, length: number, reserve: number, label = owner): ServerTotalsRow => ({ owner, label, cables, lengthMeters: length, reserveMeters: reserve, totalMeters: length + reserve });

describe('compareWithServer', () => {
  it('iguais: confere', () => {
    expect(compareWithServer([local('a', 3, 100, 10), local('b', 1, 50, 0)], [server('b', 1, 50, 0), server('a', 3, 100, 10)])).toEqual({ equal: true, diffs: [] });
  });
  it('diferenca de ate 5 cm e arredondamento: ainda confere', () => {
    expect(compareWithServer([local('a', 1, 100.04, 10)], [server('a', 1, 100, 10)]).equal).toBe(true);
    expect(compareWithServer([local('a', 1, 100.2, 10)], [server('a', 1, 100, 10)]).equal).toBe(false);
  });
  it('um cabo a menos aqui = diferente, com os dois lados', () => {
    const r = compareWithServer([local('a', 2, 100, 0, 'Ana')], [server('a', 3, 150, 0, 'Ana')]);
    expect(r.equal).toBe(false);
    expect(r.diffs).toEqual([{ owner: 'a', label: 'Ana', status: 'diferente', here: { cables: 2, totalMeters: 100 }, server: { cables: 3, totalMeters: 150 } }]);
  });
  it('mesma contagem e total, mas tracado e reserva trocados: tambem e diferente', () => {
    expect(compareWithServer([local('a', 1, 100, 10)], [server('a', 1, 110, 0)]).equal).toBe(false);
  });
  it('tecnico so no servidor (nada chegou aqui) e so aqui', () => {
    const r = compareWithServer([local('b', 1, 5, 0, 'Bia')], [server('a', 2, 80, 0, 'Ana')]);
    expect(r.diffs.map((d) => [d.label, d.status])).toEqual([['Ana', 'so-servidor'], ['Bia', 'so-aqui']]);
  });
  it('tecnico sem cabo nenhum nos dois lados nao e diferenca (so tem elementos/atividades)', () => {
    expect(compareWithServer([local('a', 0, 0, 0)], []).equal).toBe(true);
  });
});

describe('periodBounds', () => {
  it('do inicio do dia "de" ate o inicio do dia seguinte a "ate"', () => {
    const b = periodBounds({ from: '2026-10-01', to: '2026-10-31' });
    expect(new Date(b.from).getTime()).toBe(new Date(2026, 9, 1).getTime());
    expect(new Date(b.to).getTime()).toBe(new Date(2026, 10, 1).getTime());
  });
  it('sem datas: periodo aberto', () => {
    expect(periodBounds({ from: '', to: '' })).toEqual({ from: '1970-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' });
    expect(new Date(periodBounds({ from: '2026-10-01', to: '' }).to).getUTCFullYear()).toBe(2100);
  });
});

describe('createSupabaseTotalsApi', () => {
  const chain = (reply: object) => new Proxy({}, { get: (_t, k) => (k === 'then' ? (ok: (v: object) => unknown) => Promise.resolve(reply).then(ok) : () => chain(reply)) });
  const apiReplying = (reply: object) => createSupabaseTotalsApi({ rpc: () => chain(reply) } as never);

  it('traduz as colunas do servidor', async () => {
    const rows = await apiReplying({ data: [{ owner_id: 'u1', technician: 'Ana', cables: 3, length_m: 100.5, reserve_m: 10, total_m: 110.5 }], error: null, status: 200 }).cableTotals('a', 'b');
    expect(rows).toEqual([{ owner: 'u1', label: 'Ana', cables: 3, lengthMeters: 100.5, reserveMeters: 10, totalMeters: 110.5 }]);
  });
  it('erros viram o tipo certo', async () => {
    await expect(apiReplying({ error: { message: 'x' }, status: 0 }).cableTotals('a', 'b')).rejects.toMatchObject({ kind: 'network' });
    await expect(apiReplying({ error: { message: 'x' }, status: 503 }).cableTotals('a', 'b')).rejects.toMatchObject({ kind: 'network' });
    await expect(apiReplying({ error: { code: 'PGRST301', message: 'x' }, status: 401 }).cableTotals('a', 'b')).rejects.toMatchObject({ kind: 'auth' });
    await expect(apiReplying({ error: { code: '22P02', message: 'x' }, status: 400 }).cableTotals('a', 'b')).rejects.toMatchObject({ kind: 'other' });
  });
  it('cada tipo de erro tem frase propria', () => {
    const t = (['network', 'auth', 'other'] as const).map((k) => totalsErrorText(new TotalsApiError(k)));
    expect(new Set(t).size).toBe(3);
    expect(totalsErrorText(new Error('x'))).toBe(t[2]);
  });
});
