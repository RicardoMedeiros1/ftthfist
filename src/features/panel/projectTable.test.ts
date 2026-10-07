import { describe, expect, it } from 'vitest';
import type { Activity, Cable, NetworkElement, Project } from '../../db/types';
import { DEFAULT_PROJECT_FILTERS, activeProjectFilterCount, buildProjectTableRows, filterProjectRows, nextProjectSort, projectCounts, projectTotalsOf, projectsCsv, projectsFileName, sortProjectRows, type ProjectTableRow } from './projectTable';

const NOW = new Date(2026, 9, 20, 10, 0, 0).getTime();
const P = (over: Partial<Project> = {}): Project => ({ id: 'p1', ownerId: 'adm', assignedTo: 'ana', title: 'Rua das Flores', kind: 'implantacao', description: '', address: '', status: 'aberto', deleted: false, createdAt: 1, updatedAt: 1, ...over });
const A = (over: Partial<Activity> = {}): Activity => ({ id: 'a1', createdAt: 1, updatedAt: 1, createdBy: 'Ana', deleted: false, syncStatus: 'synced', kind: 'implantacao', title: 'Trecho', technician: 'Ana', startedAt: 100, status: 'aberta', description: '', materials: [], projectId: 'p1', ...over });
const E = (activityId: string, deleted = false): Pick<NetworkElement, 'activityId' | 'deleted'> => ({ activityId, deleted });
const C = (activityId: string, totalMeters: number, deleted = false): Pick<Cable, 'activityId' | 'deleted' | 'totalMeters'> => ({ activityId, deleted, totalMeters });
const names = new Map([['ana', 'Ana Souza'], ['bia', 'Bia Lima']]);

