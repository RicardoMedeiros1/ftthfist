import { describe, expect, it } from 'vitest';
import type { Activity, Cable, NetworkElement } from '../../db/types';
import { DEFAULT_MAP_FILTERS, activeMapFilterCount, applyMapFilters, liveItems, dayEnd, dayStart, ownerKey, presetRange, searchHits, technicianOptions, toDateInput, type MapFilters } from './mapFilters';

const base = { id: 'x', createdAt: 1, updatedAt: 1, createdBy: 'a', deleted: false, syncStatus: 'synced' as const };
let n = 0;
const act = (over: Partial<Activity> = {}): Activity =>
  ({ ...base, id: `a${++n}`, kind: 'implantacao', title: 'Rua A', technician: 'Ana', ownerId: 'u-ana', startedAt: new Date(2026, 9, 5, 10).getTime(), status: 'aberta', description: '', materials: [], ...over }) as Activity;
const el = (activityId: string, over: Partial<NetworkElement> = {}): NetworkElement =>
  ({ ...base, id: `e${++n}`, type: 'poste', lat: -23.5, lng: -46.6, positionSource: 'gps', code: '', notes: '', activityId, attrs: {}, ...over }) as NetworkElement;
const cable = (activityId: string, over: Partial<Cable> = {}): Cable =>
  ({ ...base, id: `c${++n}`, cableType: 'AS-80', fiberCount: 12, vertices: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], lengthMeters: 100, reserveMeters: 0, totalMeters: 100, activityId, notes: '', ...over }) as Cable;
const F = (over: Partial<MapFilters> = {}): MapFilters => ({ ...DEFAULT_MAP_FILTERS, ...over });

// Ana (implantacao, aberta, 5/10) e Bruno (manutencao, concluida, 1/10)
const ana = act({ id: 'A1', title: 'Rua do Painel', osNumber: '123', technician: 'Ana', ownerId: 'u-ana' });
const bruno = act({ id: 'A2', title: 'Troca de CTO', technician: 'Bruno', ownerId: 'u-bruno', kind: 'manutencao', status: 'concluida', startedAt: new Date(2026, 9, 1, 9).getTime(), description: 'cliente sem sinal' });
const data = {
  activities: [ana, bruno],
  elements: [el('A1', { id: 'E1', code: 'P-001' }), el('A1', { id: 'E2', type: 'cto', code: 'CTO-7', attrs: { splitter: '1:8' } }), el('A2', { id: 'E3', type: 'ocorrencia', code: 'OC-1', notes: 'rompimento na esquina', attrs: { problem: 'rompimento' } })],
  cables: [cable('A1', { id: 'C1', fiberCount: 12 }), cable('A2', { id: 'C2', fiberCount: 48, cableType: 'AS-120', notes: 'lance novo' })],
};
const ids = (l: { id: string }[]) => l.map((x) => x.id).sort();

