import { SETTING_KEYS, db, getSetting, setSetting } from '../../db/db';
import type { NetworkElement } from '../../db/types';
import { distanceMeters, formatMeters, nearestWithin } from '../../lib/geo';
import { classifyAccuracy } from '../../lib/geo';
import { draftStore } from '../elements/draftStore';
import { elementStore } from '../elements/elementRepo';
import type { Map as LeafletMap, LatLng } from 'leaflet';
import { unlinkReserves } from './cableLinks';
import { cableStore } from './cableRepo';
import {
  cableDraftStore,
  draftLengthMeters,
  draftReserveMeters,
  type CableDraft,
} from './cableDraft';
import { gpsFeed } from './gpsFeed';
import { quickCapture } from './quickCapture';

/** Toque a até 25 px de um elemento gruda nele em vez de criar um ponto solto. */
export const SNAP_PX = 25;
/** Dois postes não ficam a menos disso: evita criar o mesmo poste duas vezes por toque duplo. */
export const MIN_POLE_SPACING_M = 3;

const technician = () => getSetting<string>(SETTING_KEYS.technician, '');

// ---- pontos do traçado ----

/** Toque no mapa durante o lançamento: gruda no elemento mais próximo (≤ 25 px) ou cria um ponto solto. */
export async function addVertexAtMapPoint(map: LeafletMap, at: LatLng): Promise<void> {
  const target = map.latLngToContainerPoint(at);
  const items = (await elementStore.list()).map((e) => {
    const p = map.latLngToContainerPoint([e.lat, e.lng]);
    return { x: p.x, y: p.y, e };
  });
  const near = nearestWithin(target, items, SNAP_PX);
  if (near) addElementVertex(near.e);
  else cableDraftStore.addVertex({ lat: at.lat, lng: at.lng });
}

/** Toque direto no ícone de um elemento. */
export function addElementVertex(e: Pick<NetworkElement, 'id' | 'lat' | 'lng'>): void {
  cableDraftStore.addVertex({ elementId: e.id, lat: e.lat, lng: e.lng });
}

export type MarkResult =
  | { ok: true }
  | { ok: false; message: string }
  | { ok: 'pending' }; // precisão ruim: o técnico ajusta o ponto antes de confirmar

/** Cria o poste (posição do GPS ou ajustada) e o liga ao cabo. */
export async function createPoleAndLink(pos: {
  lat: number;
  lng: number;
  accuracy?: number;
  source: 'gps' | 'manual';
}): Promise<void> {
  const el = await elementStore.create(
    { type: 'poste', lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, positionSource: pos.source },
    await technician(),
  );
  cableDraftStore.addVertex({ elementId: el.id, lat: el.lat, lng: el.lng }, el.id);
}

/** "Marcar poste aqui e ligar": usa o GPS agora. Precisão acima de 15 m pede ajuste no mapa. */
export async function markPoleHere(): Promise<MarkResult> {
  const d = cableDraftStore.getState();
  if (!d) return { ok: false, message: 'Nenhum cabo em lançamento.' };
  const fix = await quickCapture(gpsFeed);
  if (!fix) return { ok: false, message: 'Sem sinal de GPS agora. Tente de novo ou toque no mapa.' };

  const last = d.vertices[d.vertices.length - 1];
  if (last && distanceMeters(last, fix) < MIN_POLE_SPACING_M) {
    return { ok: false, message: 'Você está no mesmo ponto do último poste. Ande até o próximo e toque de novo.' };
  }
  if (classifyAccuracy(fix.accuracy) === 'ruim') {
    draftStore.setGpsBest(fix); // vira o marcador arrastável (satélite)
    return { ok: 'pending' };
  }
  await createPoleAndLink({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, source: 'gps' });
  return { ok: true };
}

/** Confirma o ponto de precisão baixa (já ajustado ou não). */
export async function confirmPendingPole(): Promise<void> {
  const p = draftStore.getState().position;
  if (!p) return;
  await createPoleAndLink({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: p.source });
  draftStore.discardPosition();
}

// ---- reservas ----

/** Reserva no último ponto lançado, ligada a este cabo. */
export async function addReserveHere(meters: number): Promise<{ ok: boolean; message?: string }> {
  const d = cableDraftStore.getState();
  const last = d?.vertices[d.vertices.length - 1];
  if (!d || !last) return { ok: false, message: 'Marque ao menos um ponto antes de registrar a reserva.' };
  if (!(meters > 0) || !Number.isFinite(meters)) return { ok: false, message: 'Informe os metros da reserva.' };
  const el = await elementStore.create(
    { type: 'reserva', lat: last.lat, lng: last.lng, positionSource: 'manual', attrs: { meters, cableId: d.cableId } },
    await technician(),
  );
  cableDraftStore.addReserve(el.id, meters);
  return { ok: true };
}

// ---- desfazer / finalizar / descartar ----

/** Desfaz a última ação. Poste ou reserva criados por ela saem do mapa (exclusão lógica); elementos que já existiam ficam. */
export async function undoLast(): Promise<void> {
  const a = cableDraftStore.undo();
  if (!a) return;
  const created = a.kind === 'reserve' ? a.elementId : a.createdElementId;
  if (created) await elementStore.remove(created).catch(() => undefined);
}

export function summaryOf(d: CableDraft) {
  const length = draftLengthMeters(d);
  const reserves = draftReserveMeters(d);
  return { length, reserves, total: Math.round((length + reserves) * 100) / 100 };
}

/** Salva o cabo e encerra o lançamento. */
export async function finishCable(notes: string): Promise<string> {
  const d = cableDraftStore.getState();
  if (!d) throw new Error('Nenhum cabo em lançamento.');
  const cable = await cableStore.create(
    { id: d.cableId, cableType: d.cableType, fiberCount: d.fiberCount, ...(d.colorStandard ? { colorStandard: d.colorStandard } : {}), vertices: d.vertices, notes },
    await technician(),
  );
  await setSetting(SETTING_KEYS.lastCable, { cableType: d.cableType, fiberCount: d.fiberCount });
  cableDraftStore.clear();
  const msg = `Cabo salvo: ${formatMeters(cable.totalMeters)}`;
  draftStore.saved(msg);
  return msg;
}

/** Descarta o lançamento. Postes e reservas já marcados continuam no mapa (reservas ficam sem cabo). */
export async function discardCable(): Promise<void> {
  const d = cableDraftStore.getState();
  if (d) {
    await db.transaction('rw', db.elements, db.cables, () => unlinkReserves(db, d.cableId));
  }
  cableDraftStore.clear();
  draftStore.cancel();
}
