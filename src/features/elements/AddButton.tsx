import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { draftStore, useDraft } from './draftStore';

/** Botão "+" do mapa. Sem atividade aberta, leva para iniciar uma (todo elemento pertence a uma atividade). */
export default function AddButton() {
  const idle = useDraft((s) => s.phase === 'idle');
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando
  if (!idle) return null;

  function onClick() {
    if (open === undefined) return;
    if (open === null) {
      draftStore.hintNeedsActivity();
      navigate('nova-atividade');
    } else {
      draftStore.startAdd();
    }
  }

  return (
    <button className="add-btn" onClick={onClick} disabled={open === undefined} aria-label="Marcar elemento">
      +
    </button>
  );
}
