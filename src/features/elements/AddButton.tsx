import { useLiveQuery } from 'dexie-react-hooks';
import { navigate, parseRoute } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { draftStore } from './draftStore';
import { decideStartMark, needsMapNavigation } from './startMark';

/**
 * Começa a marcar um elemento. Sem atividade aberta, leva para iniciar uma (todo elemento pertence a uma atividade).
 * Vale de qualquer tela: vai para o mapa e abre a escolha de tipo.
 */
export function useStartMark(): { ready: boolean; start: () => void } {
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando
  return {
    ready: open !== undefined,
    start() {
      const action = decideStartMark({ open, phase: draftStore.getState().phase });
      if (action === 'wait') return;
      if (action === 'need-activity') {
        draftStore.hintNeedsActivity();
        navigate('nova-atividade');
        return;
      }
      if (needsMapNavigation(parseRoute(window.location.hash))) navigate('map', { replace: true });
      if (action === 'start') draftStore.startAdd();
    },
  };
}

/** Botão "+" do meio da barra de abas. */
export default function AddButton() {
  const { ready, start } = useStartMark();
  return (
    <button className="add-btn" onClick={start} disabled={!ready} aria-label="Marcar elemento">
      <span aria-hidden="true">+</span>
    </button>
  );
}
