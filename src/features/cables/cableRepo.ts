import { db, newBase, touch, type RotaFibraDB } from '../../db/db';
import type { Cable, CableVertex, FiberCount } from '../../db/types';
import { round2 } from '../../lib/geo';
import { isMine, notMineMessage } from '../../lib/ownership';
import { moveElementWithCables, recomputeCable, totalsFor, unlinkReserves } from './cableLinks';
import { isFiberCount } from './style';

export type CableRuleCode =
  | 'NO_OPEN_ACTIVITY'
  | 'TOO_FEW_VERTICES'
  | 'MIN_VERTICES'
  | 'INVALID_POSITION'
  | 'INVALID_FIBERS'
  | 'INVALID_TYPE'
  | 'NOT_FOUND'
  | 'NOT_OWNER';

export class CableRuleError extends Error {
  constructor(
    readonly code: CableRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'CableRuleError';
  }
}

export interface NewCableInput {
  /** Permite criar o cabo com o id que as reservas já usam no `cableId` (o cabo é salvo só ao finalizar). */
  id?: string;
  cableType: string;
  fiberCount: number;
  vertices: CableVertex[];
  notes?: string;
}

export interface CablePatch {
  cableType?: string;
  fiberCount?: number;
  notes?: string;
}

const validCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const invalidPosition = () => new CableRuleError('INVALID_POSITION', 'Posição inválida. Marque o ponto de novo.');
const notFound = () => new CableRuleError('NOT_FOUND', 'Cabo não encontrado.');

function checkType(t: string): string {
  const v = t.trim();
  if (!v) throw new CableRuleError('INVALID_TYPE', 'Escolha o tipo do cabo.');
  return v;
}
function checkFibers(n: number): FiberCount {
  if (!isFiberCount(n)) throw new CableRuleError('INVALID_FIBERS', 'Número de fibras inválido.');
  return n;
}

