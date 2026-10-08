import { SETTING_KEYS, db, getSetting, setSetting } from '../../db/db';
import type { ElementType, NetworkElement } from '../../db/types';
import { distanceMeters, formatMeters, nearestWithin, round2 } from '../../lib/geo';
import { classifyAccuracy } from '../../lib/geo';
import { canEdit } from '../../lib/ownership';
import { draftStore } from '../elements/draftStore';
import { elementStore } from '../elements/elementRepo';
import type { Map as LeafletMap, LatLng } from 'leaflet';
import { unlinkReserves } from './cableLinks';
import { cableStore } from './cableRepo';
import {
  activeCable,
  cableDraftStore,
  cableLengthMeters,
  cableReserveMeters,
  cablesToSave,
  lastVertex,
  type CableChoice,
  type CableDraft,
  type DraftCable,
} from './cableDraft';
import { gpsFeed } from './gpsFeed';
import { quickCapture } from './quickCapture';

/** Toque a até 25 px de um elemento gruda nele em vez de criar um ponto solto. */
export const SNAP_PX = 25;
/** Dois postes não ficam a menos disso: evita criar o mesmo poste duas vezes por toque duplo. */
export const MIN_POLE_SPACING_M = 3;

const technician = () => getSetting<string>(SETTING_KEYS.technician, '');

/** O que dá para marcar durante o lançamento. Poste é o comum; CEO e CTO valem para o próximo ponto só. */
export const MARK_TYPES = ['poste', 'ceo', 'cto'] as const;
export type MarkType = (typeof MARK_TYPES)[number];
const isMarkType = (t: ElementType | null): t is MarkType => (MARK_TYPES as readonly (ElementType | null)[]).includes(t);

/** O tipo do rascunho como tipo de ponto do lançamento (poste se não for um dos três). */
export const toMarkType = (t: ElementType | null): MarkType => (isMarkType(t) ? t : 'poste');

/** O tipo escolhido para o próximo ponto agora. */
export const markTypeNow = (): MarkType => toMarkType(draftStore.getState().type);

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

/**
 * Cria o ponto (poste, CEO ou CTO; posição do GPS ou ajustada) e o liga ao cabo ativo.
 * Depois de uma CEO ou CTO o próximo ponto volta a ser poste, que é o comum.
 */
export async function createPointAndLink(
  pos: { lat: number; lng: number; accuracy?: number; source: 'gps' | 'manual' },
  type: MarkType = markTypeNow(),
): Promise<void> {
  const el = await elementStore.create(
    { type, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, positionSource: pos.source },
    await technician(),
  );
  cableDraftStore.addVertex({ elementId: el.id, lat: el.lat, lng: el.lng }, el.id);
  draftStore.setMarkType('poste');
}

/** "Marcar … aqui e ligar": usa o GPS agora. Precisão acima de 15 m pede ajuste no mapa. */
export async function markPointHere(): Promise<MarkResult> {
  const d = cableDraftStore.getState();
  if (!d) return { ok: false, message: 'Nenhum cabo em lançamento.' };
  const fix = await quickCapture(gpsFeed);
  if (!fix) return { ok: false, message: 'Sem sinal de GPS agora. Tente de novo ou toque no mapa.' };

  const last = lastVertex(activeCable(d));
  if (last && distanceMeters(last, fix) < MIN_POLE_SPACING_M) {
    return { ok: false, message: 'Você está no mesmo ponto do último poste. Ande até o próximo e toque de novo.' };
  }
  if (classifyAccuracy(fix.accuracy) === 'ruim') {
    draftStore.setGpsBest(fix); // vira o marcador arrastável (satélite)
    return { ok: 'pending' };
  }
  await createPointAndLink({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, source: 'gps' });
  return { ok: true };
}

/** Confirma o ponto de precisão baixa (já ajustado ou não). */
export async function confirmPendingPoint(): Promise<void> {
  const p = draftStore.getState().position;
  if (!p) return;
  await createPointAndLink({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, source: p.source });
  draftStore.discardPosition();
}

// ---- ramais ----

export type BranchResult = { ok: true } | { ok: false; message: string };

/** Dá para derivar daqui? O último ponto do cabo ativo precisa ser um elemento (poste, CEO, CTO…), não um ponto solto. */
export function canBranchHere(): boolean {
  const d = cableDraftStore.getState();
  return d !== null && lastVertex(activeCable(d))?.elementId !== undefined;
}

export const BRANCH_FROM_MESSAGE = 'Derive de um poste, CEO ou CTO. Marque o ponto primeiro (toque num ponto solto não serve).';

/** Deriva um ramal do último ponto (precisa ser um elemento já marcado) e guarda a escolha para a próxima derivação. */
export async function branchHere(choice: CableChoice): Promise<BranchResult> {
  if (!cableDraftStore.branch(choice)) {
    return { ok: false, message: BRANCH_FROM_MESSAGE };
  }
  await setSetting(SETTING_KEYS.lastBranch, { cableType: choice.cableType, fiberCount: choice.fiberCount });
  return { ok: true };
}

/** Termina o ramal e volta ao cabo de onde ele saiu. */
export function endBranchHere(): BranchResult {
  if (!cableDraftStore.endBranch()) return { ok: false, message: 'Marque ao menos um ponto do ramal antes de terminar.' };
  return { ok: true };
}