describe('applyMapFilters', () => {
  it('sem filtros mostra tudo e os totais batem', () => {
    const v = applyMapFilters(data, F());
    expect(ids(v.elements)).toEqual(['E1', 'E2', 'E3']);
    expect(ids(v.cables)).toEqual(['C1', 'C2']);
    expect(v.totals).toEqual({ activities: 2, elements: 3, cables: 2 });
  });

  it('ignora o que foi excluido (atividade, elemento e cabo) e nao conta nos totais', () => {
    const v = applyMapFilters({ activities: [...data.activities, act({ id: 'A9', deleted: true })], elements: [...data.elements, el('A1', { id: 'E9', deleted: true })], cables: [...data.cables, cable('A1', { id: 'C9', deleted: true })] }, F());
    expect(v.totals).toEqual({ activities: 2, elements: 3, cables: 2 });
    expect(ids(v.elements)).not.toContain('E9');
  });

  it('tecnico: so o que e daquela pessoa, e elementos e cabos seguem a atividade', () => {
    const v = applyMapFilters(data, F({ owner: 'u-bruno' }));
    expect(ids(v.elements)).toEqual(['E3']);
    expect(ids(v.cables)).toEqual(['C2']);
    expect(ids(v.activities)).toEqual(['A2']);
  });

  it('tipo e situacao da atividade', () => {
    expect(ids(applyMapFilters(data, F({ kind: 'manutencao' })).elements)).toEqual(['E3']);
    expect(ids(applyMapFilters(data, F({ status: 'aberta' })).elements)).toEqual(['E1', 'E2']);
    expect(applyMapFilters(data, F({ kind: 'manutencao', status: 'aberta' })).elements).toEqual([]);
  });

  it('tipos de elemento (varios) e interruptores de elementos e cabos', () => {
    expect(ids(applyMapFilters(data, F({ types: ['cto', 'ocorrencia'] })).elements)).toEqual(['E2', 'E3']);
    const noEl = applyMapFilters(data, F({ showElements: false }));
    expect(noEl.elements).toEqual([]);
    expect(noEl.cables).toHaveLength(2);
    const noCa = applyMapFilters(data, F({ showCables: false }));
    expect(noCa.cables).toEqual([]);
    expect(noCa.elements).toHaveLength(3);
  });

  it('fibras filtram so os cabos', () => {
    const v = applyMapFilters(data, F({ fibers: 48 }));
    expect(ids(v.cables)).toEqual(['C2']);
    expect(v.elements).toHaveLength(3);
  });

  it('periodo vale pelo inicio da atividade e inclui o dia inteiro dos dois lados', () => {
    expect(ids(applyMapFilters(data, F({ from: '2026-10-05' })).elements)).toEqual(['E1', 'E2']);
    expect(ids(applyMapFilters(data, F({ to: '2026-10-01' })).elements)).toEqual(['E3']);
    expect(ids(applyMapFilters(data, F({ from: '2026-10-01', to: '2026-10-05' })).elements)).toEqual(['E1', 'E2', 'E3']);
    expect(applyMapFilters(data, F({ from: '2026-10-02', to: '2026-10-04' })).elements).toEqual([]);
  });

  it('o limite do periodo e exato: um dia depois da meia-noite ja e outro dia', () => {
    const d = { activities: [act({ id: 'N1', startedAt: new Date(2026, 9, 6, 0, 0, 0, 0).getTime() }), act({ id: 'N0', startedAt: new Date(2026, 9, 5, 23, 59, 59, 999).getTime() })], elements: [el('N1', { id: 'EN1' }), el('N0', { id: 'EN0' })], cables: [] };
    expect(ids(applyMapFilters(d, F({ to: '2026-10-05' })).elements)).toEqual(['EN0']);
    expect(ids(applyMapFilters(d, F({ from: '2026-10-06' })).elements)).toEqual(['EN1']);
  });

  it('busca pelo codigo acha so aquele elemento (sem acentos nem maiusculas)', () => {
    expect(ids(applyMapFilters(data, F({ query: 'p-001' })).elements)).toEqual(['E1']);
    expect(ids(applyMapFilters(data, F({ query: 'ROMPIMENTO' })).elements)).toEqual(['E3']);
    expect(ids(applyMapFilters(data, F({ query: '1:8' })).elements)).toEqual(['E2']);
  });

  it('busca pela atividade (titulo, OS, tecnico, descricao) traz tudo o que e dela', () => {
    for (const q of ['painel', '123', 'ana', 'sem sinal']) {
      const v = applyMapFilters(data, F({ query: q }));
      const owner = q === 'sem sinal' ? 'A2' : 'A1';
      expect(v.elements.every((e) => e.activityId === owner), q).toBe(true);
      expect(v.elements.length, q).toBeGreaterThan(0);
      expect(v.activities.map((a) => a.id), q).toEqual([owner]);
    }
  });

  it('busca no cabo (tipo, fibras, observacao)', () => {
    expect(ids(applyMapFilters(data, F({ query: 'as-120' })).cables)).toEqual(['C2']);
    expect(ids(applyMapFilters(data, F({ query: 'lance novo' })).cables)).toEqual(['C2']);
    expect(ids(applyMapFilters(data, F({ query: '12 fibras' })).cables)).toEqual(['C1']);
  });

  it('busca e filtros se combinam (os dois precisam valer)', () => {
    expect(applyMapFilters(data, F({ query: 'P-001', owner: 'u-bruno' })).elements).toEqual([]);
    expect(ids(applyMapFilters(data, F({ query: 'cto', owner: 'u-ana' })).elements)).toEqual(['E2']);
  });

  it('elemento de atividade que ainda nao chegou: aparece sem filtro de atividade, some com ele', () => {
    const orphan = { ...data, elements: [...data.elements, el('A404', { id: 'E4' })] };
    expect(ids(applyMapFilters(orphan, F()).elements)).toContain('E4');
    expect(ids(applyMapFilters(orphan, F({ owner: 'u-ana' })).elements)).not.toContain('E4');
    expect(ids(applyMapFilters(orphan, F({ status: 'aberta' })).elements)).not.toContain('E4');
    expect(ids(applyMapFilters(orphan, F({ from: '2026-01-01' })).elements)).not.toContain('E4');
  });

  it('atividades da lista: so as que passam e (com busca) as que combinam ou tem item achado', () => {
    expect(ids(applyMapFilters(data, F({ owner: 'u-ana' })).activities)).toEqual(['A1']);
    expect(ids(applyMapFilters(data, F({ query: 'OC-1' })).activities)).toEqual(['A2']);
  });
});

