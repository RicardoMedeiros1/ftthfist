import { describe, expect, it } from 'vitest';
import type { Activity, Cable, NetworkElement } from '../../db/types';
import { DEFAULT_ROW_FILTERS, DEFAULT_SORT, activeRowFilterCount, buildRows, filterRows, firstDir, nextSort, sortRows, totalsOf, type ActivityRow, type RowFilters, type RowsData } from './activityRows';

const base = { id: 'x', createdAt: 1, updatedAt: 1, createdBy: 'a', deleted: false, syncStatus: 'synced' as const };
const D = (day: number, h = 10) => new Date(2026, 9, day, h).getTime();
const act = (over: Partial<Activity>): Activity =>
  ({ ...base, kind: 'implantacao', title: 'T', technician: 'Ana', ownerId: 'u-ana', startedAt: D(5), status: 'aberta', description: '', materials: [], ...over }) as Activity;
const el = (activityId: string, over: Partial<NetworkElement> = {}): NetworkElement =>
  ({ ...base, id: `e-${Math.random()}`, type: 'poste', lat: 0, lng: 0, positionSource: 'gps', code: '', notes: '', activityId, attrs: {}, ...over }) as NetworkElement;
const cable = (activityId: string, total: number, over: Partial<Cable> = {}): Cable =>
  ({ ...base, id: `c-${Math.random()}`, cableType: 'AS-80', fiberCount: 12, vertices: [], lengthMeters: total, reserveMeters: 0, totalMeters: total, activityId, notes: '', ...over }) as Cable;

const data: RowsData = {
  activities: [
    act({ id: 'A1', title: 'Rua do Painel', osNumber: '123', technician: 'Ana', ownerId: 'u-ana', startedAt: D(5) }),
    act({ id: 'A2', title: 'Troca de CTO', technician: 'Bruno', ownerId: 'u-bruno', kind: 'manutencao', status: 'concluida', startedAt: D(1, 9), endedAt: D(1, 11), description: 'cliente sem sinal' }),
    act({ id: 'A3', title: 'água e luz', technician: 'Carla', ownerId: 'u-carla', startedAt: D(3), status: 'concluida', endedAt: D(3, 10) + 30 * 60_000 }),
    act({ id: 'AX', title: 'excluida', deleted: true }),
  ],
  elements: [el('A1', { code: 'P-001' }), el('A1', { type: 'cto', code: 'CTO-7' }), el('A2', { type: 'ocorrencia', notes: 'rompimento na esquina' }), el('A1', { code: 'P-9', deleted: true })],
  cables: [cable('A1', 160), cable('A1', 40), cable('A2', 230, { cableType: 'AS-120', fiberCount: 48, notes: 'lance novo' }), cable('A1', 999, { deleted: true })],
  photos: [{ activityId: 'A1', deleted: false }, { activityId: 'A1', deleted: false }, { activityId: 'A1', deleted: true }, { activityId: 'A2', deleted: false }],
};
const rows = buildRows(data);
const byId = (id: string) => rows.find((r) => r.id === id)!;
const ids = (l: ActivityRow[]) => l.map((r) => r.id);
const F = (over: Partial<RowFilters> = {}): RowFilters => ({ ...DEFAULT_ROW_FILTERS, ...over });

