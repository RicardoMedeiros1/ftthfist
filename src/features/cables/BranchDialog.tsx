import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import '../../components/confirm.css';
import { SETTING_KEYS, getSetting } from '../../db/db';
import { Chips } from '../elements/fields';
import { elementStore } from '../elements/elementRepo';
import { ELEMENT_META } from '../elements/meta';
import type { CableChoice } from './cableDraft';
import { useCableTypes } from './cableTypes';
import FiberCountChips from './FiberCountChips';
import { STANDARD_LABEL, DEFAULT_COLOR_STANDARD } from './fibers';
import { FIBER_COUNTS } from './style';

/**
 * Ao derivar: tipo e nº de fibras do ramal. Já abre com o último ramal usado (na maioria das vezes é só confirmar); na
 * primeira vez, com o cabo de onde ele sai. As cores seguem as do cabo de origem.
 */
export default function BranchDialog({
  fromElementId,
  from,
  onCancel,
  onConfirm,
}: {
  fromElementId: string | undefined;
  /** O cabo de onde o ramal sai: serve de ponto de partida e define as cores. */
  from: CableChoice;
  onCancel: () => void;
  onConfirm: (choice: CableChoice) => void;
}) {
  const types = useCableTypes();
  const last = useLiveQuery(() => getSetting<{ cableType: string; fiberCount: number } | null>(SETTING_KEYS.lastBranch, null));
  const element = useLiveQuery(async () => (fromElementId ? elementStore.get(fromElementId) : undefined), [fromElementId]);
  const [cableType, setCableType] = useState('');
  const [fiberCount, setFiberCount] = useState<number>(from.fiberCount);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready || types === undefined || last === undefined) return;
    const pick = last && types.includes(last.cableType) ? last : null;
    setCableType(pick ? pick.cableType : types.includes(from.cableType) ? from.cableType : (types[0] ?? ''));
    const n = pick?.fiberCount ?? from.fiberCount;
    if ((FIBER_COUNTS as readonly number[]).includes(n)) setFiberCount(n);
    setReady(true);
  }, [ready, types, last, from]);

  const standard = from.colorStandard ?? DEFAULT_COLOR_STANDARD;
  const where = element ? `${ELEMENT_META[element.type].label}${element.code ? ` ${element.code}` : ''}` : 'o ponto atual';
  return (
    <div className="confirm-backdrop">
      <div className="confirm field scrolling" role="dialog" aria-modal="true" aria-labelledby="branch-title">
        <h2 id="branch-title">Derivar um ramal</h2>
        <div className="confirm-body">
          <p>
            Saindo de <strong>{where}</strong>
          </p>
          <Chips
            label="Tipo do cabo do ramal"
            value={cableType}
            options={(types ?? []).map((t) => ({ value: t, label: t }))}
            onChange={(v) => v && setCableType(v)}
          />
          <FiberCountChips compact value={fiberCount} onChange={setFiberCount} />
          <p className="hint">Cores das fibras: {STANDARD_LABEL[standard]}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn" onClick={onCancel}>
            Voltar
          </button>
          <button
            className="btn btn-primary"
            disabled={!ready || !cableType}
            onClick={() => onConfirm({ cableType, fiberCount, ...(from.colorStandard ? { colorStandard: from.colorStandard } : {}) })}
          >
            Derivar
          </button>
        </div>
      </div>
    </div>
  );
}
