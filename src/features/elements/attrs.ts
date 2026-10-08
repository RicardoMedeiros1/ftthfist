import type { ElementAttrsByType, ElementType } from '../../db/types';
import { isUuid } from '../cables/linkData';

const OWNERS = ['concessionaria', 'proprio', 'outro'] as const;
const PROBLEMS = ['rompimento', 'atenuacao', 'poste_caido', 'caixa_danificada', 'outro'] as const;

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** Aceita número ou texto digitado ("12,5"). Vazio, negativo ou inválido vira undefined. */
function num(v: unknown, integer = false): number | undefined {
  let n: number | undefined;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') n = Number(v.trim().replace(',', '.'));
  if (n === undefined || !Number.isFinite(n) || n < 0) return undefined;
  return integer ? Math.round(n) : n;
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Normaliza os atributos do tipo: descarta o que não pertence ao tipo, converte números e remove vazios. */
export function sanitizeAttrs(type: ElementType, raw: unknown): ElementAttrsByType[ElementType] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  switch (type) {
    case 'poste':
      return compact({ owner: oneOf(OWNERS, r.owner), ownerCode: str(r.ownerCode) });
    case 'cto': {
      const splitter = str(r.splitter);
      // cabo e fibra de entrada: valem juntos (fibra começa em 1); pela metade, nenhum dos dois fica
      const feedCableId = isUuid(r.feedCableId) ? r.feedCableId : undefined;
      const feedFiber = num(r.feedFiber, true);
      const feed = feedCableId !== undefined && feedFiber !== undefined && feedFiber >= 1;
      return compact({
        capacity: num(r.capacity, true),
        splitter: splitter && /^\d+:\d+$/.test(splitter) ? splitter : undefined,
        feedCableId: feed ? feedCableId : undefined,
        feedFiber: feed ? feedFiber : undefined,
      });
    }
    case 'ceo':
      return compact({ trays: num(r.trays, true), splices: num(r.splices, true) });
    case 'reserva':
      // cableId liga a reserva ao cabo (a metragem dela entra no total do cabo).
      return compact({ meters: num(r.meters), cableId: str(r.cableId) });
    case 'ocorrencia':
      return compact({ problem: oneOf(PROBLEMS, r.problem), actionTaken: str(r.actionTaken) });
    case 'outro':
      return {};
  }
}
