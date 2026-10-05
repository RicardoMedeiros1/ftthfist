import { describe, expect, it } from 'vitest';
import { classifyAccuracy, distanceMeters, formatAccuracy, formatMeters, nearestWithin, pathLengthMeters, round2 } from './geo';

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

// Referência independente: Vincenty inverso no elipsoide WGS-84 (o que a régua do Google Earth usa).
function vincenty(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = (1 - f) * a;
  const rad = Math.PI / 180;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * rad));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * rad));
  const L = (lon2 - lon1) * rad;
  let lam = L;
  let sinS = 0, cosS = 0, sig = 0, cosSqA = 0, cos2SM = 0;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam);
    sinS = Math.sqrt((Math.cos(U2) * sl) ** 2 + (Math.cos(U1) * Math.sin(U2) - Math.sin(U1) * Math.cos(U2) * cl) ** 2);
    if (sinS === 0) return 0;
    cosS = Math.sin(U1) * Math.sin(U2) + Math.cos(U1) * Math.cos(U2) * cl;
    sig = Math.atan2(sinS, cosS);
    const sinA = (Math.cos(U1) * Math.cos(U2) * sl) / sinS;
    cosSqA = 1 - sinA * sinA;
    cos2SM = cosSqA ? cosS - (2 * Math.sin(U1) * Math.sin(U2)) / cosSqA : 0;
    const C = (f / 16) * cosSqA * (4 + f * (4 - 3 * cosSqA));
    const prev = lam;
    lam = L + (1 - C) * f * sinA * (sig + C * sinS * (cos2SM + C * cosS * (-1 + 2 * cos2SM ** 2)));
    if (Math.abs(lam - prev) < 1e-12) break;
  }
  const uSq = (cosSqA * (a * a - b * b)) / (b * b);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const ds = B * sinS * (cos2SM + (B / 4) * (cosS * (-1 + 2 * cos2SM ** 2) - (B / 6) * cos2SM * (-3 + 4 * sinS ** 2) * (-3 + 4 * cos2SM ** 2)));
  return b * A * (sig - ds);
}

describe('referência Vincenty (validação do próprio teste)', () => {
  it('reproduz o valor publicado de Flinders Peak → Buninyong (54972,271 m)', () => {
    expect(vincenty(-37.95103341666667, 144.42486788888888, -37.65282113888889, 143.92649552777778)).toBeCloseTo(54972.271, 2);
  });
});

describe('pathLengthMeters', () => {
  const pt = (lat: number, lng: number) => ({ lat, lng });

  it('menos de 2 pontos não tem comprimento', () => {
    expect(pathLengthMeters([])).toBe(0);
    expect(pathLengthMeters([pt(-23.5, -46.6)])).toBe(0);
  });

  it('1 grau de latitude no Equador é ~111 km', () => {
    expect(pathLengthMeters([pt(0, 0), pt(1, 0)])).toBeGreaterThan(110_000);
    expect(pathLengthMeters([pt(0, 0), pt(1, 0)])).toBeLessThan(112_000);
  });

  // Critério da Fase 1B: bater com a régua do Google Earth (< 2%). O Turf é esférico; o erro real é ~0,6% no pior caso.
  const cases: [string, number, number, number, number][] = [
    ['N-S 100 m, lat -23,5', -23.5, -46.6, -23.5009, -46.6],
    ['L-O 100 m, lat -23,5', -23.5, -46.6, -23.5, -46.599],
    ['diagonal 1 km, lat -23,5', -23.5, -46.6, -23.507, -46.592],
    ['N-S 5 km perto do Equador', -3.0, -60.0, -3.045, -60.0],
    ['L-O 5 km, lat -30', -30, -51, -30, -50.948],
    ['N-S 50 m, lat 4 (Roraima)', 4.0, -60.6, 4.00045, -60.6],
  ];
  it.each(cases)('trecho único %s: diferença para o WGS-84 abaixo de 0,7%%', (_n, la1, lo1, la2, lo2) => {
    const ref = vincenty(la1, lo1, la2, lo2);
    const got = pathLengthMeters([pt(la1, lo1), pt(la2, lo2)]);
    expect(Math.abs(got - ref) / ref).toBeLessThan(0.007);
  });

  it('traçado de 5 postes andando na rua (~150 m): soma dos trechos a menos de 0,7% do WGS-84 e muito abaixo dos 2%', () => {
    const poles = [pt(-23.55, -46.63), pt(-23.5503, -46.6301), pt(-23.5506, -46.6303), pt(-23.5509, -46.6306), pt(-23.5511, -46.631)];
    let ref = 0;
    for (let i = 1; i < poles.length; i++) ref += vincenty(poles[i - 1]!.lat, poles[i - 1]!.lng, poles[i]!.lat, poles[i]!.lng);
    const got = pathLengthMeters(poles);
    expect(ref).toBeGreaterThan(100);
    expect(Math.abs(got - ref) / ref).toBeLessThan(0.007);
  });

  it('o comprimento não depende do sentido do traçado', () => {
    const line = [pt(-23.5, -46.6), pt(-23.502, -46.601), pt(-23.504, -46.6)];
    expect(pathLengthMeters([...line].reverse())).toBeCloseTo(pathLengthMeters(line), 6);
  });

  it('distanceMeters é o trecho entre dois pontos', () => {
    expect(distanceMeters(pt(0, 0), pt(0, 0.001))).toBeCloseTo(pathLengthMeters([pt(0, 0), pt(0, 0.001)]), 9);
  });
});

describe('nearestWithin (aderência do toque ao elemento)', () => {
  const items = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 120, y: 100 }, { id: 'c', x: 300, y: 300 }];
  it('pega o mais próximo dentro do raio', () => {
    expect(nearestWithin({ x: 112, y: 100 }, items, 25)?.id).toBe('b');
    expect(nearestWithin({ x: 105, y: 100 }, items, 25)?.id).toBe('a');
  });
  it('fora do raio devolve null', () => {
    expect(nearestWithin({ x: 200, y: 200 }, items, 25)).toBeNull();
    expect(nearestWithin({ x: 0, y: 0 }, [], 25)).toBeNull();
  });
  it('o limite é inclusivo (25 px exatos grudam)', () => {
    expect(nearestWithin({ x: 125, y: 100 }, [{ id: 'a', x: 100, y: 100 }], 25)?.id).toBe('a');
    expect(nearestWithin({ x: 125.1, y: 100 }, [{ id: 'a', x: 100, y: 100 }], 25)).toBeNull();
  });
});

describe('formatação de metros', () => {
  it('formato brasileiro com 1 casa', () => {
    expect(formatMeters(128.44)).toBe('128,4 m');
    expect(formatMeters(0)).toBe('0,0 m');
  });
  it('round2 arredonda para centímetros', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // o ruído que o round2 elimina
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(143.4449)).toBe(143.44);
  });
});
