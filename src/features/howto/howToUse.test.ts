import { describe, expect, it } from 'vitest';
import { DEMO_PATH, howToUseUrl } from './howToUse';

describe('endereço do "Como usar"', () => {
  it('fica na pasta demo/ da base do app', () => {
    expect(DEMO_PATH).toBe('demo/');
    expect(howToUseUrl('/')).toBe('/demo/');
    expect(howToUseUrl('/ftthfist/')).toBe('/ftthfist/demo/');
  });
  it('aceita base sem a barra final', () => {
    expect(howToUseUrl('/ftthfist')).toBe('/ftthfist/demo/');
  });
  it('sem base explícita usa a do build', () => {
    expect(howToUseUrl()).toBe(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}demo/`);
  });
});
