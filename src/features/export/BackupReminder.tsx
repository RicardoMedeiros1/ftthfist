import { useLiveQuery } from 'dexie-react-hooks';
import { SETTING_KEYS, db, getSetting, setSetting } from '../../db/db';
import { navigate, useRoute } from '../../lib/route';
import { useDraft } from '../elements/draftStore';
import { dataSummary, hasData } from './backup';
import { backupReminder, reminderMessage } from './backupReminder';

/** Lembrete na tela do mapa quando o último backup é antigo (ou nunca houve um). */
export default function BackupReminder() {
  const route = useRoute();
  const idle = useDraft((s) => s.phase === 'idle');
  const inputs = useLiveQuery(async () => {
    const [summary, lastBackupAt, dismissedAt] = await Promise.all([
      dataSummary(db),
      getSetting<number | null>(SETTING_KEYS.lastBackupAt, null),
      getSetting<number | null>(SETTING_KEYS.backupDismissedAt, null),
    ]);
    return { hasData: hasData(summary), firstDataAt: summary.firstDataAt, lastBackupAt, dismissedAt };
  });
  // Só no mapa e fora de uma marcação: não pode atrapalhar o trabalho de campo.
  if (route !== 'map' || !idle || !inputs) return null;
  const state = backupReminder({ ...inputs, now: Date.now() });
  if (!state.show) return null;

  return (
    <div className="backup-toast" role="status">
      <span>{reminderMessage(state)}</span>
      <div className="update-actions">
        <button className="btn btn-small" onClick={() => void setSetting(SETTING_KEYS.backupDismissedAt, Date.now())}>
          Depois
        </button>
        <button className="btn btn-primary btn-small" onClick={() => navigate('backup')}>
          Fazer backup
        </button>
      </div>
    </div>
  );
}
