import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { LatLng } from '../../lib/geo';
import { Chips } from '../elements/fields';
import { cableStore } from './cableRepo';
import { feedChoices, usedFibers } from './feed';
import FiberPicker from './FiberPicker';
import { DEFAULT_COLOR_STANDARD, fiberInfo, fiberLabel } from './fibers';

/**
 * No formulário da CTO: de qual cabo e qual fibra ela pegou. O texto fica em `feedCableId` e `feedFiber` (convertidos ao salvar).
 * `elementId` é o da CTO quando ela já existe (para achar os cabos que passam por ela e não contar a própria fibra como "em uso").
 */
export default function CtoFeedFields({
  attrs,
  setMany,
  position,
  elementId,
}: {
  attrs: Record<string, string>;
  setMany: (patch: Record<string, string>) => void;
  position: LatLng;
  elementId?: string;
}) {
  const cables = useLiveQuery(() => cableStore.list());
  const ctos = useLiveQuery(() => db.elements.where('type').equals('cto').filter((e) => !e.deleted).toArray());
  if (!cables || !ctos) return null;

  const cableId = attrs.feedCableId ?? '';
  const fiber = Number(attrs.feedFiber) >= 1 ? Number(attrs.feedFiber) : null;
  const choices = feedChoices(position, cables, elementId, cableId || undefined);
  const chosen = cables.find((c) => c.id === cableId);
  const standard = chosen?.colorStandard ?? DEFAULT_COLOR_STANDARD;
  const used = chosen ? usedFibers(ctos, chosen.id, elementId) : undefined;
  const info = chosen && fiber ? fiberInfo(chosen.fiberCount, fiber, standard) : null;

  return (
    <section className="field" aria-label="Fibra de entrada da CTO">
      <span className="label">Fibra de entrada</span>
      {choices.length === 0 ? (
        <p className="hint">Nenhum cabo passa por esta CTO nem está a menos de 30 m. Lance o cabo até ela e depois escolha a fibra aqui (Editar).</p>
      ) : (
        <>
          <Chips
            label="Cabo que alimenta esta CTO"
            value={cableId}
            options={choices.map((c) => ({ value: c.cable.id, label: c.label }))}
            onChange={(v) => setMany({ feedCableId: v, feedFiber: '' })}
          />
          {cableId && !chosen && <div className="alert" role="status">O cabo que estava escolhido não existe mais. Escolha outro.</div>}
          {chosen && (
            <>
              <FiberPicker fiberCount={chosen.fiberCount} standard={standard} value={fiber} used={used} onChange={(n) => setMany({ feedFiber: String(n) })} />
              {!fiber && <p className="hint">Escolha a fibra que a CTO pegou. Sem a fibra, o cabo não fica guardado.</p>}
              {info && <p className="feed-summary">{fiberLabel(info)}</p>}
              {fiber && used?.has(fiber) && <div className="alert" role="status">Esta fibra já alimenta {used.get(fiber)}. Confira antes de salvar.</div>}
              {fiber && !info && <div className="alert" role="status">Este cabo só tem {chosen.fiberCount} fibras. Escolha outra.</div>}
            </>
          )}
        </>
      )}
    </section>
  );
}
