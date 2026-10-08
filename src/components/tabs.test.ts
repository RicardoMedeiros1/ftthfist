import { describe, expect, it } from 'vitest';
import type { Route } from '../lib/route';
import { TAB_ROUTES, isTabRoute, projectsRouteFor, tabBarVisible, tabOf } from './tabs';

const free = { phase: 'idle', routeOpen: false, legendOpen: false };

describe('barra de abas: onde aparece', () => {
  it('só nas telas raiz', () => {
    for (const r of TAB_ROUTES) expect(isTabRoute(r)).toBe(true);
    for (const r of ['atividade', 'nova-atividade', 'elemento', 'cabo', 'novo-cabo', 'backup', 'trilha', 'painel', 'meu-projeto', 'projeto', 'conta'] as Route[]) {
      expect(isTabRoute(r)).toBe(false);
      expect(tabBarVisible({ route: r, ...free })).toBe(false);
    }
  });

  it('nas telas raiz fora do mapa aparece sempre (mesmo com marcação em andamento)', () => {
    for (const r of ['atividades', 'meus-projetos', 'projetos', 'config'] as Route[]) {
      expect(tabBarVisible({ route: r, ...free })).toBe(true);
      expect(tabBarVisible({ route: r, phase: 'cabo', routeOpen: true, legendOpen: true })).toBe(true);
    }
  });

  it('no mapa só com o mapa livre: marcação, lançamento, legenda e rota acesa a escondem', () => {
    expect(tabBarVisible({ route: 'map', ...free })).toBe(true);
    for (const phase of ['tipo', 'posicao', 'mover', 'cabo', 'cabo-editar']) {
      expect(tabBarVisible({ route: 'map', ...free, phase })).toBe(false);
    }
    expect(tabBarVisible({ route: 'map', ...free, routeOpen: true })).toBe(false);
    expect(tabBarVisible({ route: 'map', ...free, legendOpen: true })).toBe(false);
  });
});

describe('barra de abas: aba acesa', () => {
  it('cada tela raiz acende a sua aba; as outras não acendem nenhuma', () => {
    expect(tabOf('map')).toBe('mapa');
    expect(tabOf('atividades')).toBe('atividades');
    expect(tabOf('meus-projetos')).toBe('projetos');
    expect(tabOf('projetos')).toBe('projetos');
    expect(tabOf('config')).toBe('ajustes');
    expect(tabOf('atividade')).toBeNull();
    expect(tabOf('backup')).toBeNull();
  });

  it('a aba Projetos leva o administrador à gestão e os outros aos projetos que receberam', () => {
    expect(projectsRouteFor('admin')).toBe('projetos');
    expect(projectsRouteFor('tecnico')).toBe('meus-projetos');
    expect(projectsRouteFor('escritorio')).toBe('meus-projetos');
    expect(projectsRouteFor(undefined)).toBe('meus-projetos'); // sem conta (uso só no aparelho)
  });
});
