// "Como usar": o demonstrativo é uma página estática publicada junto do app (public/demo/), com telas de exemplo para o
// técnico (celular) e para o administrador e o escritório (computador). Abre na mesma janela, dentro do escopo do app.

/** Pasta do demonstrativo, relativa à base do app. */
export const DEMO_PATH = 'demo/';

/** Endereço do demonstrativo para a base do app (`/` no desenvolvimento, `/ftthfist/` no GitHub Pages). */
export function howToUseUrl(base: string = import.meta.env.BASE_URL): string {
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  return `${withSlash}${DEMO_PATH}`;
}
