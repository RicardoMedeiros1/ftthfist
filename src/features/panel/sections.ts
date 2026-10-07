import type { Route } from '../../lib/route';

// As secoes do painel. 'aqui' = conteudo do proprio painel; 'tela' = abre uma tela que ja existe; 'em-breve' = ainda nao feita.
export type PanelSectionId = 'visao-geral' | 'mapa' | 'atividades' | 'totais' | 'exportar' | 'sincronizacao';

export type PanelSection =
  | { id: PanelSectionId; label: string; kind: 'aqui' }
  | { id: PanelSectionId; label: string; kind: 'tela'; route: Route }
  | { id: PanelSectionId; label: string; kind: 'em-breve' };

export const PANEL_SECTIONS: PanelSection[] = [
  { id: 'visao-geral', label: 'Visão geral', kind: 'aqui' },
  { id: 'mapa', label: 'Mapa da rede', kind: 'aqui' },
  { id: 'atividades', label: 'Atividades', kind: 'aqui' },
  { id: 'totais', label: 'Totais', kind: 'em-breve' },
  { id: 'exportar', label: 'Exportar', kind: 'tela', route: 'exportar' },
  { id: 'sincronizacao', label: 'Sincronização', kind: 'tela', route: 'sincronizacao' },
];

/** A secao aberta pelo endereco (#/painel ou #/painel/<secao>). Endereco desconhecido cai na visao geral. */
export function sectionOf(id: string | undefined): PanelSection {
  return PANEL_SECTIONS.find((s) => s.id === id) ?? PANEL_SECTIONS[0]!;
}
