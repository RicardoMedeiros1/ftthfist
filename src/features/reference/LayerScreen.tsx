import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ConfirmDialog from '../../components/ConfirmDialog';
import ScreenShell from '../../components/ScreenShell';
import type { ElementType } from '../../db/types';
import { formatDateTime, plural } from '../../lib/format';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { ELEMENT_TYPES } from '../elements/meta';
import { ElementRuleError } from '../elements/elementRepo';
import { useTechnician } from '../settings/useTechnician';
import { describeCounts, viewOnMap } from './CamadasScreen';
import { ReferenceRuleError, references } from './referenceRepo';
import './reference.css';

const SHOWN = 100;

/** Sem acento e em minúsculas, para a busca achar "Conceição" digitando "conceicao". */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function LayerScreen() {
  const id = useRouteId();
  const layer = useLiveQuery(async () => (id ? ((await references.get(id)) ?? null) : null), [id]);
  const open = useLiveQuery(() => activities.getOpen());
  const technician = useTechnician();

  const points = useLiveQuery(
    async () => (id ? (await references.features(id)).filter((f) => f.geom.kind === 'point').map((f) => ({ n: f.n, name: f.name })) : []),
    [id],
  );

  const [name, setName] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [type, setType] = useState<ElementType>('poste');
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return (points ?? []).filter((p) => !q || norm(p.name).includes(q));
  }, [points, query]);

  if (layer === undefined) return <ScreenShell title="Camada" onBack={() => goBack('camadas')}>{null}</ScreenShell>;
  if (layer === null) {
    return (
      <ScreenShell title="Camada" onBack={() => goBack('camadas')}>
        <div className="alert" role="alert">Esta camada não existe mais.</div>
        <button className="btn btn-block" onClick={() => navigate('camadas', { replace: true })}>Ver camadas</button>
      </ScreenShell>
    );
  }

  const converted = new Set(layer.converted);
  const shown = filtered.slice(0, SHOWN);
  const editedName = name ?? layer.name;

  const toggle = (n: number) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  async function convert() {
    setConfirmConvert(false);
    setBusy(true);
    setMsg(null);
    try {
      const made = await references.convertPoints(layer!.id, [...picked], type, technician ?? '');
      setPicked(new Set());
      setMsg({ kind: 'ok', text: `${plural(made.length, 'elemento criado', 'elementos criados')} na atividade “${open?.title ?? ''}”.` });
    } catch (e) {
      setMsg({
        kind: 'error',
        text:
          e instanceof ElementRuleError || e instanceof ReferenceRuleError
            ? e.message
            : 'Não foi possível criar os elementos. Nada foi criado.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    await references.remove(layer!.id);
    navigate('camadas', { replace: true });
  }

  const typeLabel = ELEMENT_TYPES.find((t) => t.type === type)!.label;

  return (
    <ScreenShell title="Camada de referência" onBack={() => goBack('camadas')}>
      <section className="card" aria-label="Camada">
        <div className="card-title">
          <span className="ref-dot" style={{ background: layer.color }} aria-hidden="true" />
          {layer.name}
        </div>
        <div className="card-meta">{describeCounts(layer.counts)}</div>
        <div className="card-meta">{layer.fileName} · importada em {formatDateTime(layer.createdAt)}</div>
        {layer.skipped > 0 && <div className="card-meta">{plural(layer.skipped, 'item ficou', 'itens ficaram')} de fora (sem coordenadas válidas).</div>}
        <div className="card-actions">
          <button className="btn btn-small" aria-pressed={layer.visible} onClick={() => void references.setVisible(layer.id, !layer.visible)}>
            {layer.visible ? 'Ocultar' : 'Mostrar'}
          </button>
          <button className="btn btn-small" onClick={() => viewOnMap(layer)}>Ver no mapa</button>
        </div>
      </section>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void references.rename(layer.id, editedName).then(() => setName(null));
        }}
      >
        <label htmlFor="rename">Nome da camada</label>
        <input id="rename" type="text" value={editedName} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-block" type="submit" disabled={editedName.trim() === '' || editedName.trim() === layer.name}>
          Renomear
        </button>
      </form>

      {layer.counts.points > 0 && (
        <section className="section" aria-label="Converter pontos em elementos">
          <h2>Converter pontos em elementos</h2>
          <p className="hint">
            Marque os pontos que quer trazer para o seu trabalho. Eles viram elementos na atividade aberta, com a posição do arquivo (marcada como “no mapa”, sem precisão de GPS).
          </p>

          <div className="field">
            <span className="label" id="conv-type-label">Tipo dos novos elementos</span>
            <div className="chips chips-types" role="group" aria-labelledby="conv-type-label">
              {ELEMENT_TYPES.map((t) => (
                <button key={t.type} type="button" aria-pressed={type === t.type} onClick={() => setType(t.type)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="ref-search">Buscar pelo nome</label>
            <input id="ref-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ex.: CTO-12" />
          </div>

          <div className="ref-actions">
            <button className="btn btn-small" onClick={() => setPicked(new Set(filtered.map((p) => p.n)))} disabled={filtered.length === 0}>
              Marcar todos ({filtered.length})
            </button>
            <button className="btn btn-small" onClick={() => setPicked(new Set())} disabled={picked.size === 0}>
              Limpar
            </button>
          </div>

          {points === undefined ? null : (
            <div className="ref-list" role="group" aria-label="Pontos da camada">
              {shown.map((p) => (
                <button key={p.n} type="button" className="ref-row" aria-pressed={picked.has(p.n)} onClick={() => toggle(p.n)}>
                  <span className="ref-box" aria-hidden="true">{picked.has(p.n) ? '✓' : ''}</span>
                  <span className="ref-name">{p.name || '(sem nome)'}</span>
                  {converted.has(p.n) && <span className="ref-badge">já convertido</span>}
                </button>
              ))}
              {filtered.length === 0 && <p className="hint">Nenhum ponto encontrado.</p>}
              {filtered.length > shown.length && (
                <p className="hint">Mostrando {shown.length} de {filtered.length}. Refine a busca para ver outros (“Marcar todos” marca os {filtered.length}).</p>
              )}
            </div>
          )}

          {open === null && (
            <div className="alert" role="alert">
              Não há atividade aberta. Inicie uma atividade para criar elementos.
              <button className="btn btn-block" style={{ marginTop: 10 }} onClick={() => navigate('nova-atividade')}>Iniciar atividade</button>
            </div>
          )}
          {msg && <div className={msg.kind === 'ok' ? 'ok-note' : 'alert'} role={msg.kind === 'ok' ? 'status' : 'alert'}>{msg.text}</div>}
          <button className="btn btn-primary btn-block" disabled={picked.size === 0 || !open || busy} onClick={() => setConfirmConvert(true)}>
            {picked.size === 0 ? 'Converter pontos marcados' : `Converter ${plural(picked.size, 'ponto', 'pontos')}`}
          </button>
        </section>
      )}

      <section className="section" aria-label="Excluir">
        <button className="btn btn-danger btn-block" onClick={() => setConfirmDelete(true)}>Excluir camada</button>
        <p className="hint">Remove só a camada deste aparelho. Os elementos que você já converteu continuam.</p>
      </section>

      {confirmConvert && open && (
        <ConfirmDialog
          title="Criar elementos?"
          message={`Criar ${plural(picked.size, 'elemento', 'elementos')} do tipo ${typeLabel} na atividade “${open.title}”?`}
          confirmLabel="Criar"
          onCancel={() => setConfirmConvert(false)}
          onConfirm={() => void convert()}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Excluir camada?"
          message={`A camada “${layer.name}” será removida deste aparelho. Os elementos já convertidos não são afetados. Você pode importar o arquivo de novo depois.`}
          confirmLabel="Excluir"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </ScreenShell>
  );
}
