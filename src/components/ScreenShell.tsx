import type { ReactNode } from 'react';
import { useRoute } from '../lib/route';
import { isTabRoute } from './tabs';
import './ui.css';

export default function ScreenShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  // Nas telas raiz a barra de abas fica por cima do rodapé: o conteúdo precisa terminar acima dela.
  const tabs = isTabRoute(useRoute());
  return (
    <div className={`screen${tabs ? ' screen-tabs' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="screen-header">
        <button className="btn btn-small" onClick={onBack} aria-label="Voltar">
          ←
        </button>
        <h1>{title}</h1>
      </header>
      <div className="screen-body">{children}</div>
    </div>
  );
}
