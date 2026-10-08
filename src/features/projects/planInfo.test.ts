import { describe, expect, it } from 'vitest';
import type { Project, ProjectPlan } from '../../db/types';
import { codeText, lineText, plannedFromProject, plannedProjects, pointTitle } from './planInfo';
import type { ProjectRow } from './projectState';
import type { ProjectState } from './types';

const plan: ProjectPlan = { lines: [{ id: 'l', points: [[-23.55, -46.63], [-23.551, -46.63]] }], points: [] };
const onlyPoints: ProjectPlan = { lines: [], points: [{ id: 'p', type: 'poste', lat: -23.5, lng: -46.6 }] };
const row = (id: string, state: ProjectState, p?: ProjectPlan | undefined, over: Partial<Project> = {}): Pick<ProjectRow, 'project' | 'state'> => ({
  project: { id, title: `Projeto ${id}`, ownerId: 'o', assignedTo: 'a', kind: 'implantacao', description: '', address: '', status: 'aberto', deleted: false, createdAt: 1, updatedAt: 1, ...(p ? { plan: p } : {}), ...over },
  state,
});

describe('plannedProjects: o que aparece no mapa do tecnico', () => {
  it('so projetos para fazer (pendente ou em andamento) e com desenho', () => {
    const out = plannedProjects([
      row('a', 'pendente', plan),
      row('b', 'em_andamento', onlyPoints),
      row('c', 'concluido', plan),
      row('d', 'cancelado', plan),
      row('e', 'pendente'), // sem desenho
      row('f', 'pendente', { lines: [], points: [] }), // desenho vazio
    ]);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
    expect(out[0]).toEqual({ id: 'a', title: 'Projeto a', plan });
  });
  it('projeto excluido nao aparece', () => {
    expect(plannedProjects([row('x', 'pendente', plan, { deleted: true })])).toEqual([]);
  });
  it('lista vazia = nada', () => {
    expect(plannedProjects([])).toEqual([]);
  });
  it('plannedFromProject: so quando ha desenho', () => {
    expect(plannedFromProject(row('a', 'pendente', plan).project)).toEqual({ id: 'a', title: 'Projeto a', plan });
    expect(plannedFromProject(row('b', 'pendente').project)).toBeNull();
    expect(plannedFromProject(row('c', 'pendente', { lines: [], points: [] }).project)).toBeNull();
  });
});

describe('textos', () => {
  it('titulo do ponto projetado', () => {
    expect(pointTitle('poste')).toBe('Poste projetado');
    expect(pointTitle('cto')).toBe('CTO projetado');
    expect(pointTitle('ceo')).toBe('CEO projetado');
    expect(pointTitle('reserva')).toBe('Reserva projetada');
    expect(pointTitle('outro')).toBe('Ponto projetado');
  });
  it('codigo so quando existe', () => {
    expect(codeText('P-014')).toBe('Código: P-014');
    expect(codeText('')).toBeNull();
    expect(codeText(undefined)).toBeNull();
  });
  it('texto do traçado: metros e pontos', () => {
    expect(lineText({ id: 'l', points: [[-23.55, -46.63], [-23.551, -46.63], [-23.552, -46.63]] })).toBe('222,4 m · 3 pontos');
  });
});
