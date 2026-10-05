import { describe, expect, it } from 'vitest';
import { classifyAccuracy, formatAccuracy } from './geo';

describe('precisão do GPS', () => {
  it('até 15 m é boa; acima de 15 m é ruim', () => {
    expect(classifyAccuracy(5)).toBe('boa');
    expect(classifyAccuracy(15)).toBe('boa');
    expect(classifyAccuracy(15.1)).toBe('ruim');
    expect(classifyAccuracy(80)).toBe('ruim');
  });
  it('formata arredondando para metros inteiros', () => {
    expect(formatAccuracy(7.6)).toBe('±8 m');
  });
});
