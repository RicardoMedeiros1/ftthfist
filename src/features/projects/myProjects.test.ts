import { describe, expect, it } from 'vitest';
import type { Activity, Project } from '../../db/types';
import { canStart, directionsUrl, isTodo, linkedByProject, myProjectRows, noticeText, startInput, technicianNameFor } from './myProjects';

const NOW = new Date(2026, 9, 20, 10, 0, 0).getTime();
const P = (over: Partial<Project> = {}): Project => ({ id: 'p1', ownerId: 'adm', assignedTo: 'ana', title: 'Rua das Flores', kind: 'implantacao', description: '', address: '', status: 'aberto', deleted: false, createdAt: 1, updatedAt: 1, ...over });
const A = (over: Partial<Activity> = {}): Activity => ({
  id: 'a1', createdAt: 1, updatedAt: 1, createdBy: 'Ana', deleted: false, syncStatus: 'synced', kind: 'implantacao', title: 'Trecho', technician: 'Ana', startedAt: 100, status: 'aberta', description: '', materials: [], ...over,
});

describe('linkedByProject', () => {
  it('agrupa por projeto, em ordem de inicio, e ignora a atividade avulsa', () => {
    const map = linkedByProject([
      A({ id: 'a2', projectId: 'p1', startedAt: 300, title: 'Depois' }),
      A({ id: 'a1', projectId: 'p1', startedAt: 100, title: 'Antes' }),
      A({ id: 'a3', projectId: 'p2', startedAt: 200 }),
      A({ id: 'a4' }),
    ]);
    expect([...map.keys()].sort()).toEqual(['p1', 'p2']);
    expect(map.get('p1')!.map((a) => a.title)).toEqual(['Antes', 'Depois']);
  });
  it('traz situacao, quem fez, se terminou o projeto e se foi excluida', () => {
    const [x] = linkedByProject([A({ id: 'a1', projectId: 'p1', status: 'concluida', completesProject: true, deleted: true, technician: 'Bia' })]).get('p1')!;
    expect(x).toEqual({ id: 'a1', title: 'Trecho', technician: 'Bia', status: 'concluida', completesProject: true, deleted: true, startedAt: 100 });
  });
  it('sem completesProject, nao termina o projeto', () => {
    expect(linkedByProject([A({ projectId: 'p1' })]).get('p1')![0]!.completesProject).toBe(false);
  });
  it('nao altera a lista de entrada', () => {
    const list = [A({ id: 'b', projectId: 'p1', startedAt: 2 }), A({ id: 'a', projectId: 'p1', startedAt: 1 })];
    linkedByProject(list);
    expect(list.map((a) => a.id)).toEqual(['b', 'a']);
  });
});

describe('myProjectRows', () => {
  const projects = [
    P({ id: 'a', title: 'A pendente' }),
    P({ id: 'b', title: 'B andamento' }),
    P({ id: 'c', title: 'C de outro', assignedTo: 'bruno' }),
    P({ id: 'd', title: 'D excluido', deleted: true }),
    P({ id: 'e', title: 'E cancelado', status: 'cancelado' }),
    P({ id: 'f', title: 'F atrasado', dueDate: '2026-10-01' }),
    P({ id: 'g', title: 'G concluido pela atividade' }),
  ];
  const acts = [A({ id: 'x1', projectId: 'b' }), A({ id: 'x2', projectId: 'g', status: 'concluida', completesProject: true })];
  const rows = myProjectRows(projects, acts, 'ana', NOW);

  it('so os meus, sem os excluidos, com situacao e atraso', () => {
    expect(rows.map((r) => r.project.id).sort()).toEqual(['a', 'b', 'e', 'f', 'g']);
    const by = (id: string) => rows.find((r) => r.project.id === id)!;
    expect(by('a').state).toBe('pendente');
    expect(by('b').state).toBe('em_andamento');
    expect(by('e').state).toBe('cancelado');
    expect(by('g').state).toBe('concluido');
    expect(by('f')).toMatchObject({ state: 'pendente', overdue: true });
  });
  it('os que pedem atencao vem primeiro', () => {
    expect(rows.map((r) => r.project.id)).toEqual(['f', 'b', 'a', 'g', 'e']);
  });
  it('a atividade de um colega tambem conta para o andamento do projeto', () => {
    const r = myProjectRows([P({ id: 'a' })], [A({ projectId: 'a', technician: 'Bruno', ownerId: 'bruno' })], 'ana', NOW);
    expect(r[0]!.state).toBe('em_andamento');
  });
  it('sem usuario identificado, nada', () => {
    expect(myProjectRows(projects, acts, null, NOW)).toEqual([]);
    expect(myProjectRows(projects, acts, '', NOW)).toEqual([]);
  });
  it('outra pessoa ve os dela', () => {
    expect(myProjectRows(projects, acts, 'bruno', NOW).map((r) => r.project.id)).toEqual(['c']);
  });
});

