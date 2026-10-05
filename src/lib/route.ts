import { useSyncExternalStore } from 'react';

// Navegação por hash: funciona em qualquer subpasta (GitHub Pages) e o botão
// "voltar" do celular segue o histórico do app.
export type Route = 'map' | 'atividades' | 'nova-atividade' | 'novo-elemento' | 'elemento' | 'config';

const STATIC_HASH: Record<Exclude<Route, 'elemento'>, string> = {
  map: '#/',
  atividades: '#/atividades',
  'nova-atividade': '#/atividades/nova',
  'novo-elemento': '#/elemento/novo',
  config: '#/config',
};

export interface AppLocation {
  route: Route;
  /** Só na rota 'elemento': id do elemento aberto. */
  id?: string;
}

export function parseLocation(hash: string): AppLocation {
  const fixed = (Object.keys(STATIC_HASH) as Exclude<Route, 'elemento'>[]).find((r) => STATIC_HASH[r] === hash);
  if (fixed) return { route: fixed };
  const m = /^#\/elemento\/([^/]+)$/.exec(hash);
  if (m?.[1]) {
    try {
      return { route: 'elemento', id: decodeURIComponent(m[1]) };
    } catch {
      return { route: 'map' };
    }
  }
  return { route: 'map' };
}

export function parseRoute(hash: string): Route {
  return parseLocation(hash).route;
}

function hashFor(route: Route, id?: string): string {
  if (route === 'elemento') return id ? `#/elemento/${encodeURIComponent(id)}` : STATIC_HASH.map;
  return STATIC_HASH[route];
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

export function navigate(route: Route, opts: { replace?: boolean; id?: string } = {}) {
  const hash = hashFor(route, opts.id);
  if (opts.replace) history.replaceState({ idx: idx() }, '', hash);
  else history.pushState({ idx: idx() + 1 }, '', hash);
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

/** Id do elemento na rota 'elemento' (undefined nas outras). */
export function useRouteId(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => parseLocation(window.location.hash).id,
    () => undefined,
  );
}
