export const DAY_MS = 86_400_000;
/** Lembrar quando o último backup tiver mais de 7 dias (roteiro da Fase 1B). */
export const BACKUP_INTERVAL_DAYS = 7;
/** "Depois" silencia o lembrete por um dia. */
export const SNOOZE_MS = DAY_MS;

export interface ReminderInput {
  hasData: boolean;
  /** Quando o dado mais antigo foi criado: referência enquanto nunca houve backup. */
  firstDataAt: number | null;
  lastBackupAt: number | null;
  dismissedAt: number | null;
  now: number;
}

export interface ReminderState {
  show: boolean;
  never: boolean;
  days: number;
}

export function backupReminder(i: ReminderInput): ReminderState {
  const never = i.lastBackupAt === null;
  const reference = i.lastBackupAt ?? i.firstDataAt ?? i.now;
  const age = i.now - reference;
  const due = i.hasData && age >= BACKUP_INTERVAL_DAYS * DAY_MS;
  // Relógio do aparelho mudado para o passado: a soneca não pode ficar valendo para sempre.
  const snoozed = i.dismissedAt !== null && i.now - i.dismissedAt >= 0 && i.now - i.dismissedAt < SNOOZE_MS;
  return { show: due && !snoozed, never, days: Math.max(0, Math.floor(age / DAY_MS)) };
}

export function reminderMessage(s: ReminderState): string {
  return s.never
    ? `Os dados deste aparelho têm ${s.days} dias e ainda não têm backup.`
    : `Faz ${s.days} dias desde o último backup.`;
}