describe('o que falta fazer', () => {
  it('pendente e em andamento; o resto e historico', () => {
    expect(isTodo({ state: 'pendente' })).toBe(true);
    expect(isTodo({ state: 'em_andamento' })).toBe(true);
    expect(isTodo({ state: 'concluido' })).toBe(false);
    expect(isTodo({ state: 'cancelado' })).toBe(false);
  });
  it('so da para iniciar enquanto falta fazer e o projeto existe', () => {
    expect(canStart({ state: 'pendente', project: P() })).toBe(true);
    expect(canStart({ state: 'em_andamento', project: P() })).toBe(true);
    expect(canStart({ state: 'concluido', project: P() })).toBe(false);
    expect(canStart({ state: 'cancelado', project: P() })).toBe(false);
    expect(canStart({ state: 'pendente', project: P({ deleted: true }) })).toBe(false);
  });
  it('texto do aviso concorda com o numero', () => {
    expect(noticeText(1)).toBe('Você tem 1 projeto para fazer');
    expect(noticeText(2)).toBe('Você tem 2 projetos para fazer');
    expect(noticeText(10)).toBe('Você tem 10 projetos para fazer');
  });
});

describe('startInput e directionsUrl', () => {
  it('a atividade nasce com o nome, o tipo e a OS do projeto, e ligada a ele', () => {
    expect(startInput(P({ id: 'p9', title: 'Rua X', kind: 'manutencao', osNumber: 'OS-1' }))).toEqual({ kind: 'manutencao', title: 'Rua X', osNumber: 'OS-1', projectId: 'p9' });
    expect(startInput(P())).toEqual({ kind: 'implantacao', title: 'Rua das Flores', projectId: 'p1' });
    expect('osNumber' in startInput(P({ osNumber: '' }))).toBe(false);
  });
  it('rota ate o ponto, so quando ha ponto', () => {
    expect(directionsUrl(P({ lat: -23.5505, lng: -46.6333 }))).toBe('https://www.google.com/maps/dir/?api=1&destination=-23.5505,-46.6333');
    expect(directionsUrl(P({ lat: 0, lng: 0 }))).toBe('https://www.google.com/maps/dir/?api=1&destination=0,0');
    expect(directionsUrl(P())).toBeNull();
    expect(directionsUrl(P({ lat: -23.5 }))).toBeNull();
  });
});

describe('technicianNameFor', () => {
  it('o nome das Configuracoes vale primeiro; sem ele, o do cadastro; sem nenhum, vazio (a tela pergunta)', () => {
    expect(technicianNameFor(' Ana Souza ', 'Ana do Cadastro')).toBe('Ana Souza');
    expect(technicianNameFor('', 'Ana do Cadastro ')).toBe('Ana do Cadastro');
    expect(technicianNameFor(undefined, 'Ana do Cadastro')).toBe('Ana do Cadastro');
    expect(technicianNameFor('   ', '  ')).toBe('');
    expect(technicianNameFor(undefined, undefined)).toBe('');
  });
});
