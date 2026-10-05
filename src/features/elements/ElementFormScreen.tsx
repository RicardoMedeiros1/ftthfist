import { useEffect, useState, type FormEvent } from 'react';
import ScreenShell from '../../components/ScreenShell';
import { formatAccuracy } from '../../lib/geo';
import { goBack, navigate } from '../../lib/route';
import { useTechnician } from '../settings/useTechnician';
import { draftStore, useDraft } from './draftStore';
import { ElementRuleError, elementStore } from './elementRepo';
import { elementSvg } from './elementSvg';
import { Chips, NumberField, TextField } from './fields';
import { ELEMENT_META } from './meta';
import type { ElementType } from '../../db/types';

const OWNERS = [
  { value: 'concessionaria', label: 'Concessionária' },
  { value: 'proprio', label: 'Próprio' },
  { value: 'outro', label: 'Outro' },
] as const;
const SPLITTERS = ['1:2', '1:4', '1:8', '1:16', '1:32'].map((v) => ({ value: v, label: v }));
const PROBLEMS = [
  { value: 'rompimento', label: 'Rompimento' },
  { value: 'atenuacao', label: 'Atenuação' },
  { value: 'poste_caido', label: 'Poste caído' },
  { value: 'caixa_danificada', label: 'Caixa danificada' },
  { value: 'outro', label: 'Outro' },
] as const;

type Attrs = Record<string, string>;

function TypeFields({ type, attrs, set }: { type: ElementType; attrs: Attrs; set: (k: string, v: string) => void }) {
  const get = (k: string) => attrs[k] ?? '';
  switch (type) {
    case 'poste':
      return (
        <>
          <Chips label="De quem é o poste" value={get('owner')} options={[...OWNERS]} onChange={(v) => set('owner', v)} />
          <TextField id="ownerCode" label="Nº da plaqueta da concessionária" value={get('ownerCode')} onChange={(v) => set('ownerCode', v)} />
        </>
      );
    case 'cto':
      return (
        <>
          <NumberField id="capacity" label="Capacidade (portas)" value={get('capacity')} onChange={(v) => set('capacity', v)}>
            <div className="chips">
              {[8, 16].map((n) => (
                <button type="button" key={n} aria-pressed={get('capacity') === String(n)} onClick={() => set('capacity', String(n))}>
                  {n}
                </button>
              ))}
            </div>
          </NumberField>
          <Chips label="Splitter" value={get('splitter')} options={SPLITTERS} onChange={(v) => set('splitter', v)} />
        </>
      );
    case 'ceo':
      return (
        <>
          <NumberField id="trays" label="Bandejas" value={get('trays')} onChange={(v) => set('trays', v)} />
          <NumberField id="splices" label="Emendas" value={get('splices')} onChange={(v) => set('splices', v)} />
        </>
      );
    case 'reserva':
      return <NumberField id="meters" label="Metros de reserva" decimal value={get('meters')} onChange={(v) => set('meters', v)} hint="O vínculo com o cabo entra junto com o desenho de cabo." />;
    case 'ocorrencia':
      return (
        <>
          <Chips label="Problema" value={get('problem')} options={[...PROBLEMS]} onChange={(v) => set('problem', v)} />
          <TextField id="actionTaken" label="O que foi feito" value={get('actionTaken')} onChange={(v) => set('actionTaken', v)} />
        </>
      );
    case 'outro':
      return null;
  }
}

export default function ElementFormScreen() {
  const type = useDraft((s) => s.type);
  const position = useDraft((s) => s.position);
  const technician = useTechnician();
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [attrs, setAttrs] = useState<Attrs>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const missing = !type || !position;
  // Recarregar a página nesta tela perde o rascunho: volta para o mapa.
  useEffect(() => {
    if (missing) navigate('map', { replace: true });
  }, [missing]);
  if (missing) return null;

  const meta = ELEMENT_META[type];
  const where =
    position.source === 'gps' && position.accuracy !== undefined
      ? `GPS ${formatAccuracy(position.accuracy)}`
      : 'Posição marcada no mapa';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !type || !position) return;
    setBusy(true);
    setError(null);
    try {
      await elementStore.create(
        {
          type,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          positionSource: position.source,
          code,
          notes,
          attrs,
        },
        technician ?? '',
      );
      draftStore.saved(`Salvo: ${meta.label}${code.trim() ? ` ${code.trim()}` : ''}`);
      navigate('map', { replace: true });
    } catch (err) {
      setError(err instanceof ElementRuleError ? err.message : 'Não foi possível salvar. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <ScreenShell title="Dados do elemento" onBack={() => goBack('map')}>
      <form onSubmit={onSubmit} className="screen-body" style={{ padding: 0 }}>
        <div className="card element-summary">
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: elementSvg(type, { size: 44 }) }} />
          <div>
            <div className="card-title">{meta.label}</div>
            <div className="card-meta">{where}</div>
          </div>
        </div>

        <TextField id="code" label="Identificação / plaqueta" value={code} onChange={setCode} />
        <TypeFields type={type} attrs={attrs} set={(k, v) => setAttrs((a) => ({ ...a, [k]: v }))} />

        <div className="field">
          <label htmlFor="notes">Observações</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </div>

        {error && <div className="alert" role="alert">{error}</div>}

        <div className="sticky-actions">
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            Salvar {meta.label}
          </button>
        </div>
      </form>
    </ScreenShell>
  );
}
