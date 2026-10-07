import { describe, expect, it } from 'vitest';
import { buildRows, countByState, dayString, filterRows, formatDueDate, isOverdue, projectState, sortRows, STATE_FILTERS, type ProjectRow } from './projectState';
import type { LinkedActivity, Project } from './types';

const P = (over: Partial<Project> = {}): Project => ({ id: 'p1', ownerId: 'adm', assignedTo: 'u1', title: 'Rua das Flores', kind: 'implantacao', description: '', address: '', status: 'aberto', deleted: false, createdAt: 1000, updatedAt: 1000, ...over });
const A = (over: Partial<LinkedActivity> = {}): LinkedActivity => ({ id: 'a1', title: 'Atividade', technician: 'Ana', status: 'aberta', completesProject: false, deleted: false, ...over });
const NOW = new Date(2026, 9, 20, 10, 0, 0).getTime(); // 20/10/2026 10h, hora local

describe('projectState', () => {
  it('sem atividade = pendente; com atividade aberta ou concluida sem terminar o projeto = em andamento', () => {
    expect(projectState(P(), [])).toBe('pendente');
    expect(projectState(P(), [A()])).toBe('em_andamento');
    expect(projectState(P(), [A({ status: 'concluida' })])).toBe('em_andamento');
  });
  it('concluido so quando a atividade concluida diz que terminou o projeto', () => {
    expect(projectState(P(), [A({ status: 'concluida', completesProject: true })])).toBe('concluido');
    expect(projectState(P(), [A({ status: 'aberta', completesProject: true })])).toBe('em_andamento'); // ainda nao concluiu
    expect(projectState(P(), [A({ status: 'concluida', completesProject: true }), A({ id: 'a2' })])).toBe('concluido');
  });
  it('atividade excluida nao conta (nem para andamento, nem para concluir)', () => {
    expect(projectState(P(), [A({ deleted: true })])).toBe('pendente');
    expect(projectState(P(), [A({ status: 'concluida', completesProject: true, deleted: true })])).toBe('pendente');
    expect(projectState(P(), [A({ status: 'concluida', completesProject: true, deleted: true }), A({ id: 'a2' })])).toBe('em_andamento');
  });
  it('o que o administrador marcou vale sobre as atividades', () => {
    expect(projectState(P({ status: 'cancelado' }), [A({ status: 'concluida', completesProject: true })])).toBe('cancelado');
    expect(projectState(P({ status: 'concluido' }), [])).toBe('concluido');
    expect(projectState(P({ status: 'cancelado' }), [])).toBe('cancelado');
  });
});

