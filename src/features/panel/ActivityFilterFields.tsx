import { presetRange, type ActivityFilterValues, type PeriodPreset, type TechnicianOption } from './mapFilters';

const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
];

/** Tecnico, tipo, situacao e periodo da atividade: os mesmos campos no mapa e na tabela. `prefix` evita ids repetidos. */
export default function ActivityFilterFields({
  prefix,
  value,
  owners,
  onChange,
  hideStatus = false,
  periodLabel = 'Período (início da atividade)',
}: {
  prefix: string;
  value: ActivityFilterValues;
  owners: TechnicianOption[];
  onChange: (patch: Partial<ActivityFilterValues>) => void;
  /** A secao de totais nao filtra pela situacao da atividade. */
  hideStatus?: boolean;
  periodLabel?: string;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-owner`}>Técnico</label>
        <select id={`${prefix}-owner`} value={value.owner} onChange={(e) => onChange({ owner: e.target.value })}>
          <option value="todos">Todos</option>
          {owners.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-kind`}>Tipo de atividade</label>
        <select id={`${prefix}-kind`} value={value.kind} onChange={(e) => onChange({ kind: e.target.value as ActivityFilterValues['kind'] })}>
          <option value="todas">Todos</option>
          <option value="implantacao">Implantação</option>
          <option value="manutencao">Manutenção</option>
        </select>
      </div>
      {!hideStatus && (
      <div className="field">
        <label htmlFor={`${prefix}-status`}>Situação</label>
        <select id={`${prefix}-status`} value={value.status} onChange={(e) => onChange({ status: e.target.value as ActivityFilterValues['status'] })}>
          <option value="todas">Todas</option>
          <option value="aberta">Em aberto</option>
          <option value="concluida">Concluídas</option>
        </select>
      </div>
      )}
      <div className="field">
        <span className="label">{periodLabel}</span>
        <div className="panel-presets" role="group" aria-label="Período">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="btn btn-small" onClick={() => onChange(presetRange(p.id, Date.now()))}>
              {p.label}
            </button>
          ))}
          <button type="button" className="btn btn-small" disabled={value.from === '' && value.to === ''} onClick={() => onChange({ from: '', to: '' })}>
            Tudo
          </button>
        </div>
        <div className="panel-dates">
          <label htmlFor={`${prefix}-from`}>De</label>
          <input id={`${prefix}-from`} type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
          <label htmlFor={`${prefix}-to`}>Até</label>
          <input id={`${prefix}-to`} type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
        </div>
      </div>
    </>
  );
}
