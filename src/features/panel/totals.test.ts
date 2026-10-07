import { describe, expect, it } from 'vitest';
import type { Activity, Cable, ElementType, NetworkElement } from '../../db/types';
import { DEFAULT_TOTALS_FILTERS, activeTotalsFilterCount, computeTotals, sumTotals, totalsCsv, totalsFileName, type TotalsFilters, type TotalsRow } from './totals';

const base = { id: 'x', createdAt: new Date(2026, 9, 5, 10).getTime(), updatedAt: 1, createdBy: 'a', deleted: false, syncStatus: 'synced' as const };
const D = (day: number, h = 10) => new Date(2026, 9, day, h).getTime();
let n = 0;
const act = (over: Partial<Activity>): Activity =>
  ({ ...base, id: `a${++n}`, kind: 'implantacao', title: 'T', technician: 'Ana', ownerId: 'u-ana', startedAt: D(5), status: 'aberta', description: '', materials: [], ...over }) as Activity;
const el = (activityId: string, type: ElementType, over: Partial<NetworkElement> = {}): NetworkElement =>
  ({ ...base, id: `e${++n}`, type, lat: 0, lng: 0, positionSource: 'gps', code: '', notes: '', activityId, attrs: {}, ownerId: 'u-ana', createdBy: 'Ana', ...over }) as NetworkElement;
const cab = (activityId: string, len: number, res: number, over: Partial<Cable> = {}): Cable =>
  ({ ...base, id: `c${++n}`, cableType: 'AS-80', fiberCount: 12, vertices: [], lengthMeters: len, reserveMeters: res, totalMeters: len + res, activityId, notes: '', ownerId: 'u-ana', createdBy: 'Ana', ...over }) as Cable;
const F = (over: Partial<TotalsFilters> = {}): TotalsFilters => ({ ...DEFAULT_TOTALS_FILTERS, ...over });
const byOwner = (rows: TotalsRow[], o: string) => rows.find((r) => r.owner === o)!;

const data = {
  activities: [
    act({ id: 'A1', technician: 'Ana', ownerId: 'u-ana', startedAt: D(5) }),
    act({ id: 'A2', technician: 'Ana', ownerId: 'u-ana', kind: 'manutencao', startedAt: D(1) }),
    act({ id: 'A3', technician: 'Bruno', ownerId: 'u-bruno', startedAt: D(3) }),
    act({ id: 'AX', technician: 'Zé', ownerId: 'u-ze', deleted: true }),
  ],
  elements: [
    el('A1', 'poste'), el('A1', 'poste'), el('A1', 'cto'),
    el('A2', 'ocorrencia', { createdAt: D(1) }),
    el('A3', 'ceo', { ownerId: 'u-bruno', createdBy: 'Bruno', createdAt: D(3) }),
    el('A1', 'poste', { deleted: true }),
  ],
  cables: [
    cab('A1', 100.25, 10), cab('A1', 50, 0),
    cab('A2', 30, 5, { createdAt: D(1) }),
    cab('A3', 200, 20, { ownerId: 'u-bruno', createdBy: 'Bruno', createdAt: D(3) }),
    cab('A1', 999, 0, { deleted: true }),
  ],
};

describe('computeTotals', () => {
  const rows = computeTotals(data, F());
  it('uma linha por tecnico, do que tem mais metros ao que tem menos', () => {
    expect(rows.map((r) => r.owner)).toEqual(['u-bruno', 'u-ana']); // Bruno 220, Ana 195,25
  });
  it('soma tracado, reservas e total de cabo (sem o que foi excluido), com duas casas', () => {
    expect(byOwner(rows, 'u-ana')).toMatchObject({ label: 'Ana', cables: 3, lengthMeters: 180.25, reserveMeters: 15, totalMeters: 195.25 });
    expect(byOwner(rows, 'u-bruno')).toMatchObject({ cables: 1, lengthMeters: 200, reserveMeters: 20, totalMeters: 220 });
  });
  it('conta elementos por tipo (sem excluidos) e atividades (sem excluidas)', () => {
    expect(byOwner(rows, 'u-ana')).toMatchObject({ elements: 4, activities: 2, byType: { poste: 2, cto: 1, ocorrencia: 1, ceo: 0, reserva: 0, outro: 0 } });
    expect(byOwner(rows, 'u-bruno')).toMatchObject({ elements: 1, activities: 1, byType: { ceo: 1, poste: 0 } });
    expect(rows.find((r) => r.owner === 'u-ze')).toBeUndefined();
  });
  it('filtro de tecnico', () => {
    const r = computeTotals(data, F({ owner: 'u-bruno' }));
    expect(r.map((x) => x.owner)).toEqual(['u-bruno']);
  });
  it('filtro de tipo de atividade vale para cabos, elementos e atividades', () => {
    const r = computeTotals(data, F({ kind: 'manutencao' }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ owner: 'u-ana', activities: 1, cables: 1, totalMeters: 35, elements: 1, byType: { ocorrencia: 1, poste: 0 } });
  });
  it('periodo vale pela data de registro do cabo e do elemento (e pelo inicio, nas atividades)', () => {
    const r = computeTotals(data, F({ from: '2026-10-03', to: '2026-10-05' }));
    expect(byOwner(r, 'u-ana')).toMatchObject({ cables: 2, totalMeters: 160.25, elements: 3, activities: 1 });
    expect(byOwner(r, 'u-bruno')).toMatchObject({ cables: 1, activities: 1 });
    const only = computeTotals(data, F({ to: '2026-10-02' }));
    expect(only.map((x) => x.owner)).toEqual(['u-ana']);
    expect(only[0]).toMatchObject({ cables: 1, totalMeters: 35 });
  });
  it('periodo exato: o ultimo instante do dia entra, a meia-noite seguinte nao', () => {
    const edge = { ...data, cables: [cab('A1', 10, 0, { createdAt: new Date(2026, 9, 5, 23, 59, 59, 999).getTime() }), cab('A1', 20, 0, { createdAt: new Date(2026, 9, 6, 0, 0, 0, 0).getTime() })] };
    expect(computeTotals(edge, F({ to: '2026-10-05' }))[0]).toMatchObject({ cables: 1, totalMeters: 10 });
    expect(computeTotals(edge, F({ from: '2026-10-06' }))[0]).toMatchObject({ cables: 1, totalMeters: 20 });
  });
  it('cabo de atividade que ainda nao chegou: entra sem filtro de tipo, sai com ele', () => {
    const orphan = { ...data, cables: [cab('A404', 10, 0)] };
    expect(computeTotals(orphan, F()).find((r) => r.owner === 'u-ana')?.cables).toBe(1);
    expect(computeTotals(orphan, F({ kind: 'implantacao' })).find((r) => r.owner === 'u-ana')?.cables ?? 0).toBe(0);
  });
  it('registro antigo sem dono: agrupa pelo nome de quem registrou', () => {
    const legacy = { activities: [act({ id: 'L', ownerId: undefined, technician: 'Zé' })], elements: [], cables: [cab('L', 10, 0, { ownerId: undefined, createdBy: 'Zé' })] };
    const r = computeTotals(legacy, F());
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ owner: 'nome:Zé', label: 'Zé', cables: 1, activities: 1 });
  });
  it('tecnico que mudou de nome: usa o nome da atividade mais recente', () => {
    const r = computeTotals({ activities: [act({ id: 'N1', technician: 'Ana S.', startedAt: D(9) }), act({ id: 'N2', technician: 'Ana', startedAt: D(1) })], elements: [], cables: [cab('N1', 1, 0)] }, F());
    expect(r[0]!.label).toBe('Ana S.');
  });
  it('sem dados: nenhuma linha', () => {
    expect(computeTotals({ activities: [], elements: [], cables: [] }, F())).toEqual([]);
  });
});

