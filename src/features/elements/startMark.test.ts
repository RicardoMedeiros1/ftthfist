import { describe, expect, it } from 'vitest';
import { decideStartMark, needsMapNavigation } from './startMark';

const activity = { id: 'a1' };

describe('botão "+" (marcar elemento)', () => {
  it('espera enquanto a atividade aberta carrega', () => {
    expect(decideStartMark({ open: undefined, phase: 'idle' })).toBe('wait');
    expect(decideStartMark({ open: undefined, phase: 'cabo' })).toBe('wait');
  });

  it('sem atividade aberta leva a iniciar uma', () => {
    expect(decideStartMark({ open: null, phase: 'idle' })).toBe('need-activity');
  });

  it('com atividade aberta e mapa livre abre a escolha de tipo', () => {
    expect(decideStartMark({ open: activity, phase: 'idle' })).toBe('start');
  });

  it('com marcação ou lançamento em andamento só volta ao mapa, sem recomeçar nada', () => {
    for (const phase of ['tipo', 'posicao', 'mover', 'cabo', 'cabo-editar']) {
      expect(decideStartMark({ open: activity, phase })).toBe('resume');
      expect(decideStartMark({ open: null, phase })).toBe('resume');
    }
  });

  it('só troca de tela quando não está no mapa', () => {
    expect(needsMapNavigation('map')).toBe(false);
    expect(needsMapNavigation('atividades')).toBe(true);
    expect(needsMapNavigation('config')).toBe(true);
  });
});
