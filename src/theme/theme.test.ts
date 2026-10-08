import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_THEME, THEMES, THEME_STORAGE_KEY, applyTheme, getTheme, isThemeId, parseTheme, readTheme, setTheme } from './theme';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('tema da interface', () => {
  it('os dois temas existem e o padrão é o Polegar', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['polegar', 'fibra']);
    expect(DEFAULT_THEME).toBe('polegar');
  });

  it('só reconhece os temas conhecidos; o resto volta ao padrão', () => {
    expect(isThemeId('fibra')).toBe(true);
    expect(isThemeId('claro')).toBe(false);
    expect(parseTheme('fibra')).toBe('fibra');
    for (const lixo of [null, undefined, '', 'FIBRA', 'sol', 3, {}]) expect(parseTheme(lixo)).toBe('polegar');
  });

  it('lê do aparelho; sem nada guardado, ou com armazenamento quebrado, usa o padrão', () => {
    const s = new MemoryStorage();
    expect(readTheme(s)).toBe('polegar');
    s.setItem(THEME_STORAGE_KEY, 'fibra');
    expect(readTheme(s)).toBe('fibra');
    s.setItem(THEME_STORAGE_KEY, 'qualquer');
    expect(readTheme(s)).toBe('polegar');
    expect(readTheme(null)).toBe('polegar');
    expect(readTheme({ getItem: () => { throw new Error('bloqueado'); }, setItem: () => undefined })).toBe('polegar');
  });

  it('liga o tema na página e muda a cor da barra do sistema', () => {
    const root = { dataset: {} as Record<string, string | undefined> };
    const meta = { content: '', setAttribute(_n: string, v: string) { this.content = v; } };
    applyTheme('fibra', root, meta);
    expect(root.dataset.theme).toBe('fibra');
    expect(meta.content).toBe('#0b1f2a');
    applyTheme('polegar', root, meta);
    expect(root.dataset.theme).toBe('polegar');
    expect(meta.content).toBe('#111418');
    applyTheme('fibra', null, null); // sem página (testes, servidor): não quebra
  });

  describe('trocar de tema', () => {
    let s: MemoryStorage;
    beforeEach(() => { s = new MemoryStorage(); });

    it('guarda no aparelho e vale na hora', () => {
      setTheme('fibra', s);
      expect(s.getItem(THEME_STORAGE_KEY)).toBe('fibra');
      expect(getTheme()).toBe('fibra');
      setTheme('polegar', s);
      expect(s.getItem(THEME_STORAGE_KEY)).toBe('polegar');
      expect(getTheme()).toBe('polegar');
    });

    it('se não der para guardar, o tema vale mesmo assim nesta sessão', () => {
      setTheme('fibra', { getItem: () => null, setItem: () => { throw new Error('cheio'); } });
      expect(getTheme()).toBe('fibra');
      setTheme('polegar', null);
      expect(getTheme()).toBe('polegar');
    });
  });

  it('cada tema tem amostra e cor de barra próprias, e nenhuma se repete', () => {
    expect(new Set(THEMES.map((t) => t.swatch.accent)).size).toBe(2);
    expect(new Set(THEMES.map((t) => t.color)).size).toBe(2);
    for (const t of THEMES) expect(t.color).toBe(t.swatch.bg);
  });
});
