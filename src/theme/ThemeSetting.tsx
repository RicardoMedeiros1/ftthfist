import { THEMES, setTheme, useTheme } from './theme';

/** Em Configurações: escolher o tema da interface (vale na hora e fica no aparelho). */
export default function ThemeSetting() {
  const current = useTheme();
  return (
    <section className="card" aria-label="Aparência">
      <div className="card-title">Aparência</div>
      <div className="theme-options" role="group" aria-label="Tema da interface">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="theme-option"
            aria-pressed={current === t.id}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-swatch" aria-hidden="true" style={{ background: t.swatch.bg }}>
              <span style={{ background: t.swatch.surface }} />
              <span style={{ background: t.swatch.accent }} />
            </span>
            <span className="theme-option-text">
              <strong>{t.label}</strong>
              <small>{t.hint}</small>
            </span>
          </button>
        ))}
      </div>
      <p className="hint">A escolha vale só para este aparelho. O mapa é claro nos dois temas.</p>
    </section>
  );
}
