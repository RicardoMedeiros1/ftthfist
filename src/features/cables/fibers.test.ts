import { describe, expect, it } from 'vitest';
import { COLOR_STANDARDS, DEFAULT_COLOR_STANDARD, FIBERS_PER_TUBE, FIBER_COLORS, STANDARD_LABEL, fiberGroups, fiberInfo, fiberLabel, fiberShort, isColorStandard, tubeCount } from './fibers';

const names = (s: 'abnt' | 'tia598') => FIBER_COLORS[s].map((c) => c.name);

describe('tabelas de cores', () => {
  it('ABNT: a sequência das 12 cores', () => {
    expect(names('abnt')).toEqual(['Verde', 'Amarelo', 'Branco', 'Azul', 'Vermelho', 'Violeta', 'Marrom', 'Rosa', 'Preto', 'Cinza', 'Laranja', 'Água']);
  });
  it('internacional (TIA-598): a sequência das 12 cores', () => {
    expect(names('tia598')).toEqual(['Azul', 'Laranja', 'Verde', 'Marrom', 'Cinza', 'Branco', 'Vermelho', 'Preto', 'Amarelo', 'Violeta', 'Rosa', 'Água']);
  });
  it('cada padrão usa as mesmas 12 cores, sem repetir, e cada cor tem um hex diferente', () => {
    for (const s of COLOR_STANDARDS) {
      expect(new Set(names(s)).size).toBe(12);
      expect(new Set(FIBER_COLORS[s].map((c) => c.hex)).size).toBe(12);
    }
    expect([...names('abnt')].sort()).toEqual([...names('tia598')].sort());
  });
  it('ABNT é o padrão; os dois têm nome na tela; só dois valores são válidos', () => {
    expect(DEFAULT_COLOR_STANDARD).toBe('abnt');
    expect(STANDARD_LABEL).toEqual({ abnt: 'ABNT', tia598: 'Internacional (TIA-598)' });
    expect(isColorStandard('abnt')).toBe(true);
    expect(isColorStandard('tia598')).toBe(true);
    expect(isColorStandard('ABNT')).toBe(false);
    expect(isColorStandard(undefined)).toBe(false);
    expect(isColorStandard(null)).toBe(false);
  });
});

describe('tubos', () => {
  it('até 12 fibras não tem tubo; acima, 12 fibras por tubo', () => {
    expect(FIBERS_PER_TUBE).toBe(12);
    expect([1, 2, 4, 6, 12].map(tubeCount)).toEqual([0, 0, 0, 0, 0]);
    expect([24, 36, 48, 72, 144].map(tubeCount)).toEqual([2, 3, 4, 6, 12]);
    expect(tubeCount(13)).toBe(2); // cabo fora da lista: o último tubo fica incompleto
  });
});

describe('fiberInfo', () => {
  it('cabo pequeno: só a cor, sem tubo', () => {
    expect(fiberInfo(12, 1)).toMatchObject({ number: 1, position: 1, color: { name: 'Verde' } });
    expect(fiberInfo(12, 1)!.tube).toBeUndefined();
    expect(fiberInfo(12, 12)).toMatchObject({ number: 12, position: 12, color: { name: 'Água' } });
    expect(fiberInfo(2, 2)).toMatchObject({ number: 2, color: { name: 'Amarelo' } });
  });
  it('a 12ª fibra é a última cor; a 13ª volta à primeira, no tubo 2', () => {
    const f12 = fiberInfo(24, 12)!;
    const f13 = fiberInfo(24, 13)!;
    expect([f12.color.name, f12.tube?.number, f12.tube?.color.name]).toEqual(['Água', 1, 'Verde']);
    expect([f13.color.name, f13.position, f13.tube?.number, f13.tube?.color.name]).toEqual(['Verde', 1, 2, 'Amarelo']);
  });
  it('cabo de 144: a fibra 144 é a última do tubo 12', () => {
    const f = fiberInfo(144, 144)!;
    expect([f.color.name, f.position, f.tube?.number, f.tube?.color.name]).toEqual(['Água', 12, 12, 'Água']);
    const g = fiberInfo(144, 133)!; // 1ª fibra do tubo 12
    expect([g.color.name, g.position, g.tube?.number]).toEqual(['Verde', 1, 12]);
  });
  it('o padrão escolhido muda as cores, não a posição', () => {
    expect(fiberInfo(12, 1, 'tia598')!.color.name).toBe('Azul');
    expect(fiberInfo(12, 2, 'tia598')!.color.name).toBe('Laranja');
    expect(fiberInfo(24, 13, 'tia598')!.tube?.color.name).toBe('Laranja'); // tubo 2
    expect(fiberInfo(12, 7, 'abnt')!.color.name).toBe('Marrom');
    expect(fiberInfo(12, 7, 'tia598')!.color.name).toBe('Vermelho');
  });
  it('mais de 12 tubos: as cores dos tubos recomeçam (cabo fora da lista, mas não pode dar erro)', () => {
    const f = fiberInfo(156, 145)!; // 1ª fibra do tubo 13
    expect([f.tube?.number, f.tube?.color.name, f.color.name]).toEqual([13, 'Verde', 'Verde']);
  });
  it('fibra que não existe no cabo = null', () => {
    expect(fiberInfo(12, 0)).toBeNull();
    expect(fiberInfo(12, 13)).toBeNull();
    expect(fiberInfo(2, 3)).toBeNull();
    expect(fiberInfo(12, 1.5)).toBeNull();
    expect(fiberInfo(12, -1)).toBeNull();
    expect(fiberInfo(12, NaN)).toBeNull();
  });
});

describe('textos', () => {
  it('fiberLabel e fiberShort', () => {
    expect(fiberLabel(fiberInfo(12, 7)!)).toBe('Fibra 7 · Marrom');
    expect(fiberLabel(fiberInfo(48, 19)!)).toBe('Fibra 19 · Marrom · Tubo 2 Amarelo');
    expect(fiberShort(fiberInfo(12, 7)!)).toBe('7 Marrom');
    expect(fiberShort(fiberInfo(48, 19)!)).toBe('19 Marrom, tubo 2 Amarelo');
  });
});

describe('fiberGroups', () => {
  it('cabo sem tubo: uma lista só, sem tubo', () => {
    const g = fiberGroups(6);
    expect(g).toHaveLength(1);
    expect(g[0]!.tube).toBeUndefined();
    expect(g[0]!.fibers.map((f) => f.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('cabo com tubos: um grupo por tubo, 12 fibras cada, na ordem', () => {
    const g = fiberGroups(36);
    expect(g.map((x) => x.tube?.number)).toEqual([1, 2, 3]);
    expect(g.map((x) => x.tube?.color.name)).toEqual(['Verde', 'Amarelo', 'Branco']);
    expect(g.every((x) => x.fibers.length === 12)).toBe(true);
    expect(g[2]!.fibers[0]!.number).toBe(25);
    expect(g[2]!.fibers.at(-1)!.number).toBe(36);
  });
  it('todas as fibras aparecem uma vez, em qualquer tamanho de cabo', () => {
    for (const n of [1, 2, 4, 6, 12, 24, 36, 48, 72, 144]) {
      const all = fiberGroups(n).flatMap((x) => x.fibers.map((f) => f.number));
      expect(all).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});