describe('atividade excluida', () => {
  it('cabos e elementos que sobraram de uma atividade excluida nao entram nos totais', () => {
    const gone = act({ id: 'AG', technician: 'Ana', ownerId: 'u-ana', deleted: true });
    const d = { activities: [...data.activities, gone], elements: [...data.elements, el('AG', 'poste')], cables: [...data.cables, cab('AG', 500, 0)] };
    expect(sumTotals(computeTotals(d, F()))).toEqual(sumTotals(computeTotals(data, F())));
  });
});

describe('sumTotals', () => {
  it('soma as linhas', () => {
    const t = sumTotals(computeTotals(data, F()));
    expect(t).toMatchObject({ label: 'Total', activities: 3, cables: 4, lengthMeters: 380.25, reserveMeters: 35, totalMeters: 415.25, elements: 5, byType: { poste: 2, cto: 1, ceo: 1, ocorrencia: 1 } });
  });
  it('lista vazia = tudo zero', () => {
    expect(sumTotals([])).toMatchObject({ activities: 0, cables: 0, totalMeters: 0, elements: 0 });
  });
});

describe('totalsCsv', () => {
  it('cabecalho, uma linha por tecnico e a linha de total, com numero brasileiro', () => {
    const csv = totalsCsv(computeTotals(data, F())).replace('﻿', '').split('\r\n');
    expect(csv[0]).toBe('Técnico;Atividades;Cabos;Traçado (m);Reservas (m);Total de cabo (m);Elementos;Elementos: Poste;Elementos: CTO;Elementos: CEO;Elementos: Reserva;Elementos: Ocorrência;Elementos: Outro');
    expect(csv[1]).toBe('Bruno;1;1;200,00;20,00;220,00;1;0;0;1;0;0;0');
    expect(csv[2]).toBe('Ana;2;3;180,25;15,00;195,25;4;2;1;0;0;1;0');
    expect(csv[3]).toBe('Total;3;4;380,25;35,00;415,25;5;2;1;1;0;1;0');
    expect(csv[4]).toBe('');
  });
  it('nome com formula nao vira formula; sem linhas so tem o cabecalho', () => {
    const r = computeTotals({ activities: [act({ id: 'F', technician: '=CMD()', ownerId: 'u-x' })], elements: [], cables: [cab('F', 1, 0, { ownerId: 'u-x' })] }, F());
    expect(totalsCsv(r)).toContain("\r\n'=CMD();");
    expect(totalsCsv([]).split('\r\n')).toHaveLength(2);
  });
});

describe('totalsFileName', () => {
  const today = new Date(2026, 9, 7);
  it('com periodo: as datas; sem periodo: a data de hoje', () => {
    expect(totalsFileName({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe('totais-2026-10-01_a_2026-10-31.csv');
    expect(totalsFileName({ from: '2026-10-01', to: '' }, today)).toBe('totais-desde-2026-10-01.csv');
    expect(totalsFileName({ from: '', to: '2026-10-31' }, today)).toBe('totais-ate-2026-10-31.csv');
    expect(totalsFileName({ from: '', to: '' }, today)).toBe('totais-2026-10-07.csv');
  });
});

describe('activeTotalsFilterCount', () => {
  it('conta tecnico, tipo e periodo', () => {
    expect(activeTotalsFilterCount(DEFAULT_TOTALS_FILTERS)).toBe(0);
    expect(activeTotalsFilterCount(F({ owner: 'x', kind: 'manutencao', from: '2026-10-01' }))).toBe(3);
    expect(activeTotalsFilterCount(F({ from: '2026-10-01', to: '2026-10-02' }))).toBe(1);
  });
});
