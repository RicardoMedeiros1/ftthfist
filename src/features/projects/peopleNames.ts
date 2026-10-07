import type { Activity } from '../../db/types';

// Nome de quem recebeu o projeto. O aparelho nao guarda o cadastro das pessoas, entao o painel junta duas fontes:
// o nome do cadastro (guardado quando ha internet) e, na falta dele, o nome que a pessoa usa nas atividades dela.

export type NameCache = Record<string, string>;

/** Ids sem nome no cadastro guardado (e a eles que vale perguntar ao servidor). */
export const missingNames = (ids: Iterable<string>, cache: NameCache): string[] => [...new Set(ids)].filter((id) => !cache[id]?.trim());

/** Acrescenta os nomes novos ao que ja estava guardado; nome vazio nunca apaga um nome bom. */
export function mergeNames(cache: NameCache, fresh: ReadonlyMap<string, string>): NameCache {
  const out = { ...cache };
  for (const [id, name] of fresh) if (name.trim()) out[id] = name.trim();
  return out;
}

/** id -> nome: o do cadastro; senao o da atividade mais recente da pessoa; quem nao tem nenhum dos dois fica de fora. */
export function resolveNames(ids: Iterable<string>, cache: NameCache, activities: readonly Pick<Activity, 'ownerId' | 'technician' | 'startedAt' | 'deleted'>[]): Map<string, string> {
  const wanted = new Set(ids);
  const latest = new Map<string, { at: number; name: string }>();
  for (const a of activities) {
    if (a.deleted || !a.ownerId || !wanted.has(a.ownerId) || !a.technician.trim()) continue;
    const cur = latest.get(a.ownerId);
    if (!cur || a.startedAt > cur.at) latest.set(a.ownerId, { at: a.startedAt, name: a.technician.trim() });
  }
  const out = new Map<string, string>();
  for (const id of wanted) {
    const name = cache[id]?.trim() || latest.get(id)?.name;
    if (name) out.set(id, name);
  }
  return out;
}
