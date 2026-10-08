import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { formatMeters } from '../../lib/geo';
import { isMine } from '../../lib/ownership';
import { CableRuleError, cableStore } from './cableRepo';
import { cablesAt, linkedAt, routeOf } from './routes';
import './fibers.css';

/**
 * Na ficha de um elemento (CEO, poste ou CTO): os cabos que passam nele e quais continuam um no outro (a emenda). Só aparece
 * quando passam pelo menos 2 cabos. Cabos que só se cruzam no poste ficam sem marcar.
 */
export default function ElementCableLinks({ elementId }: { elementId: string }) {
  const all = useLiveQuery(() => cableStore.list());
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = o que já está gravado
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (!all) return null;
  const here = cablesAt(all, elementId);
  if (here.length < 2) return null;

  const current = linkedAt(all, elementId);
  const sel = picked ?? current;
  const changed = picked !== null && (picked.size !== current.size || [...picked].some((id) => !current.has(id)));

  function toggle(id: string) {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
    setSaved(false);
    setError(null);
  }

  async function save() {
    if (busy || !picked) return;
    setBusy(true);
    setError(null);
    try {
      await cableStore.setLinksAt(elementId, [...picked]);
      setPicked(null);
      setSaved(true);
    } catch (e) {
      setError(e instanceof CableRuleError ? e.message : 'Não foi possível salvar as ligações. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  const firstLinked = here.find((c) => current.has(c.id));
  const route = firstLinked ? routeOf(firstLinked.id, all) : null;

  return (
    <section className="field" aria-label="Cabos ligados neste ponto">
      <span className="label">Cabos que passam aqui ({here.length})</span>
      <p className="hint">Marque os cabos que continuam um no outro neste ponto (a emenda). Cabos que só se cruzam no poste ficam sem marcar.</p>
      <div className="link-list">
        {here.map((c) => (
          <button key={c.id} type="button" className="link-row" aria-pressed={sel.has(c.id)} onClick={() => toggle(c.id)}>
            <span className="link-box" aria-hidden="true">{sel.has(c.id) ? '✓' : ''}</span>
            <span className="link-text">
              <strong>{c.cableType} · {c.fiberCount} fibras</strong>
              <small>{formatMeters(c.totalMeters)}{isMine(c) ? '' : ` · de ${c.createdBy}`}</small>
            </span>
          </button>
        ))}
      </div>
      {picked !== null && picked.size === 1 && <div className="alert" role="status">Marque pelo menos 2 cabos para ligar, ou desmarque este para desligar.</div>}
      {error && <div className="alert" role="alert">{error}</div>}
      {saved && !changed && <div className="ok-note" role="status">Ligações salvas.</div>}
      {route && route.cableIds.length > 1 && !changed && <p className="hint">Rota: {route.cableIds.length} cabos ligados.</p>}
      <button className="btn btn-primary btn-block" disabled={busy || !changed || picked?.size === 1} onClick={() => void save()}>
        {busy ? 'Salvando…' : 'Salvar ligações'}
      </button>
    </section>
  );
}
