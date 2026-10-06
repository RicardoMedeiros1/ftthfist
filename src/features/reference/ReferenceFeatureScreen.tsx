import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ScreenShell from '../../components/ScreenShell';
import type { ElementType, RefGeometry } from '../../db/types';
import { formatMeters, pathLengthMeters } from '../../lib/geo';
import { goBack, navigate, useRouteId } from '../../lib/route';
import { activities } from '../activities/activityRepo';
import { ElementRuleError } from '../elements/elementRepo';
import { ELEMENT_TYPES } from '../elements/meta';
import { mapCommands, type Bounds } from '../map/mapCommands';
import { useTechnician } from '../settings/useTechnician';
import { ReferenceRuleError, parseFeatureId, references } from './referenceRepo';
import './reference.css';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value pre-wrap">{value}</span>
    </div>
  );
}

const KIND_LABEL = { point: 'Ponto', line: 'Linha', polygon: 'Polígono' } as const;

function boundsOf(g: RefGeometry): Bounds {
  const all = g.kind === 'point' ? [g.coord] : g.kind === 'line' ? g.parts.flat() : g.rings.flat();
  const lats = all.map((c) => c[1]);
  const lngs = all.map((c) => c[0]);
  return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)];
}

/** Um item da camada de referência (aberto ao tocar nele no mapa). Pontos podem virar elementos. */
export default function ReferenceFeatureScreen() {
  const id = useRouteId();
  const parsed = id ? parseFeatureId(id) : null;
  const feature = useLiveQuery(async () => (id ? ((await references.getFeature(id)) ?? null) : null), [id]);
  const layer = useLiveQuery(async () => (parsed ? ((await references.get(parsed.layerId)) ?? null) : null), [parsed?.layerId]);
  const open = useLiveQuery(() => activities.getOpen());
  const technician = useTechnician();

  const [type, setType] = useState<ElementType>('poste');
  const [edits, setEdits] = useState<{ code: string; notes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => goBack('map');

  if (feature === undefined || layer === undefined) return <ScreenShell title="Referência" onBack={back}>{null}</ScreenShell>;
  if (!feature || !layer) {
    return (
      <ScreenShell title="Referência" onBack={back}>
        <div className="alert" role="alert">Este item não existe mais. A camada pode ter sido excluída.</div>
        <button className="btn btn-block" onClick={back}>Voltar ao mapa</button>
      </ScreenShell>
    );
  }

  const g = feature.geom;
  const already = layer.converted.includes(feature.n);
  const defaults = {
    code: feature.name.slice(0, 80),
    notes: [`Origem: camada ${layer.name}`, feature.description].filter(Boolean).join('\n').slice(0, 1000),
  };
  const form = edits ?? defaults;

  const size =
    g.kind === 'point'
      ? `${g.coord[1].toFixed(6)}, ${g.coord[0].toFixed(6)}`
      : g.kind === 'line'
        ? `${formatMeters(g.parts.reduce((s, p) => s + pathLengthMeters(p.map(([lng, lat]) => ({ lat, lng }))), 0))} · ${g.parts.flat().length} pontos`
        : `${g.rings.flat().length} pontos no contorno`;

  function viewOnMap() {
    if (!layer!.visible) void references.setVisible(layer!.id, true);
    if (g.kind === 'point') mapCommands.center(g.coord[1], g.coord[0], 19);
    else mapCommands.fitBounds(boundsOf(g));
    navigate('map');
  }

  async function convert() {
    setBusy(true);
    setError(null);
    try {
      const [el] = await references.convertPoints(layer!.id, [feature!.n], type, technician ?? '', { override: { code: form.code, notes: form.notes } });
      navigate('elemento', { id: el!.id, replace: true });
    } catch (e) {
      setError(e instanceof ElementRuleError || e instanceof ReferenceRuleError ? e.message : 'Não foi possível criar o elemento. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="Item de referência" onBack={back}>
      <section className="card" aria-label="Item">
        <div className="card-title">{feature.name || '(sem nome)'}</div>
        <div className="card-meta">
          <span className="ref-dot" style={{ background: layer.color }} aria-hidden="true" />
          {KIND_LABEL[g.kind]} · camada {layer.name}
        </div>
      </section>

      <div className="info-list">
        <Row label={g.kind === 'point' ? 'Posição (do arquivo)' : 'Tamanho'} value={size} />
        {feature.props.map(([k, v]) => (
          <Row key={k} label={k} value={v} />
        ))}
      </div>
      {feature.description && (
        <div className="field">
          <span className="label">Descrição</span>
          <div className="ref-desc pre-wrap">{feature.description}</div>
        </div>
      )}

      <button className="btn btn-block" onClick={viewOnMap}>Ver no mapa</button>

      {g.kind === 'point' && (
        <section className="section" aria-label="Converter em elemento">
          <h2>Converter em elemento</h2>
          {already && <div className="ok-note" role="status">Este ponto já foi convertido em elemento. Converter de novo cria outro.</div>}
          <div className="field">
            <span className="label" id="one-type-label">Tipo</span>
            <div className="chips chips-types" role="group" aria-labelledby="one-type-label">
              {ELEMENT_TYPES.map((t) => (
                <button key={t.type} type="button" aria-pressed={type === t.type} onClick={() => setType(t.type)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="conv-code">Identificação (código)</label>
            <input id="conv-code" type="text" value={form.code} onChange={(e) => setEdits({ ...form, code: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="conv-notes">Observações</label>
            <textarea id="conv-notes" rows={3} value={form.notes} onChange={(e) => setEdits({ ...form, notes: e.target.value })} />
          </div>
          <p className="hint">A posição vem do arquivo, não do GPS: o elemento fica marcado como “posição no mapa”, sem precisão.</p>
          {open === null && (
            <div className="alert" role="alert">
              Não há atividade aberta. Inicie uma atividade para criar elementos.
              <button className="btn btn-block" style={{ marginTop: 10 }} onClick={() => navigate('nova-atividade')}>Iniciar atividade</button>
            </div>
          )}
          {error && <div className="alert" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={!open || busy} onClick={() => void convert()}>
            Converter em elemento
          </button>
        </section>
      )}
    </ScreenShell>
  );
}
