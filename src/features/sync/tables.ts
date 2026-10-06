// Quais tabelas sincronizam e em que ordem. Fotos entram no passo 4 (precisam do envio do arquivo).

export type SyncTable = 'activities' | 'elements' | 'cables' | 'trackPoints';

/** Ordem de envio: o servidor exige a atividade antes dos registros que dependem dela. */
export const PUSH_ORDER: readonly SyncTable[] = ['activities', 'elements', 'cables', 'trackPoints'];

/** O que se baixa. A trilha só sobe: a de um colega nunca vai para o celular de ninguém. */
export const PULL_ORDER: readonly SyncTable[] = ['activities', 'elements', 'cables'];

export const REMOTE_TABLE: Record<SyncTable, string> = {
  activities: 'activities',
  elements: 'elements',
  cables: 'cables',
  trackPoints: 'track_points',
};

export const TABLE_LABEL: Record<SyncTable, string> = {
  activities: 'atividades',
  elements: 'elementos',
  cables: 'cabos',
  trackPoints: 'pontos de trilha',
};
