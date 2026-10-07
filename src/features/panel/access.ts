import type { AccountStatus } from '../account/accountStore';
import type { Role } from '../account/authApi';

// Quem pode abrir o painel web: o escritorio (so leitura) e o administrador. Tecnico nao: para ele existe o app de campo.

export type PanelAccess = 'liberado' | 'sem-conta' | 'aguardando' | 'sem-permissao';

export function panelAccess(status: AccountStatus, role: Role | undefined): PanelAccess {
  if (status === 'ativo') return role === 'escritorio' || role === 'admin' ? 'liberado' : 'sem-permissao';
  if (status === 'pendente' || status === 'verificando' || status === 'carregando') return 'aguardando';
  if (status === 'desativado') return 'sem-permissao';
  return 'sem-conta'; // deslogado ou app sem servidor
}

export const ACCESS_TEXT: Record<Exclude<PanelAccess, 'liberado'>, string> = {
  'sem-conta': 'Entre na sua conta para abrir o painel.',
  aguardando: 'Ainda não deu para confirmar o seu acesso. Confira a internet e tente de novo.',
  'sem-permissao': 'O painel é para o escritório e para administradores. O técnico usa o app de campo.',
};
