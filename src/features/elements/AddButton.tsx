import { useLiveQuery } from 'dexie-react-hooks';
import { navigate, parseRoute } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { draftStore } from './draftStore';

/**
 * Começa a marcar um elemento. Sem atividade aberta, leva para iniciar uma (todo elemento pertence a uma atividade).
 * Vale de qualquer tela: vai para o mapa e abre a escolha de tipo.
 */
export function useStartMark(): { ready: boolean; start: () => void } {
  const open = useLiveQuery(() => activities.getOpen()); // undefined = carregando
  return {
    ready: open !== undefined,
    start() {
      if (open === undefined) return;
      // Marcação ou lançamento em andamento (o técnico foi olhar outra tela): só volta ao mapa, sem recomeçar nada.
      if (draftStore.getState().phase !== 'idle') {
        if (parseRoute(window.location.hash) !== 'map') navigate('map', { replace: true });
        return;
      }
      if (open === null) {
        draftStore.hintNeedsActivity();
        navigate('nova-atividade');
        return;
      }
      if (parseRoute(window.location.hash) !== 'map') navigate('map', { replace: true });
      draftStore.startAdd();
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
