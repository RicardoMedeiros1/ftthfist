import type { CableLink } from '../../db/types';

// Ligações entre cabos como vêm do servidor ou do arquivo de backup: lidas com cuidado (o que não presta é deixado de fora).

export const MAX_LINKS = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Lista de ligações válidas, sem repetidas (mesmo elemento e mesmo cabo), até MAX_LINKS. Qualquer outra coisa = lista vazia. */
export function parseLinks(raw: unknown): CableLink[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CableLink[] = [];
  for (const x of raw) {
    if (typeof x !== 'object' || x === null) continue;
    const { elementId, cableId } = x as Record<string, unknown>;
    if (!isUuid(elementId) || !isUuid(cableId)) continue;
    const key = `${elementId}|${cableId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ elementId, cableId });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}
