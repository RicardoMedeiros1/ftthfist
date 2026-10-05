import { useLiveQuery } from 'dexie-react-hooks';
import { SETTING_KEYS, getSetting } from '../../db/db';

export const DEFAULT_CABLE_TYPES = ['drop', 'AS-80', 'AS-120', 'outro'];
export const MAX_CABLE_TYPES = 20;
export const MAX_TYPE_LENGTH = 30;

/** Limpa a lista editável: tira espaços e repetidos (sem diferenciar maiúsculas), limita tamanho e quantidade. */
export function normalizeCableTypes(list: unknown): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_CABLE_TYPES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().slice(0, MAX_TYPE_LENGTH);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_CABLE_TYPES) break;
  }
  return out.length > 0 ? out : [...DEFAULT_CABLE_TYPES];
}

/** Tipos de cabo configurados nas Configurações (undefined enquanto carrega). */
export function useCableTypes(): string[] | undefined {
  return useLiveQuery(async () => normalizeCableTypes(await getSetting<unknown>(SETTING_KEYS.cableTypes, DEFAULT_CABLE_TYPES)));
}
