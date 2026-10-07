import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo } from 'react';
import { SETTING_KEYS, getSetting, setSetting } from '../../db/db';
import type { Activity } from '../../db/types';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { adminApi } from '../admin/adminRuntime';
import { mergeNames, missingNames, resolveNames, type NameCache } from './peopleNames';

// Ids ja perguntados ao servidor nesta visita (um que nao voltou nao e perguntado de novo a cada desenho da tela).
const asked = new Set<string>();

/**
 * id da pessoa -> nome, para mostrar o tecnico de um projeto. Usa o cadastro guardado no aparelho e as atividades da pessoa;
 * com internet, busca no servidor o nome de quem ainda nao esta guardado (e guarda, para valer tambem sem rede).
 */
export function usePeopleNames(ids: readonly string[], activities: readonly Activity[]): ReadonlyMap<string, string> {
  const cache = useLiveQuery(() => getSetting<NameCache>(SETTING_KEYS.profileNames, {})) ?? {};
  const online = useOnlineStatus();
  const key = [...new Set(ids)].sort().join(',');

  useEffect(() => {
    if (!online || !adminApi) return;
    const todo = missingNames(key ? key.split(',') : [], cache).filter((id) => !asked.has(id));
    if (todo.length === 0) return;
    todo.forEach((id) => asked.add(id));
    adminApi.names(todo).then(
      async (found) => {
        if (found.size > 0) await setSetting(SETTING_KEYS.profileNames, mergeNames(await getSetting<NameCache>(SETTING_KEYS.profileNames, {}), found));
      },
      () => todo.forEach((id) => asked.delete(id)), // sem rede agora: tenta de novo na proxima vez
    );
  }, [online, key, cache]);

  return useMemo(() => resolveNames(key ? key.split(',') : [], cache, activities), [key, cache, activities]);
}