export function cableRepo(database: RotaFibraDB = db) {
  /** O vértice ligado a um elemento sempre usa a posição do elemento; se ele não existe mais, vira ponto solto. */
  async function canonicalVertex(v: CableVertex): Promise<CableVertex> {
    if (!validCoord(v.lat, v.lng)) throw invalidPosition();
    if (v.elementId) {
      const el = await database.elements.get(v.elementId);
      if (el && !el.deleted) return { elementId: el.id, lat: el.lat, lng: el.lng };
    }
    return { lat: v.lat, lng: v.lng };
  }

  /** O cabo que vai ser alterado: precisa existir e ser meu. */
  async function mustGet(id: string): Promise<Cable> {
    const c = await database.cables.get(id);
    if (!c || c.deleted) throw notFound();
    if (!isMine(c)) throw new CableRuleError('NOT_OWNER', notMineMessage('cabo'));
    return c;
  }

  async function saveVertices(c: Cable, vertices: CableVertex[]): Promise<Cable> {
    await database.cables.update(c.id, touch<Cable>({ vertices }));
    await recomputeCable(database, c.id);
    return (await database.cables.get(c.id)) as Cable;
  }

  return {
    /** Cabos não excluídos, de todas as atividades. */
    list: (): Promise<Cable[]> => database.cables.filter((c) => !c.deleted).toArray(),

    async get(id: string): Promise<Cable | undefined> {
      const c = await database.cables.get(id);
      return c && !c.deleted ? c : undefined;
    },

    /** Grava o cabo na atividade aberta. `technician` vazio usa o técnico da atividade. */
    async create(input: NewCableInput, technician: string): Promise<Cable> {
      const cableType = checkType(input.cableType);
      const fiberCount = checkFibers(input.fiberCount);
      if (input.vertices.length < 2) {
        throw new CableRuleError('TOO_FEW_VERTICES', 'Um cabo precisa de pelo menos 2 pontos.');
      }

      return database.transaction('rw', database.activities, database.elements, database.cables, async () => {
        const open = await database.activities
          .where('status')
          .equals('aberta')
          .filter((a) => !a.deleted && isMine(a))
          .first();
        if (!open) throw new CableRuleError('NO_OPEN_ACTIVITY', 'Inicie uma atividade antes de lançar um cabo.');

        const vertices: CableVertex[] = [];
        for (const v of input.vertices) vertices.push(await canonicalVertex(v));
        const base = newBase(technician.trim() || open.technician);
        const cable: Cable = {
          ...base,
          ...(input.id ? { id: input.id } : {}),
          cableType,
          fiberCount,
          vertices,
          ...totalsFor(vertices, 0),
          activityId: open.id,
          notes: input.notes?.trim() ?? '',
        };
        await database.cables.add(cable);
        // Reservas que já apontam para este cabo (criadas durante o lançamento) entram no total.
        await recomputeCable(database, cable.id);
        return (await database.cables.get(cable.id)) as Cable;
      });
    },

    async update(id: string, patch: CablePatch): Promise<Cable> {
      return database.transaction('rw', database.cables, async () => {
        const c = await mustGet(id);
        const changes: Partial<Cable> = {};
        if (patch.cableType !== undefined) changes.cableType = checkType(patch.cableType);
        if (patch.fiberCount !== undefined) changes.fiberCount = checkFibers(patch.fiberCount);
        if (patch.notes !== undefined) changes.notes = patch.notes.trim();
        await database.cables.update(c.id, touch<Cable>(changes));
        return (await database.cables.get(id)) as Cable;
      });
    },

    /** Move um ponto do traçado. Se o ponto é um elemento, é o elemento que se move (e todos os cabos que passam por ele). */
    async moveVertex(id: string, index: number, pos: { lat: number; lng: number }): Promise<Cable> {
      if (!validCoord(pos.lat, pos.lng)) throw invalidPosition();
      return database.transaction('rw', database.elements, database.cables, async () => {
        const c = await mustGet(id);
        const v = c.vertices[index];
        if (!v) throw new CableRuleError('NOT_FOUND', 'Ponto não encontrado.');
        if (v.elementId) {
          const el = await database.elements.get(v.elementId);
          if (el && !el.deleted) {
            if (!isMine(el)) throw new CableRuleError('NOT_OWNER', notMineMessage('elemento'));
            await moveElementWithCables(database, el.id, { ...pos, positionSource: 'manual' });
            return (await database.cables.get(id)) as Cable;
          }
        }
        return saveVertices(c, c.vertices.map((x, i) => (i === index ? { lat: pos.lat, lng: pos.lng } : x)));
      });
    },

    /** Insere um ponto entre `afterIndex` e o seguinte. Com `elementId`, usa a posição do elemento. */
    async insertVertex(id: string, afterIndex: number, v: CableVertex): Promise<Cable> {
      return database.transaction('rw', database.elements, database.cables, async () => {
        const c = await mustGet(id);
        if (!Number.isInteger(afterIndex) || afterIndex < 0 || afterIndex >= c.vertices.length - 1) {
          throw new CableRuleError('NOT_FOUND', 'Trecho não encontrado.');
        }
        const next = [...c.vertices];
        next.splice(afterIndex + 1, 0, await canonicalVertex(v));
        return saveVertices(c, next);
      });
    },

    /** Remove um ponto do traçado (o elemento, se houver, continua no mapa). O cabo mantém ao menos 2 pontos. */
    async removeVertex(id: string, index: number): Promise<Cable> {
      return database.transaction('rw', database.elements, database.cables, async () => {
        const c = await mustGet(id);
        if (!c.vertices[index]) throw new CableRuleError('NOT_FOUND', 'Ponto não encontrado.');
        if (c.vertices.length <= 2) {
          throw new CableRuleError('MIN_VERTICES', 'O cabo precisa de pelo menos 2 pontos. Exclua o cabo se ele não existe mais.');
        }
        return saveVertices(c, c.vertices.filter((_, i) => i !== index));
      });
    },

    /** Exclusão lógica. As reservas que eram dele continuam no mapa, sem cabo. */
    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.elements, database.cables, async () => {
        const c = await mustGet(id);
        await database.cables.update(c.id, touch<Cable>({ deleted: true }));
        await unlinkReserves(database, c.id);
      });
    },
  };
}

export const cableStore = cableRepo();
export { round2 };
