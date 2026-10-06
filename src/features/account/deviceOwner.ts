import { SETTING_KEYS, db, type RotaFibraDB } from '../../db/db';
import { setActingUser } from '../../lib/ownership';

// Dono do aparelho = a primeira conta que o usou. Tudo o que foi registrado ANTES de existir conta
// (sem `ownerId`) passa a ser dessa pessoa. Depois disso, quem sai da conta continua agindo como o dono
// do aparelho, e outro tecnico que entre aqui enxerga os registros do primeiro como "de outro".

/** Alguem entrou (userId) ou saiu (null). Define quem esta agindo e, na primeira vez, adota os registros antigos. */
export async function applyIdentity(userId: string | null, database: RotaFibraDB = db): Promise<void> {
  const stored = ((await database.settings.get(SETTING_KEYS.deviceOwner))?.value as string | undefined) ?? null;
  if (userId && !stored) {
    await database.transaction(
      'rw',
      [database.activities, database.elements, database.cables, database.photos, database.trackPoints, database.settings],
      async () => {
        const adopt = { ownerId: userId };
        await database.activities.filter((r) => !r.ownerId).modify(adopt);
        await database.elements.filter((r) => !r.ownerId).modify(adopt);
        await database.cables.filter((r) => !r.ownerId).modify(adopt);
        await database.photos.filter((r) => !r.ownerId).modify(adopt);
        await database.trackPoints.filter((r) => !r.ownerId).modify(adopt);
        await database.settings.put({ key: SETTING_KEYS.deviceOwner, value: userId });
      },
    );
    setActingUser(userId);
    return;
  }
  setActingUser(userId ?? stored);
}
