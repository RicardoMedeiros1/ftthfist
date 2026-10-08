import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { touch } from '../../db/db';
import type { Cable } from '../../db/types';
import { setActingRole, setActingUser } from '../../lib/ownership';
import { fromRemote, toRemote } from './mapping';
import { Device, fieldWork } from './testDevice';
import { TestServer } from './testServer';

const E = '00000000-0000-4000-8000-0000000000e1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

const cable = (over: Partial<Cable> = {}): Cable => ({
  id: '00000000-0000-4000-8000-0000000000c1', createdAt: 1, updatedAt: 2, createdBy: 'Ana', deleted: false, syncStatus: 'pending',
  cableType: 'AS-80', fiberCount: 12, vertices: [{ lat: 1, lng: 2 }, { lat: 1, lng: 3 }], lengthMeters: 1, reserveMeters: 0, totalMeters: 1, activityId: 'a', notes: '',
  ...over,
});

describe('cabo: padrão de cores e ligações na sincronização', () => {
  it('cabo comum sobe sem as colunas novas (servidor sem a migration continua aceitando)', () => {
    const row = toRemote('cables', cable());
    expect('color_standard' in row).toBe(false);
    expect('links' in row).toBe(false);
  });
  it('com padrão e ligações, sobem traduzidos', () => {
    const row = toRemote('cables', cable({ colorStandard: 'tia598', links: [{ elementId: E, cableId: C2 }] }));
    expect(row).toMatchObject({ color_standard: 'tia598', links: [{ elementId: E, cableId: C2 }] });
  });
  it('ligações apagadas (lista vazia) sobem como lista vazia, para limpar o servidor', () => {
    expect(toRemote('cables', cable({ links: [] }))).toMatchObject({ links: [] });
  });
  it('descem de volta: padrão e ligações válidos entram; lixo é deixado de fora', () => {
    const base = toRemote('cables', cable());
    const down = fromRemote('cables', { ...base, owner_id: 'ana', server_updated_at: '2026-10-01T00:00:00Z', created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(), color_standard: 'tia598', links: [{ elementId: E, cableId: C2 }, { elementId: 'x' }] });
    expect(down.colorStandard).toBe('tia598');
    expect(down.links).toEqual([{ elementId: E, cableId: C2 }]);
  });
  it('linha do servidor sem padrão e com lista vazia: o cabo local não ganha os campos', () => {
    const base = toRemote('cables', cable());
    const down = fromRemote('cables', { ...base, owner_id: 'ana', server_updated_at: '2026-10-01T00:00:00Z', created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(), color_standard: null, links: [] });
    expect('colorStandard' in down).toBe(false);
    expect('links' in down).toBe(false);
    expect(fromRemote('cables', { ...base, owner_id: 'ana', server_updated_at: '2026-10-01T00:00:00Z', created_at: new Date(1).toISOString(), updated_at: new Date(2).toISOString(), color_standard: 'ABNT' }).colorStandard).toBeUndefined();
  });
});

// ---- ponta a ponta com o motor de sincronizacao e um servidor falso ----
describe('motor: padrão de cores e ligações viajam entre aparelhos', () => {
  let server: TestServer;
  let ana: Device;
  let bruno: Device;
  beforeEach(async () => {
    server = new TestServer();
    server.addUser('ana');
    server.addUser('bruno');
    ana = await new Device(server.client('ana'), 'ana').open();
    bruno = await new Device(server.client('bruno'), 'bruno').open();
  });
  afterEach(() => {
    setActingUser(null);
    setActingRole(null);
  });

  it('sobe com o cabo, desce no outro aparelho e mudar de volta limpa os dois', async () => {
    const { cable } = await fieldWork(ana);
    await ana.db.cables.update(cable.id, touch<Cable>({ colorStandard: 'tia598', links: [{ elementId: E, cableId: C2 }] }));
    await ana.sync();
    expect(server.get('cables', cable.id)).toMatchObject({ color_standard: 'tia598', links: [{ elementId: E, cableId: C2 }] });
    await bruno.sync();
    const there = await bruno.db.cables.get(cable.id);
    expect(there).toMatchObject({ colorStandard: 'tia598', links: [{ elementId: E, cableId: C2 }] });

    await ana.db.cables.update(cable.id, touch<Cable>({ links: [] }));
    await ana.sync();
    expect(server.get('cables', cable.id)!.links).toEqual([]);
    await bruno.sync();
    expect(await bruno.db.cables.get(cable.id)).not.toHaveProperty('links');
  });

  it('cabo comum não manda as colunas novas ao servidor', async () => {
    const { cable } = await fieldWork(ana);
    await ana.sync();
    const row = server.get('cables', cable.id)!;
    expect('color_standard' in row).toBe(false);
    expect('links' in row).toBe(false);
  });
});