describe('buildRows', () => {
  it('uma linha por atividade nao excluida, com os totais dela (sem contar o que foi excluido)', () => {
    expect(ids(rows).sort()).toEqual(['A1', 'A2', 'A3']);
    expect(byId('A1')).toMatchObject({ elements: 2, cables: 2, meters: 200, photos: 2, title: 'Rua do Painel', osNumber: '123', technician: 'Ana', owner: 'u-ana' });
    expect(byId('A2')).toMatchObject({ elements: 1, cables: 1, meters: 230, photos: 1 });
    expect(byId('A3')).toMatchObject({ elements: 0, cables: 0, meters: 0, photos: 0, osNumber: '' });
  });

  it('duracao: so quando a atividade terminou; aberta fica sem duracao', () => {
    expect(byId('A1').durationMs).toBeNull();
    expect(byId('A2').durationMs).toBe(2 * 3600_000);
    expect(byId('A3').durationMs).toBe(30 * 60_000);
    expect(buildRows({ ...data, activities: [act({ id: 'N', startedAt: D(5), endedAt: D(5) - 1000 })] })[0]!.durationMs).toBe(0); // relogio errado nao da duracao negativa
  });

  it('registro antigo sem dono: o dono e o nome do tecnico', () => {
    expect(buildRows({ ...data, activities: [act({ id: 'O', ownerId: undefined, technician: 'Zé' })] })[0]!.owner).toBe('nome:Zé');
  });
});

describe('filterRows', () => {
  it('sem filtros mostra tudo', () => {
    expect(filterRows(rows, F())).toHaveLength(3);
  });
  it('tecnico, tipo e situacao', () => {
    expect(ids(filterRows(rows, F({ owner: 'u-bruno' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ kind: 'manutencao' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ status: 'concluida' }))).sort()).toEqual(['A2', 'A3']);
    expect(filterRows(rows, F({ owner: 'u-ana', status: 'concluida' }))).toEqual([]);
  });
  it('periodo pelo inicio, com o dia inteiro dos dois lados', () => {
    expect(ids(filterRows(rows, F({ from: '2026-10-03', to: '2026-10-05' }))).sort()).toEqual(['A1', 'A3']);
    expect(ids(filterRows(rows, F({ to: '2026-10-01' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ from: '2026-10-05' })))).toEqual(['A1']);
  });
  it('busca no titulo, OS, tecnico e descricao, sem acento nem maiuscula', () => {
    expect(ids(filterRows(rows, F({ query: 'AGUA' })))).toEqual(['A3']);
    expect(ids(filterRows(rows, F({ query: '123' })))).toEqual(['A1']);
    expect(ids(filterRows(rows, F({ query: 'bruno' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ query: 'sem sinal' })))).toEqual(['A2']);
  });
  it('a busca tambem acha pelo que ha DENTRO da atividade (codigo do poste, tipo de cabo, observacao)', () => {
    expect(ids(filterRows(rows, F({ query: 'p-001' })))).toEqual(['A1']);
    expect(ids(filterRows(rows, F({ query: 'cto-7' })))).toEqual(['A1']);
    expect(ids(filterRows(rows, F({ query: 'as-120' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ query: 'rompimento' })))).toEqual(['A2']);
    expect(ids(filterRows(rows, F({ query: '48 fibras' })))).toEqual(['A2']);
  });
  it('o que foi excluido dentro da atividade nao entra na busca', () => {
    expect(filterRows(rows, F({ query: 'P-9' }))).toEqual([]);
  });
  it('busca so com espacos nao filtra; filtros ligados sao contados', () => {
    expect(filterRows(rows, F({ query: '   ' }))).toHaveLength(3);
    expect(activeRowFilterCount(DEFAULT_ROW_FILTERS)).toBe(0);
    expect(activeRowFilterCount(F({ owner: 'x', kind: 'manutencao', status: 'aberta', from: '2026-10-01', query: 'a' }))).toBe(5);
    expect(activeRowFilterCount(F({ from: '2026-10-01', to: '2026-10-02' }))).toBe(1);
  });
});

