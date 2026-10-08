import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import '../../components/confirm.css';
import { db } from '../../db/db';
import type { NetworkElement } from '../../db/types';
import { formatMeters } from '../../lib/geo';
import { ELEMENT_META } from '../elements/meta';
import type { CableSummaryItem, CtoPick } from './cableActions';
import type { CableDraft } from './cableDraft';
import { ctoSpots, type CtoSpot } from './ctoSpots';
import FiberPicker from './FiberPicker';
import { DEFAULT_COLOR_STANDARD, fiberInfo, fiberLabel } from './fibers';
import { FiberLine } from './Legend';

const elementText = (e: NetworkElement | undefined) => (e ? `${ELEMENT_META[e.type].label}${e.code ? ` ${e.code}` : ''}` : 'um ponto');

interface Pick {
  code: string;
  fiber: number | null;
}

/**
 * Resumo ao finalizar: cada cabo (o tronco e os ramais) com a metragem, a soma, e, para cada CTO, a fibra que ela pegou e o
 * código dela. Tudo da CTO é opcional (dá para informar depois, em Editar). Observações valem para o lançamento todo.
 */
export default function CableSummaryDialog({
  draft,
  summary,
  error,
  busy,
  onSave,
  onBack,
}: {
  draft: CableDraft;
  summary: { items: CableSummaryItem[]; length: number; reserves: number; total: number };
  error: string | null;
  busy: boolean;
  onSave: (notes: string, ctos: CtoPick[]) => void;
  onBack: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [open, setOpen] = useState<string | null>(null);

  const ids = [...new Set(draft.cables.flatMap((c) => c.vertices.flatMap((v) => (v.elementId ? [v.elementId] : []))))];
  const elements = useLiveQuery(
    async () => new Map((await db.elements.bulkGet(ids)).flatMap((e) => (e ? [[e.id, e] as const] : []))),
    [ids.join()],
  );
  const spots = elements ? ctoSpots(draft, elements) : [];
  const pickOf = (s: CtoSpot): Pick => picks[s.element.id] ?? { code: s.element.code, fiber: null };
  const change = (s: CtoSpot, patch: Partial<Pick>) => setPicks((all) => ({ ...all, [s.element.id]: { ...pickOf(s), ...patch } }));

  const several = summary.items.length > 1;
  let branchNo = 0;
  const rows = summary.items.map((item) => {
    const isBranch = item.cable.parentId !== undefined;
    const role = isBranch ? `Ramal ${(branchNo += 1)}` : 'Tronco';
    const from = isBranch ? elementText(elements?.get(item.cable.vertices[0]?.elementId ?? '')) : null;
    return { item, role, from };
  });

  function save() {
    const out: CtoPick[] = [];
    for (const s of spots) {
      const p = pickOf(s);
      const code = p.code.trim() === s.element.code ? '' : p.code.trim();
      if (!p.fiber && !code) continue;
      out.push({ elementId: s.element.id, ...(p.fiber ? { cableId: s.cable.cableId, fiber: p.fiber } : {}), ...(code ? { code } : {}) });
    }
    onSave(notes, out);
  }

  const only = summary.items[0]?.cable;
  return (
    <div className="confirm-backdrop">
      <div className="confirm field scrolling" role="dialog" aria-modal="true" aria-labelledby="sum-title">
        <h2 id="sum-title">{several ? 'Finalizar lançamento' : 'Finalizar cabo'}</h2>
        <div className="confirm-body">
          {several ? (
            <ul className="sum-cables" aria-label="Cabos do lançamento">
              {rows.map(({ item, role, from }) => (
                <li key={item.cable.cableId}>
                  <FiberLine fiberCount={item.cable.fiberCount} width={32} />
                  <span className="sum-cable-text">
                    <strong>{role}</strong> · {item.cable.cableType} · {item.cable.fiberCount} fibras
                    <small>
                      {item.cable.vertices.length} pontos{from ? ` · sai de ${from}` : ''}
                    </small>
                  </span>
                  <strong className="sum-cable-len">{formatMeters(item.total)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            only && (
              <div className="row">
                <FiberLine fiberCount={only.fiberCount} />
                <strong>
                  {only.cableType} · {only.fiberCount} fibras · {only.vertices.length} pontos
                </strong>
              </div>
            )
          )}
          <div className="summary-math" role="status">
            <span>Traçado {formatMeters(summary.length)}</span>
            <span>+ Reservas {formatMeters(summary.reserves)}</span>
            <strong>= Total {formatMeters(summary.total)}</strong>
          </div>

          {spots.length > 0 && (
            <section className="cto-spots" aria-label="Fibra de cada CTO">
              <span className="label">Fibra de cada CTO (opcional)</span>
              <p className="hint">Diga de qual fibra cada CTO vive. Quem não souber agora informa depois, em Editar a CTO.</p>
              {spots.map((s, i) => {
                const p = pickOf(s);
                const standard = s.cable.colorStandard ?? DEFAULT_COLOR_STANDARD;
                const info = p.fiber ? fiberInfo(s.cable.fiberCount, p.fiber, standard) : null;
                const key = s.element.id;
                return (
                  <div className="cto-spot" key={key} role="group" aria-label={`CTO ${i + 1}`}>
                    <div className="cto-spot-head">
                      <strong>CTO {s.element.code || i + 1}</strong>
                      <small>
                        {s.end ? 'fim do' : 'no meio do'} {s.cable.cableType} · {s.cable.fiberCount} fibras
                      </small>
                    </div>
                    <label className="hint" htmlFor={`cto-code-${key}`}>Código da CTO</label>
                    <input id={`cto-code-${key}`} value={p.code} maxLength={60} placeholder="Ex.: CTO-12 (opcional)" onChange={(e) => change(s, { code: e.target.value })} />
                    <div className="cto-spot-fiber">
                      <span className="feed-summary">{info ? fiberLabel(info) : 'Fibra não informada'}</span>
                      <button type="button" className="btn btn-small" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                        {open === key ? 'Fechar' : p.fiber ? 'Trocar fibra' : 'Escolher fibra'}
                      </button>
                    </div>
                    {open === key && (
                      <FiberPicker fiberCount={s.cable.fiberCount} standard={standard} value={p.fiber} onChange={(n) => change(s, { fiber: n })} />
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <label htmlFor="cable-notes" className="hint">Observações (opcional)</label>
          <textarea id="cable-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <div className="alert" role="alert">{error}</div>}
        </div>
        <div className="confirm-actions">
          <button className="btn" onClick={onBack} disabled={busy}>
            Voltar
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !elements}>
            {several ? 'Salvar tudo' : 'Salvar cabo'}
          </button>
        </div>
      </div>
    </div>
  );
}
