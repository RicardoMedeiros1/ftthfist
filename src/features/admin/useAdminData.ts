import { useCallback, useEffect, useRef, useState } from 'react';
import { adminErrorText } from './people';

export interface AdminLoad<T> {
  data: T | null;
  loading: boolean;
  /** Texto pronto para mostrar (ja em portugues). */
  error: string | null;
  reload(): void;
}

/** Carrega algo do servidor ao abrir a tela e quando `reload` e chamado. Uma resposta atrasada nunca sobrescreve a mais nova. */
export function useAdminData<T>(load: () => Promise<T>, deps: unknown[] = []): AdminLoad<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => mine === seq.current && setState({ data, loading: false, error: null }),
      (e: unknown) => mine === seq.current && setState((s) => ({ ...s, loading: false, error: adminErrorText(e) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
    return () => {
      seq.current++;
    };
  }, [run]);
  return { ...state, reload: run };
}
