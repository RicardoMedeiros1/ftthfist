import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('reconhece as telas', () => {
    expect(parseRoute('#/atividades')).toBe('atividades');
    expect(parseRoute('#/atividades/nova')).toBe('nova-atividade');
    expect(parseRoute('#/config')).toBe('config');
  });
  it('qualquer outra coisa abre o mapa', () => {
    expect(parseRoute('')).toBe('map');
    expect(parseRoute('#/')).toBe('map');
    expect(parseRoute('#/inexistente')).toBe('map');
  });
});
