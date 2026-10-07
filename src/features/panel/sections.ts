import type { Route } from '../../lib/route';

// As secoes do painel. 'aqui' = conteudo do proprio painel; 'tela' = abre uma tela que ja existe.
export type PanelSectionId = 'visao-geral' | 'mapa' | 'atividades' | 'projetos' | 'totais' | 'exportar' | 'sincronizacao';

export type PanelSection =
  | { id: PanelSectionId; label: string; kind: 'aqui' }
  | { id: PanelSectionId; label: string; kind: 'tela'; route: Route };

export const PANEL_SECTIONS: PanelSection[] = [
  { id: 'visao-geral', label: 'Visão geral', kind: 'aqui' },
  { id: 'mapa', label: 'Mapa da rede', kind: 'aqui' },
  { id: 'atividades', label: 'Atividades', kind: 'aqui' },
  { id: 'projetos', label: 'Projetos', kind: 'aqui' },
  { id: 'totais', label: 'Totais', kind: 'aqui' },
  { id: 'exportar', label: 'Exportar', kind: 'tela', route: 'exportar' },
  { id: 'sincronizacao', label: 'Sincronização', kind: 'tela', route: 'sincronizacao' },
];

/** A secao aberta pelo endereco (#/painel ou #/painel/<secao>). Endereco desconhecido, ou de uma secao que e so um atalho para outra tela, cai na visao geral. */
export function sectionOf(id: string | undefined): PanelSection {
  return PANEL_SECTIONS.find((s) => s.kind === 'aqui' && s.id === id) ?? PANEL_SECTIONS[0]!;
}
