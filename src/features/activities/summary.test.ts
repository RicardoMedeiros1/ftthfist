import { describe, expect, it } from 'vitest';
import type { Cable, NetworkElement, Photo } from '../../db/types';
import { activityBounds, summarizeActivity } from './summary';

const base = { id: 'x', createdAt: 1, updatedAt: 1, createdBy: 'a', deleted: false, syncStatus: 'synced' as const };
const el = (type: NetworkElement['type'], lat: number, lng: number, over: Partial<NetworkElement> = {}): NetworkElement =>
  ({ ...base, id: crypto.randomUUID(), type, lat, lng, positionSource: 'gps', code: '', notes: '', activityId: 'a1', attrs: {}, ...over }) as NetworkElement;
const cable = (vs: Array<[number, number]>, m: [number, number, number], over: Partial<Cable> = {}): Cable =>
  ({ ...base, id: crypto.randomUUID(), cableType: 'AS-80', fiberCount: 12, vertices: vs.map(([lat, lng]) => ({ lat, lng })), lengthMeters: m[0], reserveMeters: m[1], totalMeters: m[2], activityId: 'a1', notes: '', ...over }) as Cable;
const photo = (over: Partial<Photo> = {}): Photo => ({ ...base, id: crypto.randomUUID(), takenAt: 1, activityId: 'a1', ...over }) as Photo;

describe('summarizeActivity', () => {
  it('conta por tipo (na ordem padrão), soma os metros do cabo e ignora os excluídos', () => {
    const s = summarizeActivity(
      [el('poste', 0, 0), el('poste', 0, 0), el('cto', 0, 0), el('reserva', 0, 0), el('poste', 0, 0, { deleted: true })],
      [cable([[0, 0], [1, 1]], [100.25, 10, 110.25]), cable([[0, 0], [1, 1]], [50.1, 0, 50.1]), cable([[0, 0], [1, 1]], [999, 0, 999], { deleted: true })],
      [photo(), photo({ deleted: true })],
    );
    expect(s.byType).toEqual([{ type: 'poste', label: 'postes', count: 2 }, { type: 'cto', label: 'CTO', count: 1 }, { type: 'reserva', label: 'Reserva', count: 1 }]);
    expect(s).toMatchObject({ elements: 4, cables: 2, lengthMeters: 150.35, reserveMeters: 10, totalMeters: 160.35, photos: 1 });
  });

  it('atividade vazia', () => {
    expect(summarizeActivity([], [], [])).toEqual({ byType: [], elements: 0, cables: 0, lengthMeters: 0, reserveMeters: 0, totalMeters: 0, photos: 0 });
  });
});

describe('activityBounds', () => {
  it('caixa [sul, oeste, norte, leste] com elementos e vértices dos cabos', () => {
    const b = activityBounds([el('poste', -23.55, -46.63), el('cto', -23.56, -46.64)], [cable([[-23.5, -46.6], [-23.7, -46.7]], [1, 0, 1])]);
    expect(b).toEqual([-23.7, -46.7, -23.5, -46.6]);
  });

  it('ignora excluídos e coordenadas inválidas; sem pontos devolve null', () => {
    expect(activityBounds([el('poste', 1, 1, { deleted: true })], [cable([[2, 2], [3, 3]], [1, 0, 1], { deleted: true })])).toBeNull();
    expect(activityBounds([el('poste', Number.NaN, 1)], [])).toBeNull();
    expect(activityBounds([el('poste', 5, 6)], [])).toEqual([5, 6, 5, 6]);
  });
});
