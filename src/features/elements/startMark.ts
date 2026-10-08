import type { Route } from '../../lib/route';

export type StartMarkAction =
  /** A atividade aberta ainda está carregando: ainda não dá para decidir. */
  | 'wait'
  /** Já há marcação ou lançamento em andamento: só volta ao mapa, sem recomeçar nada. */
  | 'resume'
  /** Sem atividade aberta: leva a iniciar uma (todo elemento pertence a uma atividade). */
  | 'need-activity'
  /** Abre a escolha de tipo (indo ao mapa antes, se estiver em outra tela). */
  | 'start';

/** O que o botão "+" faz: `open` é a atividade aberta (undefined = carregando; null = nenhuma). */
export function decideStartMark(s: { open: unknown; phase: string }): StartMarkAction {
  if (s.open === undefined) return 'wait';
  if (s.phase !== 'idle') return 'resume';
  if (s.open === null) return 'need-activity';
  return 'start';
}

/** Só troca de tela se não estiver no mapa (e no lugar da tela atual: o ← não volta para a aba). */
export const needsMapNavigation = (route: Route): boolean => route !== 'map';
