// De quem e cada registro. Os dados de todos os tecnicos passam a conviver no aparelho (Fase 2):
// cada um edita so o que e seu. O "usuario que age" e a conta logada ou, sem login, o dono deste aparelho.

let acting: string | null = null;
const listeners = new Set<() => void>();

export const setActingUser = (id: string | null) => {
  if (id === acting) return;
  acting = id;
  listeners.forEach((l) => l());
};
/** Avisa quando quem age muda (a interface reavalia o que pode editar). */
export const subscribeActingUser = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
export const actingUserId = (): string | null => acting;

/**
 * O registro e meu (posso editar)? Sem dono gravado = foi criado neste aparelho antes de existir conta.
 * Sem ninguem identificado neste aparelho tambem vale como meu (nenhuma conta nunca foi usada aqui).
 */
export function isMine(r: { ownerId?: string }): boolean {
  return !r.ownerId || acting === null || r.ownerId === acting;
}

const FEMININE = new Set(['atividade']);

/** "Este elemento foi registrado por Ana. Só quem registrou pode alterar." (concorda com o genero; sem presumir o de ninguem) */
export function otherOwnerText(what: string, author?: string): string {
  const fem = FEMININE.has(what);
  const who = author?.trim() || 'outro técnico';
  return `${fem ? 'Esta' : 'Este'} ${what} foi ${fem ? 'registrada' : 'registrado'} por ${who}. Só quem registrou pode alterar.`;
}

export const notMineMessage = (what: string) => otherOwnerText(what);
