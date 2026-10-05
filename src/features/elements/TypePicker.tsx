import { navigate } from '../../lib/route';
import { cableDraftStore } from '../cables/cableDraft';
import { draftStore, useDraft } from './draftStore';
import { elementSvg } from './elementSvg';
import { ELEMENT_TYPES } from './meta';

export default function TypePicker() {
  const phase = useDraft((s) => s.phase);
  if (phase !== 'tipo') return null;
  return (
    <div className="sheet" role="dialog" aria-label="Escolher o tipo de elemento">
      <div className="sheet-title">O que você vai marcar?</div>
      <button
        className="btn btn-block cable-launch"
        onClick={() => {
          // Já há um cabo em lançamento (app reaberto)? Retoma. Senão, escolhe tipo e fibras primeiro.
          if (cableDraftStore.getState()) draftStore.startCable();
          else {
            draftStore.cancel();
            navigate('novo-cabo');
          }
        }}
      >
        {cableDraftStore.getState() ? 'Retomar o cabo em lançamento' : 'Lançar cabo'}
      </button>
      <div className="type-grid">
        {ELEMENT_TYPES.map((m) => (
          <button key={m.type} className="type-tile" onClick={() => draftStore.chooseType(m.type)}>
            <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(m.type, { size: 40 }) }} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>
      <button className="btn btn-block" onClick={draftStore.cancel}>
        Cancelar
      </button>
    </div>
  );
}
