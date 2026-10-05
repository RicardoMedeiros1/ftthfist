import { describe, expect, it } from 'vitest';
import type { Cable } from '../../db/types';
import { cableChoicesNear, cableLabel } from './cableChoices';

const cable = (id: string, vertices: { lat: number; lng: number }[], over: Partial<Cable> = {}): Cable => ({
  id, createdAt: 1, updatedAt: 1, createdBy: 'J', deleted: false, syncStatus: 'pending',
  cableType: 'AS-80', fiberCount: 12, vertices, lengthMeters: 100, reserveMeters: 0, totalMeters: 128.4, activityId: 'a', notes: '', ...over,
});

describe('cableChoicesNear', () => {
  const perto = cable('perto', [{ lat: -23.5, lng: -46.6 }, { lat: -23.501, lng: -46.6 }]);
  const maisPerto = cable('mais-perto', [{ lat: -23.50001, lng: -46.6 }, { lat: -23.52, lng: -46.6 }]);
  const longe = cable('longe', [{ lat: -23.6, lng: -46.7 }, { lat: -23.61, lng: -46.7 }], { cableType: 'drop', fiberCount: 2 });
  const here = { lat: -23.5, lng: -46.6 };

  it('só os cabos com vértice dentro do alcance, do mais próximo ao mais distante', () => {
    expect(cableChoicesNear(here, [perto, longe, maisPerto]).map((c) => c.id)).toEqual(['perto', 'mais-perto']);
  });
  it('cabo atual continua na lista mesmo longe (para não perder a ligação ao editar)', () => {
    expect(cableChoicesNear(here, [longe], 15, 'longe').map((c) => c.id)).toEqual(['longe']);
    expect(cableChoicesNear(here, [longe], 15)).toEqual([]);
  });
  it('ignora cabos excluídos', () => {
    expect(cableChoicesNear(here, [cable('x', [{ lat: -23.5, lng: -46.6 }, { lat: -23.5, lng: -46.601 }], { deleted: true })])).toEqual([]);
  });
  it('rótulo legível', () => {
    expect(cableLabel(perto)).toBe('AS-80 · 12 fibras · 128,4 m');
  });
});
