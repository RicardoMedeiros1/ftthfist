import type { CycleAbort } from './engine';

// Textos para o tecnico (portugues, sem jargao). O texto original do servidor fica como "detalhe tecnico".

/** Por que o servidor recusou um registro, em palavras simples. */
export function explainRefusal(message: string): string {
  if (/row-level security|permission denied|42501/i.test(message)) {
    return 'O servidor não aceitou por falta de permissão. O registro pode ser de outro técnico, ou o seu acesso mudou.';
  }
  if (/pelo menos 2 pontos|vertices invalidos/i.test(message)) return 'O traçado deste cabo não é válido para o servidor (precisa de pelo menos 2 pontos).';
  if (/check constraint|violates check|invalid input|22P02|23514|22023/i.test(message)) {
    return 'Algum dado deste registro não é válido para o servidor (por exemplo, uma coordenada fora do mundo).';
  }
  if (/data inválida|registro inválido/i.test(message)) return 'Este registro tem uma data inválida e não pôde ser enviado.';
  return 'O servidor recusou este registro.';
}

const ABORT_TEXT: Record<CycleAbort['reason'], string> = {
  network: 'Sem conexão com o servidor. Seus dados continuam salvos no aparelho.',
  auth: 'Sua sessão expirou. Entre de novo na conta para continuar enviando.',
  server: 'O servidor não respondeu direito. Vamos tentar de novo daqui a pouco.',
  'too-many-blocked': 'O servidor recusou vários registros seguidos. Veja a lista e avise o administrador se continuar.',
};

export const abortMessage = (reason: CycleAbort['reason']) => ABORT_TEXT[reason];
