import { useSyncExternalStore } from 'react';

// Tema da interface: duas paletas sobre o mesmo layout. É uma preferência do aparelho (não vai para o servidor nem para o
// backup): fica no localStorage para valer já na primeira pintura, antes de qualquer leitura do banco local.

export type ThemeId = 'polegar' | 'fibra';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  hint: string;
  /** Cores da amostra na tela de escolha (as mesmas do tema). */
  swatch: { bg: string; surface: string; accent: string };
  /** Cor da barra do sistema (PWA) com o tema ativo. */
  color: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'polegar', label: 'Polegar', hint: 'Grafite e verde-limão. Contraste alto, o melhor para ler ao sol.', swatch: { bg: '#111418', surface: '#1b2026', accent: '#b6f23c' }, color: '#111418' },
  { id: 'fibra', label: 'Fibra', hint: 'Azul-petróleo e ciano. Mais suave, ótimo à noite e no escritório.', swatch: { bg: '#0b1f2a', surface: '#12313f', accent: '#22d3ee' }, color: '#0b1f2a' },
];

export const DEFAULT_THEME: ThemeId = 'polegar';
export const THEME_STORAGE_KEY = 'rf-theme';

export const isThemeId = (v: unknown): v is ThemeId => v === 'polegar' || v === 'fibra';

/** Qualquer valor guardado vira um tema válido (o que não for reconhecido volta ao padrão). */
export const parseTheme = (v: unknown): ThemeId => (isThemeId(v) ? v : DEFAULT_THEME);

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** localStorage, se existir e funcionar (pode faltar ou lançar em janela privada). */
function deviceStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readTheme(storage: StorageLike | null = deviceStorage()): ThemeId {
  try {
    return parseTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

interface RootLike {
  dataset: Record<string, string | undefined>;
}
interface MetaLike {
  setAttribute(name: string, value: string): void;
}

/** Liga o tema na página: o atributo `data-theme` do `<html>` e a cor do `<meta name="theme-color">`. */
export function applyTheme(
  id: ThemeId,
  root: RootLike | null = typeof document === 'undefined' ? null : document.documentElement,
  meta: MetaLike | null = typeof document === 'undefined' ? null : document.querySelector('meta[name="theme-color"]'),
): void {
  if (root) root.dataset.theme = id;
  meta?.setAttribute('content', THEMES.find((t) => t.id === id)!.color);
}

const listeners = new Set<() => void>();
let current: ThemeId = DEFAULT_THEME;

/** Ao abrir o app: lê o tema do aparelho e liga na página. */
export function initTheme(): ThemeId {
  current = readTheme();
  applyTheme(current);
  return current;
}

/** Muda o tema agora e guarda no aparelho (falhar ao guardar não impede de usar nesta sessão). */
export function setTheme(id: ThemeId, storage: StorageLike | null = deviceStorage()): void {
  current = id;
  try {
    storage?.setItem(THEME_STORAGE_KEY, id);
  } catch {
    /* sem armazenamento: vale só até fechar o app */
  }
  applyTheme(id);
  listeners.forEach((l) => l());
}

export const getTheme = (): ThemeId => current;

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => DEFAULT_THEME,
  );
}
