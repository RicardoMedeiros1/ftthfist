import { describe, expect, it } from 'vitest';
import type { Activity, Cable, NetworkElement, Photo } from '../../db/types';
import { overview } from './overview';

const base = { id: 'x', createdAt: 1, updatedAt: 1, createdBy: 'a', deleted: false, syncStatus: 'synced' as const };
const act = (over: Partial<Activity> = {}): Activity =>
  ({ ...base, id: crypto.randomUUID(), kind: 'implantacao', title: 'T', technician: 'Ana', startedAt: 1, status: 'aberta', description: '', materials: [], ...over }) as Activity;
const el = (over: Partial<NetworkElement> = {}): NetworkElement =>
  ({ ...base, id: crypto.randomUUID(), type: 'poste', lat: 0, lng: 0, positionSource: 'gps', code: '', notes: '', activityId: 'a', attrs: {}, ...over }) as NetworkElement;
const cable = (m: number, over: Partial<Cable> = {}): Cable =>
  ({ ...base, id: crypto.randomUUID(), cableType: 'AS-80', fiberCount: 12, vertices: [], lengthMeters: m, reserveMeters: 0, totalMeters: m, activityId: 'a', notes: '', ...over }) as Cable;
const photo = (over: Partial<Photo> = {}): Photo => ({ ...base, id: crypto.randomUUID(), takenAt: 1, activityId: 'a', ...over }) as Photo;

describe('overview', () => {
  it('rede vazia', () => {
    expect(overview({ activities: [], elements: [], cables: [], photos: [] })).toMatchObject({ technicians: 0, activities: 0, openActivities: 0, elements: 0, cables: 0, totalMeters: 0, photos: 0 });
  });

  it('conta atividades (abertas e total) e tecnicos distintos pelo dono da conta', () => {
    const o = overview({
      activities: [
        act({ ownerId: 'u1', technician: 'Ana' }),
        act({ ownerId: 'u1', technician: 'Ana', status: 'concluida' }),
        act({ ownerId: 'u2', technician: 'Bruno', status: 'concluida' }),
      ],
      elements: [],
      cables: [],
      photos: [],
    });
    expect(o).toMatchObject({ activities: 3, openActivities: 1, technicians: 2 });
  });

  it('o mesmo nome em contas diferentes sao duas pessoas; registro antigo sem dono conta pelo nome', () => {
    const o = overview({
      activities: [act({ ownerId: 'u1', technician: 'Ana' }), act({ ownerId: 'u2', technician: 'Ana' }), act({ technician: 'Zé' }), act({ technician: 'Zé' })],
      elements: [], cables: [], photos: [],
    });
    expect(o.technicians).toBe(3);
  });

  it('um nome de tecnico nunca se confunde com o id de uma conta', () => {
    const o = overview({ activities: [act({ ownerId: 'Ana', technician: 'X' }), act({ technician: 'Ana' })], elements: [], cables: [], photos: [] });
    expect(o.technicians).toBe(2);
  });

  it('nao conta o que foi excluido (atividade, elemento, cabo, foto)', () => {
    const o = overview({
      activities: [act({ ownerId: 'u1' }), act({ ownerId: 'u2', deleted: true })],
      elements: [el(), el({ deleted: true })],
      cables: [cable(100), cable(500, { deleted: true })],
      photos: [photo(), photo({ deleted: true })],
    });
    expect(o).toMatchObject({ technicians: 1, activities: 1, elements: 1, cables: 1, totalMeters: 100, photos: 1 });
  });

  it('soma os metros da rede inteira, de todos os tecnicos', () => {
    const o = overview({ activities: [], elements: [], cables: [cable(100.5), cable(200.25, { reserveMeters: 10, totalMeters: 210.25 })], photos: [] });
    expect(o).toMatchObject({ lengthMeters: 300.75, reserveMeters: 10, totalMeters: 310.75 });
  });
});
