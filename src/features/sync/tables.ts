// Quais tabelas sincronizam e em que ordem.

export type SyncTable = 'activities' | 'elements' | 'cables' | 'photos' | 'trackPoints';

/** Ordem de envio: o servidor exige a atividade (e o elemento) antes dos registros que dependem deles. */
export const PUSH_ORDER: readonly SyncTable[] = ['activities', 'elements', 'cables', 'photos', 'trackPoints'];

/** O que se baixa. A trilha só sobe: a de um colega nunca vai para o celular de ninguém. */
export const PULL_ORDER: readonly SyncTable[] = ['activities', 'elements', 'cables', 'photos'];

export const REMOTE_TABLE: Record<SyncTable, string> = {
  activities: 'activities',
  elements: 'elements',
  cables: 'cables',
  photos: 'photos',
  trackPoints: 'track_points',
};

export const TABLE_LABEL: Record<SyncTable, string> = {
  activities: 'atividades',
  elements: 'elementos',
  cables: 'cabos',
  photos: 'fotos',
  trackPoints: 'pontos de trilha',
};

/** Bucket privado das fotos; caminho `<dono>/<id>.jpg` (a primeira pasta e o dono: e o que a politica do servidor confere). */
export const PHOTO_BUCKET = 'fotos';
export const photoPath = (ownerId: string, photoId: string) => `${ownerId}/${photoId}.jpg`;
