// De quem e cada registro. Os dados de todos os tecnicos passam a conviver no aparelho (Fase 2):
// cada um edita so o que e seu. O "usuario que age" e a conta logada ou, sem login, o dono deste aparelho.

export type ActingRole = 'tecnico' | 'escritorio' | 'admin';

let acting: string | null = null;
let role: ActingRole | null = null;
const listeners = new Set<() => void>();

export const setActingUser = (id: string | null) => {
  if (id === acting) return;
  acting = id;
  listeners.forEach((l) => l());
};
/** Papel de quem esta logado e ATIVO (null = ninguem ou conta inativa). Define o que o administrador pode alterar. */
export const setActingRole = (r: ActingRole | null) => {
  if (r === role) return;
  role = r;
  listeners.forEach((l) => l());
};
export const actingRole = (): ActingRole | null => role;
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

/**
 * Posso ALTERAR este registro? O que e meu, ou qualquer um se eu for administrador (o servidor confere de novo:
 * a regra de verdade e a RLS). Registro NOVO e atividade aberta continuam valendo so para o que e meu (isMine).
 */
export function canEdit(r: { ownerId?: string }): boolean {
  return isMine(r) || role === 'admin';
}

const FEMININE = new Set(['atividade']);

/** "Este elemento foi registrado por Ana. Só quem registrou pode alterar." (concorda com o genero; sem presumir o de ninguem) */
export function otherOwnerText(what: string, author?: string): string {
  const fem = FEMININE.has(what);
  const who = author?.trim() || 'outro técnico';
  return `${fem ? 'Esta' : 'Este'} ${what} foi ${fem ? 'registrada' : 'registrado'} por ${who}. Só quem registrou pode alterar.`;
}

export const notMineMessage = (what: string) => otherOwnerText(what);

const demonstrative = (what: string) => (FEMININE.has(what) ? 'Esta' : 'Este');

/** Faixa do administrador alterando o que e de um tecnico. */
export function adminEditingText(what: string, author?: string): string {
  const fem = FEMININE.has(what);
  const who = author?.trim() || 'outro técnico';
  return `${demonstrative(what)} ${what} foi ${fem ? 'registrada' : 'registrado'} por ${who}. Você está alterando como administrador; quem registrou recebe a mudança na próxima sincronização.`;
}

/** Texto da confirmacao ao excluir o que e de outro (so o administrador chega aqui). */
export function adminDeleteText(what: string, author?: string): string {
  const fem = FEMININE.has(what);
  const who = author?.trim() || 'outro técnico';
  return `${demonstrative(what)} ${what} foi ${fem ? 'registrada' : 'registrado'} por ${who}. A exclusão vale para todos, inclusive para quem registrou.`;
}
