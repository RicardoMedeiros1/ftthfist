import type { Route } from '../lib/route';

/** Telas "raiz": a barra de abas aparece nelas (e some nas telas de detalhe, que têm o botão ←). */
export const TAB_ROUTES: readonly Route[] = ['map', 'atividades', 'meus-projetos', 'projetos', 'config'];

export const isTabRoute = (route: Route): boolean => TAB_ROUTES.includes(route);

export type Tab = 'mapa' | 'atividades' | 'projetos' | 'ajustes';

/** Qual aba fica acesa na tela atual (null = a tela não tem aba). */
export function tabOf(route: Route): Tab | null {
  if (route === 'map') return 'mapa';
  if (route === 'atividades') return 'atividades';
  if (route === 'meus-projetos' || route === 'projetos') return 'projetos';
  if (route === 'config') return 'ajustes';
  return null;
}

/** Para onde a aba Projetos leva: o administrador gerencia; os demais veem os projetos que receberam. */
export const projectsRouteFor = (role: string | undefined): Route => (role === 'admin' ? 'projetos' : 'meus-projetos');

/**
 * A barra de baixo aparece nas telas raiz. No mapa só com o mapa livre: marcação, lançamento, legenda e rota acesa
 * ocupam o rodapé com os próprios painéis.
 */
export function tabBarVisible(s: { route: Route; phase: string; routeOpen: boolean; legendOpen: boolean }): boolean {
  if (!isTabRoute(s.route)) return false;
  if (s.route === 'map') return s.phase === 'idle' && !s.routeOpen && !s.legendOpen;
  return true;
}
