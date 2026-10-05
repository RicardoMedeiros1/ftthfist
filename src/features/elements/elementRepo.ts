import { db, newBase, type RotaFibraDB } from '../../db/db';
import type { ElementType, NetworkElement, PositionSource } from '../../db/types';
import { sanitizeAttrs } from './attrs';
import { isElementType } from './meta';

export type ElementRuleCode = 'NO_OPEN_ACTIVITY' | 'INVALID_POSITION' | 'INVALID_TYPE';

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

const validCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

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

    /** Grava um elemento na atividade aberta. `technician` vazio usa o técnico da atividade. */
    async create(input: NewElementInput, technician: string): Promise<NetworkElement> {
      if (!isElementType(input.type)) throw new ElementRuleError('INVALID_TYPE', 'Tipo de elemento inválido.');
      const gps = input.positionSource === 'gps';
      if (
        !validCoord(input.lat, input.lng) ||
        (gps && !(typeof input.accuracy === 'number' && Number.isFinite(input.accuracy) && input.accuracy >= 0))
      ) {
        throw new ElementRuleError('INVALID_POSITION', 'Posição inválida. Marque o ponto de novo.');
      }

      return database.transaction('rw', database.activities, database.elements, async () => {
        const open = await database.activities
          .where('status')
          .equals('aberta')
          .filter((a) => !a.deleted)
          .first();
        if (!open) {
          throw new ElementRuleError('NO_OPEN_ACTIVITY', 'Inicie uma atividade antes de marcar elementos.');
        }
        const element: NetworkElement = {
          ...newBase(technician.trim() || open.technician),
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
        return element;
      });
    },
  };
}

export const elementStore = elementRepo();
