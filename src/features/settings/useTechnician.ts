import { useLiveQuery } from 'dexie-react-hooks';
import { SETTING_KEYS, getSetting } from '../../db/db';

/** Nome do técnico salvo nas Configurações. `undefined` enquanto carrega; '' se ainda não definido. */
export function useTechnician(): string | undefined {
  return useLiveQuery(() => getSetting<string>(SETTING_KEYS.technician, ''));
}
