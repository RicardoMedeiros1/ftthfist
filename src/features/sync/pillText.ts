import type { SyncState } from './syncStore';

export interface PillView {
  text: string;
  /** neutro | atencao (algo precisa de olhar) */
  tone: 'ok' | 'atencao';
}

/** O que o indicador do mapa diz. Sem conta ativa, continua sendo so "Online/Offline". */
export function pillView(s: Pick<SyncState, 'phase' | 'pending' | 'blocked' | 'progress' | 'firstSync'>, online: boolean): PillView {
  const base = online ? 'Online' : 'Offline';
  if (s.phase === 'desligado') return { text: base, tone: 'ok' };
  if (s.phase === 'sincronizando') {
    return { text: s.firstSync ? `Baixando a rede… ${s.progress?.done ?? 0}` : 'Sincronizando…', tone: 'ok' };
  }
  if (s.phase === 'precisa-entrar') return { text: 'Entre de novo', tone: 'atencao' };
  const parts = [base];
  if (s.pending > 0) parts.push(`${s.pending} pend.`);
  if (s.blocked > 0) parts.push(`⚠ ${s.blocked} recusado${s.blocked > 1 ? 's' : ''}`);
  if (s.phase === 'erro') parts.push('falha');
  return { text: parts.join(' · '), tone: s.blocked > 0 || s.phase === 'erro' ? 'atencao' : 'ok' };
}

/** Frase curta do estado, para as telas de Conta e Sincronizacao. */
export function stateSentence(s: Pick<SyncState, 'phase' | 'pending' | 'blocked' | 'lastSyncAt'>, now: number): string {
  if (s.phase === 'sincronizando') return 'Sincronizando…';
  if (s.phase === 'precisa-entrar') return 'Sua sessão expirou. Entre de novo.';
  if (s.phase === 'sem-rede') return s.pending > 0 ? `Sem rede · ${s.pending} aguardando envio` : 'Sem rede';
  if (s.blocked > 0) return `${s.blocked} registro${s.blocked > 1 ? 's' : ''} recusado${s.blocked > 1 ? 's' : ''} pelo servidor`;
  if (s.pending > 0) return `${s.pending} aguardando envio`;
  if (s.lastSyncAt === null) return 'Ainda não sincronizou neste aparelho';
  const min = Math.floor(Math.max(0, now - s.lastSyncAt) / 60000);
  return min < 1 ? 'Tudo enviado · agora há pouco' : min < 60 ? `Tudo enviado · há ${min} min` : 'Tudo enviado';
}
