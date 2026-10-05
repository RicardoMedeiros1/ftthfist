import type { NetworkElement } from '../../db/types';

export interface InfoRow {
  label: string;
  value: string;
}

const OWNER: Record<string, string> = { concessionaria: 'Concessionária', proprio: 'Próprio', outro: 'Outro' };
const PROBLEM: Record<string, string> = {
  rompimento: 'Rompimento',
  atenuacao: 'Atenuação',
  poste_caido: 'Poste caído',
  caixa_danificada: 'Caixa danificada',
  outro: 'Outro',
};

/** Número no formato brasileiro (12.5 → "12,5"). */
export const formatNumber = (n: number) => String(n).replace('.', ',');

/** Atributos do tipo, já em linhas legíveis. Só aparecem os que foram preenchidos. */
export function describeAttrs(el: Pick<NetworkElement, 'type' | 'attrs'>): InfoRow[] {
  const a = el.attrs as Record<string, unknown>;
  const rows: InfoRow[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value !== undefined && value !== '') rows.push({ label, value });
  };
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : undefined);

  switch (el.type) {
    case 'poste':
      add('Dono', OWNER[str('owner') ?? '']);
      add('Plaqueta da concessionária', str('ownerCode'));
      break;
    case 'cto':
      add('Capacidade', num('capacity') !== undefined ? `${num('capacity')} portas` : undefined);
      add('Splitter', str('splitter'));
      break;
    case 'ceo':
      add('Bandejas', num('trays') !== undefined ? String(num('trays')) : undefined);
      add('Emendas', num('splices') !== undefined ? String(num('splices')) : undefined);
      break;
    case 'reserva':
      add('Reserva', num('meters') !== undefined ? `${formatNumber(num('meters')!)} m` : undefined);
      break;
    case 'ocorrencia':
      add('Problema', PROBLEM[str('problem') ?? '']);
      add('O que foi feito', str('actionTaken'));
      break;
    case 'outro':
      break;
  }
  return rows;
}

/** Atributos guardados → texto dos campos do formulário (para editar). */
export function attrsToFormStrings(attrs: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((attrs ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'number') out[k] = formatNumber(v);
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}
