import type { ElementType } from '../../db/types';
import type { CableChoice } from '../cables/cableChoices';
import { Chips, NumberField, TextField } from './fields';

export interface FieldValues {
  code: string;
  notes: string;
  /** Texto dos campos do tipo (convertido em número/validado ao salvar). */
  attrs: Record<string, string>;
}

export const emptyValues: FieldValues = { code: '', notes: '', attrs: {} };

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

function TypeFields({
  type,
  attrs,
  set,
  cableChoices,
}: {
  type: ElementType;
  attrs: Record<string, string>;
  set: (k: string, v: string) => void;
  cableChoices: CableChoice[];
}) {
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
      return (
        <>
          <NumberField id="meters" label="Metros de reserva" decimal value={get('meters')} onChange={(v) => set('meters', v)} />
          {cableChoices.length > 0 && (
            <Chips
              label="Cabo desta reserva"
              value={get('cableId')}
              options={cableChoices.map((c) => ({ value: c.id, label: c.label }))}
              onChange={(v) => set('cableId', v)}
            />
          )}
        </>
      );
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

/** Campos do elemento (identificação, atributos do tipo e observações), usados ao criar e ao editar. */
export default function ElementFields({
  type,
  values,
  onChange,
  cableChoices = [],
}: {
  type: ElementType;
  values: FieldValues;
  onChange: (v: FieldValues) => void;
  /** Cabos próximos (para ligar uma reserva); só aparece em Reserva. */
  cableChoices?: CableChoice[];
}) {
  return (
    <>
      <TextField id="code" label="Identificação / plaqueta" value={values.code} onChange={(code) => onChange({ ...values, code })} />
      <TypeFields
        type={type}
        attrs={values.attrs}
        set={(k, v) => onChange({ ...values, attrs: { ...values.attrs, [k]: v } })}
        cableChoices={cableChoices}
      />
      <div className="field">
        <label htmlFor="notes">Observações</label>
        <textarea id="notes" value={values.notes} onChange={(e) => onChange({ ...values, notes: e.target.value })} rows={3} />
      </div>
    </>
  );
}
