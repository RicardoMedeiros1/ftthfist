import { describe, expect, it } from 'vitest';
import { DAY_MS, backupReminder, reminderMessage } from './backupReminder';

const NOW = 100 * DAY_MS;
const base = { hasData: true, firstDataAt: NOW - 30 * DAY_MS, lastBackupAt: null, dismissedAt: null, now: NOW };

describe('backupReminder', () => {
  it('sem dados nunca lembra', () => {
    expect(backupReminder({ ...base, hasData: false }).show).toBe(false);
  });
  it('último backup há mais de 7 dias lembra; há menos, não', () => {
    expect(backupReminder({ ...base, lastBackupAt: NOW - 8 * DAY_MS }).show).toBe(true);
    expect(backupReminder({ ...base, lastBackupAt: NOW - 7 * DAY_MS }).show).toBe(true);
    expect(backupReminder({ ...base, lastBackupAt: NOW - 6 * DAY_MS }).show).toBe(false);
  });
  it('nunca fez backup: conta a partir do dado mais antigo', () => {
    expect(backupReminder({ ...base, firstDataAt: NOW - 3 * DAY_MS }).show).toBe(false);
    const r = backupReminder({ ...base, firstDataAt: NOW - 9 * DAY_MS });
    expect(r).toEqual({ show: true, never: true, days: 9 });
  });
  it('"Depois" silencia por 1 dia e depois volta', () => {
    const old = { ...base, lastBackupAt: NOW - 10 * DAY_MS };
    expect(backupReminder({ ...old, dismissedAt: NOW - 3_600_000 }).show).toBe(false);
    expect(backupReminder({ ...old, dismissedAt: NOW - DAY_MS }).show).toBe(true);
  });
  it('soneca "no futuro" (relógio mexido) não silencia', () => {
    expect(backupReminder({ ...base, lastBackupAt: NOW - 10 * DAY_MS, dismissedAt: NOW + DAY_MS }).show).toBe(true);
  });
  it('backup no futuro (relógio mexido) não lembra e não dá dias negativos', () => {
    const r = backupReminder({ ...base, lastBackupAt: NOW + 5 * DAY_MS });
    expect(r.show).toBe(false);
    expect(r.days).toBe(0);
  });
  it('mensagens', () => {
    expect(reminderMessage({ show: true, never: false, days: 9 })).toBe('Faz 9 dias desde o último backup.');
    expect(reminderMessage({ show: true, never: true, days: 9 })).toContain('ainda não têm backup');
  });
});
