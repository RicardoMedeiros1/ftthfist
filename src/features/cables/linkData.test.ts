import { describe, expect, it } from 'vitest';
import { MAX_LINKS, isUuid, parseLinks } from './linkData';

const E = '00000000-0000-4000-8000-0000000000e1';
const C = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';

describe('isUuid', () => {
  it('só uuid completo, maiúsculo ou minúsculo', () => {
    expect(isUuid(E)).toBe(true);
    expect(isUuid(E.toUpperCase())).toBe(true);
    for (const bad of ['', 'x', E.slice(1), `${E}0`, 5, null, undefined, {}, `${E.slice(0, 8)}_${E.slice(9)}`]) expect(isUuid(bad), String(bad)).toBe(false);
  });
});

describe('parseLinks', () => {
  it('lê ligações válidas, na ordem', () => {
    expect(parseLinks([{ elementId: E, cableId: C }, { elementId: E, cableId: C2 }])).toEqual([{ elementId: E, cableId: C }, { elementId: E, cableId: C2 }]);
  });
  it('o que não é lista vira lista vazia', () => {
    for (const bad of [null, undefined, 'x', 5, {}, true]) expect(parseLinks(bad)).toEqual([]);
  });
  it('deixa de fora item que não é objeto, sem campo, com campo que não é uuid', () => {
    expect(parseLinks([null, 'x', 5, [], {}, { elementId: E }, { cableId: C }, { elementId: 'a', cableId: C }, { elementId: E, cableId: 'b' }, { elementId: 1, cableId: C }, { elementId: E, cableId: C }])).toEqual([{ elementId: E, cableId: C }]);
  });
  it('tira repetidas, mantém a primeira, e guarda só os dois campos', () => {
    const out = parseLinks([{ elementId: E, cableId: C, extra: 1 }, { elementId: E, cableId: C }]);
    expect(out).toEqual([{ elementId: E, cableId: C }]);
    expect(Object.keys(out[0]!)).toEqual(['elementId', 'cableId']);
  });
  it(`guarda no máximo ${MAX_LINKS}`, () => {
    const many = Array.from({ length: MAX_LINKS + 20 }, (_, i) => ({ elementId: E, cableId: `00000000-0000-4000-8000-${String(100000 + i).padStart(12, '0')}` }));
    expect(parseLinks(many)).toHaveLength(MAX_LINKS);
    expect(parseLinks(many.slice(0, MAX_LINKS))).toHaveLength(MAX_LINKS);
  });
});
