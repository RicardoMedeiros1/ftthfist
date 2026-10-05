import { describe, expect, it } from 'vitest';
import type { Cable } from '../../db/types';
import { nearestCableVertex } from './nearestVertex';

const cable = (id: string, vertices: { lat: number; lng: number }[], deleted = false): Cable => ({
  id, createdAt: 1, updatedAt: 1, createdBy: 'J', deleted, syncStatus: 'pending',
  cableType: 'AS-80', fiberCount: 12, vertices, lengthMeters: 0, reserveMeters: 0, totalMeters: 0, activityId: 'a', notes: '',
});

describe('nearestCableVertex', () => {
  const a = cable('a', [{ lat: -23.5, lng: -46.6 }, { lat: -23.501, lng: -46.6 }]);
  const b = cable('b', [{ lat: -23.5002, lng: -46.6 }, { lat: -23.52, lng: -46.6 }]);

  it('acha o vértice mais próximo entre todos os cabos', () => {
    // ~2,2 m do primeiro vértice de "b" e ~11 m do de "a"
    const r = nearestCableVertex({ lat: -23.5002, lng: -46.60002 }, [a, b], 15);
    expect(r?.cable.id).toBe('b');
    expect(r?.index).toBe(0);
    expect(r?.distance).toBeLessThan(5);
  });
  it('fora do alcance devolve null', () => {
    expect(nearestCableVertex({ lat: -23.6, lng: -46.7 }, [a, b], 15)).toBeNull();
    expect(nearestCableVertex({ lat: -23.5, lng: -46.6 }, [], 15)).toBeNull();
  });
  it('ignora cabos excluídos', () => {
    const gone = cable('gone', [{ lat: -23.5, lng: -46.6 }, { lat: -23.5, lng: -46.601 }], true);
    expect(nearestCableVertex({ lat: -23.5, lng: -46.6 }, [gone], 15)).toBeNull();
  });
});
