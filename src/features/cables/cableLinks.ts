import type { RotaFibraDB } from '../../db/db';
import { touch } from '../../db/db';
import type { Cable, CableVertex, NetworkElement, PositionSource } from '../../db/types';
import { pathLengthMeters, round2 } from '../../lib/geo';
import { canEdit } from '../../lib/ownership';

// Regras que ligam cabos e elementos. As funções abaixo NÃO abrem transação: quem chama
// precisa estar dentro de uma transação 'rw' que inclua as tabelas `elements` e `cables`.

type Tables = Pick<RotaFibraDB, 'elements' | 'cables'>;

/** Soma dos metros das reservas (não excluídas) ligadas ao cabo. */
async function linkedReserveMeters(database: Tables, cableId: string): Promise<number> {
  let sum = 0;
  await database.elements
    .where('type')
    .equals('reserva')
    .filter((e) => !e.deleted && (e.attrs as { cableId?: string }).cableId === cableId)
    .each((e) => {
      sum += (e.attrs as { meters?: number }).meters ?? 0;
    });
  return sum;
}

export function totalsFor(vertices: CableVertex[], reserveMeters: number) {
  const lengthMeters = round2(pathLengthMeters(vertices));
  const reserve = round2(reserveMeters);
  return { lengthMeters, reserveMeters: reserve, totalMeters: round2(lengthMeters + reserve) };
}

/** Recalcula traçado, reservas e total do cabo e grava se algo mudou. Não faz nada se o cabo não existe/foi excluído. */
export async function recomputeCable(database: Tables, cableId: string): Promise<void> {
  const cable = await database.cables.get(cableId);
  if (!cable || cable.deleted || !canEdit(cable)) return; // cabo de outro técnico: só ele (ou o administrador) recalcula
  const t = totalsFor(cable.vertices, await linkedReserveMeters(database, cableId));
  if (t.lengthMeters === cable.lengthMeters && t.reserveMeters === cable.reserveMeters && t.totalMeters === cable.totalMeters) return;
  await database.cables.update(cableId, touch<Cable>(t));
}

/** Cabos que EU posso alterar (meus; todos, se eu for administrador), não excluídos, que passam por este elemento. */
export function cablesThrough(database: Tables, elementId: string): Promise<Cable[]> {
  return database.cables.filter((c) => !c.deleted && canEdit(c) && c.vertices.some((v) => v.elementId === elementId)).toArray();
}

/** Move o elemento e leva junto o vértice de todos os cabos que passam por ele. Posição manual não guarda precisão. */
export async function moveElementWithCables(
  database: Tables,
  id: string,
  pos: { lat: number; lng: number; positionSource: PositionSource; accuracy?: number },
): Promise<void> {
  await database.elements.update(
    id,
    touch<NetworkElement>({
      lat: pos.lat,
      lng: pos.lng,
      positionSource: pos.positionSource,
      // `undefined` remove o campo no Dexie.
      accuracy: pos.positionSource === 'gps' ? pos.accuracy : undefined,
    }),
  );
  for (const c of await cablesThrough(database, id)) {
    const vertices = c.vertices.map((v) => (v.elementId === id ? { ...v, lat: pos.lat, lng: pos.lng } : v));
    await database.cables.update(c.id, touch<Cable>({ vertices }));
    await recomputeCable(database, c.id);
  }
}

/** O elemento deixou de existir: os vértices dele ficam no lugar, como pontos soltos. */
export async function detachElementFromCables(database: Tables, id: string): Promise<void> {
  for (const c of await cablesThrough(database, id)) {
    const vertices = c.vertices.map((v) => (v.elementId === id ? { lat: v.lat, lng: v.lng } : v));
    await database.cables.update(c.id, touch<Cable>({ vertices }));
  }
}

/** Reservas ligadas ao cabo passam a não ter cabo (o cabo foi excluído ou descartado). */
export async function unlinkReserves(database: Tables, cableId: string): Promise<void> {
  const now = Date.now();
  await database.elements
    .where('type')
    .equals('reserva')
    .filter((e) => canEdit(e) && (e.attrs as { cableId?: string }).cableId === cableId)
    .modify((e) => {
      const { cableId: _drop, ...rest } = e.attrs as Record<string, unknown>;
      e.attrs = rest as NetworkElement['attrs'];
      e.updatedAt = now;
      e.syncStatus = 'pending';
    });
}