// ---- reservas ----

/** Reserva no último ponto lançado, ligada ao cabo ativo. */
export async function addReserveHere(meters: number): Promise<{ ok: boolean; message?: string }> {
  const d = cableDraftStore.getState();
  const cable = d ? activeCable(d) : null;
  const last = cable ? lastVertex(cable) : undefined;
  if (!d || !cable || !last) return { ok: false, message: 'Marque ao menos um ponto antes de registrar a reserva.' };
  if (!(meters > 0) || !Number.isFinite(meters)) return { ok: false, message: 'Informe os metros da reserva.' };
  const el = await elementStore.create(
    { type: 'reserva', lat: last.lat, lng: last.lng, positionSource: 'manual', attrs: { meters, cableId: cable.cableId } },
    await technician(),
  );
  cableDraftStore.addReserve(el.id, meters);
  return { ok: true };
}

// ---- desfazer / finalizar / descartar ----

/** Desfaz a última ação. Elemento ou reserva criados por ela saem do mapa (exclusão lógica); elementos que já existiam ficam. */
export async function undoLast(): Promise<void> {
  const a = cableDraftStore.undo();
  if (!a) return;
  const created = a.kind === 'reserve' ? a.elementId : a.kind === 'vertex' ? a.createdElementId : undefined;
  if (created) await elementStore.remove(created).catch(() => undefined);
}

export interface CableSummaryItem {
  cable: DraftCable;
  length: number;
  reserves: number;
  total: number;
}

/** O que será salvo: cada cabo com a sua metragem, e a soma de todos. */
export function summaryOf(d: CableDraft) {
  const items: CableSummaryItem[] = cablesToSave(d).map((cable) => {
    const length = cableLengthMeters(cable);
    const reserves = cableReserveMeters(d, cable.cableId);
    return { cable, length, reserves, total: round2(length + reserves) };
  });
  const length = round2(items.reduce((sum, i) => sum + i.length, 0));
  const reserves = round2(items.reduce((sum, i) => sum + i.reserves, 0));
  return { items, length, reserves, total: round2(length + reserves) };
}

/** Fibra de entrada de uma CTO, escolhida no resumo: o cabo (do lançamento) e a fibra dele. */
export interface CtoFeedPick {
  elementId: string;
  cableId: string;
  fiber: number;
}

/**
 * Salva tudo o que foi lançado (o tronco e os ramais) de uma vez, já ligado: cada ramal é ligado ao cabo de onde saiu, no
 * elemento da derivação. `feeds` grava, nas CTOs onde um cabo termina, a fibra que elas pegaram. Tudo ou nada.
 */
export async function finishCable(notes: string, feeds: readonly CtoFeedPick[] = []): Promise<string> {
  const d = cableDraftStore.getState();
  if (!d) throw new Error('Nenhum cabo em lançamento.');
  const toSave = cablesToSave(d);
  const savedIds = new Set(toSave.map((c) => c.cableId));
  const inputs = toSave.map((c, i) => ({
    id: c.cableId,
    cableType: c.cableType,
    fiberCount: c.fiberCount,
    ...(c.colorStandard ? { colorStandard: c.colorStandard } : {}),
    vertices: c.vertices,
    // as observações valem para o lançamento todo: ficam no primeiro cabo
    notes: i === 0 ? notes : '',
    // o ramal se liga ao cabo de onde saiu, no elemento da derivação (o primeiro ponto dele)
    ...(c.parentId && savedIds.has(c.parentId) && c.vertices[0]?.elementId
      ? { links: [{ elementId: c.vertices[0].elementId, cableId: c.parentId }] }
      : {}),
  }));

  const who = await technician();
  const cables = await db.transaction('rw', db.activities, db.elements, db.cables, async () => {
    const saved = await cableStore.createMany(inputs, who);
    for (const f of feeds) {
      const cable = saved.find((c) => c.id === f.cableId);
      const el = await db.elements.get(f.elementId);
      if (!cable || !el || el.deleted || el.type !== 'cto' || !canEdit(el)) continue;
      if (!Number.isInteger(f.fiber) || f.fiber < 1 || f.fiber > cable.fiberCount) continue;
      await elementStore.update(el.id, { attrs: { ...(el.attrs as object), feedCableId: cable.id, feedFiber: f.fiber } });
    }
    return saved;
  });

  const trunk = toSave[0]!;
  await setSetting(SETTING_KEYS.lastCable, { cableType: trunk.cableType, fiberCount: trunk.fiberCount });
  cableDraftStore.clear();
  const total = round2(cables.reduce((sum, c) => sum + c.totalMeters, 0));
  const msg = cables.length === 1 ? `Cabo salvo: ${formatMeters(total)}` : `${cables.length} cabos salvos: ${formatMeters(total)}`;
  draftStore.saved(msg);
  return msg;
}

/** Descarta o lançamento. Elementos e reservas já marcados continuam no mapa (reservas ficam sem cabo). */
export async function discardCable(): Promise<void> {
  const d = cableDraftStore.getState();
  if (d) {
    await db.transaction('rw', db.elements, db.cables, async () => {
      for (const c of d.cables) await unlinkReserves(db, c.cableId);
    });
  }
  cableDraftStore.clear();
  draftStore.cancel();
}