describe('buildProjectTableRows', () => {
  const data = {
    projects: [P(), P({ id: 'p2', title: 'Praça Central', assignedTo: 'bia', dueDate: '2026-10-01', osNumber: 'OS-5', address: 'Av. Brasil' }), P({ id: 'p3', title: 'Excluído', deleted: true })],
    activities: [
      A({ id: 'a1', title: 'Trecho 1' }),
      A({ id: 'a2', title: 'Trecho 2', status: 'concluida', completesProject: true }),
      A({ id: 'a3', title: 'Apagada', deleted: true }),
      A({ id: 'a4', title: 'Avulsa', projectId: undefined }),
      A({ id: 'a5', title: 'Da praça', projectId: 'p2' }),
    ],
    elements: [E('a1'), E('a1'), E('a2'), E('a1', true), E('a3'), E('a4'), E('a5')],
    cables: [C('a1', 100.5), C('a2', 50), C('a2', 10, true), C('a3', 999), C('a4', 777), C('a5', 20)],
  };
  const rows = buildProjectTableRows(data, names, NOW);
  const by = (id: string) => rows.find((r) => r.id === id)!;

  it('uma linha por projeto nao excluido, com situacao, atraso e nome do tecnico', () => {
    expect(rows.map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(by('p1')).toMatchObject({ state: 'concluido', technicianName: 'Ana Souza', overdue: false, title: 'Rua das Flores', osNumber: '' });
    expect(by('p2')).toMatchObject({ state: 'em_andamento', technicianName: 'Bia Lima', overdue: true, osNumber: 'OS-5' });
  });
  it('conta so o que e das atividades do proprio projeto, sem excluidos nem avulsas', () => {
    expect(by('p1')).toMatchObject({ activities: 2, elements: 3, cables: 2, meters: 150.5 });
    expect(by('p2')).toMatchObject({ activities: 1, elements: 1, cables: 1, meters: 20 });
  });
  it('projeto sem atividade: tudo zero e pendente', () => {
    const [r] = buildProjectTableRows({ ...data, projects: [P({ id: 'p9' })], activities: [], elements: [], cables: [] }, names, NOW);
    expect(r).toMatchObject({ state: 'pendente', activities: 0, elements: 0, cables: 0, meters: 0 });
  });
  it('a busca olha o projeto, o endereco, o tecnico e o nome das atividades (sem acento)', () => {
    const s = (id: string) => by(id).search;
    expect(s('p2')).toContain('praca central');
    expect(s('p2')).toContain('av. brasil');
    expect(s('p2')).toContain('bia lima');
    expect(s('p2')).toContain('da praca');
    expect(s('p1')).toContain('trecho 1');
    expect(s('p1')).not.toContain('apagada');
  });
});

describe('filtros', () => {
  const mk = (over: Partial<ProjectTableRow> & { id: string }): ProjectTableRow => ({
    project: P({ id: over.id, assignedTo: 'ana' }), state: 'pendente', technicianName: 'Ana', linked: [], overdue: false,
    title: over.id, osNumber: '', activities: 0, elements: 0, cables: 0, meters: 0, search: over.id, ...over,
  });
  const rows = [
    mk({ id: 'a', state: 'pendente' }),
    mk({ id: 'b', state: 'em_andamento', overdue: true, project: P({ id: 'b', assignedTo: 'bia' }) }),
    mk({ id: 'c', state: 'concluido' }),
    mk({ id: 'd', state: 'cancelado', search: 'texto especial' }),
  ];
  const ids = (f: Partial<typeof DEFAULT_PROJECT_FILTERS>) => filterProjectRows(rows, { ...DEFAULT_PROJECT_FILTERS, ...f }).map((r) => r.id);
  it('padrao: o que falta fazer', () => expect(ids({})).toEqual(['a', 'b']));
  it('por situacao', () => {
    expect(ids({ state: 'todos' })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids({ state: 'concluido' })).toEqual(['c']);
    expect(ids({ state: 'cancelado' })).toEqual(['d']);
  });
  it('por tecnico', () => expect(ids({ state: 'todos', technician: 'bia' })).toEqual(['b']));
  it('so atrasados', () => expect(ids({ state: 'todos', onlyOverdue: true })).toEqual(['b']));
  it('busca no texto da linha, sem acento e sem maiusculas', () => {
    expect(ids({ state: 'todos', query: '  ESPECIAL ' })).toEqual(['d']);
    expect(ids({ state: 'todos', query: 'nada' })).toEqual([]);
  });
  it('filtros juntos', () => expect(ids({ state: 'abertos', onlyOverdue: true, technician: 'bia', query: 'b' })).toEqual(['b']));
  it('conta quantos filtros diferem do padrao', () => {
    expect(activeProjectFilterCount(DEFAULT_PROJECT_FILTERS)).toBe(0);
    expect(activeProjectFilterCount({ state: 'todos', technician: 'x', query: ' q ', onlyOverdue: true })).toBe(4);
    expect(activeProjectFilterCount({ ...DEFAULT_PROJECT_FILTERS, query: '   ' })).toBe(0);
  });
});

describe('ordem', () => {
  const mk = (id: string, over: Partial<ProjectTableRow> = {}, project: Partial<Project> = {}): ProjectTableRow => ({
    project: P({ id, ...project }), state: 'pendente', technicianName: 'Ana', linked: [], overdue: false,
    id, title: id, osNumber: '', activities: 0, elements: 0, cables: 0, meters: 0, search: '', ...over,
  });
  const rows = [
    mk('b', { title: 'Beta', technicianName: 'Zeca', activities: 1, meters: 50, state: 'concluido' }, { dueDate: '2026-11-02', createdAt: 2 }),
    mk('a', { title: 'alfa', technicianName: 'Ágata', activities: 3, meters: 500, state: 'em_andamento' }, { createdAt: 1 }),
    mk('c', { title: 'Charlie', technicianName: 'Bia', activities: 2, meters: 5, state: 'pendente' }, { dueDate: '2026-10-05', createdAt: 3 }),
  ];
  const ids = (s: Parameters<typeof sortProjectRows>[1]) => sortProjectRows(rows, s).map((r) => r.id);
  it('sem ordem escolhida: a ordem padrao dos que pedem atencao', () => expect(ids(null)).toEqual(['a', 'c', 'b']));
  it('texto em ordem alfabetica (acento e maiuscula nao atrapalham)', () => {
    expect(ids({ key: 'title', dir: 'asc' })).toEqual(['a', 'b', 'c']);
    expect(ids({ key: 'technician', dir: 'asc' })).toEqual(['a', 'c', 'b']);
    expect(ids({ key: 'title', dir: 'desc' })).toEqual(['c', 'b', 'a']);
  });
  it('numeros do maior para o menor, e inverte', () => {
    expect(ids({ key: 'meters', dir: 'desc' })).toEqual(['a', 'b', 'c']);
    expect(ids({ key: 'activities', dir: 'asc' })).toEqual(['b', 'c', 'a']);
  });
  it('prazo: sem prazo vai sempre para o fim, em qualquer sentido', () => {
    expect(ids({ key: 'dueDate', dir: 'asc' })).toEqual(['c', 'b', 'a']);
    expect(ids({ key: 'dueDate', dir: 'desc' })).toEqual(['b', 'c', 'a']);
  });
  it('sem prazo vai para o fim mesmo sendo o mais novo (nao e o desempate que o coloca la)', () => {
    const r = [mk('old1', {}, { dueDate: '2026-10-05', createdAt: 1 }), mk('new', {}, { createdAt: 99 }), mk('old2', {}, { dueDate: '2026-11-05', createdAt: 2 })];
    expect(sortProjectRows(r, { key: 'dueDate', dir: 'asc' }).map((x) => x.id)).toEqual(['old1', 'old2', 'new']);
    expect(sortProjectRows(r, { key: 'dueDate', dir: 'desc' }).map((x) => x.id)).toEqual(['old2', 'old1', 'new']);
  });
  it('situacao: em andamento, pendente, concluido', () => expect(ids({ key: 'state', dir: 'asc' })).toEqual(['a', 'c', 'b']));
  it('empate desempata pelo mais novo e depois pelo id', () => {
    const tie = [mk('x', { activities: 1 }, { createdAt: 1 }), mk('y', { activities: 1 }, { createdAt: 2 }), mk('w', { activities: 1 }, { createdAt: 2 })];
    expect(sortProjectRows(tie, { key: 'activities', dir: 'asc' }).map((r) => r.id)).toEqual(['w', 'y', 'x']);
  });
  it('nao altera a lista de entrada', () => {
    const copy = [...rows];
    sortProjectRows(rows, { key: 'title', dir: 'asc' });
    sortProjectRows(rows, null);
    expect(rows).toEqual(copy);
  });
  it('clicar na coluna: ordena, inverte e volta ao padrao', () => {
    const s1 = nextProjectSort(null, 'title');
    expect(s1).toEqual({ key: 'title', dir: 'asc' });
    const s2 = nextProjectSort(s1, 'title');
    expect(s2).toEqual({ key: 'title', dir: 'desc' });
    expect(nextProjectSort(s2, 'title')).toBeNull();
    expect(nextProjectSort(s2, 'meters')).toEqual({ key: 'meters', dir: 'desc' }); // outra coluna recomeca pelo sentido dela
    const m2 = nextProjectSort({ key: 'meters', dir: 'desc' }, 'meters');
    expect(m2).toEqual({ key: 'meters', dir: 'asc' });
    expect(nextProjectSort(m2, 'meters')).toBeNull();
  });
});

describe('totais e contagens', () => {
  const r = (state: ProjectTableRow['state'], over: Partial<ProjectTableRow> = {}) =>
    ({ project: P(), state, technicianName: '', linked: [], overdue: false, id: 'x', title: 'x', osNumber: '', activities: 1, elements: 2, cables: 3, meters: 10.5, search: '', ...over }) as ProjectTableRow;
  it('somam o que esta na tabela', () => {
    expect(projectTotalsOf([r('pendente'), r('concluido', { activities: 4, meters: 0.5 })])).toEqual({ projects: 2, activities: 5, elements: 4, cables: 6, meters: 11 });
    expect(projectTotalsOf([])).toEqual({ projects: 0, activities: 0, elements: 0, cables: 0, meters: 0 });
  });
  it('contam por situacao e os atrasados', () => {
    expect(projectCounts([r('pendente', { overdue: true }), r('pendente'), r('em_andamento', { overdue: true }), r('concluido'), r('cancelado')])).toEqual({ total: 5, pendente: 2, em_andamento: 1, concluido: 1, cancelado: 1, overdue: 2 });
  });
});

describe('CSV e nome do arquivo', () => {
  const row = (over: Partial<ProjectTableRow>) =>
    ({ project: P({ address: 'Rua X; 10', dueDate: '2026-10-05' }), state: 'em_andamento', technicianName: '=Ana', linked: [], overdue: true, id: 'p', title: 'Rua "Boa"', osNumber: 'OS-1', activities: 2, elements: 3, cables: 1, meters: 1234.5, search: '', ...over }) as ProjectTableRow;
  it('cabecalho, linha em formato brasileiro e protecao contra formula', () => {
    const csv = projectsCsv([row({})]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('Projeto;Técnico;Tipo;OS;Endereço;Prazo;Situação;Atrasado;Atividades;Elementos;Cabos;Metros de cabo');
    expect(lines[1]).toBe('"Rua ""Boa""";\'=Ana;Implantação;OS-1;"Rua X; 10";05/10/2026;Em andamento;sim;2;3;1;1234,50');
    expect(lines[2]).toBe('');
  });
  it('sem prazo, nao atrasado', () => {
    const lines = projectsCsv([row({ project: P(), overdue: false, state: 'pendente' })]).replace(/^﻿/, '').split('\r\n');
    expect(lines[1]).toContain(';;Pendente;não;');
  });
  it('lista vazia: so o cabecalho', () => expect(projectsCsv([]).replace(/^﻿/, '').split('\r\n')).toHaveLength(2));
  it('nome do arquivo com o dia local', () => {
    expect(projectsFileName(new Date(2026, 0, 5, 23, 59))).toBe('projetos-2026-01-05.csv');
    expect(projectsFileName(new Date(2026, 11, 31, 0, 0))).toBe('projetos-2026-12-31.csv');
  });
});
