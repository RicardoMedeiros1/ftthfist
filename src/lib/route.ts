import { useSyncExternalStore } from 'react';

// Navegação por hash: funciona em qualquer subpasta (GitHub Pages) e o botão
// "voltar" do celular segue o histórico do app.
export type Route = 'map' | 'atividades' | 'nova-atividade' | 'novo-elemento' | 'elemento' | 'novo-cabo' | 'cabo' | 'trilha' | 'backup' | 'exportar' | 'camadas' | 'camada' | 'referencia' | 'conta' | 'config';

type IdRoute = 'elemento' | 'cabo' | 'exportar' | 'camada' | 'referencia';

// 'exportar' sem id exporta a rede inteira; com id, só aquela atividade.
const STATIC_HASH: Record<Exclude<Route, 'elemento' | 'cabo' | 'camada' | 'referencia'>, string> = {
  map: '#/',
  atividades: '#/atividades',
  'nova-atividade': '#/atividades/nova',
  'novo-elemento': '#/elemento/novo',
  'novo-cabo': '#/cabo/novo',
  trilha: '#/trilha',
  backup: '#/backup',
  exportar: '#/exportar',
  camadas: '#/camadas',
  conta: '#/conta',
  config: '#/config',
};

export interface AppLocation {
  route: Route;
  /** Nas rotas com id: id do registro aberto. */
  id?: string;
}

const WITH_ID: { route: IdRoute; re: RegExp }[] = [
  { route: 'elemento', re: /^#\/elemento\/([^/]+)$/ },
  { route: 'cabo', re: /^#\/cabo\/([^/]+)$/ },
  { route: 'exportar', re: /^#\/exportar\/([^/]+)$/ },
  { route: 'camada', re: /^#\/camada\/([^/]+)$/ },
  // id = `<camada>:<número>`; o ":" vai codificado (%3A)
  { route: 'referencia', re: /^#\/referencia\/([^/]+)$/ },
];

export function parseLocation(hash: string): AppLocation {
  const fixed = (Object.keys(STATIC_HASH) as (keyof typeof STATIC_HASH)[]).find((r) => STATIC_HASH[r] === hash);
  if (fixed) return { route: fixed };
  for (const { route, re } of WITH_ID) {
    const m = re.exec(hash);
    if (!m?.[1]) continue;
    try {
      return { route, id: decodeURIComponent(m[1]) };
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
  if (route === 'elemento' || route === 'cabo' || route === 'camada' || route === 'referencia') {
    return id ? `#/${route}/${encodeURIComponent(id)}` : STATIC_HASH.map;
  }
  if (route === 'exportar' && id) return `#/exportar/${encodeURIComponent(id)}`;
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

/** Id do registro nas rotas com id: 'elemento', 'cabo' e 'exportar' (undefined nas outras). */
export function useRouteId(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => parseLocation(window.location.hash).id,
    () => undefined,
  );
}
