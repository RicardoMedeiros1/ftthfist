import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SETTING_KEYS, getSetting } from '../../db/db';
import type { PlanPointType, ProjectPlan } from '../../db/types';
import { formatMeters } from '../../lib/geo';
import { goBack, useRouteId } from '../../lib/route';
import { useOnlineStatus } from '../../lib/useOnlineStatus';
import { useAccount } from '../account/accountStore';
import { adminApi } from '../admin/adminRuntime';
import { adminErrorText } from '../admin/people';
import { useAdminData } from '../admin/useAdminData';
import { Chips } from '../elements/fields';
import type { Bounds } from '../map/mapCommands';
import { ReferenceImportError, browserParseXml, parseReferenceFile } from '../reference/kmlImport';
import { ELEMENT_META } from '../elements/meta';
import type { BaseLayerId } from '../map/layers';
import { PLAN_POINT_TYPES, emptyPlan, isEmptyPlan, lineMeters, planBounds, planSummary, validatePlan } from './plan';
import {
  LIMIT_TEXT, addLine, addPoint, appendVertex, canRedo, canUndo, commit, deleteLine, deletePoint, deleteVertex, finishLine, insertVertex, isDirty, limitReached, moveVertex,
  movePoint, newEditor, planToSave, pruneSelection, redo, setPointCode, setPointType, undo, type Editor, type Selection,
} from './planEditor';
import PlanMapEditor, { type InitialView, type Mode } from './PlanMapEditor';
import { applyImport, hasUsable, importMessage, noUsableText, planImportFromLayer, type ImportMode, type PlanImport } from './planImport';
import { parseCoordinates } from './projectForm';
import './plan.css';

const BRASIL: InitialView = { kind: 'center', lat: -14.2, lng: -51.9, zoom: 4 };
const TYPE_OPTIONS = PLAN_POINT_TYPES.map((t) => ({ value: t, label: ELEMENT_META[t].label }));

function uid(plan: ProjectPlan): string {
  const taken = new Set([...plan.lines.map((l) => l.id), ...plan.points.map((p) => p.id)]);
  for (;;) {
    const id = crypto.randomUUID().slice(0, 8);
    if (!taken.has(id)) return id;
  }
}

