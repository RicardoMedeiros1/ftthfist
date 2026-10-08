import type { AccountStatus } from './accountStore';

/** O que o app mostra no lugar do mapa até a pessoa ter o acesso aprovado. */
export type AccessGate = 'open' | 'loading' | 'login' | 'checking' | 'pending' | 'disabled';

/**
 * Só abre o app quem tem o acesso aprovado (ou o build sem servidor, que funciona só no aparelho).
 * Depois de aprovado o último estado fica guardado: reabrir SEM internet continua abrindo direto.
 */
export function accessGateFor(status: AccountStatus): AccessGate {
  switch (status) {
    case 'sem-configuracao':
    case 'ativo':
      return 'open';
    case 'carregando':
      return 'loading';
    case 'deslogado':
      return 'login';
    case 'verificando':
      return 'checking';
    case 'pendente':
      return 'pending';
    case 'desativado':
      return 'disabled';
  }
}
