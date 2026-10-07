import { isSupabaseConfigured, loadSupabaseClient } from '../account/supabaseClient';
import { TotalsApiError, createSupabaseTotalsApi, type TotalsApi } from './serverTotals';

// Liga a conferencia dos totais ao cliente do Supabase (carregado so quando se pede a conferencia).

let api: Promise<TotalsApi> | null = null;
function load(): Promise<TotalsApi> {
  api ??= loadSupabaseClient().then((client) => {
    if (!client) throw new TotalsApiError('other', 'app sem servidor');
    return createSupabaseTotalsApi(client);
  });
  return api.catch((e: unknown) => {
    api = null; // sem internet na primeira vez: nao guarda a falha
    throw e instanceof TotalsApiError ? e : new TotalsApiError('network', 'nao deu para carregar o cliente do servidor');
  });
}

/** Null quando o app nao esta ligado a um servidor. */
export const totalsApi: TotalsApi | null = isSupabaseConfigured ? { cableTotals: async (from, to) => (await load()).cableTotals(from, to) } : null;
