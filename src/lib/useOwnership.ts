import { useSyncExternalStore } from 'react';
import { actingRole, actingUserId, canEdit, isMine, subscribeActingUser } from './ownership';

const snapshot = () => `${actingUserId() ?? ''}|${actingRole() ?? ''}`;

function useActing(): void {
  useSyncExternalStore(subscribeActingUser, snapshot, snapshot); // so para re-renderizar quando muda quem age ou o papel
}

/** O registro e meu? Reavalia quando alguem entra ou sai da conta. */
export function useIsMine(record: { ownerId?: string } | null | undefined): boolean {
  useActing();
  return record ? isMine(record) : false;
}

/** Posso ALTERAR este registro (e meu, ou sou administrador)? */
export function useCanEdit(record: { ownerId?: string } | null | undefined): boolean {
  useActing();
  return record ? canEdit(record) : false;
}
