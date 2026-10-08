import type { ReactNode } from 'react';

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** Botões grandes de escolha. Tocar no selecionado desmarca (campos opcionais). */
export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: string;
  options: Option<T>[];
  onChange: (v: string) => void;
  /** Classe a mais no grupo de botões (ex.: para diferenciar este grupo de outro igual na mesma tela). */
  className?: string;
}) {
  const id = `chips-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className={className ? `chips ${className}` : 'chips'} role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? '' : o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  decimal = false,
  hint,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  decimal?: boolean;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
