import type { ReactNode } from 'react';
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
  return (
    <div className="screen" role="dialog" aria-modal="true" aria-label={title}>
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
