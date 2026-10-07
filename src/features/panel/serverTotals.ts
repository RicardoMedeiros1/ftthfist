import type { SupabaseClient } from '@supabase/supabase-js';
import { classifyError } from '../sync/remote';
import { dayEnd, dayStart } from './mapFilters';
import type { TotalsFilters, TotalsRow } from './totals';

// Conferencia dos totais com o servidor: a funcao cable_totals soma os cabos de la (a mesma conta do celular). Se a soma daqui
// nao bate, este navegador ainda nao recebeu tudo (falta sincronizar).

export interface ServerTotalsRow {
  owner: string;
  label: string;
  cables: number;
  lengthMeters: number;
  reserveMeters: number;
  totalMeters: number;
}

export type TotalsErrorKind = 'network' | 'auth' | 'other';
export class TotalsApiError extends Error {
  constructor(readonly kind: TotalsErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'TotalsApiError';
  }
}

export interface TotalsApi {
  /** Periodo [from, to): o fim NAO entra (como na funcao do servidor). */
  cableTotals(fromIso: string, toIso: string): Promise<ServerTotalsRow[]>;
}

const OPEN_FROM = '1970-01-01T00:00:00.000Z';
const OPEN_TO = '2100-01-01T00:00:00.000Z';

/** Limites do periodo para o servidor: do inicio do dia "de" ate o inicio do dia seguinte a "ate" (aberto se vazio). */
export function periodBounds(f: Pick<TotalsFilters, 'from' | 'to'>): { from: string; to: string } {
  const from = f.from ? dayStart(f.from) : null;
  const to = f.to ? dayEnd(f.to) : null;
  return { from: from === null ? OPEN_FROM : new Date(from).toISOString(), to: to === null ? OPEN_TO : new Date(to + 1).toISOString() };
}

export function createSupabaseTotalsApi(client: Pick<SupabaseClient, 'rpc'>): TotalsApi {
  return {
    async cableTotals(fromIso, toIso) {
      const { data, error, status } = await client.rpc('cable_totals', { p_from: fromIso, p_to: toIso }).retry(false);
      if (error) {
        const kind = classifyError(status, error.code);
        throw new TotalsApiError(kind === 'network' || kind === 'transient' ? 'network' : kind === 'auth' ? 'auth' : 'other', error.message);
      }
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        owner: String(r.owner_id),
        label: String(r.technician ?? ''),
        cables: Number(r.cables),
        lengthMeters: Number(r.length_m),
        reserveMeters: Number(r.reserve_m),
        totalMeters: Number(r.total_m),
      }));
    },
  };
}

export type DiffStatus = 'diferente' | 'so-servidor' | 'so-aqui';
export interface TotalsDiff {
  owner: string;
  label: string;
  status: DiffStatus;
  here: { cables: number; totalMeters: number };
  server: { cables: number; totalMeters: number };
}

const TOLERANCE_M = 0.05;

/** Compara por tecnico (conta). Sem diferenca = os numeros daqui batem com o servidor. */
export function compareWithServer(local: TotalsRow[], server: ServerTotalsRow[]): { equal: boolean; diffs: TotalsDiff[] } {
  const mine = new Map(local.filter((r) => r.cables > 0).map((r) => [r.owner, r]));
  const theirs = new Map(server.filter((r) => r.cables > 0).map((r) => [r.owner, r]));
  const diffs: TotalsDiff[] = [];
  for (const k of new Set([...mine.keys(), ...theirs.keys()])) {
    const a = mine.get(k);
    const b = theirs.get(k);
    const here = { cables: a?.cables ?? 0, totalMeters: a?.totalMeters ?? 0 };
    const there = { cables: b?.cables ?? 0, totalMeters: b?.totalMeters ?? 0 };
    const label = a?.label ?? b?.label ?? '';
    if (!a) diffs.push({ owner: k, label, status: 'so-servidor', here, server: there });
    else if (!b) diffs.push({ owner: k, label, status: 'so-aqui', here, server: there });
    else if (here.cables !== there.cables || Math.abs(here.totalMeters - there.totalMeters) > TOLERANCE_M || Math.abs(a.lengthMeters - b.lengthMeters) > TOLERANCE_M || Math.abs(a.reserveMeters - b.reserveMeters) > TOLERANCE_M) {
      diffs.push({ owner: k, label, status: 'diferente', here, server: there });
    }
  }
  return { equal: diffs.length === 0, diffs: diffs.sort((x, y) => x.label.localeCompare(y.label, 'pt-BR')) };
}

export function totalsErrorText(e: unknown): string {
  const kind = e instanceof TotalsApiError ? e.kind : 'other';
  return kind === 'network' ? 'Sem conexão com o servidor. Confira a internet e tente de novo.' : kind === 'auth' ? 'Sua sessão venceu. Saia e entre de novo na conta.' : 'Não foi possível conferir agora. Tente de novo.';
}
