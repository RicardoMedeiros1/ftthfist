import { useCallback, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatMeters } from '../../lib/geo';
import { draftStore, useDraft } from '../elements/draftStore';
import { ElementRuleError } from '../elements/elementRepo';
import { classifyAccuracy, formatAccuracy } from '../../lib/geo';
import { ELEMENT_META } from '../elements/meta';
import {
  BRANCH_FROM_MESSAGE,
  MARK_TYPES,
  type CtoPick,
  addReserveHere,
  branchHere,
  canBranchHere,
  confirmPendingPoint,
  discardCable,
  endBranchHere,
  finishCable,
  markPointHere,
  toMarkType,
  summaryOf,
  undoLast,
} from './cableActions';
import {
  activeCable,
  cableLengthMeters,
  canFinishDraft,
  draftLengthMeters,
  draftReserveMeters,
  inBranch,
  lastVertex,
  useCableDraft,
} from './cableDraft';
import { CableRuleError } from './cableRepo';
import BranchDialog from './BranchDialog';
import CableSummaryDialog from './CableSummaryDialog';
import { useLatestFix } from './gpsFeed';
import { FiberLine } from './Legend';
import MetersDialog from './MetersDialog';

/**
 * Guarda a altura do painel em `--cabo-panel-h` no mapa: os botões do mapa e a atribuição ficam sempre acima dele,
 * qualquer que seja o estado (tronco, ramal, ponto aguardando ajuste, texto em mais linhas).
 */
function usePanelHeightVar() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    const root = el?.closest<HTMLElement>('.map-screen');
    if (!el || !root) return;
    const sync = () => root.style.setProperty('--cabo-panel-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    sync();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
    ro?.observe(el);
    cleanup.current = () => {
      ro?.disconnect();
      root.style.removeProperty('--cabo-panel-h');
    };
  }, []);
}

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ElementRuleError || e instanceof CableRuleError ? e.message : fallback;

/**
 * Painel inferior do lançamento: andar de poste em poste e tocar em "Marcar poste aqui e ligar". Onde o cabo se divide,
 * "Derivar" abre um ramal (que termina com "Terminar ramal"); CEO e CTO se marcam escolhendo o tipo antes.
 */
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
  const [branchOpen, setBranchOpen] = useState(false);
  const markType = toMarkType(useDraft((s) => s.type));
  const panelRef = usePanelHeightVar();

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
  const branching = inBranch(draft);
  const several = draft.cables.length > 1;
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
      const r = await markPointHere();
      if (r.ok === false) setMessage(r.message);
    });

  function openBranch() {
    setMessage(null);
    if (canBranchHere()) setBranchOpen(true);
    else setMessage(BRANCH_FROM_MESSAGE);
  }

  function endBranch() {
    const r = endBranchHere();
    setMessage(r.ok ? null : r.message);
  }

  async function save(notes: string, ctos: CtoPick[]) {
    setBusy(true);
    setSummaryError(null);
    try {
      await finishCable(notes, ctos);
      setSummaryOpen(false);
    } catch (e) {
      setSummaryError(errMsg(e, 'Não foi possível salvar o cabo. Tente de novo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="placement-panel" role="region" aria-label="Lançar cabo" ref={panelRef}>
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
              {several ? (
                <>
                  <span className="cabo-badge">{branching ? 'Ramal' : 'Tronco'}</span> {formatMeters(cableLengthMeters(current))}
                </>
              ) : (
                `Traçado ${formatMeters(length)}`
              )}{' '}
              · {points} {points === 1 ? 'ponto' : 'pontos'}
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
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void run(confirmPendingPoint)}>
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
          <div className="chips mark-types" role="group" aria-label="Tipo do próximo ponto">
            {MARK_TYPES.map((t) => (
              <button type="button" key={t} aria-pressed={markType === t} onClick={() => draftStore.setMarkType(t)}>
                {ELEMENT_META[t].label}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void mark()}>
            {busy ? 'Pegando GPS…' : `Marcar ${markType === 'poste' ? 'poste' : ELEMENT_META[markType].label} aqui e ligar`}
          </button>
          {branching && (
            <button className="btn btn-small btn-block" disabled={busy || points < 2} onClick={endBranch}>
              Terminar ramal
            </button>
          )}
          <div className="placement-row placement-row-4">
            <button className="btn btn-small" disabled={busy || draft.actions.length === 0} onClick={() => void run(undoLast)}>
              Desfazer
            </button>
            <button className="btn btn-small" disabled={busy || points === 0} onClick={() => setMetersOpen(true)}>
              Reserva
            </button>
            <button className="btn btn-small" disabled={busy || !lastVertex(current)} onClick={openBranch}>
              Derivar
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
      {branchOpen && (
        <BranchDialog
          fromElementId={lastVertex(current)?.elementId}
          from={{ cableType: current.cableType, fiberCount: current.fiberCount, ...(current.colorStandard ? { colorStandard: current.colorStandard } : {}) }}
          onCancel={() => setBranchOpen(false)}
          onConfirm={(choice) => {
            setBranchOpen(false);
            void run(async () => {
              const r = await branchHere(choice);
              if (!r.ok) setMessage(r.message);
            });
          }}
        />
      )}
      {summaryOpen && (
        <CableSummaryDialog
          draft={draft}
          summary={summaryOf(draft)}
          error={summaryError}
          busy={busy}
          onBack={() => setSummaryOpen(false)}
          onSave={(n, ctos) => void save(n, ctos)}
        />
      )}
      {confirmCancel && (
        <ConfirmDialog
          title={several ? 'Descartar este lançamento?' : 'Descartar este cabo?'}
          message={`${several ? 'O tronco e os ramais serão descartados.' : 'O traçado será descartado.'} Os postes, CEOs, CTOs e reservas já marcados continuam no mapa (as reservas ficam sem cabo).`}
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
