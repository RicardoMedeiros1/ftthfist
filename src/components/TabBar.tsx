import type { ReactNode } from 'react';
import { useRoute, navigate, type Route } from '../lib/route';
import { useAccount } from '../features/account/accountStore';
import AddButton from '../features/elements/AddButton';
import { useDraft } from '../features/elements/draftStore';
import { useSelectedRoute } from '../features/cables/routeStore';
import { useLegendOpen } from '../features/map/legendStore';
import './tabbar.css';

/** Telas "raiz": a barra de abas aparece nelas (e some nas telas de detalhe, que têm o botão ←). */
const TAB_ROUTES: readonly Route[] = ['map', 'atividades', 'meus-projetos', 'projetos', 'config'];

export const isTabRoute = (route: Route): boolean => TAB_ROUTES.includes(route);

type Tab = 'mapa' | 'atividades' | 'projetos' | 'ajustes';

const tabOf = (route: Route): Tab | null =>
  route === 'map' ? 'mapa' : route === 'atividades' ? 'atividades' : route === 'meus-projetos' || route === 'projetos' ? 'projetos' : route === 'config' ? 'ajustes' : null;

const ICONS: Record<Tab, ReactNode> = {
  mapa: <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />,
  atividades: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  projetos: <path d="M4 5h16v14H4zM4 10h16M9 10v9" />,
  ajustes: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
    </>
  ),
};

function TabButton({ tab, label, current, onGo }: { tab: Tab; label: string; current: Tab | null; onGo: () => void }) {
  return (
    <button className="tab-btn" onClick={onGo} aria-current={current === tab ? 'page' : undefined}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[tab]}
      </svg>
      {label}
    </button>
  );
}

/**
 * Barra de baixo: Mapa, Atividades, "+" (marcar elemento), Projetos e Ajustes. Um único componente no App, para o
 * "+" existir uma vez só. No mapa só aparece com o mapa livre (durante marcação, lançamento ou folhas, os painéis ocupam o rodapé).
 */
export default function TabBar() {
  const route = useRoute();
  const phase = useDraft((s) => s.phase);
  const routeOpen = useSelectedRoute() !== null;
  const legendOpen = useLegendOpen();
  const role = useAccount((a) => (a.status === 'ativo' ? a.profile?.role : undefined));

  if (!isTabRoute(route)) return null;
  if (route === 'map' && (phase !== 'idle' || routeOpen || legendOpen)) return null;

  const current = tabOf(route);
  // Entre abas troca no lugar (o ← do celular volta para o mapa, não percorre as abas visitadas).
  const go = (to: Route) => {
    if (to === route) return;
    navigate(to, { replace: route !== 'map' });
  };

  return (
    <nav className={`tab-bar ${route === 'map' ? '' : 'tab-bar-over'}`} aria-label="Navegação">
      <TabButton tab="mapa" label="Mapa" current={current} onGo={() => go('map')} />
      <TabButton tab="atividades" label="Atividades" current={current} onGo={() => go('atividades')} />
      <div className="tab-add-slot">
        <AddButton />
        <span className="tab-add-label" aria-hidden="true">
          Marcar
        </span>
      </div>
      <TabButton tab="projetos" label="Projetos" current={current} onGo={() => go(role === 'admin' ? 'projetos' : 'meus-projetos')} />
      <TabButton tab="ajustes" label="Ajustes" current={current} onGo={() => go('config')} />
    </nav>
  );
}
