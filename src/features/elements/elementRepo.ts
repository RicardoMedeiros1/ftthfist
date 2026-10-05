import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { ElementType, NetworkElement, Photo, PositionSource } from '../../db/types';
import { sanitizeAttrs } from './attrs';
import { isElementType } from './meta';
import { buildPhoto, type NewPhotoInput } from './photoRepo';

export type ElementRuleCode = 'NO_OPEN_ACTIVITY' | 'INVALID_POSITION' | 'INVALID_TYPE' | 'NOT_FOUND';

export class ElementRuleError extends Error {
  constructor(
    readonly code: ElementRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'ElementRuleError';
  }
}

export interface NewElementInput {
  type: ElementType;
  lat: number;
  lng: number;
  /** Metros. Obrigatório quando a posição veio do GPS; ignorado quando é manual. */
  accuracy?: number;
  positionSource: PositionSource;
  code?: string;
  notes?: string;
  attrs?: unknown;
}

export interface NewPositionInput {
  lat: number;
  lng: number;
  accuracy?: number;
  positionSource: PositionSource;
}

export interface ElementPatch {
  code?: string;
  notes?: string;
  attrs?: unknown;
}

const validCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Posição do GPS exige precisão; coordenadas precisam estar dentro do mundo. */
function assertPosition(p: NewPositionInput) {
  const gps = p.positionSource === 'gps';
  if (
    !validCoord(p.lat, p.lng) ||
    (gps && !(typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) && p.accuracy >= 0))
  ) {
    throw new ElementRuleError('INVALID_POSITION', 'Posição inválida. Marque o ponto de novo.');
  }
}

export function elementRepo(database: RotaFibraDB = db) {
  return {
    /** Elementos não excluídos, de todas as atividades. */
    async list(): Promise<NetworkElement[]> {
      return database.elements.filter((e) => !e.deleted).toArray();
    },

    async get(id: string): Promise<NetworkElement | undefined> {
      const e = await database.elements.get(id);
      return e && !e.deleted ? e : undefined;
    },

    /**
     * Grava um elemento na atividade aberta, junto com as fotos já tiradas (tudo ou nada).
     * `technician` vazio usa o técnico da atividade.
     */
    async create(input: NewElementInput, technician: string, photos: NewPhotoInput[] = []): Promise<NetworkElement> {
      if (!isElementType(input.type)) throw new ElementRuleError('INVALID_TYPE', 'Tipo de elemento inválido.');
      assertPosition(input);
      const gps = input.positionSource === 'gps';

      return database.transaction('rw', database.activities, database.elements, database.photos, async () => {
        const open = await database.activities
          .where('status')
          .equals('aberta')
          .filter((a) => !a.deleted)
          .first();
        if (!open) {
          throw new ElementRuleError('NO_OPEN_ACTIVITY', 'Inicie uma atividade antes de marcar elementos.');
        }
        const createdBy = technician.trim() || open.technician;
        const element: NetworkElement = {
          ...newBase(createdBy),
          type: input.type,
          lat: input.lat,
          lng: input.lng,
          ...(gps ? { accuracy: input.accuracy } : {}),
          positionSource: input.positionSource,
          code: input.code?.trim() ?? '',
          notes: input.notes?.trim() ?? '',
          activityId: open.id,
          attrs: sanitizeAttrs(input.type, input.attrs),
        };
        await database.elements.add(element);
        if (photos.length > 0) {
          const records: Photo[] = photos.map((p) => buildPhoto(element, p, createdBy));
          await database.photos.bulkAdd(records);
        }
        return element;
      });
    },

    /** Edita identificação, observações e atributos. O tipo e a atividade não mudam. */
    async update(id: string, patch: ElementPatch): Promise<NetworkElement> {
      return database.transaction('rw', database.elements, async () => {
        const el = await database.elements.get(id);
        if (!el || el.deleted) throw new ElementRuleError('NOT_FOUND', 'Elemento não encontrado.');
        const changes: Partial<NetworkElement> = {};
        if (patch.code !== undefined) changes.code = patch.code.trim();
        if (patch.notes !== undefined) changes.notes = patch.notes.trim();
        if (patch.attrs !== undefined) changes.attrs = sanitizeAttrs(el.type, patch.attrs);
        await database.elements.update(id, touch<NetworkElement>(changes));
        return (await database.elements.get(id)) as NetworkElement;
      });
    },

    /** Muda a posição. Posição manual não guarda precisão (ela só descreve uma leitura de GPS). */
    async move(id: string, pos: NewPositionInput): Promise<NetworkElement> {
      assertPosition(pos);
      return database.transaction('rw', database.elements, async () => {
        const el = await database.elements.get(id);
        if (!el || el.deleted) throw new ElementRuleError('NOT_FOUND', 'Elemento não encontrado.');
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
        return (await database.elements.get(id)) as NetworkElement;
      });
    },

    /** Exclusão lógica do elemento e das fotos dele. */
    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.elements, database.photos, async () => {
        const el = await database.elements.get(id);
        if (!el || el.deleted) throw new ElementRuleError('NOT_FOUND', 'Elemento não encontrado.');
        const now = Date.now();
        await database.elements.update(id, touch<NetworkElement>({ deleted: true }, now));
        await database.photos
          .where('elementId')
          .equals(id)
          .modify((p) => {
            p.deleted = true;
            p.updatedAt = now;
            p.syncStatus = 'pending';
          });
      });
    },
  };
}

export const elementStore = elementRepo();
