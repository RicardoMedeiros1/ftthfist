import { useSyncExternalStore } from 'react';
import { actingUserId, isMine, subscribeActingUser } from './ownership';

/** O registro e meu (posso alterar)? Reavalia quando alguem entra ou sai da conta. */
export function useIsMine(record: { ownerId?: string } | null | undefined): boolean {
  const acting = useSyncExternalStore(subscribeActingUser, actingUserId, actingUserId);
  void acting; // so para re-renderizar: isMine le o mesmo valor
  return record ? isMine(record) : false;
}
