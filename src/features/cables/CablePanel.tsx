import { useCallback, useRef, useState, type ReactNode } from 'react';
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
  draftReserveMeters,
  inBranch,
  lastVertex,
  openStack,
  useCableDraft,
} from './cableDraft';
import { CableRuleError } from './cableRepo';
import BranchDialog from './BranchDialog';
import CableSummaryDialog from './CableSummaryDialog';
import { useLatestFix } from './gpsFeed';
import { FiberLine } from './Legend';
import MetersDialog from './MetersDialog';
import { reserveUi, useReserveOpen } from './reserveUi';
import './cableDock.css';

/**
 * Guarda a altura da parte de baixo (tipo + dock) em `--cabo-panel-h` no mapa: os botões do mapa e a atribuição ficam
 * sempre acima dela, qualquer que seja o estado (tronco, ramal, ponto aguardando ajuste).
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

const ICON_PROPS = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

function DockButton({ icon, label, ariaLabel, tone, disabled, onClick }: { icon: ReactNode; label: string; ariaLabel?: string; tone?: 'end'; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`dock-btn${tone ? ` dock-btn-${tone}` : ''}`} aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      <svg {...ICON_PROPS}>{icon}</svg>
      {label}
    </button>
  );
}

/** Botão "Reserva" entre os botões do mapa durante o lançamento (o diálogo dos metros abre no painel de lançamento). */
export function ReserveButton() {
  const phase = useDraft((s) => s.phase);
  const pending = useDraft((s) => s.position !== null);
  const hasPoints = useCableDraft((d) => (d ? activeCable(d).vertices.length > 0 : false));
  if (phase !== 'cabo' || pending || !hasPoints) return null;
  return (
    <button className="map-btn map-btn-wide" onClick={() => reserveUi.set(true)}>
      Reserva
    </button>
  );
}

/**
 * Parte de baixo do lançamento: no alto o caminho (Tronco › Ramal) com as medidas e o Cancelar; embaixo a escolha do tipo do
 * próximo ponto e o dock com o MARCAR no meio. Onde o cabo se divide, "Derivar" abre um ramal (que termina com "Terminar").
 */
export default function CablePanel() {
  const phase = useDraft((s) => s.phase);
  const pending = useDraft((s) => s.position);
  const draft = useCableDraft((d) => d);
  const fix = useLatestFix();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const metersOpen = useReserveOpen();
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
  const reserves = draftReserveMeters(draft);
  const points = current.vertices.length;
  const bad = pending?.accuracy !== undefined && classifyAccuracy(pending.accuracy) === 'ruim';
  const gpsBad = fix ? classifyAccuracy(fix.accuracy) === 'ruim' : false;
  // Tronco › Ramal 1 › Ramal 3: o último é o cabo que recebe os pontos agora
  const trail = openStack(draft).map((id) => {
    const i = draft.cables.findIndex((c) => c.cableId === id);
    return i <= 0 ? 'Tronco' : `Ramal ${i}`;
  });

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
    <>
      <div className="cabo-top" role="region" aria-label="Cabo em lançamento">
        <div className="cabo-crumbs">
          {trail.slice(0, -1).map((name, i) => (
            <span key={i} className="cabo-crumb-wrap">
              <span className="cabo-crumb">{name}</span>
              <span className="cabo-sep" aria-hidden="true">›</span>
            </span>
          ))}
          <span className={`cabo-crumb cabo-crumb-now${branching ? ' cabo-crumb-ramal' : ''}`}>
            <FiberLine fiberCount={current.fiberCount} width={30} />
            <span>
              {several ? `${trail.at(-1)} · ` : ''}
              {current.cableType} · <span className="nb">{current.fiberCount} fibras</span>
            </span>
          </span>
        </div>
        {!pending && (
          <div className="cabo-stats" role="status">
            <span className="nb">
              {formatMeters(cableLengthMeters(current))} · {points} {points === 1 ? 'ponto' : 'pontos'}
              {reserves > 0 ? ` · Reservas ${formatMeters(reserves)}` : ''}
            </span>{' '}
            <span className={`nb ${gpsBad ? 'tone-warn' : 'cabo-gps-ok'}`}>· {fix ? `GPS ${formatAccuracy(fix.accuracy)}` : 'Aguardando o GPS…'}</span>
          </div>
        )}
        {message && (
          <div className="cabo-msg" role="alert">
            {message}
          </div>
        )}
      </div>
      <button className="cabo-cancel" onClick={() => setConfirmCancel(true)}>
        Cancelar
      </button>

      <div className="cabo-stack" ref={panelRef}>
        {pending ? (
          <div className="placement-panel cabo-pending" role="region" aria-label="Confirmar ponto">
            <div className={`placement-status${bad ? ' tone-warn' : ''}`} role="status">
              {bad && pending.accuracy !== undefined
                ? `Precisão baixa (${formatAccuracy(pending.accuracy)}). Arraste o marcador até o ponto certo.`
                : 'Posição ajustada. Confirme o ponto.'}
            </div>
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void run(confirmPendingPoint)}>
              Confirmar ponto
            </button>
            <div className="placement-row">
              <button className="btn btn-small" onClick={draftStore.discardPosition}>
                Descartar ponto
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="cabo-types" role="group" aria-label="Tipo do próximo ponto">
              {MARK_TYPES.map((t) => (
                <button type="button" key={t} className={`cabo-type cabo-type-${t}`} aria-pressed={markType === t} onClick={() => draftStore.setMarkType(t)}>
                  <span className="cabo-type-icon" aria-hidden="true" />
                  {ELEMENT_META[t].label}
                </button>
              ))}
            </div>
            <div className="cabo-dock" role="region" aria-label="Lançar cabo">
              <DockButton icon={<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />} label="Desfazer" disabled={busy || draft.actions.length === 0} onClick={() => void run(undoLast)} />
              <DockButton icon={<path d="M6 4v8a4 4 0 0 0 4 4h8M14 12l4 4-4 4" />} label="Derivar" disabled={busy || !lastVertex(current)} onClick={openBranch} />
              <span className="dock-gap" aria-hidden="true" />
              {branching ? (
                <DockButton icon={<path d="M5 12h12M13 7l5 5-5 5M20 5v14" />} label="Terminar" ariaLabel="Terminar ramal" tone="end" disabled={busy || points < 2} onClick={endBranch} />
              ) : (
                <span aria-hidden="true" />
              )}
              <DockButton
                icon={<path d="M5 13l4 4L19 7" />}
                label="Finalizar"
                disabled={busy || !canFinishDraft(draft)}
                onClick={() => {
                  setSummaryError(null);
                  setSummaryOpen(true);
                }}
              />
              <button
                type="button"
                className="cabo-mark"
                disabled={busy}
                aria-label={`Marcar ${markType === 'poste' ? 'poste' : ELEMENT_META[markType].label} aqui e ligar`}
                onClick={() => void mark()}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                {busy ? 'GPS…' : 'MARCAR'}
              </button>
            </div>
          </>
        )}
      </div>

      {metersOpen && (
        <MetersDialog
          onCancel={() => reserveUi.set(false)}
          onConfirm={(m) => {
            reserveUi.set(false);
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
    </>
  );
}