/** Desenhar o projeto no mapa (tracado e pontos projetados). Exige internet e um administrador ativo; funciona no computador e no celular. */
export default function ProjetoDesenhoScreen() {
  const id = useRouteId();
  const online = useOnlineStatus();
  const isAdmin = useAccount((a) => a.status === 'ativo' && a.profile?.role === 'admin');
  const project = useAdminData(async () => (adminApi && id ? ((await adminApi.listProjects()).find((p) => p.id === id) ?? null) : null), [id]);
  const savedView = useLiveQuery(() => getSetting<{ lat: number; lng: number; zoom: number } | null>(SETTING_KEYS.mapView, null));

  const [ed, setEd] = useState<Editor | null>(null);
  const edRef = useRef<Editor | null>(null);
  edRef.current = ed;
  const [saved, setSaved] = useState<ProjectPlan>(emptyPlan());
  const [initial, setInitial] = useState<InitialView | null>(null);
  const [mode, setMode] = useState<Mode>('selecionar');
  const [pointType, setType] = useState<PlanPointType>('poste');
  const [sel, setSel] = useState<Selection | null>(null);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [base, setBase] = useState<BaseLayerId>('ruas');
  const [jump, setJump] = useState<{ lat: number; lng: number; seq: number } | null>(null);
  const [fit, setFit] = useState<{ bounds: Bounds; seq: number } | null>(null);
  const [jumpText, setJumpText] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<PlanImport | null>(null);
  const [codeDraft, setCodeDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<'sair' | 'apagar-tudo' | null>(null);

  const p = project.data;
  const plan = ed?.plan ?? emptyPlan();

  // abre uma vez por projeto: o desenho salvo, e a vista (o proprio desenho, senao o ponto do projeto, senao onde o mapa estava)
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!p || savedView === undefined || openedFor.current === p.id) return;
    openedFor.current = p.id;
    const start = p.plan ?? emptyPlan();
    setEd(newEditor(start));
    setSaved(start);
    const b = planBounds(start);
    setInitial(b ? { kind: 'bounds', bounds: b } : p.lat !== undefined && p.lng !== undefined ? { kind: 'center', lat: p.lat, lng: p.lng, zoom: 17 } : savedView ? { kind: 'center', ...savedView } : BRASIL);
  }, [p, savedView]);

  // depois de desfazer/refazer a escolha ou o traçado em desenho podem nao existir mais
  useEffect(() => {
    setSel((s) => pruneSelection(s, plan));
    setDrawing((d) => (d && plan.lines.some((l) => l.id === d) ? d : null));
  }, [plan]);

  const selectedPoint = sel?.kind === 'point' ? plan.points.find((x) => x.id === sel.id) : undefined;
  useEffect(() => setCodeDraft(selectedPoint?.code ?? ''), [selectedPoint?.id, selectedPoint?.code]);

  const dirty = isDirty(plan, saved);
  const summary = useMemo(() => planSummary(planToSave(plan)), [plan]);

  const apply = (fn: (pl: ProjectPlan) => ProjectPlan) => {
    setNote(null);
    setError(null);
    setEd((prev) => (prev ? commit(prev, fn(prev.plan)) : prev));
  };

  function endDrawing() {
    if (drawing) {
      const line = drawing;
      apply((pl) => finishLine(pl, line));
      setSel((s) => s ?? { kind: 'line', id: line });
    }
    setDrawing(null);
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    endDrawing();
    setMode(next);
    if (next !== 'selecionar') setSel(null);
  }

  function onMapClick(lat: number, lng: number) {
    const cur = edRef.current?.plan;
    if (!cur) return;
    if (mode === 'ponto') {
      if (limitReached(cur, 'ponto')) return setNote(LIMIT_TEXT.ponto);
      const pid = uid(cur);
      apply((pl) => addPoint(pl, pid, pointType, lat, lng));
      setSel({ kind: 'point', id: pid });
    } else if (mode === 'traco') {
      if (!drawing) {
        if (limitReached(cur, 'linha')) return setNote(LIMIT_TEXT.linha);
        const lid = uid(cur);
        apply((pl) => addLine(pl, lid, lat, lng));
        setDrawing(lid);
        setSel({ kind: 'line', id: lid });
      } else {
        if (limitReached(cur, 'vertice', drawing)) return setNote(LIMIT_TEXT.vertice);
        apply((pl) => appendVertex(pl, drawing, lat, lng));
      }
    } else {
      setSel(null);
    }
  }

  function doUndo() {
    setNote(null);
    setEd((e) => (e ? undo(e) : e));
  }
  function doRedo() {
    setNote(null);
    setEd((e) => (e ? redo(e) : e));
  }

  function removeSelected() {
    if (!sel) return;
    if (sel.kind === 'point') apply((pl) => deletePoint(pl, sel.id));
    else if (sel.kind === 'line') apply((pl) => deleteLine(pl, sel.id));
    else apply((pl) => deleteVertex(pl, sel.lineId, sel.index));
    // apagar um ponto do traçado deixa o traçado escolhido (se ele ainda existir), para continuar ajustando
    setSel(sel.kind === 'vertex' ? { kind: 'line', id: sel.lineId } : null);
  }

  // atalhos no computador: Delete apaga, Ctrl+Z desfaz, Ctrl+Y/Ctrl+Shift+Z refaz, Esc termina o traçado ou solta a escolha
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel && mode === 'selecionar') {
        e.preventDefault();
        removeSelected();
      }
    } else if (e.key === 'Escape') {
      if (drawing) endDrawing();
      else setSel(null);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Importar um KML/KMZ: linhas viram traçados e pontos viram pontos "outro"; com desenho na tela, pergunta se substitui ou acrescenta.
  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // o mesmo arquivo pode ser escolhido de novo
    if (!file || reading) return;
    setReading(true);
    setError(null);
    setNote(null);
    try {
      const imp = planImportFromLayer(await parseReferenceFile(await file.arrayBuffer(), file.name, { parseXml: browserParseXml }));
      if (!hasUsable(imp)) return setError(noUsableText(imp));
      if (isEmptyPlan(edRef.current?.plan ?? emptyPlan())) doImport(imp, 'substituir');
      else setPending(imp);
    } catch (err) {
      setError(err instanceof ReferenceImportError ? err.message : 'Não consegui ler este arquivo. Escolha um .kml ou .kmz.');
    } finally {
      setReading(false);
    }
  }

  function doImport(imp: PlanImport, mode: ImportMode) {
    const now = edRef.current?.plan;
    if (!now) return;
    const cur = drawing ? finishLine(now, drawing) : now; // o traçado em desenho termina antes (rascunho de 1 ponto some)
    const out = applyImport(cur, imp, mode, () => crypto.randomUUID().slice(0, 8));
    if (out.addedLines + out.addedPoints > 0) {
      setDrawing(null);
      apply(() => out.plan);
    } else endDrawing();
    setMode('selecionar');
    setSel(null);
    if (out.bounds) setFit({ bounds: out.bounds, seq: (fit?.seq ?? 0) + 1 });
    setNote(importMessage(out, imp));
  }

  async function save() {
    if (!adminApi || !p || !ed || busy) return;
    const toSave = planToSave(ed.plan);
    const problem = toSave ? validatePlan(toSave) : null;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await adminApi.updateProject(p.id, { plan: toSave });
      setSaved(toSave ?? emptyPlan());
      setNote(toSave ? 'Desenho salvo. O técnico recebe na próxima sincronização.' : 'O desenho foi apagado do projeto.');
    } catch (e) {
      setError(adminErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  const leave = () => goBack(id ? 'projeto' : 'projetos', id);
  const tryLeave = () => (dirty ? setAsk('sair') : leave());

  function goTo() {
    const c = parseCoordinates(jumpText);
    if (!c) return setError('Não entendi as coordenadas. Cole como aparecem no Google Maps, por exemplo -23.5505, -46.6333.');
    setError(null);
    setJump({ ...c, seq: (jump?.seq ?? 0) + 1 });
  }

  if (!isAdmin || !adminApi) {
    return (
      <div className="screen" role="dialog" aria-modal="true" aria-label="Desenhar projeto">
        <header className="screen-header"><button className="btn btn-small" onClick={leave} aria-label="Voltar">←</button><h1>Desenhar projeto</h1></header>
        <div className="screen-body"><div className="alert" role="alert">Esta tela é só para administradores.</div></div>
      </div>
    );
  }

  const selLine = sel?.kind === 'line' ? plan.lines.find((l) => l.id === sel.id) : sel?.kind === 'vertex' ? plan.lines.find((l) => l.id === sel.lineId) : undefined;

  return (
    <div className="screen plan-screen" role="dialog" aria-modal="true" aria-label="Desenhar projeto">
      <header className="screen-header">
        <button className="btn btn-small" onClick={tryLeave} aria-label="Voltar">←</button>
        <h1>{p ? `Desenhar: ${p.title}` : 'Desenhar projeto'}</h1>
      </header>

      <div className="plan-body">
        <div className="plan-map-wrap">
          {initial && ed ? (
            <PlanMapEditor
              plan={plan}
              mode={mode}
              selection={sel}
              drawingId={drawing}
              baseLayer={base}
              initial={initial}
              jumpTo={jump}
              fitTo={fit}
              onMapClick={onMapClick}
              onSelect={(s) => {
                setNote(null);
                setSel(s);
              }}
              onMovePoint={(pid, lat, lng) => apply((pl) => movePoint(pl, pid, lat, lng))}
              onMoveVertex={(lid, i, lat, lng) => apply((pl) => moveVertex(pl, lid, i, lat, lng))}
              onInsertVertex={(lid, i, lat, lng) => {
                apply((pl) => insertVertex(pl, lid, i, lat, lng));
                setSel({ kind: 'vertex', lineId: lid, index: i });
              }}
            />
          ) : (
            <p className="hint plan-loading">{project.loading ? 'Carregando o projeto…' : ''}</p>
          )}
        </div>

        <section className="plan-panel" aria-label="Ferramentas do desenho">
          {!online && <div className="alert" role="alert">Sem internet. Para abrir e salvar o desenho é preciso estar conectado.</div>}
          {project.error && <div className="alert" role="alert">{project.error}</div>}
          {project.data === null && !project.loading && !project.error && <div className="alert" role="alert">Projeto não encontrado. Volte e atualize a lista.</div>}
          {error && <div className="alert" role="alert">{error}</div>}
          {note && <div className="ok-note" role="status">{note}</div>}

          {ed && (
            <>
              {/* fica fixo no topo do painel: dá para trocar de ferramenta e ver "não salvo" sem rolar */}
              <div className="plan-head">
                <div className="plan-summary" role="status">{summary}{dirty ? ' · não salvo' : ''}</div>
                <div className="seg3" role="group" aria-label="Ferramenta">
                  <button type="button" aria-pressed={mode === 'selecionar'} onClick={() => changeMode('selecionar')}>Selecionar</button>
                  <button type="button" aria-pressed={mode === 'traco'} onClick={() => changeMode('traco')}>Traçado</button>
                  <button type="button" aria-pressed={mode === 'ponto'} onClick={() => changeMode('ponto')}>Ponto</button>
                </div>
              </div>

              {mode === 'traco' && (
                <>
                  <p className="hint">{drawing ? 'Toque no mapa para marcar o próximo ponto do traçado.' : 'Toque no mapa para começar um traçado.'} Para ajustar, termine e use “Selecionar”.</p>
                  <button className="btn btn-block" disabled={!drawing} onClick={() => { endDrawing(); setMode('selecionar'); }}>Terminar traçado</button>
                </>
              )}

              {mode === 'ponto' && (
                <>
                  <Chips label="Tipo do próximo ponto" value={pointType} options={TYPE_OPTIONS} onChange={(v) => v && setType(v as PlanPointType)} />
                  <p className="hint">Toque no mapa para colocar. Depois dá para escrever o código dele.</p>
                </>
              )}

              {selectedPoint && (
                <div className="plan-selected" role="group" aria-label="Ponto escolhido">
                  <span className="label">Ponto projetado</span>
                  {mode === 'selecionar' && (
                    <Chips label="Tipo" value={selectedPoint.type} options={TYPE_OPTIONS} onChange={(v) => v && apply((pl) => setPointType(pl, selectedPoint.id, v as PlanPointType))} />
                  )}
                  <div className="field">
                    <label htmlFor="plan-code">Código (opcional)</label>
                    <input
                      id="plan-code"
                      type="text"
                      value={codeDraft}
                      maxLength={60}
                      placeholder="Ex.: P-014 ou CTO-3"
                      onChange={(e) => setCodeDraft(e.target.value)}
                      onBlur={() => apply((pl) => setPointCode(pl, selectedPoint.id, codeDraft))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                    />
                  </div>
                  <button className="btn btn-danger btn-block" onClick={removeSelected}>Apagar este ponto</button>
                </div>
              )}

              {mode === 'selecionar' && selLine && (
                <div className="plan-selected" role="group" aria-label="Traçado escolhido">
                  <span className="label">Traçado: {formatMeters(lineMeters(selLine))} · {selLine.points.length} pontos</span>
                  {sel?.kind === 'vertex' ? (
                    <>
                      <p className="hint">Ponto {sel.index + 1} de {selLine.points.length}. Arraste para mover.</p>
                      <button className="btn btn-danger btn-block" onClick={removeSelected}>Apagar este ponto do traçado</button>
                      <button className="btn btn-block" onClick={() => setSel({ kind: 'line', id: selLine.id })}>Escolher o traçado todo</button>
                    </>
                  ) : (
                    <>
                      <p className="hint">Arraste as bolinhas brancas para mover; toque numa bolinha pequena entre elas para criar um ponto.</p>
                      <button className="btn btn-block" onClick={() => { setDrawing(selLine.id); setMode('traco'); setSel({ kind: 'line', id: selLine.id }); }}>Continuar este traçado</button>
                      <button className="btn btn-danger btn-block" onClick={removeSelected}>Apagar este traçado</button>
                    </>
                  )}
                </div>
              )}

              {mode === 'selecionar' && !sel && isEmptyPlan(plan) && <p className="hint">Escolha “Traçado” para desenhar a rota do cabo ou “Ponto” para marcar poste, CTO, CEO ou reserva.</p>}
              {mode === 'selecionar' && !sel && !isEmptyPlan(plan) && <p className="hint">Toque num traçado ou num ponto para escolher, mover ou apagar.</p>}

              <div className="plan-row">
                <button className="btn" disabled={!canUndo(ed)} onClick={doUndo}>Desfazer</button>
                <button className="btn" disabled={!canRedo(ed)} onClick={doRedo}>Refazer</button>
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || !online || !dirty} onClick={() => void save()}>{busy ? 'Salvando…' : dirty ? 'Salvar desenho' : 'Sem mudanças para salvar'}</button>

              <div className="plan-row">
                <button className="btn" onClick={() => setBase(base === 'ruas' ? 'satelite' : 'ruas')}>{base === 'ruas' ? 'Ver satélite' : 'Ver ruas'}</button>
                <button className="btn btn-danger" disabled={isEmptyPlan(plan)} onClick={() => setAsk('apagar-tudo')}>Apagar tudo</button>
              </div>

              <div className="plan-import">
                <input ref={picker} type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" hidden onChange={(e) => void pickFile(e)} />
                <button className="btn btn-block" disabled={reading} onClick={() => picker.current?.click()}>{reading ? 'Lendo o arquivo…' : 'Importar KML/KMZ'}</button>
                <p className="hint">Linhas viram traçado e pontos viram pontos “Outro”, com o nome do arquivo como código. Áreas (polígonos) não entram.</p>
              </div>

              <details className="plan-jump">
                <summary>Ir para um lugar</summary>
                <div className="field">
                  <label htmlFor="plan-jump">Coordenadas (do Google Maps)</label>
                  <input id="plan-jump" type="text" value={jumpText} placeholder="-23.5505, -46.6333" onChange={(e) => setJumpText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goTo()} />
                  <button className="btn btn-block" onClick={goTo}>Ir</button>
                </div>
              </details>
            </>
          )}
        </section>
      </div>

      {pending && (
        <div className="confirm-backdrop">
          <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="import-title" aria-describedby="import-msg">
            <h2 id="import-title">Importar para o desenho</h2>
            <p id="import-msg">
              O arquivo tem {pending.lines.length === 1 ? '1 traçado' : `${pending.lines.length} traçados`} e {pending.points.length === 1 ? '1 ponto' : `${pending.points.length} pontos`}. O desenho que está na tela tem: {summary}. Quer juntar os dois ou trocar pelo do arquivo? Dá para Desfazer depois.
            </p>
            <div className="confirm-actions plan-import-actions">
              <button className="btn btn-primary" onClick={() => { const i = pending; setPending(null); doImport(i, 'acrescentar'); }}>Acrescentar</button>
              <button className="btn btn-danger" onClick={() => { const i = pending; setPending(null); doImport(i, 'substituir'); }}>Substituir</button>
              <button className="btn" autoFocus onClick={() => setPending(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {ask === 'sair' && (
        <ConfirmDialog title="Sair sem salvar?" message="O desenho tem mudanças que ainda não foram salvas. Se sair agora, elas se perdem." confirmLabel="Sair sem salvar" danger onCancel={() => setAsk(null)} onConfirm={() => { setAsk(null); leave(); }} />
      )}
      {ask === 'apagar-tudo' && (
        <ConfirmDialog
          title="Apagar o desenho todo?"
          message="Tira todos os traçados e pontos desta tela. Só vale de verdade depois de “Salvar desenho”, e dá para Desfazer antes disso."
          confirmLabel="Apagar tudo"
          danger
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null);
            setDrawing(null);
            setSel(null);
            apply(() => emptyPlan());
          }}
        />
      )}
    </div>
  );
}
