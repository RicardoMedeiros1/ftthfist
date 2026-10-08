import { useLiveQuery } from 'dexie-react-hooks';
import { navigate } from '../../lib/route';
import { cableLabel } from './cableChoices';
import { cableStore } from './cableRepo';
import { describeFeed, readFeed } from './feed';
import { FiberSwatch } from './FiberList';
import './fibers.css';

/** Na ficha da CTO: a fibra de entrada com a cor, de qual cabo, e o atalho para o cabo. */
export default function CtoFeedInfo({ attrs, editable }: { attrs: unknown; editable: boolean }) {
  const cables = useLiveQuery(() => cableStore.list());
  const feed = readFeed(attrs);
  if (!cables) return null;
  if (!feed) {
    return (
      <section className="field" aria-label="Fibra de entrada da CTO">
        <span className="label">Fibra de entrada</span>
        <p className="hint">Ainda não informada.{editable ? ' Toque em Editar para dizer de qual cabo e qual fibra esta CTO pegou.' : ''}</p>
      </section>
    );
  }
  const view = describeFeed(feed, cables);
  return (
    <section className="field" aria-label="Fibra de entrada da CTO">
      <span className="label">Fibra de entrada</span>
      <div className="feed-card">
        {view.fiber && <FiberSwatch color={view.fiber.color} size={30} />}
        <div className="feed-card-text">
          <strong>{view.text}</strong>
          {view.cable && <small>{cableLabel(view.cable)}</small>}
        </div>
      </div>
      {view.cable && (
        <button className="btn btn-block" onClick={() => navigate('cabo', { id: view.cable!.id })}>
          Abrir o cabo
        </button>
      )}
    </section>
  );
}