describe('prazo', () => {
  it('dayString usa o dia local e completa com zeros', () => {
    expect(dayString(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(dayString(NOW)).toBe('2026-10-20');
  });
  it('atrasado so depois do dia do prazo, e so para o que ainda esta aberto', () => {
    expect(isOverdue({ dueDate: '2026-10-19' }, 'pendente', NOW)).toBe(true);
    expect(isOverdue({ dueDate: '2026-10-19' }, 'em_andamento', NOW)).toBe(true);
    expect(isOverdue({ dueDate: '2026-10-20' }, 'pendente', NOW)).toBe(false); // vence hoje: ainda no prazo
    expect(isOverdue({ dueDate: '2026-10-21' }, 'pendente', NOW)).toBe(false);
    expect(isOverdue({ dueDate: '2026-10-19' }, 'concluido', NOW)).toBe(false);
    expect(isOverdue({ dueDate: '2026-10-19' }, 'cancelado', NOW)).toBe(false);
    expect(isOverdue({}, 'pendente', NOW)).toBe(false);
  });
  it('formata dia/mes/ano', () => {
    expect(formatDueDate('2026-10-05')).toBe('05/10/2026');
    expect(formatDueDate('lixo')).toBe('lixo');
  });
});

describe('lista', () => {
  const names = new Map([['u1', 'Ana Técnica'], ['u2', 'Bruno Técnico']]);
  const projects = [
    P({ id: 'a', title: 'Antena Norte', assignedTo: 'u1', dueDate: '2026-10-25', createdAt: 1 }),
    P({ id: 'b', title: 'Bairro Açaí', assignedTo: 'u2', kind: 'manutencao', osNumber: 'OS-77', address: 'Av. Brasil 100', dueDate: '2026-10-10', createdAt: 2 }), // atrasado
    P({ id: 'c', title: 'Centro', assignedTo: 'u1', status: 'cancelado', createdAt: 3 }),
    P({ id: 'd', title: 'Distrito', assignedTo: 'u2', createdAt: 4 }), // sem prazo
    P({ id: 'e', title: 'Excluido', deleted: true, createdAt: 5 }),
    P({ id: 'f', title: 'Feito', assignedTo: 'u1', dueDate: '2026-09-01', createdAt: 6 }), // venceu, mas concluido
    P({ id: 'g', title: 'Em campo', assignedTo: 'u2', dueDate: '2026-10-30', createdAt: 7 }),
  ];
  const linked = new Map<string, LinkedActivity[]>([
    ['f', [A({ id: 'f1', status: 'concluida', completesProject: true })]],
    ['g', [A({ id: 'g1' })]],
  ]);
  const rows = buildRows(projects, linked, names, NOW);

  it('buildRows: tira os excluidos, calcula situacao, atraso e nome do tecnico', () => {
    expect(rows.map((r) => r.project.id)).toEqual(['a', 'b', 'c', 'd', 'f', 'g']);
    const by = (id: string) => rows.find((r) => r.project.id === id)!;
    expect(by('b')).toMatchObject({ state: 'pendente', overdue: true, technicianName: 'Bruno Técnico' });
    expect(by('f')).toMatchObject({ state: 'concluido', overdue: false });
    expect(by('g')).toMatchObject({ state: 'em_andamento', overdue: false });
    expect(by('c').state).toBe('cancelado');
  });
  it('tecnico que nao esta no cadastro ganha um nome honesto', () => {
    expect(buildRows([P({ assignedTo: 'x' })], new Map(), names, NOW)[0]!.technicianName).toBe('Técnico não encontrado');
  });

  const ids = (rs: ProjectRow[]) => rs.map((r) => r.project.id);
  it('filtros por situacao ("Para fazer" = pendente + em andamento)', () => {
    expect(ids(filterRows(rows, 'abertos', ''))).toEqual(['a', 'b', 'd', 'g']);
    expect(ids(filterRows(rows, 'pendente', ''))).toEqual(['a', 'b', 'd']);
    expect(ids(filterRows(rows, 'em_andamento', ''))).toEqual(['g']);
    expect(ids(filterRows(rows, 'concluido', ''))).toEqual(['f']);
    expect(ids(filterRows(rows, 'cancelado', ''))).toEqual(['c']);
    expect(ids(filterRows(rows, 'todos', ''))).toEqual(['a', 'b', 'c', 'd', 'f', 'g']);
  });
  it('filtro por tecnico', () => {
    expect(ids(filterRows(rows, 'todos', '', 'u2'))).toEqual(['b', 'd', 'g']);
  });
  it('busca sem acento e sem maiusculas em nome, OS, endereco, tipo e tecnico; espacos nas pontas nao atrapalham', () => {
    expect(ids(filterRows(rows, 'todos', 'acai'))).toEqual(['b']);
    expect(ids(filterRows(rows, 'todos', '  os-77 '))).toEqual(['b']);
    expect(ids(filterRows(rows, 'todos', 'AV. BRASIL'))).toEqual(['b']);
    expect(ids(filterRows(rows, 'todos', 'manutencao'))).toEqual(['b']);
    expect(ids(filterRows(rows, 'todos', 'bruno'))).toEqual(['b', 'd', 'g']);
    expect(ids(filterRows(rows, 'abertos', 'ana'))).toEqual(['a']);
    expect(ids(filterRows(rows, 'todos', 'nao existe'))).toEqual([]);
  });
  it('ordem: atrasados, depois em andamento, pendentes, concluidos, cancelados; dentro de cada, prazo mais proximo, sem prazo por ultimo, depois o mais novo', () => {
    expect(ids(sortRows(rows))).toEqual(['b', 'g', 'a', 'd', 'f', 'c']);
    const two = buildRows([P({ id: 'x', createdAt: 1 }), P({ id: 'y', createdAt: 2 })], new Map(), names, NOW);
    expect(ids(sortRows(two))).toEqual(['y', 'x']); // sem prazo: o mais novo primeiro
    const dated = buildRows([P({ id: 'x', dueDate: '2026-11-02' }), P({ id: 'y', dueDate: '2026-11-01' }), P({ id: 'z' })], new Map(), names, NOW);
    expect(ids(sortRows(dated))).toEqual(['y', 'x', 'z']);
  });
  it('nao mexe na lista original', () => {
    const mine = buildRows(projects, linked, names, NOW);
    const copy = [...mine];
    sortRows(mine);
    expect(mine).toEqual(copy);
  });
  it('contagem por situacao para os botoes de filtro', () => {
    expect(countByState(rows)).toEqual({ todos: 6, abertos: 4, pendente: 3, em_andamento: 1, concluido: 1, cancelado: 1 });
  });
  it('todo filtro da lista tem contagem', () => {
    const c = countByState(rows);
    for (const f of STATE_FILTERS) expect(typeof c[f.value]).toBe('number');
  });
});
