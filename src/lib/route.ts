import { useSyncExternalStore } from 'react';

// Navegação por hash: funciona em qualquer subpasta (GitHub Pages) e o botão
// "voltar" do celular segue o histórico do app.
export type Route = 'map' | 'atividades' | 'nova-atividade' | 'config';

const HASH: Record<Route, string> = {
  map: '#/',
  atividades: '#/atividades',
  'nova-atividade': '#/atividades/nova',
  config: '#/config',
};

export function parseRoute(hash: string): Route {
  const found = (Object.keys(HASH) as Route[]).find((r) => HASH[r] === hash);
  return found ?? 'map';
}

const EVENT = 'rf-route';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVENT, cb);
  };
}

const idx = () => (history.state as { idx?: number } | null)?.idx ?? 0;

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState({ idx: idx() }, '', HASH[route]);
  else history.pushState({ idx: idx() + 1 }, '', HASH[route]);
  window.dispatchEvent(new Event(EVENT));
}

/** Volta no histórico do app; se a tela foi aberta direto (sem histórico), vai para `fallback`. */
export function goBack(fallback: Route = 'map') {
  if (idx() > 0) history.back();
  else navigate(fallback, { replace: true });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    subscribe,
    () => parseRoute(window.location.hash),
    () => 'map' as Route,
  );
}
