import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatMeters } from '../../lib/geo';
import { goBack } from '../../lib/route';
import { draftStore, useDraft } from '../elements/draftStore';
import { elementStore } from '../elements/elementRepo';
import { ELEMENT_META } from '../elements/meta';
import { CableRuleError, cableStore } from './cableRepo';

/** Painel inferior ao editar o traçado de um cabo salvo. */
export default function CableEditPanel() {
  const phase = useDraft((s) => s.phase);
  const id = useDraft((s) => s.editingCableId);
  const sel = useDraft((s) => s.selectedVertex);
  const cable = useLiveQuery(async () => (id ? ((await cableStore.get(id)) ?? null) : null), [id]);
  const vertex = cable && sel !== null ? cable.vertices[sel] : undefined;
  const element = useLiveQuery(async () => (vertex?.elementId ? ((await elementStore.get(vertex.elementId)) ?? null) : null), [vertex?.elementId]);
  const [error, setError] = useState<string | null>(null);

  if (phase !== 'cabo-editar' || !cable) return null;

  const done = () => {
    draftStore.cancel();
    goBack('map');
  };

  async function removePoint() {
    if (sel === null) return;
    setError(null);
    try {
      await cableStore.removeVertex(cable!.id, sel);
      draftStore.selectVertex(null);
    } catch (e) {
      setError(e instanceof CableRuleError ? e.message : 'Não foi possível remover o ponto.');
    }
  }

  let hint = 'Arraste os pontos. Toque no + entre dois pontos para inserir um novo.';
  if (vertex && sel !== null) {
    hint = vertex.elementId
      ? `Ponto ${sel + 1}: ${element ? `${ELEMENT_META[element.type].label}${element.code ? ' ' + element.code : ''}` : 'elemento'}. Mover o ponto move o elemento.`
      : `Ponto ${sel + 1}: ponto solto (não é um elemento).`;
  }

  return (
    <div className="placement-panel" role="region" aria-label="Editar traçado">
      <div className="placement-status" role="status">
        {/* Uma linha só (a área de status tem altura fixa de 3 linhas). */}
        <div>
          <strong>{cable.cableType}</strong> · {cable.fiberCount} fibras · {formatMeters(cable.lengthMeters)}
        </div>
        <div className={error ? 'tone-error' : ''}>{error ?? hint}</div>
      </div>
      <button className="btn btn-primary btn-block" onClick={done}>
        Concluir edição
      </button>
      <div className="placement-row">
        <button className="btn btn-small" disabled={sel === null || cable.vertices.length <= 2} onClick={() => void removePoint()}>
          Remover ponto
        </button>
      </div>
    </div>
  );
}
