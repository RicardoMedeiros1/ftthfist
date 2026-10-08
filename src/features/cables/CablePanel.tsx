import { useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatMeters } from '../../lib/geo';
import { draftStore, useDraft } from '../elements/draftStore';
import { ElementRuleError } from '../elements/elementRepo';
import { classifyAccuracy, formatAccuracy } from '../../lib/geo';
import { addReserveHere, confirmPendingPole, discardCable, finishCable, markPoleHere, summaryOf, undoLast } from './cableActions';
import { activeCable, canFinishDraft, draftLengthMeters, draftReserveMeters, useCableDraft } from './cableDraft';
import { CableRuleError } from './cableRepo';
import CableSummaryDialog from './CableSummaryDialog';
import { useLatestFix } from './gpsFeed';
import { FiberLine } from './Legend';
import MetersDialog from './MetersDialog';

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ElementRuleError || e instanceof CableRuleError ? e.message : fallback;

/** Painel inferior do lançamento: andar de poste em poste e tocar em "Marcar poste aqui e ligar". */
export default function CablePanel() {
  const phase = useDraft((s) => s.phase);
  const pending = useDraft((s) => s.position);
  const draft = useCableDraft((d) => d);
  const fix = useLatestFix();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [metersOpen, setMetersOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (phase !== 'cabo') return null;
  if (!draft) {
    return (
      <div className="placement-panel" role="region" aria-label="Lançar cabo">
        <div className="placement-status tone-error">Nenhum cabo em lançamento.</div>
        <button className="btn btn-primary btn-block" onClick={draftStore.cancel}>
          Voltar ao mapa
        </button>
      </div>
    );
  }

  const current = activeCable(draft);
  const trunk = draft.cables[0]!;
  const length = draftLengthMeters(draft);
  const reserves = draftReserveMeters(draft);
  const points = current.vertices.length;
  const bad = pending?.accuracy !== undefined && classifyAccuracy(pending.accuracy) === 'ruim';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage(errMsg(e, 'Não foi possível concluir. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }

  const mark = () =>
    run(async () => {
      const r = await markPoleHere();
      if (r.ok === false) setMessage(r.message);
    });

  async function save(notes: string) {
    setBusy(true);
    setSummaryError(null);
    try {
      await finishCable(notes);
      setSummaryOpen(false);
    } catch (e) {
      setSummaryError(errMsg(e, 'Não foi possível salvar o cabo. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="placement-panel" role="region" aria-label="Lançar cabo">
      <div className="placement-status cabo-status" role="status">
        <div className="cabo-head">
          <span className="cabo-title">
            <FiberLine fiberCount={current.fiberCount} width={36} />
            <strong>{current.cableType}</strong> · {current.fiberCount} fibras
          </span>
          <button className="btn btn-small cabo-cancel" onClick={() => setConfirmCancel(true)}>
            Cancelar
          </button>
        </div>
        {pending && bad ? (
          <div className="tone-warn">
            Precisão baixa ({formatAccuracy(pending.accuracy!)}). Arraste o marcador até o ponto certo.
          </div>
        ) : pending ? (
          <div>Posição ajustada. Confirme o ponto.</div>
        ) : (
          <>
            <div>
              Traçado {formatMeters(length)} · {points} {points === 1 ? 'ponto' : 'pontos'}
              {reserves > 0 ? ` · Reservas ${formatMeters(reserves)}` : ''}
            </div>
            <div className={message ? 'tone-error' : fix && classifyAccuracy(fix.accuracy) === 'ruim' ? 'tone-warn' : ''}>
              {message ?? (fix ? `GPS ${formatAccuracy(fix.accuracy)}` : 'Aguardando o GPS…')}
            </div>
          </>
        )}
      </div>

      {pending ? (
        <>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void run(confirmPendingPole)}>
            Confirmar ponto
          </button>
          <div className="placement-row">
            <button className="btn btn-small" onClick={draftStore.discardPosition}>
              Descartar ponto
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void mark()}>
            {busy ? 'Pegando GPS…' : 'Marcar poste aqui e ligar'}
          </button>
          <div className="placement-row">
            <button className="btn btn-small" disabled={busy || draft.actions.length === 0} onClick={() => void run(undoLast)}>
              Desfazer
            </button>
            <button className="btn btn-small" disabled={busy || points === 0} onClick={() => setMetersOpen(true)}>
              Reserva
            </button>
            <button
              className="btn btn-small"
              disabled={busy || !canFinishDraft(draft)}
              onClick={() => {
                setSummaryError(null);
                setSummaryOpen(true);
              }}
            >
              Finalizar
            </button>
          </div>
        </>
      )}

      {metersOpen && (
        <MetersDialog
          onCancel={() => setMetersOpen(false)}
          onConfirm={(m) => {
            setMetersOpen(false);
            void run(async () => {
              const r = await addReserveHere(m);
              if (!r.ok) setMessage(r.message ?? 'Não foi possível registrar a reserva.');
            });
          }}
        />
      )}
      {summaryOpen && (
        <CableSummaryDialog
          cableType={trunk.cableType}
          fiberCount={trunk.fiberCount}
          {...(() => {
            const s = summaryOf(draft);
            return { length: s.length, reserves: s.reserves, total: s.total };
          })()}
          points={points}
          error={summaryError}
          busy={busy}
          onBack={() => setSummaryOpen(false)}
          onSave={(n) => void save(n)}
        />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title="Descartar este cabo?"
          message="O traçado será descartado. Os postes e reservas já marcados continuam no mapa (as reservas ficam sem cabo)."
          confirmLabel="Descartar"
          danger
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => {
            setConfirmCancel(false);
            void run(discardCable);
          }}
        />
      )}
    </div>
  );
}