describe('sortRows', () => {
  it('padrao: inicio, do mais recente para o mais antigo', () => {
    expect(ids(sortRows(rows, DEFAULT_SORT))).toEqual(['A1', 'A3', 'A2']);
  });
  it('texto em ordem alfabetica do pt-BR (acento e maiuscula nao atrapalham)', () => {
    expect(ids(sortRows(rows, { key: 'title', dir: 'asc' }))).toEqual(['A3', 'A1', 'A2']); // água, Rua, Troca
    expect(ids(sortRows(rows, { key: 'title', dir: 'desc' }))).toEqual(['A2', 'A1', 'A3']);
    expect(ids(sortRows(rows, { key: 'technician', dir: 'asc' }))).toEqual(['A1', 'A2', 'A3']);
  });
  it('numeros: elementos, cabos, metros e fotos', () => {
    expect(ids(sortRows(rows, { key: 'meters', dir: 'desc' }))).toEqual(['A2', 'A1', 'A3']);
    expect(ids(sortRows(rows, { key: 'meters', dir: 'asc' }))).toEqual(['A3', 'A1', 'A2']);
    expect(ids(sortRows(rows, { key: 'photos', dir: 'desc' }))[0]).toBe('A1');
    expect(ids(sortRows(rows, { key: 'elements', dir: 'desc' }))[0]).toBe('A1');
  });
  it('duracao: a atividade aberta (sem duracao) fica no fim nos dois sentidos', () => {
    expect(ids(sortRows(rows, { key: 'durationMs', dir: 'desc' }))).toEqual(['A2', 'A3', 'A1']);
    expect(ids(sortRows(rows, { key: 'durationMs', dir: 'asc' }))).toEqual(['A3', 'A2', 'A1']);
  });
  it('empate desempata pelo inicio mais recente e nao muda a lista original', () => {
    const before = ids(rows);
    expect(ids(sortRows(rows, { key: 'kind', dir: 'asc' }))).toEqual(['A1', 'A3', 'A2']); // implantacao (A1, A3 mais novo primeiro), manutencao
    expect(ids(rows)).toEqual(before);
  });
  it('o desempate nao depende da ordem em que as linhas chegaram', () => {
    expect(ids(sortRows([...rows].reverse(), { key: 'kind', dir: 'asc' }))).toEqual(['A1', 'A3', 'A2']);
    const same = buildRows({ ...data, activities: [act({ id: 'Z2', title: 'X', startedAt: D(2) }), act({ id: 'Z1', title: 'X', startedAt: D(2) })], elements: [], cables: [], photos: [] });
    expect(ids(sortRows(same, { key: 'title', dir: 'asc' }))).toEqual(['Z1', 'Z2']); // tudo igual: pelo id
  });
  it('numero dentro do texto ordena como numero e maiuscula nao conta ("Visita 2" antes de "Visita 10")', () => {
    const v = buildRows({ ...data, activities: [act({ id: 'V10', title: 'Visita 10' }), act({ id: 'V2', title: 'Visita 2' }), act({ id: 'V3', title: 'visita 3' })], elements: [], cables: [], photos: [] });
    expect(ids(sortRows(v, { key: 'title', dir: 'asc' }))).toEqual(['V2', 'V3', 'V10']);
  });
  it('clicar na coluna: 1a vez ordena (texto A-Z, numero do maior), de novo inverte, outra coluna recomeca', () => {
    expect(firstDir('title')).toBe('asc');
    expect(firstDir('meters')).toBe('desc');
    expect(firstDir('startedAt')).toBe('desc');
    const a = nextSort(DEFAULT_SORT, 'title');
    expect(a).toEqual({ key: 'title', dir: 'asc' });
    expect(nextSort(a, 'title')).toEqual({ key: 'title', dir: 'desc' });
    expect(nextSort(nextSort(a, 'title'), 'title')).toEqual({ key: 'title', dir: 'asc' });
    expect(nextSort(a, 'meters')).toEqual({ key: 'meters', dir: 'desc' });
  });
});

describe('totalsOf', () => {
  it('soma o que esta na lista (use depois do filtro)', () => {
    expect(totalsOf(rows)).toEqual({ activities: 3, elements: 3, cables: 3, meters: 430, photos: 3 });
    expect(totalsOf(filterRows(rows, F({ owner: 'u-ana' })))).toEqual({ activities: 1, elements: 2, cables: 2, meters: 200, photos: 2 });
    expect(totalsOf([])).toEqual({ activities: 0, elements: 0, cables: 0, meters: 0, photos: 0 });
  });
});
