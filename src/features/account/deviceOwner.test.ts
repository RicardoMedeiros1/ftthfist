import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotaFibraDB, SETTING_KEYS } from '../../db/db';
import { actingUserId, setActingUser } from '../../lib/ownership';
import { activityRepo } from '../activities/activityRepo';
import { elementRepo } from '../elements/elementRepo';
import { applyIdentity } from './deviceOwner';

let db: RotaFibraDB;
beforeEach(async () => {
  db = new RotaFibraDB(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(() => setActingUser(null));

async function legacyData() {
  const a = await activityRepo(db).create({ kind: 'implantacao', title: 'Antes da conta' }, 'Carlos');
  const e = await elementRepo(db).create({ type: 'poste', lat: -23.55, lng: -46.63, accuracy: 4, positionSource: 'gps' }, 'Carlos');
  return { a, e };
}

describe('applyIdentity', () => {
  it('registros feitos sem conta não têm dono', async () => {
    const { a, e } = await legacyData();
    expect(a.ownerId).toBeUndefined();
    expect(e.ownerId).toBeUndefined();
  });

  it('a primeira conta adota os registros antigos e vira dona do aparelho', async () => {
    const { a, e } = await legacyData();
    await applyIdentity('ana', db);
    expect((await db.activities.get(a.id))?.ownerId).toBe('ana');
    expect((await db.elements.get(e.id))?.ownerId).toBe('ana');
    expect((await db.settings.get(SETTING_KEYS.deviceOwner))?.value).toBe('ana');
    expect(actingUserId()).toBe('ana');
  });

  it('a adoção não mexe em updatedAt nem em syncStatus (nada vira "alterado" à toa)', async () => {
    const { a } = await legacyData();
    await db.activities.update(a.id, { syncStatus: 'synced' });
    await applyIdentity('ana', db);
    const after = await db.activities.get(a.id);
    expect(after?.updatedAt).toBe(a.updatedAt);
    expect(after?.syncStatus).toBe('synced');
  });

  it('um segundo técnico no mesmo aparelho NÃO adota nada: os registros do primeiro seguem dele', async () => {
    const { a } = await legacyData();
    await applyIdentity('ana', db);
    await applyIdentity('bia', db);
    expect((await db.activities.get(a.id))?.ownerId).toBe('ana');
    expect(actingUserId()).toBe('bia');
  });

  it('ao sair da conta, quem age volta a ser o dono do aparelho', async () => {
    await applyIdentity('ana', db);
    await applyIdentity('bia', db);
    await applyIdentity(null, db);
    expect(actingUserId()).toBe('ana');
  });

  it('sem conta nem dono do aparelho, ninguém está agindo (tudo é meu)', async () => {
    await applyIdentity(null, db);
    expect(actingUserId()).toBeNull();
  });

  it('o que se registra depois da conta nasce com o dono certo, inclusive depois de sair', async () => {
    await applyIdentity('ana', db);
    const a1 = await activityRepo(db).create({ kind: 'manutencao', title: 'Logada' }, 'Ana');
    expect(a1.ownerId).toBe('ana');
    await activityRepo(db).complete(a1.id);
    await applyIdentity(null, db); // saiu da conta, continua usando o app
    const a2 = await activityRepo(db).create({ kind: 'manutencao', title: 'Sem login' }, 'Ana');
    expect(a2.ownerId).toBe('ana');
  });
});