describe('atividade excluida', () => {
  const gone = act({ id: 'AG', deleted: true });
  const withGone = { activities: [...data.activities, gone], elements: [...data.elements, el('AG', { id: 'EG' })], cables: [...data.cables, cable('AG', { id: 'CG' })] };
  it('o que ficou dela (chegou depois da exclusao) nao aparece nem conta nos totais', () => {
    const v = applyMapFilters(withGone, F());
    expect(ids(v.elements)).toEqual(['E1', 'E2', 'E3']);
    expect(ids(v.cables)).toEqual(['C1', 'C2']);
    expect(v.totals).toEqual({ activities: 2, elements: 3, cables: 2 });
  });
  it('liveItems tira os excluidos e os de atividade excluida, e deixa os de atividade que ainda nao chegou', () => {
    const items = [{ id: 'a', activityId: 'A1', deleted: false }, { id: 'b', activityId: 'AG', deleted: false }, { id: 'c', activityId: 'A1', deleted: true }, { id: 'd', activityId: 'A404', deleted: false }];
    expect(liveItems(items, [{ id: 'A1', deleted: false }, { id: 'AG', deleted: true }]).map((x) => x.id)).toEqual(['a', 'd']);
  });
});

describe('contagem de filtros ligados', () => {
  it('conta cada grupo uma vez; padrao = zero', () => {
    expect(activeMapFilterCount(DEFAULT_MAP_FILTERS)).toBe(0);
    expect(activeMapFilterCount(F({ owner: 'x', query: ' ola ', from: '2026-10-01', to: '2026-10-02', types: ['poste', 'cto'] }))).toBe(4);
    expect(activeMapFilterCount(F({ showElements: false, showCables: false, fibers: 12, kind: 'manutencao', status: 'aberta' }))).toBe(5);
    expect(activeMapFilterCount(F({ query: '   ' }))).toBe(0);
  });
});

describe('technicianOptions / ownerKey', () => {
  it('um item por tecnico, com o nome mais recente, do que tem mais atividades ao que tem menos', () => {
    const list = [act({ ownerId: 'u1', technician: 'Ana', startedAt: 1 }), act({ ownerId: 'u1', technician: 'Ana S.', startedAt: 5 }), act({ ownerId: 'u2', technician: 'Bia', startedAt: 3 }), act({ ownerId: 'u2', technician: 'Bia', deleted: true })];
    expect(technicianOptions(list)).toEqual([{ value: 'u1', label: 'Ana S.', count: 2 }, { value: 'u2', label: 'Bia', count: 1 }]);
  });
  it('registro antigo sem dono usa o nome', () => {
    expect(ownerKey({ technician: 'Zé' })).toBe('nome:Zé');
    expect(technicianOptions([act({ ownerId: undefined, technician: 'Zé' })])[0]?.value).toBe('nome:Zé');
  });
});

describe('datas', () => {
  it('dayStart / dayEnd: dia local inteiro; data invalida = null', () => {
    const s = dayStart('2026-10-05')!;
    const e = dayEnd('2026-10-05')!;
    expect(new Date(s).getHours()).toBe(0);
    expect(e - s).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(e - s).toBeLessThanOrEqual(25 * 3600_000);
    expect(new Date(e + 1).getDate()).toBe(6);
    for (const bad of ['', '2026-13-01', '2026-02-30', 'ontem', '05/10/2026']) expect(dayStart(bad), bad).toBeNull();
    expect(dayEnd('x')).toBeNull();
  });
  it('presets: hoje, 7 dias e 30 dias contam o dia de hoje', () => {
    const now = new Date(2026, 9, 7, 15).getTime();
    expect(presetRange('hoje', now)).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(presetRange('7d', now)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(presetRange('30d', now)).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    expect(toDateInput(now)).toBe('2026-10-07');
  });
});

describe('searchHits', () => {
  it('sem busca nao lista nada', () => {
    expect(searchHits(applyMapFilters(data, F()), '  ')).toEqual({ hits: [], total: 0 });
  });
  it('atividades primeiro, depois elementos e cabos, com o contexto de quem fez', () => {
    const view = applyMapFilters(data, F());
    const r = searchHits(view, 'ana');
    expect(r.hits[0]).toMatchObject({ kind: 'atividade', id: 'A1', title: 'Rua do Painel', subtitle: 'Ana · OS 123' });
    const p = searchHits(view, 'P-001').hits;
    expect(p).toEqual([{ kind: 'elemento', id: 'E1', title: 'Poste P-001', subtitle: 'Rua do Painel · Ana' }]);
    const c = searchHits(view, 'as-120').hits;
    expect(c).toEqual([{ kind: 'cabo', id: 'C2', title: 'AS-120 · 48 fibras', subtitle: 'Troca de CTO · Bruno' }]);
  });
  it('corta no limite e diz quantos achou no total', () => {
    const many = { activities: [ana], elements: Array.from({ length: 50 }, (_, i) => el('A1', { id: `m${i}`, code: `P-${i}` })), cables: [] };
    const r = searchHits(applyMapFilters(many, F()), 'poste', 30);
    expect(r.hits).toHaveLength(30);
    expect(r.total).toBe(50);
  });
});
